// Timeline import from other editors. In DaVinci Resolve: File › Export › Timeline…
// and pick FCPXML, Final Cut Pro 7 XML, EDL or OpenTimelineIO. (Resolve's .drp
// project files are a closed format, so they can't be read directly.)
//
// Every parser returns times in seconds:
// { format, name, fps, width, height, items: [{ kind, track, start, duration, srcIn, speed, file, label, text }],
//   transitions: [{ kind, track, at, duration, type }] }

const TIMELINE_EXT = /\.(fcpxml|fcpxmld|xml|edl|otio)$/i;

function isTimelineFile(file) {
  return TIMELINE_EXT.test(file.name);
}

function mapTransition(name = '') {
  if (/white/i.test(name)) return 'dip-white';
  if (/dip|black|fade/i.test(name)) return 'dip-black';
  if (/wipe/i.test(name)) return 'wipe-left';
  if (/push/i.test(name)) return 'push';
  if (/slide/i.test(name)) return 'slide';
  if (/zoom/i.test(name)) return 'zoom';
  return 'cross-dissolve';
}

function fileNameOf(pathOrUrl = '') {
  const clean = String(pathOrUrl).split(/[?#]/)[0];
  const last = clean.split(/[\\/]/).filter(Boolean).pop() || '';
  try { return decodeURIComponent(last); } catch { return last; }
}

const normName = (n) => String(n || '').trim().toLowerCase();

function snapFps(fps) {
  const near = FPS_PRESETS.find((p) => Math.abs(p - fps) < 0.02);
  return near || Math.round(fps * 1000) / 1000;
}

const child = (el, tag) => el?.querySelector(`:scope > ${tag}`);
const childText = (el, tag) => child(el, tag)?.textContent.trim() ?? '';

// ---------- FCPXML (Final Cut Pro X / Resolve) ----------
// "1001/30000s", "3600s" → seconds
function fcpTime(v) {
  if (!v) return 0;
  const m = /^(-?\d+(?:\.\d+)?)(?:\/(\d+))?s?$/.exec(String(v).trim());
  return m ? +m[1] / (m[2] ? +m[2] : 1) : 0;
}

function parseFCPXML(doc) {
  const formats = {};
  for (const f of doc.querySelectorAll('resources > format')) {
    const fd = fcpTime(f.getAttribute('frameDuration'));
    formats[f.getAttribute('id')] = { fps: fd ? 1 / fd : null, width: +f.getAttribute('width') || null, height: +f.getAttribute('height') || null };
  }
  const assets = {};
  for (const a of doc.querySelectorAll('resources > asset')) {
    const rep = a.querySelector('media-rep');
    assets[a.getAttribute('id')] = {
      file: fileNameOf(rep?.getAttribute('src') || a.getAttribute('src') || a.getAttribute('name')),
      start: fcpTime(a.getAttribute('start')),
      hasVideo: a.getAttribute('hasVideo') !== '0',
      hasAudio: a.getAttribute('hasAudio') === '1',
    };
  }
  const seqEl = doc.querySelector('sequence');
  if (!seqEl) throw new Error('No sequence found in this FCPXML file.');
  const fmt = formats[seqEl.getAttribute('format')] || Object.values(formats)[0] || {};
  const tcStart = fcpTime(seqEl.getAttribute('tcStart'));
  const items = [], transitions = [];

  const speedOf = (el) => {
    const pts = [...(el.querySelector(':scope > timeMap')?.querySelectorAll('timept') || [])];
    if (pts.length < 2) return 1;
    const t0 = fcpTime(pts[0].getAttribute('time')), t1 = fcpTime(pts[pts.length - 1].getAttribute('time'));
    const v0 = fcpTime(pts[0].getAttribute('value')), v1 = fcpTime(pts[pts.length - 1].getAttribute('value'));
    return t1 > t0 ? Math.abs((v1 - v0) / (t1 - t0)) || 1 : 1;
  };

  const addMedia = (asset, tl, dur, srcIn, lane, label, speed) => {
    if (!asset) return;
    const base = { start: tl, duration: dur, srcIn: Math.max(0, srcIn), speed, file: asset.file, label };
    if (lane >= 0) {
      if (asset.hasVideo) items.push({ ...base, kind: 'video', track: lane + 1 });
      if (lane === 0 && asset.hasAudio) items.push({ ...base, kind: 'audio', track: 1, auto: true });
    } else {
      // Lane -1 sits under the main storyline, whose own audio is A1.
      items.push({ ...base, kind: 'audio', track: 1 - lane });
    }
  };

  const walk = (children, parentTl, parentStart, inheritedLane) => {
    for (const el of children) {
      const lane = el.hasAttribute('lane') ? +el.getAttribute('lane') : inheritedLane;
      const offset = fcpTime(el.getAttribute('offset'));
      const start = fcpTime(el.getAttribute('start'));
      const dur = fcpTime(el.getAttribute('duration'));
      const tl = parentTl + (offset - parentStart);
      const name = el.getAttribute('name') || '';
      const nested = [...el.children].filter((c) => c.hasAttribute('lane') || c.tagName === 'spine');
      switch (el.tagName) {
        case 'asset-clip': {
          const asset = assets[el.getAttribute('ref')];
          addMedia(asset, tl, dur, start - (asset?.start || 0), lane, name, speedOf(el));
          walk(nested, tl, start, 0);
          break;
        }
        case 'clip':
        case 'ref-clip': {
          const media = el.querySelector(':scope > video, :scope > audio, :scope > asset-clip');
          if (media) {
            const asset = assets[media.getAttribute('ref')];
            const srcIn = fcpTime(media.getAttribute('start')) + (start - fcpTime(media.getAttribute('offset'))) - (asset?.start || 0);
            addMedia(asset, tl, dur, srcIn, lane, name, speedOf(el));
          }
          walk(nested.filter((c) => c !== media), tl, start, 0);
          break;
        }
        case 'video':
        case 'audio': {
          const asset = assets[el.getAttribute('ref')];
          if (el.tagName === 'audio') {
            if (asset) items.push({ kind: 'audio', track: lane < 0 ? 1 - lane : 1, start: tl, duration: dur, srcIn: Math.max(0, start - asset.start), speed: 1, file: asset.file, label: name });
          } else addMedia(asset, tl, dur, start - (asset?.start || 0), lane, name, 1);
          break;
        }
        case 'gap':
        case 'sync-clip':
        case 'mc-clip':
          walk([...el.children], tl, start, lane);
          break;
        case 'spine': {
          const first = el.firstElementChild;
          walk([...el.children], tl, fcpTime(first?.getAttribute('offset')), lane);
          break;
        }
        case 'title': {
          const text = [...el.querySelectorAll('text')].map((t) => t.textContent).join('\n').trim() || name;
          items.push({ kind: 'title', track: Math.max(1, lane + 1), start: tl, duration: dur, text, label: name });
          break;
        }
        case 'transition':
          transitions.push({ kind: lane < 0 ? 'audio' : 'video', track: lane < 0 ? 1 - lane : lane + 1, at: tl + dur / 2, duration: dur, type: mapTransition(name) });
          break;
        default:
          break;
      }
    }
  };
  walk([...(child(seqEl, 'spine')?.children || [])], 0, tcStart, 0);

  // Drop embedded audio we added when the file also has its own audio clip at the same spot.
  const explicit = items.filter((i) => i.kind === 'audio' && !i.auto);
  const kept = items.filter((i) => !(i.auto && explicit.some((e) => normName(e.file) === normName(i.file) && Math.abs(e.start - i.start) < 0.05)));
  return {
    format: `FCPXML ${doc.documentElement.getAttribute('version') || ''}`.trim(),
    name: seqEl.closest('project')?.getAttribute('name') || 'Imported Timeline',
    fps: fmt.fps, width: fmt.width, height: fmt.height, items: kept, transitions,
  };
}

// ---------- Final Cut Pro 7 XML (xmeml) ----------
function xmlRate(el) {
  const r = child(el, 'rate');
  if (!r) return null;
  const tb = +childText(r, 'timebase');
  if (!tb) return null;
  return /true/i.test(childText(r, 'ntsc')) ? (tb * 1000) / 1001 : tb;
}

function parseXMEML(doc) {
  const seqEl = doc.querySelector('sequence');
  if (!seqEl) throw new Error('No sequence found in this XML file.');
  const fps = xmlRate(seqEl) || 30;
  const sc = seqEl.querySelector('media > video > format samplecharacteristics');
  const files = {};
  for (const f of doc.querySelectorAll('file[id]')) {
    const name = childText(f, 'name') || fileNameOf(childText(f, 'pathurl'));
    if (name) files[f.getAttribute('id')] = { name: fileNameOf(childText(f, 'pathurl')) || name, rate: xmlRate(f) };
  }
  const items = [], transitions = [];
  for (const kind of ['video', 'audio']) {
    const tracks = seqEl.querySelectorAll(`:scope > media > ${kind} > track`);
    tracks.forEach((tr, ti) => {
      let prevEnd = 0;
      for (const el of tr.children) {
        if (el.tagName === 'transitionitem') {
          const s = +childText(el, 'start'), e = +childText(el, 'end');
          transitions.push({ kind, track: ti + 1, at: (s + e) / 2 / fps, duration: (e - s) / fps, type: mapTransition(el.querySelector('effect > name')?.textContent) });
          continue;
        }
        if (el.tagName !== 'clipitem' && el.tagName !== 'generatoritem') continue;
        let start = +childText(el, 'start'), end = +childText(el, 'end');
        const inF = +childText(el, 'in') || 0, outF = +childText(el, 'out') || 0;
        const fileEl = child(el, 'file');
        const file = fileEl && (files[fileEl.getAttribute('id')] || { name: childText(fileEl, 'name') });
        const rate = xmlRate(el) || file?.rate || fps;
        const srcLen = ((outF - inF) / rate) * fps;
        if (start < 0 && end >= 0) start = Math.round(end - srcLen);
        if (end < 0) end = Math.round(start + srcLen);
        if (start < 0) start = prevEnd;
        prevEnd = end;
        if (end <= start) continue;
        const label = childText(el, 'name');
        if (el.tagName === 'generatoritem') {
          const text = [...el.querySelectorAll('parameter')].find((p) => /^str$|text/i.test(childText(p, 'parameterid')))?.querySelector('value')?.textContent;
          if (kind === 'video' && text) items.push({ kind: 'title', track: ti + 1, start: start / fps, duration: (end - start) / fps, text, label });
          continue;
        }
        if (!file?.name) continue;
        const speed = srcLen > 0 ? (outF - inF) / rate / ((end - start) / fps) : 1;
        items.push({ kind, track: ti + 1, start: start / fps, duration: (end - start) / fps, srcIn: inF / rate, speed: Math.abs(speed) || 1, file: file.name, label });
      }
    });
  }
  return {
    format: 'Final Cut Pro 7 XML', name: childText(seqEl, 'name') || 'Imported Timeline',
    fps, width: +childText(sc, 'width') || null, height: +childText(sc, 'height') || null, items, transitions,
  };
}

// ---------- CMX 3600 EDL ----------
function parseEDL(text, fps) {
  const base = Math.round(fps);
  const tcf = (s) => {
    const [h, m, sec, f] = s.split(/[:;.]/).map(Number);
    return ((h * 60 + m) * 60 + sec) * base + f;
  };
  const evRe = /^(\d{1,6})\s+(\S+)\s+(\S+)\s+(C|D|W\d{3}|K\S*)\s+(?:(\d{1,4})\s+)?(\d\d:\d\d:\d\d[:;.]\d\d)\s+(\d\d:\d\d:\d\d[:;.]\d\d)\s+(\d\d:\d\d:\d\d[:;.]\d\d)\s+(\d\d:\d\d:\d\d[:;.]\d\d)/;
  let title = 'Imported Timeline';
  const events = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = /^TITLE:\s*(.+)/i.exec(line))) { title = m[1].trim(); continue; }
    if ((m = evRe.exec(line))) {
      cur = { reel: m[2], chan: m[3].toUpperCase(), trans: m[4], dur: +(m[5] || 0), srcIn: tcf(m[6]), srcOut: tcf(m[7]), recIn: tcf(m[8]), recOut: tcf(m[9]), speed: 1 };
      events.push(cur);
      continue;
    }
    if (!cur) continue;
    if ((m = /^\*\s*FROM CLIP NAME:\s*(.+)/i.exec(line))) cur.name ||= m[1].trim();
    else if ((m = /^\*\s*TO CLIP NAME:\s*(.+)/i.exec(line))) cur.name = m[1].trim();
    else if ((m = /^\*\s*SOURCE FILE:\s*(.+)/i.exec(line))) cur.file = fileNameOf(m[1].trim());
    else if ((m = /^M2\s+(\S+)\s+(-?[\d.]+)/i.exec(line))) cur.speed = Math.abs(+m[2]) / fps || 1;
  }
  const clips = events.filter((e) => e.recOut > e.recIn && !/^(BL|BLACK)$/i.test(e.reel) && e.chan !== 'NONE');
  if (!clips.length) throw new Error('No events found in this EDL.');
  const hour = 3600 * base;
  const minRec = Math.min(...clips.map((e) => e.recIn));
  const zero = minRec >= hour ? Math.floor(minRec / hour) * hour : 0;
  const items = [], transitions = [];
  const tracksFor = (chan) => {
    const out = [];
    if (/V|B/.test(chan)) out.push(['video', 1]);
    const a = /A(\d+)?/.exec(chan.replace('/V', ''));
    if (/^AA|^A$|^B$|AA\/V|A\/V/.test(chan)) out.push(['audio', 1]);
    else if (a && a[1]) out.push(['audio', +a[1]]);
    return out;
  };
  for (const e of clips) {
    let recIn = e.recIn, srcIn = e.srcIn;
    if (e.trans !== 'C' && e.dur) {
      // Dissolve: in this model the cut sits in the middle of it, so the incoming clip starts there.
      const half = Math.round(e.dur / 2);
      const prev = clips[clips.indexOf(e) - 1];
      if (prev && prev.recOut === e.recIn) prev.extend = half;
      recIn += half;
      srcIn += half;
      for (const [kind, track] of tracksFor(e.chan)) transitions.push({ kind, track, at: (recIn - zero) / fps, duration: e.dur / fps, type: e.trans.startsWith('W') ? 'wipe-left' : 'cross-dissolve' });
    }
    e.cutIn = recIn;
    e.cutSrc = srcIn;
  }
  for (const e of clips) {
    const end = e.recOut + (e.extend || 0);
    const file = e.file || e.name || e.reel;
    for (const [kind, track] of tracksFor(e.chan)) {
      items.push({ kind, track, start: (e.cutIn - zero) / fps, duration: (end - e.cutIn) / fps, srcIn: e.cutSrc / fps, speed: e.speed, file, label: e.name || file });
    }
  }
  return { format: 'CMX 3600 EDL', name: title, fps, width: null, height: null, items, transitions, needsFps: true };
}

// ---------- OpenTimelineIO ----------
function parseOTIO(json) {
  const rt = (t) => (t && t.rate ? t.value / t.rate : 0);
  const tl = json.OTIO_SCHEMA?.startsWith('Timeline') ? json : null;
  if (!tl) throw new Error('Not an OpenTimelineIO timeline.');
  let fps = tl.global_start_time?.rate || null;
  const counters = { video: 0, audio: 0 };
  const items = [], transitions = [];
  for (const track of tl.tracks?.children || []) {
    if (!String(track.OTIO_SCHEMA).startsWith('Track')) continue;
    const kind = track.kind === 'Audio' ? 'audio' : 'video';
    const idx = ++counters[kind];
    let t = 0;
    for (const c of track.children || []) {
      const schema = String(c.OTIO_SCHEMA).split('.')[0];
      const dur = rt(c.source_range?.duration);
      fps ||= c.source_range?.duration?.rate || null;
      if (schema === 'Transition') {
        transitions.push({ kind, track: idx, at: t, duration: rt(c.in_offset) + rt(c.out_offset), type: mapTransition(c.transition_type || c.name) });
        continue;
      }
      if (schema === 'Clip') {
        const ref = c.media_reference || c.media_references?.[c.active_media_reference_key || 'DEFAULT_MEDIA'];
        const avail = ref?.available_range;
        const warp = (c.effects || []).find((e) => /TimeWarp/.test(e.OTIO_SCHEMA));
        items.push({
          kind, track: idx, start: t, duration: dur,
          srcIn: Math.max(0, rt(c.source_range?.start_time) - (avail ? rt(avail.start_time) : 0)),
          speed: Math.abs(warp?.time_scalar || 1) || 1,
          file: fileNameOf(ref?.target_url || ref?.name || c.name), label: c.name,
        });
      }
      t += dur;
    }
  }
  return { format: 'OpenTimelineIO', name: tl.name || 'Imported Timeline', fps, width: null, height: null, items, transitions };
}

// Renumber tracks 1, 2, 3… in order so no empty tracks are created.
function compactTracks(parsed) {
  for (const kind of ['video', 'audio']) {
    const isKind = (x) => (x.kind === 'audio' ? 'audio' : 'video') === kind;
    const used = [...new Set(parsed.items.filter(isKind).map((i) => i.track))].sort((a, b) => a - b);
    const map = new Map(used.map((t, i) => [t, i + 1]));
    for (const it of parsed.items) if (isKind(it)) it.track = map.get(it.track);
    for (const tr of parsed.transitions) if (tr.kind === kind) tr.track = map.get(tr.track) ?? tr.track;
  }
  return parsed;
}

function parseTimeline(name, text, fps = Model.fps) {
  return compactTracks(parseTimelineRaw(name, text, fps));
}

function parseTimelineRaw(name, text, fps) {
  if (/\.otio$/i.test(name) || text.trimStart().startsWith('{')) return parseOTIO(JSON.parse(text));
  if (/\.edl$/i.test(name) || /^\s*(TITLE:|\d{3}\s)/m.test(text) && !text.includes('<')) return parseEDL(text, fps);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This XML file could not be read.');
  const root = doc.documentElement.tagName;
  if (root === 'fcpxml') return parseFCPXML(doc);
  if (root === 'xmeml') return parseXMEML(doc);
  throw new Error(`Unrecognized timeline file (<${root}>).`);
}

// ---------- Building the sequence ----------
const Interchange = {
  // Media items for every file the timeline needs: existing ones, newly imported ones, or offline placeholders.
  async resolveMedia(parsed, picked) {
    const needed = [...new Set(parsed.items.filter((i) => i.file).map((i) => normName(i.file)))];
    const byName = new Map(Model.data.media.map((m) => [normName(m.name), m]));
    const toImport = needed.map((n) => !byName.has(n) && picked.get(n)).filter(Boolean);
    if (toImport.length) for (const m of await Media.importFiles(toImport)) byName.set(normName(m.name), m);
    const placeholders = [];
    for (const n of needed) {
      if (byName.has(n)) continue;
      const its = parsed.items.filter((i) => normName(i.file) === n);
      const file = its[0].file;
      const kind = /\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff)$/i.test(file) ? 'audio' : /\.(png|jpe?g|tiff?|bmp|webp|gif)$/i.test(file) ? 'image' : 'video';
      const id = uid();
      const item = {
        id, name: file, kind, size: 0, fileKey: `framecrop:${id}`,
        duration: kind === 'image' ? Infinity : Math.max(...its.map((i) => i.srcIn + i.duration * (i.speed || 1))) + 1,
        width: parsed.width || Model.seq.width, height: parsed.height || Model.seq.height, fps: null,
        hasAudio: kind !== 'image', hasVideo: kind !== 'audio',
      };
      MediaRT.set(id, { url: null, status: 'offline', thumb: null, peaks: null });
      placeholders.push(item);
      byName.set(n, item);
    }
    return { byName, placeholders };
  },

  build(parsed, byName, placeholders, mode) {
    let count = 0;
    History.step(`Import Timeline ${parsed.name}`, () => {
      const seq = Model.seq;
      Model.data.media.push(...placeholders);
      if (mode === 'replace') {
        seq.clips = [];
        seq.markers = [];
        seq.inPoint = seq.outPoint = null;
        seq.name = parsed.name || seq.name;
        if (parsed.fps) seq.fps = snapFps(parsed.fps);
        if (parsed.width && parsed.height) { seq.width = parsed.width; seq.height = parsed.height; }
      }
      const fps = seq.fps;
      const offset = mode === 'append' ? Model.duration() : 0;
      for (const kind of ['video', 'audio']) {
        const need = Math.max(0, ...parsed.items.filter((i) => (i.kind === 'audio' ? 'audio' : 'video') === kind).map((i) => i.track));
        while (Model.tracks(kind).length < need) Ops.addTrack(kind);
      }
      const made = [];
      for (const it of parsed.items) {
        const kind = it.kind === 'audio' ? 'audio' : 'video';
        const track = Model.tracks(kind)[it.track - 1];
        const start = offset + Math.round(it.start * fps);
        const duration = Math.max(1, Math.round(it.duration * fps));
        let c;
        if (it.kind === 'title') {
          c = makeClip('title', { trackId: track.id, start, duration, name: it.label || 'Title', title: { text: it.text || it.label || 'Title', size: Math.round(seq.height * 0.07) } });
        } else {
          const m = byName.get(normName(it.file));
          if (!m) continue;
          let srcIn = it.srcIn || 0;
          // Source timecodes that start at 01:00:00:00 (common for Resolve renders).
          if (Number.isFinite(m.duration) && m.duration > 0 && srcIn >= m.duration && Media.isOnline(m.id)) srcIn %= 3600;
          c = makeClip(kind === 'audio' ? 'audio' : m.kind === 'image' ? 'image' : 'video', { trackId: track.id, mediaId: m.id, name: it.label || m.name, start, duration, offset: srcIn });
          c.speed = clamp(it.speed || 1, 0.1, 10);
        }
        made.push(c);
      }
      // Link picture and sound that came from the same file at the same spot.
      const groups = new Map();
      for (const c of made) {
        if (!c.mediaId) continue;
        const key = `${c.mediaId}|${c.start}|${c.duration}`;
        (groups.get(key) || groups.set(key, []).get(key)).push(c);
      }
      for (const g of groups.values()) {
        if (g.some((c) => c.kind === 'audio') && g.some((c) => c.kind !== 'audio')) {
          const id = uid();
          for (const c of g) c.linkId = id;
        }
      }
      seq.clips.push(...made);
      for (const tr of parsed.transitions) {
        const track = Model.tracks(tr.kind)[tr.track - 1];
        if (!track) continue;
        const at = offset + Math.round(tr.at * fps);
        const d = Math.max(2, Math.round(tr.duration * fps));
        const clips = Model.clipsOn(track.id);
        const incoming = clips.find((c) => Math.abs(c.start - at) <= 1);
        const outgoing = clips.find((c) => Math.abs(Model.end(c) - at) <= 1);
        const type = tr.kind === 'audio' ? 'constant-power' : tr.type;
        if (incoming) incoming.transIn = { type, duration: Math.min(d, incoming.duration) };
        else if (outgoing) outgoing.transOut = { type, duration: Math.min(d, outgoing.duration) };
      }
      count = made.length;
      if (!count) return false;
    });
    return count;
  },

  async openFile(file) {
    let text;
    try { text = await file.text(); } catch { toast(`Couldn't read "${file.name}".`); return; }
    let parsed;
    try { parsed = parseTimeline(file.name, text); } catch (err) { toast(err.message); return; }
    timelineImportDialog(file, text, parsed);
  },
};

function timelineImportDialog(file, text, parsed) {
  const picked = new Map();
  const empty = !Model.seq.clips.length;
  const kinds = (k) => new Set(parsed.items.filter((i) => (i.kind === 'audio' ? 'audio' : 'video') === k).map((i) => i.track)).size;
  openDialog({
    title: 'Import Timeline',
    width: 640,
    okLabel: 'Import',
    body: `
      <div class="xi">
        <p class="xi-head"><b>${esc(parsed.name)}</b> · ${esc(parsed.format)}</p>
        <p class="pdialog-note" data-info></p>
        ${parsed.needsFps ? `<div class="prow"><span class="prow-label">Frame rate</span><select class="pselect" name="fps">${FPS_PRESETS.map((f) => `<option value="${f}" ${f === Model.fps ? 'selected' : ''}>${f} fps</option>`).join('')}</select><span class="pdialog-note">EDLs don't store it</span></div>` : ''}
        <div class="xi-media-head"><b>Media</b><span class="tl-spacer"></span>
          <button type="button" class="pbtn pbtn-sm" data-pick="files">Choose files…</button>
          <button type="button" class="pbtn pbtn-sm" data-pick="folder">Choose folder…</button></div>
        <div class="xi-media" data-media></div>
        <div class="prow"><span class="prow-label">Place</span>
          <label class="pcheck"><input type="radio" name="mode" value="replace" ${empty ? 'checked' : ''}> Replace the current timeline</label>
          <label class="pcheck"><input type="radio" name="mode" value="append" ${empty ? '' : 'checked'}> Add after the end</label></div>
        <p class="pdialog-note">Cuts, track layout, speed changes, titles and dissolves come across. Color grades, effects and audio levels don't travel in these formats. Missing files come in offline; relink them from the Project panel.</p>
      </div>`,
    onMount(api) {
      const draw = () => {
        parsed = api.form.fps ? parseTimeline(file.name, text, +api.form.fps.value) : parsed;
        const needed = [...new Set(parsed.items.filter((i) => i.file).map((i) => i.file))];
        const inProject = new Set(Model.data.media.filter((m) => Media.isOnline(m.id)).map((m) => normName(m.name)));
        api.el.querySelector('[data-info]').textContent = `${parsed.items.length} clips on ${kinds('video')} video and ${kinds('audio')} audio track${kinds('audio') === 1 ? '' : 's'}`
          + `${parsed.transitions.length ? ` · ${parsed.transitions.length} transition${parsed.transitions.length === 1 ? '' : 's'}` : ''}`
          + `${parsed.fps ? ` · ${Math.round(parsed.fps * 1000) / 1000} fps` : ''}${parsed.width ? ` · ${parsed.width}×${parsed.height}` : ''}`;
        api.el.querySelector('[data-media]').innerHTML = needed.map((n) => {
          const k = normName(n);
          const status = inProject.has(k) ? ['ok', 'in project'] : picked.has(k) ? ['ok', 'found'] : ['miss', 'missing — will be offline'];
          return `<div class="xi-row"><span class="xi-dot ${status[0]}"></span><span class="xi-name">${esc(n)}</span><span class="xi-status">${status[1]}</span></div>`;
        }).join('') || '<p class="pdialog-note">This timeline only has titles or generators.</p>';
      };
      api.el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        if (b.dataset.pick === 'folder') input.webkitdirectory = true;
        input.onchange = () => {
          for (const f of input.files) picked.set(normName(f.name), f);
          draw();
        };
        input.click();
      }));
      api.form.fps?.addEventListener('change', draw);
      draw();
    },
    onOk(api) {
      const mode = api.form.mode.value;
      (async () => {
        App.busy('Importing timeline…');
        try {
          const { byName, placeholders } = await Interchange.resolveMedia(parsed, picked);
          const n = Interchange.build(parsed, byName, placeholders, mode);
          Bus.emit('sequence');
          Bus.emit('media');
          Timeline.zoomToFit();
          Player.seek(mode === 'append' ? Model.seq.playhead : 0);
          const offline = placeholders.length ? ` · ${placeholders.length} file${placeholders.length === 1 ? '' : 's'} offline` : '';
          toast(`Imported ${n} clip${n === 1 ? '' : 's'} from ${parsed.name}${offline}`);
        } catch (err) {
          console.error(err);
          toast(`Timeline import failed: ${err.message}`);
        } finally {
          App.busy(false);
        }
      })();
    },
  });
}
