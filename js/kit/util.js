// Small helpers shared across PhotoCrop: math, canvases, colors, files, events.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const uid = () => Math.random().toString(36).slice(2, 10);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

// Tiny event bus so panels can react to document changes.
const Bus = (() => {
  const map = new Map();
  return {
    on(name, fn) { (map.get(name) || map.set(name, new Set()).get(name)).add(fn); },
    emit(name, data) { map.get(name)?.forEach((fn) => fn(data)); },
  };
})();

// ---------- Canvases ----------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctxOf(canvas) {
  return canvas.getContext('2d');
}

function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  ctxOf(c).drawImage(src, 0, 0);
  return c;
}

function fullRect(canvas) {
  return { x: 0, y: 0, w: canvas.width, h: canvas.height };
}

// Reusable scratch canvases, keyed by purpose. Returned cleared.
const Scratch = {
  pool: new Map(),
  get(key, w, h) {
    let c = this.pool.get(key);
    if (!c || c.width !== w || c.height !== h) {
      c = makeCanvas(w, h);
      this.pool.set(key, c);
    } else {
      const x = ctxOf(c);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'source-over';
      x.clearRect(0, 0, w, h);
    }
    return c;
  },
};

// Bounding box of non-transparent pixels, or null when the canvas is empty.
function contentBounds(canvas, threshold = 0) {
  const { width: w, height: h } = canvas;
  const d = ctxOf(canvas).getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    let row = y * w * 4 + 3;
    for (let x = 0; x < w; x++, row += 4) {
      if (d[row] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ---------- Rectangles ----------
function rectUnion(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function rectIntersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

function rectRoundOut(r) {
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

// ---------- Colors ----------
function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

function rgba({ r, g, b }, a = 1) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// h: 0–360, s/v: 0–1
function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToRgb({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: f(5), g: f(3), b: f(1) };
}

// h: 0–360, s/l: 0–1
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, s, l];
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [f(0), f(8), f(4)];
}

// ---------- Blur ----------
// Gaussian approximation: three box blurs on premultiplied RGBA. Edges are clamped.
function blurImageData(img, sigma) {
  if (sigma < 0.3) return img;
  const { width: w, height: h, data } = img;
  const a = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const al = data[i + 3] / 255;
    a[i] = data[i] * al;
    a[i + 1] = data[i + 1] * al;
    a[i + 2] = data[i + 2] * al;
    a[i + 3] = data[i + 3];
  }
  const b = new Float32Array(data.length);
  for (const size of boxSizes(sigma, 3)) {
    const r = (size - 1) / 2;
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  for (let i = 0; i < data.length; i += 4) {
    const al = a[i + 3];
    data[i + 3] = al;
    if (al > 0) {
      const k = 255 / al;
      data[i] = a[i] * k;
      data[i + 1] = a[i + 1] * k;
      data[i + 2] = a[i + 2] * k;
    }
  }
  return img;
}

// Gaussian blur of a whole canvas. Uses the browser's native canvas filter when
// available (much faster), padding with stretched edges so borders don't darken.
const HAS_CANVAS_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

function blurCanvas(src, sigma) {
  const w = src.width, h = src.height;
  if (sigma < 0.3) return cloneCanvas(src);
  if (!HAS_CANVAS_FILTER) {
    const c = cloneCanvas(src);
    const x = ctxOf(c);
    x.putImageData(blurImageData(x.getImageData(0, 0, w, h), sigma), 0, 0);
    return c;
  }
  const pad = Math.ceil(sigma * 3);
  const padded = makeCanvas(w + pad * 2, h + pad * 2);
  const p = ctxOf(padded);
  p.drawImage(src, pad, pad);
  p.drawImage(src, 0, 0, 1, h, 0, pad, pad, h);
  p.drawImage(src, w - 1, 0, 1, h, pad + w, pad, pad, h);
  p.drawImage(padded, 0, pad, w + pad * 2, 1, 0, 0, w + pad * 2, pad);
  p.drawImage(padded, 0, pad + h - 1, w + pad * 2, 1, 0, pad + h, w + pad * 2, pad);
  const out = makeCanvas(w, h);
  const o = ctxOf(out);
  o.filter = `blur(${sigma}px)`;
  o.drawImage(padded, -pad, -pad);
  o.filter = 'none';
  return out;
}

function boxSizes(sigma, n) {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function boxBlurH(src, dst, w, h, r) {
  const inv = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      const first = src[row + c];
      let val = (r + 1) * first;
      for (let j = 0; j < r; j++) val += src[row + Math.min(j, w - 1) * 4 + c];
      for (let x = 0; x < w; x++) {
        val += src[row + Math.min(x + r, w - 1) * 4 + c] - src[row + Math.max(x - r - 1, 0) * 4 + c];
        dst[row + x * 4 + c] = val * inv;
      }
    }
  }
}

function boxBlurV(src, dst, w, h, r) {
  const inv = 1 / (r + r + 1);
  const stride = w * 4;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      const col = x * 4 + c;
      let val = (r + 1) * src[col];
      for (let j = 0; j < r; j++) val += src[Math.min(j, h - 1) * stride + col];
      for (let y = 0; y < h; y++) {
        val += src[Math.min(y + r, h - 1) * stride + col] - src[Math.max(y - r - 1, 0) * stride + col];
        dst[y * stride + col] = val * inv;
      }
    }
  }
}

// ---------- Files ----------
function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const c = makeCanvas(bmp.width, bmp.height);
  ctxOf(c).drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Uses the system save dialog when the browser has one; otherwise downloads.
// Returns a file handle, 'download', or null when the person cancelled.
async function saveBlob(blob, suggestedName, type) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({ suggestedName, types: [type] });
      await writeHandle(handle, blob);
      return handle;
    } catch (err) {
      if (err.name === 'AbortError') return null;
    }
  }
  downloadBlob(blob, suggestedName);
  return 'download';
}

async function writeHandle(handle, blob) {
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

function baseName(name) {
  return String(name).replace(/\.[^.]+$/, '');
}
