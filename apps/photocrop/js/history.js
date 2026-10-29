// Undo history. Each step stores the document structure before and after,
// plus the changed pixels of any canvas edited in place (only the dirty area).

const HISTORY_LIMIT = 50;
const HISTORY_MAX_BYTES = 600 * 1024 * 1024;

class History {
  constructor(doc, baseName = 'Open') {
    this.doc = doc;
    this.entries = [{ name: baseName, icon: 'image', base: true }];
    this.index = 0;
    this.pending = null;
  }

  get current() { return this.entries[this.index]; }
  get canUndo() { return this.index > 0 && !this.pending; }
  get canRedo() { return this.index < this.entries.length - 1 && !this.pending; }

  begin(name, icon = 'image') {
    if (this.pending) this.commit();
    this.pending = { name, icon, before: this.doc.snapshotState(), backups: new Map() };
  }

  // Call before changing a canvas in place. Pass the area you'll touch,
  // nothing to record the whole canvas, or null to only take the backup.
  touch(canvas, rect) {
    const p = this.pending;
    if (!p || !canvas) return;
    let b = p.backups.get(canvas);
    if (!b) {
      b = { copy: cloneCanvas(canvas), rect: null, full: false };
      p.backups.set(canvas, b);
    }
    if (rect === undefined) b.full = true;
    else if (rect) b.rect = rectUnion(b.rect, rect);
  }

  // The untouched copy of a canvas taken by touch().
  backupOf(canvas) {
    return this.pending?.backups.get(canvas)?.copy || null;
  }

  commit() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const changes = [];
    for (const [canvas, b] of p.backups) {
      const r = b.full ? fullRect(canvas) : b.rect && rectIntersect(rectRoundOut(b.rect), fullRect(canvas));
      if (!r) continue;
      changes.push({ canvas, x: r.x, y: r.y, data: ctxOf(b.copy).getImageData(r.x, r.y, r.w, r.h) });
    }
    const entry = {
      name: p.name,
      icon: p.icon,
      before: p.before,
      after: this.doc.snapshotState(),
      changes,
      bytes: changes.reduce((sum, c) => sum + c.data.data.length, 0),
    };
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    this.index++;
    this.trim();
    this.doc.changed();
  }

  cancel() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    for (const [canvas, b] of p.backups) {
      const x = ctxOf(canvas);
      x.save();
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'copy';
      x.drawImage(b.copy, 0, 0);
      x.restore();
    }
    this.doc.restoreState(p.before);
    this.doc.changed();
  }

  // Runs fn as one history step; cancels the step if fn throws or returns false.
  step(name, icon, fn) {
    this.begin(name, icon);
    let ok;
    try {
      ok = fn();
    } catch (err) {
      this.cancel();
      throw err;
    }
    if (ok === false) this.cancel();
    else this.commit();
  }

  swap(entry) {
    for (const ch of entry.changes) {
      const x = ctxOf(ch.canvas);
      const current = x.getImageData(ch.x, ch.y, ch.data.width, ch.data.height);
      x.putImageData(ch.data, ch.x, ch.y);
      ch.data = current;
    }
  }

  undo() {
    if (!this.canUndo) return;
    const e = this.entries[this.index];
    this.swap(e);
    this.doc.restoreState(e.before);
    this.index--;
    this.doc.changed();
  }

  redo() {
    if (!this.canRedo) return;
    const e = this.entries[++this.index];
    this.swap(e);
    this.doc.restoreState(e.after);
    this.doc.changed();
  }

  goTo(i) {
    while (this.index > i && this.canUndo) this.undo();
    while (this.index < i && this.canRedo) this.redo();
  }

  trim() {
    let total = this.entries.reduce((sum, e) => sum + (e.bytes || 0), 0);
    while (this.entries.length - 1 > HISTORY_LIMIT || (total > HISTORY_MAX_BYTES && this.index > 1)) {
      const [removed] = this.entries.splice(1, 1);
      total -= removed.bytes;
      this.index--;
    }
  }
}
