#!/usr/bin/env python3
"""Make the FrameCrop sample clip: a synthesized "talking" voice with pauses of
different lengths over faint room tone, an animated background, captions and a
live waveform. Pauses are what Remove Silence is meant to find.

Needs numpy and ffmpeg (with drawtext). Run:  python3 apps/framecrop/samples/make_sample.py
Writes sample-talk.mp4 and sample-talk.js (for one-click loading) next to this script.
"""
import base64
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 48000
HERE = Path(__file__).resolve().parent
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
rng = np.random.default_rng(7)

# (caption, pause after it in seconds). Pause lengths vary so the threshold and
# minimum-length settings make a visible difference.
SCRIPT = [
    ('Hi! This is the FrameCrop sample clip.', 0.9),
    ('It is made for testing your edits.', 0.35),
    ('Notice the pauses between the lines.', 1.6),
    ('Remove Silence finds them for you.', 0.6),
    ('Raise the threshold to cut more.', 2.4),
    ('Lower it to keep the quiet breaths.', 1.1),
    ('Padding keeps a little air around each line.', 0.5),
    ('Then ripple delete closes every gap.', 3.0),
    ('Try it from the Sequence menu.', 0.8),
    ('Thanks for watching!', 1.5),
]

# Rough vowel formants (Hz): F1, F2, F3.
VOWELS = [(730, 1090, 2440), (530, 1840, 2480), (270, 2290, 3010), (570, 840, 2410), (300, 870, 2240), (660, 1720, 2410)]


def syllable(dur, f0, vowel, amp):
    n = int(dur * SR)
    t = np.arange(n) / SR
    # Slight pitch movement within the syllable.
    contour = f0 * (1 + 0.06 * np.sin(np.pi * t / dur) - 0.04 * t / dur)
    phase = 2 * np.pi * np.cumsum(contour) / SR
    sig = np.zeros(n)
    f1, f2, f3 = vowel
    for k in range(1, 40):
        fk = k * f0
        if fk > 5000:
            break
        gain = (np.exp(-((fk - f1) / 140) ** 2) + 0.7 * np.exp(-((fk - f2) / 180) ** 2) + 0.3 * np.exp(-((fk - f3) / 250) ** 2)) / k ** 0.3
        sig += gain * np.sin(k * phase)
    # Consonant at the start of most syllables.
    if rng.random() < 0.7:
        m = min(n, int(SR * rng.uniform(0.02, 0.06)))
        burst = np.diff(rng.standard_normal(m + 1)) * np.linspace(1, 0, m) * 0.35
        sig[:m] += burst
    env = np.ones(n)
    a, r = int(0.015 * SR), int(0.045 * SR)
    env[:a] = np.linspace(0, 1, a)
    env[-r:] *= np.linspace(1, 0, r)
    return sig * env * amp


def phrase(text):
    words = text.split()
    parts = []
    base = rng.uniform(115, 150)
    for wi, word in enumerate(words):
        sylls = max(1, round(len(word.strip('!.,')) / 3))
        for si in range(sylls):
            # Pitch falls across the phrase, like a statement.
            f0 = base * (1.1 - 0.25 * (wi / max(1, len(words) - 1))) * rng.uniform(0.95, 1.05)
            parts.append(syllable(rng.uniform(0.12, 0.22), f0, VOWELS[rng.integers(len(VOWELS))], rng.uniform(0.6, 1.0)))
        parts.append(np.zeros(int(SR * rng.uniform(0.02, 0.07))))
    return np.concatenate(parts)


def room_tone(n, db_rms):
    # Soft hiss scaled by its RMS level (peaks land roughly 10 dB higher).
    hiss = np.convolve(rng.standard_normal(n), np.ones(8) / 8, mode='same')
    return hiss / np.sqrt(np.mean(hiss ** 2)) * 10 ** (db_rms / 20)


def main():
    lead = 0.6
    pieces = [np.zeros(int(lead * SR))]
    cues = []
    t = lead
    for i, (text, pause) in enumerate(SCRIPT):
        voice = phrase(text)
        voice *= 10 ** (-6 / 20) / np.max(np.abs(voice))
        cues.append({'text': text, 'start': round(t, 3), 'end': round(t + len(voice) / SR, 3)})
        pieces.append(voice)
        t += len(voice) / SR
        gap = np.zeros(int(pause * SR))
        # A soft breath in some of the longer pauses (about -30 dBFS).
        if pause > 1 and i % 2 == 0:
            m = int(0.28 * SR)
            breath = rng.standard_normal(m) * np.hanning(m) * 10 ** (-36 / 20)
            start = int(len(gap) * 0.4)
            gap[start:start + m] += breath[: len(gap) - start]
        pieces.append(gap)
        t += pause
    audio = np.concatenate(pieces)
    # Room tone like a real mic in a quiet room (-54 dBFS RMS): thresholds below it find nothing.
    audio += room_tone(len(audio), -54)
    audio = np.clip(audio, -1, 1)
    duration = len(audio) / SR

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        wav = tmp / 'voice.wav'
        with wave.open(str(wav), 'wb') as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            pcm = (audio * 32767).astype('<i2')
            w.writeframes(np.column_stack([pcm, pcm]).tobytes())

        texts = []
        for i, cue in enumerate(cues):
            f = tmp / f'cue{i}.txt'
            f.write_text(cue['text'])
            texts.append(
                f"drawtext=fontfile={FONT}:textfile={f}:fontsize=44:fontcolor=white:borderw=3:bordercolor=black@0.6:"
                f"x=(w-text_w)/2:y=h*0.42:enable='between(t,{cue['start']},{cue['end']})'"
            )
        title = tmp / 'title.txt'
        title.write_text('FrameCrop sample')
        hint = tmp / 'hint.txt'
        hint.write_text('pause')
        speaking = '+'.join(f"between(t,{c['start']},{c['end']})" for c in cues)
        overlays = ','.join([
            f"drawtext=fontfile={FONT}:textfile={title}:fontsize=26:fontcolor=white@0.85:x=40:y=36",
            "drawtext=fontfile=" + FONT + ":text='%{pts\\:hms}':fontsize=22:fontcolor=white@0.7:x=w-tw-40:y=40",
            f"drawtext=fontfile={FONT}:textfile={hint}:fontsize=30:fontcolor=white@0.45:x=(w-text_w)/2:y=h*0.42:enable='not({speaking})'",
            *texts,
        ])
        graph = (
            f"[0:v]format=yuv420p[bg];"
            f"[1:a]asplit[a1][a2];"
            f"[a2]showwaves=s=1280x150:mode=cline:rate=30:colors=0xffffff@0.85:scale=sqrt[w];"
            f"[bg][w]overlay=0:H-h-50,{overlays}[v]"
        )
        out = HERE / 'sample-talk.mp4'
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', f'gradients=s=1280x720:r=30:c0=0x3a1c71:c1=0xd76d77:c2=0xffaf7b:n=3:speed=0.008:d={duration:.3f}',
            '-i', str(wav),
            '-filter_complex', graph, '-map', '[v]', '-map', '[a1]',
            '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-g', '30', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', str(out),
        ], check=True)

    data = base64.b64encode(out.read_bytes()).decode()
    (HERE / 'sample-talk.js').write_text(
        '// Generated by make_sample.py so FrameCrop can load the sample without file access.\n'
        f'window.FRAMECROP_SAMPLES = window.FRAMECROP_SAMPLES || {{}};\nwindow.FRAMECROP_SAMPLES["sample-talk.mp4"] = "data:video/mp4;base64,{data}";\n'
    )
    (HERE / 'sample-talk.json').write_text(json.dumps({'duration': round(duration, 3), 'speech': cues}, indent=1))
    print(f'{out.name}: {duration:.1f}s, {out.stat().st_size / 1e6:.2f} MB; {len(cues)} lines')


if __name__ == '__main__':
    main()
