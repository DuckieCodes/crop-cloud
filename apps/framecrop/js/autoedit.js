// AI Edit: Claude plans a montage from your clips and music, FrameCrop builds it
// on the timeline as a preview, and you keep it or throw it away.
//
// Claude can't watch video, so FrameCrop prepares what it needs here: frames
// sampled from each clip, how much the picture moves and how loud it is each
// second, and the music's beats, bars and big changes. Claude answers with an
// edit plan (shots cut to beats, transitions, effects, a look, titles) that is
// checked against the real clip lengths and then built on the timeline.

const AI_SETTINGS_KEY = 'framecrop.ai';
const AI_FRAME_BUDGET = 48;          // frames sent to Claude across all clips
const AI_FRAME_WIDTH = 512;
const AI_KEYS_URL = 'https://console.anthropic.com/settings/keys';

const AI_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'best edits', price: [4, 20], effort: 'high', fallbacks: true },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'faster, about half the price', price: [2, 10], effort: 'high', fallbacks: true },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'quickest and cheapest', price: [0.1, 0.5], effort: 'medium', fallbacks: false },
];

const AI_STYLES = [
  ['Hype', 'High-energy hype montage: fast cuts on the beat, punch-in zooms on hits, a flash on the drop, the most exciting moments first.'],
  ['Cinematic', 'Cinematic: longer shots, slow motion on the best moments, smooth dissolves in calm parts, a filmic color look, build up to the drop.'],
  ['Chill', 'Chill and relaxed: unhurried shots that breathe, gentle slow zooms, soft transitions, warm look.'],
  ['Gaming', 'Gaming montage: cut hard on every hit, speed changes on big plays, punchy zooms and flashes, end on the best play.'],
  ['Emotional', 'Emotional: slow motion, dissolves, let shots linger, black-and-white or faded look for the quiet part, end on a meaningful moment.'],
  ['Vlog', 'Vlog style: natural pacing, keep the important clip audio low under the music, simple cuts, a caption title at the start.'],
];

const AI_TRANSITIONS = { 'cross-dissolve': 'cross-dissolve', 'dip-black': 'dip-black', flash: 'dip-white', zoom: 'zoom', push: 'push', slide: 'slide', wipe: 'wipe-left' };
const AI_EFFECTS = ['none', 'punch-in', 'zoom-in', 'zoom-out', 'black-and-white', 'glow', 'vignette', 'grain'];

// The edit plan Claude must return (structured output: every field required, no extras).
const AI_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'music_start_beat', 'look', 'shots', 'titles'],
  properties: {
    title: { type: 'string', description: 'A short name for this edit.' },
    summary: { type: 'string', description: 'Two or three friendly sentences to the user: what the edit does and why.' },
    music_start_beat: { type: 'integer', description: 'Beat number in the song where the edit starts. 0 when there is no music.' },
    look: { type: 'string', enum: ['none', ...Object.keys(LOOKS)], description: 'Color look for every shot.' },
    shots: {
      type: 'array',
      description: 'Shots in timeline order. They play back to back with no gaps.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clip', 'source_start', 'length', 'speed', 'transition', 'effect', 'clip_audio', 'why'],
        properties: {
          clip: { type: 'string', description: 'Clip id, for example "c3".' },
          source_start: { type: 'number', description: 'Seconds into the clip where the shot begins.' },
          length: { type: 'number', description: 'Shot length: in beats when there is music, in seconds when there is none.' },
          speed: { type: 'number', description: '1 is normal. 0.5 is half-speed slow motion, 2 is double speed.' },
          transition: { type: 'string', enum: ['cut', ...Object.keys(AI_TRANSITIONS)], description: 'How this shot comes in.' },
          effect: { type: 'string', enum: AI_EFFECTS },
          clip_audio: { type: 'string', enum: ['mute', 'low', 'full'], description: 'The clip\'s own sound under the music.' },
          why: { type: 'string', description: 'A few words on why this shot goes here.' },
        },
      },
    },
    titles: {
      type: 'array',
      description: 'On-screen text. Empty unless the user asked for text or the style needs it.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'at', 'length', 'style'],
        properties: {
          text: { type: 'string' },
          at: { type: 'number', description: 'When it appears, from the start of the edit: beats with music, seconds without.' },
          length: { type: 'number', description: 'How long it stays: beats with music, seconds without.' },
          style: { type: 'string', enum: ['big-center', 'lower-third', 'caption'] },
        },
      },
    },
  },
};

const AI_SYSTEM_PROMPT = `You are the editor inside FrameCrop, a video editing app. The user picked some clips (and usually a song) and wants them cut into a montage in their style. Plan the edit; FrameCrop builds it on the timeline for them to review.

You can't watch the video, so for each clip you get frames sampled at the times shown, a motion curve (how much the picture changes each second, 0 = still, 9 = the fastest in this set) and a loudness curve of the clip's own sound. For the music you get every beat's time, where the bars start, the energy of each bar and where the big changes (drops) are.

How to cut a montage that feels good:
- With music, cut on the beat. Use whole beats; lengths of 1, 2 or 4 beats feel natural, half beats only for rapid hits. Change pace on bar lines and put a strong shot right on each drop.
- Match the music's energy: longer, calmer shots in quiet parts, quicker cuts and high-motion moments when the energy is high.
- Start each shot at the interesting part of its clip: use the motion curve and the frames to find action, faces and clear moments. Avoid black, blank or blurry frames and the very start and end of clips.
- Don't show the same moment twice. Reusing a clip at a different moment is fine when there isn't enough footage.
- Open with something that grabs attention. End on a strong shot, ideally where a musical phrase ends.
- Every shot must fit inside its clip: source_start + (length in seconds × speed) has to be within the clip's duration.
- Most cuts should be hard cuts. "flash" suits drops and hits; dissolves suit calm or emotional parts. Use other transitions sparingly.
- Slow motion (0.5–0.8) makes impressive moments land in calm or emotional parts. Speed above 1 is for filler only.
- Effects: "punch-in" on hits, "zoom-in"/"zoom-out" add slow movement to calm shots. Keep them purposeful.
- clip_audio: "mute" when the music carries the edit; "low" or "full" only to let an important sound through.
- Only add titles when the user asked for text or the style clearly needs it.
- Follow the user's own style notes over these defaults, and use only the features they left switched on.

Write the summary to the user in plain, friendly words.`;

// ---------- Settings ----------
const AIEdit = {
  settings: { apiKey: '', model: AI_MODELS[0].id, style: '', length: 'auto', place: 'auto', transitions: true, effects: true, look: true, titles: false, baseURL: '' },

  loadSettings() {
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(AI_SETTINGS_KEY)) || {}); } catch { /* first run */ }
    if (!AI_MODELS.some((m) => m.id === this.settings.model)) this.settings.model = AI_MODELS[0].id;
  },

  saveSettings() {
    try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage blocked */ }
  },

  model() { return AI_MODELS.find((m) => m.id === this.settings.model) || AI_MODELS[0]; },
};
AIEdit.loadSettings();

// ---------- Looking at the footage ----------
const AIAnalyze = {
  // Frames for Claude plus a per-second motion curve. The clip plays through at
  // high speed while frames are sampled (much faster than seeking around), with
  // seeking as the fallback where playback isn't possible.
  async video(item, frameCount, onStep) {
    const rt = MediaRT.get(item.id);
    const dur = item.duration;
    const el = document.createElement('video');
    el.muted = true;
    el.preload = 'auto';
    el.src = rt.url;
    await waitEvent(el, 'loadeddata', 'error', 15000);

    const every = 1 / clamp(120 / dur, 1, 4);
    const frameTimes = Array.from({ length: frameCount }, (_, i) => ((i + 0.5) / frameCount) * dur);
    const tiny = makeCanvas(32, 18);
    const tx = ctxOf(tiny);
    const big = makeCanvas(AI_FRAME_WIDTH, Math.round((AI_FRAME_WIDTH * item.height) / item.width / 2) * 2);
    const bx = ctxOf(big);
    const frames = [];
    const diffs = [];
    let prev = null;
    const grabFrame = (t) => {
      bx.drawImage(el, 0, 0, big.width, big.height);
      frames.push({ t: +t.toFixed(2), data: big.toDataURL('image/jpeg', 0.72).split(',')[1] });
    };
    const sample = (t) => {
      tx.drawImage(el, 0, 0, 32, 18);
      const px = tx.getImageData(0, 0, 32, 18).data;
      const gray = new Float32Array(32 * 18);
      for (let p = 0; p < gray.length; p++) gray[p] = px[p * 4] * 0.299 + px[p * 4 + 1] * 0.587 + px[p * 4 + 2] * 0.114;
      if (prev && t > prev.t) {
        let d = 0;
        for (let p = 0; p < gray.length; p++) d += Math.abs(gray[p] - prev.gray[p]);
        diffs.push({ t, v: d / gray.length / Math.max(0.1, t - prev.t) });
      }
      prev = { t, gray };
      if (frames.length < frameTimes.length && t >= frameTimes[frames.length] - 0.05) grabFrame(t);
      onStep?.(Math.min(1, t / dur));
    };

    const lastT = 'requestVideoFrameCallback' in el ? await playThrough(el, every, sample) : 0;
    for (let t = lastT + every; t < dur - 0.05; t += every) {
      await seekTo(el, t);
      sample(t);
    }
    // Any frames playback skipped past (decoders drop frames at 8x speed).
    for (let i = frames.length; i < frameTimes.length; i++) {
      await seekTo(el, Math.min(frameTimes[i], dur - 0.04));
      grabFrame(frameTimes[i]);
    }
    frames.sort((a, b) => a.t - b.t);
    el.removeAttribute('src');
    el.load();
    // Average motion per whole second (normalized later against all clips).
    const perSec = Array.from({ length: Math.max(1, Math.ceil(dur)) }, (_, sec) => {
      const inSec = diffs.filter((d) => d.t >= sec && d.t < sec + 1);
      return inSec.length ? inSec.reduce((a, d) => a + d.v, 0) / inSec.length : 0;
    });
    return { frames, motion: perSec };
  },

  image(item) {
    const rt = MediaRT.get(item.id);
    const h = Math.round((AI_FRAME_WIDTH * item.height) / item.width / 2) * 2;
    const c = makeCanvas(AI_FRAME_WIDTH, h);
    ctxOf(c).drawImage(rt.image, 0, 0, c.width, c.height);
    return { frames: [{ t: 0, data: c.toDataURL('image/jpeg', 0.72).split(',')[1] }], motion: [0] };
  },

  // Loudness of a clip's own sound per second, 0 (silent) – 9 (loud).
  loudness(item) {
    const peaks = MediaRT.get(item.id)?.peaks;
    if (!peaks) return null;
    const out = [];
    for (let s = 0; s * PEAKS_PER_SEC < peaks.length; s++) {
      let m = 0;
      for (let i = s * PEAKS_PER_SEC; i < Math.min(peaks.length, (s + 1) * PEAKS_PER_SEC); i++) m = Math.max(m, peaks[i]);
      const db = m > 0 ? 20 * Math.log10(m) : -100;
      out.push(clamp(Math.round(((db + 50) / 50) * 9), 0, 9));
    }
    return out;
  },

  // Tempo, beats, bars, energy and drops of a song.
  async music(item) {
    const buf = await Media.audioBuffer(item.id);
    return analyzeBeats(buf);
  },
};

// Play a muted clip at 8x, calling sample(mediaTime) about every `every` seconds of
// video. Resolves with the last sampled time (the clip end when it played through).
function playThrough(el, every, sample) {
  return new Promise((resolve) => {
    let last = -Infinity, stall = 0;
    const finish = () => { clearTimeout(stall); el.pause(); resolve(Number.isFinite(last) ? last : 0); };
    const arm = () => { clearTimeout(stall); stall = setTimeout(finish, 4000); };
    const onFrame = (now, meta) => {
      if (meta.mediaTime - last >= every * 0.95) {
        last = meta.mediaTime;
        sample(meta.mediaTime);
      }
      arm();
      if (!el.ended) el.requestVideoFrameCallback(onFrame);
    };
    el.addEventListener('ended', () => { last = el.duration; finish(); }, { once: true });
    el.playbackRate = 8;
    el.requestVideoFrameCallback(onFrame);
    arm();
    el.play().catch(finish);
  });
}

function analyzeBeats(buf) {
  const sr = buf.sampleRate, n = buf.length, chs = buf.numberOfChannels;
  const mono = new Float32Array(n);
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / chs;
  }
  const hop = Math.round(sr / 100); // 10 ms frames
  const frames = Math.floor(n / hop);
  const lowE = new Float32Array(frames), fullE = new Float32Array(frames);
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  let lp = 0;
  for (let f = 0; f < frames; f++) {
    let sl = 0, sf = 0;
    for (let i = f * hop, e = i + hop; i < e; i++) {
      const x = mono[i];
      lp += a * (x - lp);
      sl += lp * lp;
      sf += x * x;
    }
    lowE[f] = sl / hop;
    fullE[f] = sf / hop;
  }
  // Onset strength: jumps in loudness, with the bass band (kicks) weighted up.
  const lg = (v) => Math.log10(v + 1e-9);
  const raw = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    raw[f] = 0.6 * Math.max(0, lg(lowE[f]) - lg(lowE[f - 1])) + 0.4 * Math.max(0, lg(fullE[f]) - lg(fullE[f - 1]));
  }
  const onset = new Float32Array(frames);
  const W = 25;
  let run = 0;
  for (let f = 0; f < frames; f++) {
    run += raw[f] - (f >= 2 * W + 1 ? raw[f - 2 * W - 1] : 0);
    const mean = run / Math.min(f + 1, 2 * W + 1);
    onset[f] = Math.max(0, raw[f] - mean);
  }
  const at = (t) => {
    const f = Math.round(t * 100);
    let m = 0;
    for (let k = f - 1; k <= f + 1; k++) if (k >= 0 && k < frames) m = Math.max(m, onset[k]);
    return m;
  };

  // Tempo: autocorrelation of the onset curve, gently preferring ~120 BPM.
  let bestLag = 50, bestScore = -Infinity;
  const ac = (lag) => { let s = 0; for (let f = 0; f + lag < frames; f++) s += onset[f] * onset[f + lag]; return s / (frames - lag); };
  for (let lag = 33; lag <= 86; lag++) {
    const bpm = 6000 / lag;
    const s = ac(lag) * Math.exp(-0.5 * (Math.log2(bpm / 120) / 1) ** 2);
    if (s > bestScore) { bestScore = s; bestLag = lag; }
  }
  // Refine period and phase together by lining a beat comb up with the onsets.
  const duration = n / sr;
  let period = bestLag / 100, phase = 0, best = -Infinity;
  for (let p = period * 0.97; p <= period * 1.03; p += 0.0005) {
    for (let ph = 0; ph < p; ph += 0.01) {
      let s = 0;
      for (let t = ph; t < duration; t += p) s += at(t);
      if (s > best) { best = s; period = p; phase = ph; }
    }
  }
  // Beat grid, nudged to nearby strong onsets so slightly loose playing still lines up.
  const strong = [...onset].sort((x, y) => y - x)[Math.floor(frames * 0.02)] || 0;
  const beats = [];
  for (let t = phase; t < duration; t += period) {
    let bt = t, bv = 0;
    for (let f = Math.round((t - 0.025) * 100); f <= Math.round((t + 0.025) * 100); f++) {
      if (f >= 0 && f < frames && onset[f] > bv) { bv = onset[f]; bt = f / 100; }
    }
    beats.push(+(bv >= strong * 0.5 ? bt : t).toFixed(3));
  }
  // Energy per beat (0–9 across the song).
  const beatDb = beats.map((t, i) => {
    const s = Math.floor(t * sr), e = Math.min(n, Math.floor((beats[i + 1] ?? t + period) * sr));
    let sum = 0;
    for (let k = s; k < e; k++) sum += mono[k] * mono[k];
    return 10 * Math.log10(sum / Math.max(1, e - s) + 1e-10);
  });
  const sorted = [...beatDb].sort((x, y) => x - y);
  const lo = sorted[Math.floor(sorted.length * 0.05)] ?? -60, hi = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const beatEnergy = beatDb.map((db) => clamp(Math.round(((db - lo) / Math.max(1, hi - lo)) * 9), 0, 9));
  // Downbeats: the beat-in-bar position with the most bass onset (kicks and chord changes).
  let down = 0, downBest = -1;
  for (let q = 0; q < 4; q++) {
    let s = 0;
    for (let i = q; i < beats.length; i += 4) {
      const f = Math.round(beats[i] * 100);
      for (let k = f - 2; k <= f + 2; k++) if (k > 0 && k < frames) s += Math.max(0, lg(lowE[k]) - lg(lowE[k - 1]));
    }
    if (s > downBest) { downBest = s; down = q; }
  }
  const bars = [];
  for (let b = down; b < beats.length; b += 4) {
    const e = beatEnergy.slice(b, b + 4);
    bars.push({ beat: b, energy: Math.round(e.reduce((x, y) => x + y, 0) / e.length) });
  }
  // A drop: a bar clearly louder than both bars before it.
  const drops = bars.filter((bar, i) => i >= 2 && bar.energy - Math.max(bars[i - 1].energy, bars[i - 2].energy) >= 2).map((bar) => bar.beat);
  return { duration, bpm: 60 / period, period, beats, beatEnergy, bars, drops };
}

// ---------- Talking to Claude ----------
function aiFormatMusic(music, name) {
  const beatList = music.beats.map((t, i) => `${i}:${t.toFixed(2)}`).join(' ');
  return [
    `Music "${name}": ${music.duration.toFixed(1)} s, about ${Math.round(music.bpm)} BPM (one beat = ${music.period.toFixed(3)} s), ${music.beats.length} beats.`,
    `Beat times in seconds (beat:time): ${beatList}`,
    `Bars start on beats: ${music.bars.map((b) => b.beat).join(', ')}`,
    `Energy per bar, in order (0 quiet – 9 loudest): ${music.bars.map((b) => b.energy).join(' ')}`,
    music.drops.length ? `Big changes (drops) at beats: ${music.drops.map((b) => `${b} (${music.beats[b].toFixed(2)} s)`).join(', ')}` : 'No sudden drops; the energy changes gradually.',
  ].join('\n');
}

function aiBuildContent(job) {
  const s = AIEdit.settings;
  const off = [!s.transitions && 'transitions (use "cut" only)', !s.effects && 'effects (use "none" only)', !s.look && 'the color look (use "none")', !s.titles && 'titles (leave the list empty)'].filter(Boolean);
  const target = job.length === 'auto' ? 'Choose a length that suits the footage and the music.'
    : job.length === 'song' ? 'Use the whole song.' : `Aim for about ${job.length} seconds (finishing on the nearest bar line is fine).`;
  const content = [{
    type: 'text',
    text: [
      `Style the user asked for: ${job.style.trim() || 'Make it look good. Choose a style that suits the footage and music.'}`,
      target,
      off.length ? `Switched off by the user: ${off.join('; ')}.` : 'Transitions, effects, a color look and titles are all allowed.',
      job.music ? 'Shot lengths and title timings are in beats.' : 'There is no music: shot lengths and title timings are in seconds, and music_start_beat is 0.',
      `Sequence: ${Model.seq.width}×${Model.seq.height} at ${Model.fps} fps.`,
      '',
      'Clips:',
    ].join('\n'),
  }];
  for (const c of job.clips) {
    content.push({
      type: 'text',
      text: [
        `${c.id}: "${c.item.name}", ${c.item.kind === 'image' ? 'still image (any length, speed must be 1)' : `${c.item.duration.toFixed(2)} s long`}, ${c.item.width}×${c.item.height}${c.item.hasAudio ? ', has sound' : ', no sound'}`,
        c.item.kind === 'image' ? '' : `Motion per second (0–9): ${c.motion.join('')}`,
        c.loudness ? `Loudness per second (0–9): ${c.loudness.join('')}` : '',
        'Frames:',
      ].filter(Boolean).join('\n'),
    });
    for (const f of c.frames) {
      content.push({ type: 'text', text: `${c.id} at ${f.t.toFixed(1)} s` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.data } });
    }
  }
  if (job.music) content.push({ type: 'text', text: aiFormatMusic(job.music, job.musicItem.name) });
  content.push({ type: 'text', text: 'Plan the edit.' });
  return content;
}

// Rough cost of one try, for the setup dialog.
function aiEstimate(frameCount) {
  const m = AIEdit.model();
  const input = frameCount * ((AI_FRAME_WIDTH * 288) / 750) + 6000;
  const output = 9000;
  return (input * m.price[0] + output * m.price[1]) / 1e6;
}

const AIClaude = {
  client() {
    const s = AIEdit.settings;
    return new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, ...(s.baseURL ? { baseURL: s.baseURL } : {}) });
  },

  // Stream one planning request. onEvent receives { thinking } and { shots } progress.
  async plan(messages, { signal, onEvent }) {
    const m = AIEdit.model();
    const params = {
      model: m.id,
      max_tokens: 64000,
      system: AI_SYSTEM_PROMPT,
      messages,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: m.effort, format: { type: 'json_schema', schema: AI_PLAN_SCHEMA } },
      cache_control: { type: 'ephemeral' },
      ...(m.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };
    try {
      return await this.run(params, signal, onEvent);
    } catch (err) {
      // An account or region without the optional extras still gets an edit.
      if (err instanceof Anthropic.BadRequestError && (params.fallbacks || params.cache_control)) {
        const { betas, fallbacks, cache_control, ...plain } = params;
        return this.run(plain, signal, onEvent);
      }
      throw err;
    }
  },

  async run(params, signal, onEvent) {
    const stream = AIClaude.client().beta.messages.stream(params, { signal });
    let text = '';
    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'thinking_delta') onEvent?.({ thinking: event.delta.thinking });
      if (event.delta.type === 'text_delta') {
        text += event.delta.text;
        onEvent?.({ shots: (text.match(/"clip"\s*:/g) || []).length });
      }
    }
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      throw new Error(`Claude declined to plan this edit${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'}`);
    }
    if (message.stop_reason === 'max_tokens') throw new Error('The plan was cut off before it finished. Try fewer clips or a shorter length.');
    const block = message.content.find((b) => b.type === 'text');
    if (!block) throw new Error('Claude didn\'t return an edit plan. Please try again.');
    let plan;
    try { plan = JSON.parse(block.text); } catch { throw new Error('The edit plan came back damaged. Please try again.'); }
    return { plan, message };
  },

  friendly(err) {
    if (err instanceof Anthropic.APIUserAbortError) return null;
    if (err instanceof Anthropic.AuthenticationError) return 'That API key didn\'t work. Open AI Edit and choose "Change API key" to paste it again.';
    if (err instanceof Anthropic.PermissionDeniedError) return 'This API key isn\'t allowed to use that model.';
    if (err instanceof Anthropic.RateLimitError) return 'Claude is getting a lot of requests from this key right now. Wait a minute and try again.';
    if (err instanceof Anthropic.BadRequestError) return `Claude couldn't take this request: ${err.message}`;
    if (err instanceof Anthropic.InternalServerError) return 'Claude is busy right now. Please try again in a moment.';
    if (err instanceof Anthropic.APIConnectionError) return 'Can\'t reach Claude. Check your internet connection.';
    if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status}). Please try again.`;
    return err?.message || 'Something went wrong.';
  },
};

// ---------- Building the edit ----------
// Turn a plan into clips. Returns what to add, or throws when nothing usable is left.
function aiBuildClips(plan, job, from) {
  const fps = Model.fps;
  const s = AIEdit.settings;
  const music = job.music;
  const warnings = [];
  const byId = new Map(job.clips.map((c) => [c.id, c]));
  const startBeat = music ? clamp(Math.round(plan.music_start_beat) || 0, 0, music.beats.length - 1) : 0;
  const beatAt = (k) => (k < music.beats.length ? music.beats[k] : music.beats[music.beats.length - 1] + (k - music.beats.length + 1) * music.period);
  // Seconds from the start of the edit at a position given in beats (or seconds without music).
  const timeAt = (x) => {
    if (!music) return x;
    const k = startBeat + x, i = Math.floor(k);
    return beatAt(i) + (beatAt(i + 1) - beatAt(i)) * (k - i) - beatAt(startBeat);
  };
  const frameAt = (x) => from + Math.round(timeAt(x) * fps);
  const beatFrames = music ? Math.round(music.period * fps) : fps;

  const vt = Model.tracks('video').filter((t) => !t.locked);
  const at = Model.tracks('audio').filter((t) => !t.locked);
  const shotTrack = vt[0] || Ops.addTrack('video');
  const titleTrack = vt[1] || Ops.addTrack('video');

  const clips = [];
  const shots = [];
  let cursor = 0;
  for (const shot of plan.shots || []) {
    const src = byId.get(shot.clip);
    const len = Number(shot.length);
    if (!src || !(len > 0)) { warnings.push(`Skipped a shot that pointed at "${shot.clip}"`); continue; }
    const start = frameAt(cursor), end = frameAt(cursor + len);
    cursor += len;
    const duration = end - start;
    if (duration < 1) continue;
    const item = src.item;
    const lenSec = duration / fps;
    let speed = item.kind === 'image' ? 1 : clamp(Number(shot.speed) || 1, 0.25, 4);
    let srcStart = item.kind === 'image' ? 0 : clamp(Number(shot.source_start) || 0, 0, item.duration);
    if (item.kind !== 'image') {
      // Keep the shot inside the clip: slide it back, then slow it down if it still doesn't fit.
      if (srcStart + lenSec * speed > item.duration) srcStart = Math.max(0, item.duration - lenSec * speed - 0.02);
      if (lenSec * speed > item.duration) {
        speed = Math.max(0.25, (item.duration - 0.04) / lenSec);
        srcStart = 0;
        warnings.push(`Slowed down ${item.name} so the shot fits`);
      }
    }
    const linkId = shot.clip_audio !== 'mute' && item.hasAudio ? uid() : null;
    const v = makeClip(item.kind === 'image' ? 'image' : 'video', { trackId: shotTrack.id, mediaId: item.id, name: item.name, start, duration, offset: srcStart, linkId });
    v.speed = speed;
    const trans = s.transitions ? AI_TRANSITIONS[shot.transition] : null;
    if (trans) {
      const max = Math.max(2, Math.floor(duration * 0.8));
      const len = shot.transition === 'flash' ? Math.min(6, beatFrames / 2) : shot.transition === 'cross-dissolve' || shot.transition === 'dip-black' ? beatFrames : beatFrames / 2;
      v.transIn = { type: trans, duration: clamp(Math.round(len), 2, max) };
    }
    if (s.effects) aiApplyEffect(v, shot.effect, duration);
    if (s.look && plan.look && plan.look !== 'none' && LOOKS[plan.look]) applyLook(v, plan.look);
    clips.push(v);
    if (linkId) {
      const a = makeClip('audio', { trackId: (at[0] || Ops.addTrack('audio')).id, mediaId: item.id, name: item.name, start, duration, offset: srcStart, linkId });
      a.speed = speed;
      a.volume = shot.clip_audio === 'low' ? -15 : 0;
      clips.push(a);
    }
    shots.push({ ...shot, start, duration, name: item.name });
  }
  if (!shots.length) throw new Error('Claude\'s plan didn\'t contain any usable shots. Please try again.');
  const total = frameAt(cursor) - from;

  if (music) {
    const usesClipAudio = clips.some((c) => c.kind === 'audio');
    const track = (usesClipAudio ? at[1] : at[0]) || Ops.addTrack('audio');
    const m = makeClip('audio', { trackId: track.id, mediaId: job.musicItem.id, name: job.musicItem.name, start: from, duration: total, offset: beatAt(startBeat) });
    m.duration = Math.min(m.duration, Model.maxDuration(m));
    const fade = Math.min(Math.round(2 * fps), beatFrames * 4, Math.floor(m.duration / 3));
    if (fade > 1) m.keys.volume = [{ f: m.duration - fade, v: 0 }, { f: m.duration, v: -60 }];
    clips.push(m);
  }
  if (s.titles) {
    const H = Model.seq.height, Wd = Model.seq.width;
    const styles = {
      'big-center': { size: Math.round(H * 0.12), align: 'center', x: 0, y: 0, box: false, shadow: true, weight: 900 },
      'lower-third': { size: Math.round(H * 0.05), align: 'left', x: Math.round(-Wd * 0.38), y: Math.round(H * 0.33), box: true, boxColor: '#000000', boxOpacity: 65, shadow: false, weight: 600 },
      caption: { size: Math.round(H * 0.045), align: 'center', x: 0, y: Math.round(H * 0.4), box: true, boxColor: '#000000', boxOpacity: 55, shadow: false, weight: 500 },
    };
    for (const t of plan.titles || []) {
      if (!t.text?.trim() || !(t.length > 0)) continue;
      const start = clamp(frameAt(Math.max(0, t.at)), from, from + total - 1);
      const end = clamp(frameAt(Math.max(0, t.at) + t.length), start + 1, from + total);
      clips.push(makeClip('title', { trackId: titleTrack.id, start, duration: end - start, name: t.text.slice(0, 40), title: { text: t.text, ...(styles[t.style] || styles['big-center']) } }));
    }
  }
  return { clips, total, shots, warnings };
}

function aiApplyEffect(clip, effect, duration) {
  if (effect === 'punch-in') clip.keys['motion.scale'] = [{ f: 0, v: 122 }, { f: Math.min(5, duration), v: 112, ease: true }];
  if (effect === 'zoom-in') clip.keys['motion.scale'] = [{ f: 0, v: 100 }, { f: duration, v: 112, ease: true }];
  if (effect === 'zoom-out') clip.keys['motion.scale'] = [{ f: 0, v: 112 }, { f: duration, v: 100, ease: true }];
  if (effect === 'black-and-white') clip.effects.push(newEffect('bw'));
  if (effect === 'glow') clip.effects.push(newEffect('glow'));
  if (effect === 'vignette') clip.effects.push(newEffect('vignette'));
  if (effect === 'grain') clip.effects.push(newEffect('grain'));
}

// Put the edit on the timeline (no undo step yet: AIPreview decides that).
function aiPlace(plan, job) {
  const unlocked = Model.seq.tracks.filter((t) => !t.locked).map((t) => t.id);
  if (!Model.seq.clips.length) {
    const first = job.clips.find((c) => c.item.kind === 'video')?.item;
    if (first) Edit.matchSequence(first);
  }
  let from = Model.seq.playhead;
  if (job.place === 'replace') {
    from = job.range[0];
    Ops.extractRange(job.range[0], job.range[1], unlocked);
  } else if (job.place === 'end') {
    from = Model.duration();
  }
  const built = aiBuildClips(plan, job, from);
  Ops.ripple(from, built.total, unlocked);
  Model.seq.clips.push(...built.clips);
  return { ...built, from };
}

// ---------- Preview: watch, then Accept or Decline ----------
const AIPreview = {
  state: null,

  show(job, result) {
    const before = History.snapshot();
    const built = aiPlace(result.plan, job);
    this.state = { job, plan: result.plan, message: result.message, before, built, data: Model.data };
    this.afterBuild();
  },

  // A revised plan replaces the current preview.
  replace(result) {
    const st = this.live();
    if (!st) return;
    History.restore(st.before);
    st.plan = result.plan;
    st.message = result.message;
    st.built = aiPlace(result.plan, st.job);
    this.afterBuild();
  },

  afterBuild() {
    const { built } = this.state;
    App.changed();
    Edit.select(built.clips.filter((c) => c.kind !== 'audio' || c.linkId).map((c) => c.id));
    Player.seek(built.from);
    Timeline.zoomToFit();
    this.renderBar();
    if (built.warnings.length) toast(built.warnings[0]);
  },

  // The preview, unless a different project was opened since.
  live() {
    if (this.state && this.state.data !== Model.data) { this.state = null; this.renderBar(); }
    return this.state;
  },

  accept({ quiet = false } = {}) {
    const st = this.live();
    if (!st) return;
    this.state = null;
    History.undoStack.push({ name: 'AI Edit', before: st.before, after: History.snapshot() });
    History.redoStack = [];
    this.renderBar();
    App.changed({ silent: true });
    toast(quiet ? 'Kept the AI edit. Ctrl+Z undoes it.' : 'AI edit kept. Ctrl+Z undoes it.');
  },

  decline() {
    const st = this.live();
    if (!st) return;
    this.state = null;
    Player.pause();
    History.restore(st.before);
    this.renderBar();
    App.changed();
    toast('AI edit removed. Your timeline is back to how it was.');
  },

  watch() {
    const st = this.state;
    if (!st) return;
    Player.seek(st.built.from);
    Player.play(1);
  },

  // The preview controls sit in the header, in place of the project title.
  renderBar() {
    const header = document.getElementById('header');
    let bar = document.getElementById('ai-bar');
    header.classList.toggle('has-ai', !!this.state);
    if (!this.state) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'ai-bar';
      bar.className = 'ai-bar';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'AI edit preview');
      document.getElementById('hdr-title').after(bar);
      bar.addEventListener('click', (e) => {
        const a = e.target.closest('[data-ai]')?.dataset.ai;
        if (a === 'watch') this.watch();
        if (a === 'why') aiWhyDialog();
        if (a === 'change') aiChangeDialog();
        if (a === 'decline') this.decline();
        if (a === 'accept') this.accept();
      });
    }
    const { plan, built } = this.state;
    bar.innerHTML = `
      <span class="ai-bar-icon">${icon('sparkles', 14)}</span>
      <span class="ai-bar-text" title="${esc(plan.summary || '')}"><b>AI preview: ${esc(plan.title || 'Untitled')}</b> · ${(built.total / Model.fps).toFixed(1)}s · ${built.shots.length} shots</span>
      <button class="pbtn pbtn-sm" data-ai="watch">${icon('play', 11)} Watch</button>
      <button class="pbtn pbtn-sm" data-ai="why">Why?</button>
      <button class="pbtn pbtn-sm" data-ai="change">Change…</button>
      <button class="pbtn pbtn-sm" data-ai="decline">Decline</button>
      <button class="pbtn pbtn-sm pbtn-primary" data-ai="accept">Accept</button>`;
  },
};

// ---------- Running a job ----------
async function aiRun(job, messages, onDone) {
  const ctrl = new AbortController();
  const steps = job.analyzed ? [['plan', 'Claude is planning the edit']]
    : [['clips', 'Looking at your clips'], ...(job.musicItem ? [['music', 'Finding the beat']] : []), ['plan', 'Claude is planning the edit']];
  let dlg;
  openDialog({
    title: 'AI Edit',
    width: 520,
    okLabel: '',
    cancelLabel: 'Cancel',
    body: `
      <div class="ai-run">
        <ol class="ai-steps">${steps.map(([id, label]) => `<li data-step="${id}"><span class="ai-dot"></span><span>${label}</span><em></em></li>`).join('')}</ol>
        <div class="ai-think" hidden><b>Claude's notes</b><p data-think></p></div>
      </div>`,
    onMount(api) { dlg = api; },
    onCancel() { ctrl.abort(); },
  });
  const step = (id, state, note = '') => {
    const li = dlg.el.querySelector(`[data-step="${id}"]`);
    if (!li) return;
    li.className = state;
    li.querySelector('em').textContent = note;
  };
  try {
    if (!job.analyzed) {
      step('clips', 'active');
      const totalSec = job.clips.reduce((a, c) => a + (c.item.kind === 'image' ? 2 : c.item.duration), 0);
      for (const [i, c] of job.clips.entries()) {
        if (ctrl.signal.aborted) return;
        const share = c.item.kind === 'image' ? 1 : clamp(Math.round((AI_FRAME_BUDGET * c.item.duration) / totalSec), 2, 8);
        const r = c.item.kind === 'image' ? AIAnalyze.image(c.item)
          : await AIAnalyze.video(c.item, share, (p) => step('clips', 'active', `${i + 1} of ${job.clips.length} · ${Math.round(p * 100)}%`));
        Object.assign(c, r, { loudness: c.item.hasAudio ? AIAnalyze.loudness(c.item) : null });
      }
      // Motion 0–9 against the busiest moment across all clips, on a log scale so
      // one frantic clip doesn't flatten everything else to 0.
      const all = job.clips.flatMap((c) => c.motion).sort((a, b) => a - b);
      const top = Math.log1p(all[Math.floor(all.length * 0.95)] || 1);
      for (const c of job.clips) c.motion = c.motion.map((v) => clamp(Math.round((Math.log1p(v) / top) * 9), 0, 9));
      step('clips', 'done', `${job.clips.reduce((a, c) => a + c.frames.length, 0)} frames`);
      if (job.musicItem) {
        step('music', 'active');
        job.music = await AIAnalyze.music(job.musicItem);
        step('music', 'done', `${Math.round(job.music.bpm)} BPM${job.music.drops.length ? ` · ${job.music.drops.length} drop${job.music.drops.length === 1 ? '' : 's'}` : ''}`);
      }
      job.analyzed = true;
      job.content = aiBuildContent(job);
    }
    if (ctrl.signal.aborted) return;
    step('plan', 'active');
    const think = dlg.el.querySelector('[data-think]');
    let notes = '';
    const result = await AIClaude.plan(messages(job), {
      signal: ctrl.signal,
      onEvent(e) {
        if (e.thinking) {
          notes = (notes + e.thinking).slice(-600);
          think.textContent = notes;
          think.parentElement.hidden = false;
        }
        if (e.shots != null) step('plan', 'active', `${e.shots} shot${e.shots === 1 ? '' : 's'} planned`);
      },
    });
    dlg.close();
    onDone(result);
  } catch (err) {
    const msg = AIClaude.friendly(err);
    if (!msg) return;
    console.error(err);
    dlg.close();
    openDialog({ title: 'AI Edit', width: 440, okLabel: 'OK', cancelLabel: '', body: `<p>${esc(msg)}</p>` });
  }
}

// ---------- Dialogs ----------
function aiSetupDialog() {
  if (AIPreview.live()) { toast('Accept or decline the current AI edit first.'); return; }
  const visual = Model.data.media.filter((m) => (m.kind === 'video' || m.kind === 'image') && Media.isOnline(m.id));
  if (!visual.length) { toast('Import your clips first, then pick AI Edit.'); return; }
  const s = AIEdit.settings;
  const seq = Model.seq;
  const songs = Model.data.media.filter((m) => m.kind === 'audio' && Media.isOnline(m.id));

  // Start from what's selected on the timeline (or the In/Out range).
  const sel = Edit.selected();
  let range = null;
  if (sel.length) range = [Math.min(...sel.map((c) => c.start)), Math.max(...sel.map((c) => Model.end(c)))];
  else if (seq.inPoint != null && seq.outPoint != null && seq.outPoint > seq.inPoint) range = [seq.inPoint, seq.outPoint];
  const inRange = range ? seq.clips.filter((c) => c.start < range[1] && Model.end(c) > range[0]) : [];
  const pickedIds = new Set((range ? inRange.filter((c) => c.kind === 'video' || c.kind === 'image').map((c) => c.mediaId) : visual.map((m) => m.id)));
  const rangeSong = inRange.find((c) => c.kind === 'audio' && Model.media(c.mediaId)?.kind === 'audio');
  const song = rangeSong ? rangeSong.mediaId : songs.length === 1 ? songs[0].id : '';
  const place = range ? 'replace' : Model.seq.clips.length ? 'end' : 'playhead';
  const model = AIEdit.model();

  openDialog({
    title: 'AI Edit',
    width: 820,
    okLabel: 'Create Edit',
    body: `
      <div class="ai-setup">
        <p class="ai-intro">${icon('sparkles', 14)} Claude looks at your clips and the music, plans a montage in your style and builds it on the timeline. You watch it first, then keep it or not.</p>
        <div class="ai-key" ${s.apiKey ? 'hidden' : ''}>
          <b>Connect Claude</b>
          <p class="pdialog-note">AI Edit uses your own Anthropic API key. It's stored on this computer only.</p>
          <div class="prow"><input class="pinput" type="password" name="apiKey" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" value="${esc(s.apiKey)}">
            <button type="button" class="pbtn pbtn-sm" data-ai-keys>Get a key</button></div>
        </div>
        <div class="ai-cols">
          <div class="ai-col">
            <div class="ai-h">Clips <span class="pdialog-note" data-count></span><span class="tl-spacer"></span>
              <button type="button" class="pbtn pbtn-sm" data-all="1">All</button><button type="button" class="pbtn pbtn-sm" data-all="0">None</button></div>
            <div class="ai-clips">${visual.map((m) => `
              <label class="ai-clip"><input type="checkbox" name="clip" value="${m.id}" ${pickedIds.has(m.id) ? 'checked' : ''}>
                <span class="ai-thumb">${MediaRT.get(m.id)?.thumb ? `<img src="${MediaRT.get(m.id).thumb}" alt="">` : ''}</span>
                <span class="ai-clip-name">${esc(m.name)}<em>${m.kind === 'image' ? 'Still' : fmtDur(m.duration)}</em></span></label>`).join('')}</div>
            <div class="prow"><span class="prow-label">Music</span><select class="pselect" name="music">
              <option value="">No music (use the clips' sound)</option>
              ${songs.map((m) => `<option value="${m.id}" ${m.id === song ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
            ${songs.length ? '' : '<p class="pdialog-note">Import a song to cut to the beat.</p>'}
          </div>
          <div class="ai-col">
            <div class="ai-h">Style</div>
            <div class="ai-chips">${AI_STYLES.map(([name]) => `<button type="button" class="ai-chip" data-style="${name}">${name}</button>`).join('')}</div>
            <textarea class="ai-style" name="aiStyle" rows="4" placeholder="Describe the style you want, e.g. fast cuts on the beat, slow motion on the best moments, end on the sunset shot">${esc(s.style)}</textarea>
            <div class="prow"><span class="prow-label">Length</span><select class="pselect" name="aiLength">
              ${[['auto', 'Let Claude decide'], ['15', 'About 15 seconds'], ['30', 'About 30 seconds'], ['45', 'About 45 seconds'], ['60', 'About 1 minute'], ['song', 'The whole song']].map(([v, l]) => `<option value="${v}" ${s.length === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="prow"><span class="prow-label">Put it</span><select class="pselect" name="place">
              ${range ? `<option value="replace" ${place === 'replace' ? 'selected' : ''}>In place of the selected part (${tc(range[0])}–${tc(range[1])})</option>` : ''}
              <option value="playhead" ${place === 'playhead' ? 'selected' : ''}>At the playhead (${tc(seq.playhead)})</option>
              ${seq.clips.length ? `<option value="end" ${place === 'end' ? 'selected' : ''}>After the end of the timeline</option>` : ''}</select></div>
            <div class="ai-toggles">
              ${[['transitions', 'Transitions'], ['effects', 'Zooms & effects'], ['look', 'Color look'], ['titles', 'Titles']].map(([k, l]) => `<label class="pcheck"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}> ${l}</label>`).join('')}
            </div>
          </div>
        </div>
        <div class="ai-foot">
          <select class="pselect ai-model" name="model" title="Claude model">${AI_MODELS.map((m) => `<option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>${m.name}: ${m.note}</option>`).join('')}</select>
          <span class="pdialog-note" data-cost></span>
          ${s.apiKey ? '<button type="button" class="pbtn pbtn-sm" data-ai-forget>Change API key</button>' : ''}
        </div>
        <p class="pdialog-note">Frames from your clips and the music's beat map go to Claude (Anthropic) to plan the edit. Your video files stay on this computer.</p>
      </div>`,
    onMount(api) {
      const f = api.form;
      const checked = () => [...f.querySelectorAll('input[name="clip"]:checked')].map((i) => i.value);
      const update = () => {
        const ids = checked();
        api.el.querySelector('[data-count]').textContent = `${ids.length} of ${visual.length}`;
        AIEdit.settings.model = f.model.value;
        const frames = ids.reduce((a, id) => a + (Model.media(id).kind === 'image' ? 1 : 8), 0);
        api.el.querySelector('[data-cost]').textContent = `About $${Math.max(0.01, aiEstimate(Math.min(frames, AI_FRAME_BUDGET))).toFixed(2)} per try`;
      };
      f.addEventListener('change', update);
      api.el.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => {
        f.querySelectorAll('input[name="clip"]').forEach((i) => { i.checked = b.dataset.all === '1'; });
        update();
      }));
      api.el.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
        f.aiStyle.value = AI_STYLES.find(([n]) => n === b.dataset.style)[1];
        f.aiStyle.focus();
      }));
      api.el.querySelector('[data-ai-keys]')?.addEventListener('click', () => window.open(AI_KEYS_URL, '_blank', 'noopener'));
      api.el.querySelector('[data-ai-forget]')?.addEventListener('click', (e) => {
        api.el.querySelector('.ai-key').hidden = false;
        f.apiKey.value = '';
        f.apiKey.focus();
        e.currentTarget.remove();
      });
      update();
    },
    onOk(api) {
      const f = api.form;
      const ids = [...f.querySelectorAll('input[name="clip"]:checked')].map((i) => i.value);
      const key = f.apiKey.value.trim();
      if (!key) { toast('Paste your Anthropic API key first.'); f.apiKey.focus(); return false; }
      if (!ids.length) { toast('Pick at least one clip.'); return false; }
      Object.assign(AIEdit.settings, {
        apiKey: key, model: f.model.value, style: f.aiStyle.value, length: f.aiLength.value, place: f.place.value,
        transitions: f.transitions.checked, effects: f.effects.checked, look: f.look.checked, titles: f.titles.checked,
      });
      AIEdit.saveSettings();
      const job = {
        clips: ids.map((id, i) => ({ id: `c${i + 1}`, item: Model.media(id) })),
        musicItem: f.music.value ? Model.media(f.music.value) : null,
        style: f.aiStyle.value,
        length: f.aiLength.value,
        place: f.place.value,
        range,
      };
      aiRun(job, (j) => [{ role: 'user', content: j.content }], (result) => {
        job.lastMessage = result.message;
        AIPreview.show(job, result);
      });
    },
  });
}

function aiChangeDialog() {
  const st = AIPreview.state;
  if (!st) return;
  const quick = ['Faster cuts', 'Slower and more cinematic', 'More slow motion', 'Fewer effects', 'Start with a stronger shot', 'Make it shorter'];
  openDialog({
    title: 'Change the AI edit',
    width: 520,
    okLabel: 'Re-edit',
    body: `
      <div class="ai-setup">
        <div class="ai-chips">${quick.map((q) => `<button type="button" class="ai-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <textarea class="ai-style" name="feedback" rows="4" placeholder="What should Claude change? e.g. use more of the drone shots and end on the jump"></textarea>
        <p class="pdialog-note">Claude keeps what works and changes the rest. The new version replaces this preview.</p>
      </div>`,
    onMount(api) {
      api.el.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
        const t = api.form.feedback;
        t.value = t.value ? `${t.value.replace(/[.\s]*$/, '')}. ${b.dataset.q}.` : `${b.dataset.q}.`;
        t.focus();
      }));
      setTimeout(() => api.form.feedback.focus(), 0);
    },
    onOk(api) {
      const feedback = api.form.feedback.value.trim();
      if (!feedback) { toast('Say what you\'d like changed.'); return false; }
      const job = st.job;
      // The whole conversation goes back unchanged (thinking blocks included) so Claude builds on its last plan.
      // It's only kept once the revision succeeds, so a cancelled try leaves no half-finished turn behind.
      const history = [...(job.history || [{ role: 'user', content: job.content }]), { role: 'assistant', content: st.message.content },
        { role: 'user', content: [{ type: 'text', text: `Change the edit: ${feedback}\nKeep what works and return the complete updated plan.` }] }];
      aiRun(job, () => history, (result) => {
        job.history = history;
        AIPreview.replace(result);
      });
    },
  });
}

function aiWhyDialog() {
  const st = AIPreview.state;
  if (!st) return;
  openDialog({
    title: `Why these cuts: ${st.plan.title || 'AI edit'}`,
    width: 640,
    okLabel: 'Close',
    cancelLabel: '',
    body: `
      <div class="ai-why">
        <p>${esc(st.plan.summary || '')}</p>
        <table class="ai-shots"><thead><tr><th>At</th><th>Clip</th><th>Length</th><th>Why</th></tr></thead><tbody>
          ${st.built.shots.map((s) => `<tr><td>${tc(s.start)}</td><td>${esc(s.name)}</td><td>${(s.duration / Model.fps).toFixed(1)}s${s.speed && s.speed !== 1 ? ` · ${Math.round(s.speed * 100)}%` : ''}</td><td>${esc(s.why || '')}</td></tr>`).join('')}
        </tbody></table>
      </div>`,
  });
}
