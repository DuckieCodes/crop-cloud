// Editing commands used by the timeline, menus and keyboard. Each is one undo step.

const DEFAULT_STILL_SECONDS = 5;
const DEFAULT_TRANSITION_FRAMES = () => Math.round(Model.fps);

const Edit = {
  selected() {
    return [...App.sel].map((id) => Model.clip(id)).filter(Boolean);
  },

  // Select clips (and their linked partners when Linked Selection is on).
  select(ids, { add = false, toggle = false } = {}) {
    const withLinks = Ops.withPartners(ids, App.linked);
    if (!add && !toggle) App.sel.clear();
    for (const id of withLinks) {
      if (toggle && App.sel.has(id)) App.sel.delete(id);
      else App.sel.add(id);
    }
    App.selTrans = null;
    Bus.emit('selection');
  },

  clearSelection() {
    App.sel.clear();
    App.selTrans = null;
    Bus.emit('selection');
  },

  // ---------- Placing media ----------
  // First clip in an empty sequence: match the sequence to the footage (Premiere asks; we just do it).
  matchSequence(item) {
    const seq = Model.seq;
    if (Model.seq.clips.length || item.kind !== 'video') return;
    if (seq.width !== item.width || seq.height !== item.height || (item.fps && seq.fps !== item.fps)) {
      seq.width = item.width;
      seq.height = item.height;
      if (item.fps) seq.fps = item.fps;
      toast(`Sequence settings changed to match ${item.name} (${item.width} × ${item.height}${item.fps ? `, ${item.fps} fps` : ''}).`);
      Bus.emit('sequence');
    }
  },

  // Clips for a media item (video and audio parts, linked), not yet added to the sequence.
  clipsFor(item, frame, { videoTrack, audioTrack, inSec = 0, outSec = null } = {}) {
    const fps = Model.fps;
    const span = item.kind === 'image' ? DEFAULT_STILL_SECONDS : (outSec ?? item.duration) - inSec;
    const duration = Math.max(1, Math.round(span * fps));
    const linkId = item.kind === 'video' && item.hasAudio ? uid() : null;
    const out = [];
    if (item.kind !== 'audio' && videoTrack) {
      out.push(makeClip(item.kind === 'image' ? 'image' : 'video', { trackId: videoTrack.id, mediaId: item.id, name: item.name, start: frame, duration, offset: inSec, linkId }));
    }
    if (item.hasAudio && audioTrack) {
      out.push(makeClip('audio', { trackId: audioTrack.id, mediaId: item.id, name: item.name, start: frame, duration, offset: inSec, linkId }));
    }
    return out;
  },

  // Tracks for a drop on the given timeline row.
  dropTracks(track) {
    const vt = Model.tracks('video'), at = Model.tracks('audio');
    if (!track) return { videoTrack: vt.find((t) => t.target) || vt[0], audioTrack: at.find((t) => t.target) || at[0] };
    if (track.kind === 'video') {
      const n = vt.indexOf(track);
      return { videoTrack: track, audioTrack: at[n] || at[0] };
    }
    return { videoTrack: vt[at.indexOf(track)] || vt[0], audioTrack: track };
  },

  placeMedia(item, { track = null, frame = Model.seq.playhead, insert = false, inSec = 0, outSec = null } = {}) {
    let placed = [];
    History.step(insert ? 'Insert' : 'Overwrite', () => {
      this.matchSequence(item);
      const tracks = this.dropTracks(track);
      placed = this.clipsFor(item, frame, { ...tracks, inSec, outSec });
      if (!placed.length) return false;
      const len = placed[0].duration;
      if (insert) Ops.ripple(frame, len, Model.seq.tracks.filter((t) => !t.locked).map((t) => t.id));
      Model.seq.clips.push(...placed);
      if (!insert) Ops.overwrite(placed);
    });
    if (placed.length) this.select(placed.map((c) => c.id));
    return placed;
  },

  // Source monitor: , and . (insert / overwrite at the playhead using source In/Out).
  fromSource(insert) {
    const item = Source.item;
    if (!item) { toast('Open a clip in the Source monitor first (double-click it in the Project panel).'); return; }
    const { inSec, outSec } = Source.range();
    const { videoTrack, audioTrack } = this.dropTracks(null);
    const frame = Model.seq.playhead;
    this.placeMedia(item, { track: item.kind === 'audio' ? audioTrack : videoTrack, frame, insert, inSec, outSec });
    Player.seek(frame + Math.round((outSec - inSec) * Model.fps));
  },

  addSynthetic(kind, extra = {}) {
    const frame = Model.seq.playhead;
    const duration = Math.round(DEFAULT_STILL_SECONDS * Model.fps);
    let clip;
    History.step(`New ${kind === 'title' ? 'Text' : kind === 'color' ? 'Color Matte' : 'Adjustment Layer'}`, () => {
      const track = Ops.freeVideoTrack(frame, frame + duration);
      clip = makeClip(kind, { trackId: track.id, start: frame, duration, name: kind === 'title' ? 'Graphic' : kind === 'color' ? 'Color Matte' : 'Adjustment Layer', ...extra });
      Model.seq.clips.push(clip);
    });
    this.select([clip.id]);
    return clip;
  },

  // ---------- Deleting ----------
  deleteSelection(ripple = false) {
    if (App.selTrans) {
      const { clipId, side } = App.selTrans;
      History.step('Delete Transition', () => {
        const c = Model.clip(clipId);
        if (!c) return false;
        c[side === 'in' ? 'transIn' : 'transOut'] = null;
      });
      App.selTrans = null;
      return;
    }
    const ids = [...App.sel].filter((id) => !Model.track(Model.clip(id)?.trackId)?.locked);
    if (!ids.length) return;
    History.step(ripple ? 'Ripple Delete' : 'Clear', () => {
      if (ripple) Ops.rippleDelete(ids);
      else Ops.remove(ids);
    });
    this.clearSelection();
  },

  // Add Edit (Ctrl+K): cut clips under the playhead on targeted tracks (or all tracks).
  splitAtPlayhead(allTracks = false) {
    const f = Model.seq.playhead;
    const tracks = allTracks ? Model.seq.tracks : Model.seq.tracks.filter((t) => t.target || [...App.sel].some((id) => Model.clip(id)?.trackId === t.id));
    History.step(allTracks ? 'Add Edit to All Tracks' : 'Add Edit', () => {
      const before = Model.seq.clips.length;
      Ops.splitAt(f, tracks.map((t) => t.id));
      if (Model.seq.clips.length === before) return false;
    });
  },

  razor(clip, frame, allTracks) {
    History.step('Razor', () => {
      if (allTracks) Ops.splitAt(frame, Model.seq.tracks.map((t) => t.id));
      else {
        const targets = App.linked ? [clip, ...Model.partners(clip)] : [clip];
        Ops.splitAt(frame, targets.map((c) => c.trackId));
      }
    });
  },

  // Lift (;) leaves a gap; Extract (') closes it. Uses In/Out or the selection.
  liftExtract(extract) {
    const seq = Model.seq;
    if (seq.inPoint == null || seq.outPoint == null) {
      if (App.sel.size) this.deleteSelection(extract);
      else toast('Set In and Out points (I and O) to lift or extract a range.');
      return;
    }
    const from = seq.inPoint, to = seq.outPoint;
    History.step(extract ? 'Extract' : 'Lift', () => {
      const tracks = seq.tracks.filter((t) => !t.locked);
      for (const t of tracks) Ops.clearRange(t.id, from, to);
      if (extract) for (const t of tracks) Ops.closeGap(t.id, from, to);
      if (extract) { seq.outPoint = null; seq.inPoint = null; }
    });
  },

  // Q / W: ripple-trim the previous/next edit to the playhead.
  rippleTrimToPlayhead(which) {
    const f = Model.seq.playhead;
    History.step(which === 'prev' ? 'Ripple Trim Previous Edit' : 'Ripple Trim Next Edit', () => {
      let changed = false;
      for (const t of Model.seq.tracks) {
        if (t.locked) continue;
        const c = Model.clipAt(t.id, f);
        if (!c) continue;
        if (which === 'prev') {
          const cut = f - c.start;
          if (cut <= 0) continue;
          c.offset += (cut / Model.fps) * c.speed;
          c.duration -= cut;
          for (const o of Model.seq.clips) if (o.trackId === t.id && o !== c && o.start >= f) o.start -= cut;
          c.start = f - cut;
          c.start = Math.max(0, f - cut);
          changed = true;
        } else {
          const cut = Model.end(c) - f;
          if (cut <= 0) continue;
          c.duration -= cut;
          for (const o of Model.seq.clips) if (o.trackId === t.id && o !== c && o.start >= f + cut) o.start -= cut;
          changed = true;
        }
      }
      if (!changed) return false;
    });
    if (which === 'prev') {
      // The playhead lands on the new edit point.
      const c = Model.seq.clips.find((x) => x.start <= f && Model.end(x) > Math.max(0, f - 1));
      if (c) Player.seek(c.start);
    }
  },

  // ---------- Transitions ----------
  // Apply a transition at the edit point nearest the playhead on targeted tracks (Ctrl+D / Ctrl+Shift+D).
  applyDefaultTransition(kind) {
    const f = Model.seq.playhead;
    const tracks = Model.tracks(kind).filter((t) => !t.locked && (t.target || [...App.sel].some((id) => Model.clip(id)?.trackId === t.id)));
    const type = kind === 'video' ? 'cross-dissolve' : 'constant-power';
    let count = 0;
    History.step(kind === 'video' ? 'Apply Video Transition' : 'Apply Audio Transition', () => {
      for (const t of tracks) {
        const clips = Model.clipsOn(t.id);
        let best = null, bestD = Infinity;
        for (const c of clips) {
          for (const edge of [c.start, Model.end(c)]) {
            const d = Math.abs(edge - f);
            if (d < bestD) { bestD = d; best = { c, edge }; }
          }
        }
        if (!best) continue;
        this.setTransition(best.c, best.edge === best.c.start ? 'in' : 'out', type);
        count++;
      }
      if (!count) return false;
    });
    if (!count) toast('No edit point found on the targeted tracks.');
  },

  // Put a transition on one side of a clip; at a cut between two clips it goes on the incoming clip.
  setTransition(clip, side, type, duration = DEFAULT_TRANSITION_FRAMES()) {
    const clips = Model.clipsOn(clip.trackId);
    const i = clips.indexOf(clip);
    if (side === 'out' && clips[i + 1]?.start === Model.end(clip)) { clip = clips[i + 1]; side = 'in'; }
    const max = Math.max(2, clip.duration);
    clip[side === 'in' ? 'transIn' : 'transOut'] = { type, duration: Math.min(duration, max) };
  },

  // ---------- Clip properties ----------
  setSpeed(ids, speed, { keepDuration = false } = {}) {
    History.step('Speed/Duration', () => {
      for (const id of ids) {
        const c = Model.clip(id);
        if (!c || !Model.isTimed(c)) continue;
        const span = (c.duration / Model.fps) * c.speed;
        c.speed = clamp(speed, 0.1, 10);
        if (!keepDuration) c.duration = Math.max(1, Math.round((span / c.speed) * Model.fps));
        c.duration = Math.min(c.duration, Model.maxDuration(c));
      }
    });
  },

  toggleLink() {
    const clips = this.selected();
    if (!clips.length) return;
    const linked = clips.some((c) => c.linkId) && new Set(clips.map((c) => c.linkId)).size === 1 && clips[0].linkId;
    History.step(linked ? 'Unlink' : 'Link', () => {
      const id = linked ? null : uid();
      for (const c of clips) c.linkId = id;
    });
  },

  toggleEnabled() {
    const clips = this.selected();
    if (!clips.length) return;
    History.step('Enable', () => {
      const on = !clips.every((c) => c.enabled);
      for (const c of clips) c.enabled = on;
    });
  },

  nudge(frames) {
    const clips = this.selected();
    if (!clips.length) return;
    History.step('Nudge', () => {
      for (const c of clips) c.start = Math.max(0, c.start + frames);
      Ops.overwrite(clips);
    });
  },

  // ---------- Clipboard ----------
  clipboard: null,

  copy(cut = false) {
    const clips = this.selected();
    if (!clips.length) return;
    const base = Math.min(...clips.map((c) => c.start));
    this.clipboard = clips.map((c) => ({ ...structuredClone(c), start: c.start - base, track: Model.track(c.trackId) }));
    if (cut) this.deleteSelection(false);
  },

  paste(insert = false) {
    if (!this.clipboard?.length) return;
    const f = Model.seq.playhead;
    const links = new Map();
    let pasted = [];
    History.step(insert ? 'Paste Insert' : 'Paste', () => {
      pasted = this.clipboard.map((c) => {
        const copy = structuredClone({ ...c, track: undefined });
        delete copy.track;
        copy.id = uid();
        copy.start = f + c.start;
        if (c.linkId) {
          if (!links.has(c.linkId)) links.set(c.linkId, uid());
          copy.linkId = links.get(c.linkId);
        }
        copy.trackId = Model.track(c.trackId) ? c.trackId : Model.tracks(c.kind === 'audio' ? 'audio' : 'video')[0].id;
        return copy;
      });
      const len = Math.max(...pasted.map((c) => c.start + c.duration)) - f;
      if (insert) Ops.ripple(f, len, Model.seq.tracks.filter((t) => !t.locked).map((t) => t.id));
      Model.seq.clips.push(...pasted);
      if (!insert) Ops.overwrite(pasted);
    });
    this.select(pasted.map((c) => c.id));
    Player.seek(f + Math.max(...pasted.map((c) => c.start + c.duration - f)));
  },

  // Paste Attributes (Ctrl+Alt+V): motion, opacity, effects and grade from the copied clip.
  pasteAttributes() {
    const src = this.clipboard?.find((c) => c.kind !== 'audio');
    const srcAudio = this.clipboard?.find((c) => c.kind === 'audio');
    const targets = this.selected();
    if ((!src && !srcAudio) || !targets.length) { toast('Copy a clip, select other clips, then paste attributes.'); return; }
    History.step('Paste Attributes', () => {
      for (const c of targets) {
        if (c.kind === 'audio' && srcAudio) { c.volume = srcAudio.volume; c.pan = srcAudio.pan; continue; }
        if (c.kind === 'audio' || !src) continue;
        c.motion = structuredClone(src.motion);
        c.opacity = src.opacity;
        c.blend = src.blend;
        c.crop = structuredClone(src.crop);
        c.effects = src.effects.map((e) => ({ ...structuredClone(e), id: uid() }));
        c.grade = structuredClone(src.grade);
        c.grade.nodes.forEach((n) => { n.id = uid(); });
      }
    });
  },

  // ---------- Markers & In/Out ----------
  addMarker() {
    const f = Model.seq.playhead;
    History.step('Add Marker', () => {
      if (Model.seq.markers.some((m) => m.frame === f)) return false;
      Model.seq.markers.push({ id: uid(), frame: f, name: `Marker ${Model.seq.markers.length + 1}`, color: '#3ecf73' });
      Model.seq.markers.sort((a, b) => a.frame - b.frame);
    });
  },

  setInOut(which, frame = Model.seq.playhead) {
    History.step(which === 'in' ? 'Mark In' : which === 'out' ? 'Mark Out' : 'Clear In/Out', () => {
      const seq = Model.seq;
      if (which === 'in') { seq.inPoint = frame; if (seq.outPoint != null && seq.outPoint <= frame) seq.outPoint = null; }
      if (which === 'out') { seq.outPoint = frame + 1; if (seq.inPoint != null && seq.inPoint >= frame + 1) seq.inPoint = null; }
      if (which === 'clear-in') seq.inPoint = null;
      if (which === 'clear-out') seq.outPoint = null;
      if (which === 'clear') { seq.inPoint = null; seq.outPoint = null; }
    });
  },

  // Mark Clip (X): In/Out around the clip under the playhead.
  markClip() {
    const f = Model.seq.playhead;
    const c = Model.tracks('video').map((t) => Model.clipAt(t.id, f)).find(Boolean) || Model.tracks('audio').map((t) => Model.clipAt(t.id, f)).find(Boolean);
    if (!c) return;
    History.step('Mark Clip', () => { Model.seq.inPoint = c.start; Model.seq.outPoint = Model.end(c); });
  },

  // ---------- Navigation ----------
  jumpEdit(dir) {
    const f = Model.seq.playhead;
    const pts = Ops.editPoints();
    const target = dir > 0 ? pts.find((p) => p > f) : [...pts].reverse().find((p) => p < f);
    if (target != null) Player.seek(target);
  },

  jumpMarker(dir) {
    const f = Model.seq.playhead;
    const ms = Model.seq.markers.map((m) => m.frame);
    const target = dir > 0 ? ms.find((p) => p > f) : [...ms].reverse().find((p) => p < f);
    if (target != null) Player.seek(target);
  },

  addTrack(kind) {
    History.step(`Add ${kind === 'video' ? 'Video' : 'Audio'} Track`, () => { Ops.addTrack(kind); });
  },

  insertTrack(ref, where) {
    History.step(`Add ${ref.kind === 'video' ? 'Video' : 'Audio'} Track`, () => { Ops.insertTrack(ref, where); });
  },

  setChannels(track, channels) {
    History.step(channels === 'mono' ? 'Track to Mono' : 'Track to Stereo', () => { track.channels = channels; });
  },

  deleteTrack(track) {
    if (Model.tracks(track.kind).length <= 1) { toast('A sequence needs at least one track of each kind.'); return; }
    History.step('Delete Track', () => {
      Model.seq.clips = Model.seq.clips.filter((c) => c.trackId !== track.id);
      Model.seq.tracks = Model.seq.tracks.filter((t) => t !== track);
      Model.tracks(track.kind).forEach((t, i) => { t.name = `${t.kind === 'video' ? 'V' : 'A'}${i + 1}`; });
    });
  },
};
