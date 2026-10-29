// WebGL2 renderer: places each clip's frame, runs color nodes and effects,
// then composites tracks with motion, opacity, blend modes and transitions.
// All intermediate buffers hold premultiplied RGBA.

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() { uv = pos; gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0); }`;

const FRAG_HEAD = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D src;
vec3 unpremul(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
`;

const SHADERS = {
  copy: `void main() { o = texture(src, uv); }`,

  place: `
uniform vec4 rect;
uniform vec2 flip;
void main() {
  vec2 p = (uv - rect.xy) / rect.zw;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) { o = vec4(0.0); return; }
  p = mix(p, 1.0 - p, flip);
  o = texture(src, p);
}`,

  grade: `
uniform vec4 lift, gam, gain, offs;
uniform float contrast, pivot, sat, hue, temp, tint, expo, mixAmt;
uniform sampler2D curves;
uniform bool useCurves;
uniform highp sampler3D lut;
uniform bool useLut;
uniform float lutMix, lutSize;
uniform int winType;
uniform vec4 win;
uniform float winSoft;
uniform bool winInvert;
uniform vec2 aspect;
const vec3 W709 = vec3(0.2126, 0.7152, 0.0722);

vec3 rotateHue(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float cs = cos(a), sn = sin(a);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
}

float windowMask() {
  if (winType == 0) return 1.0;
  vec2 d = (uv - win.xy) / max(win.zw * 0.5, vec2(1e-4));
  float r = winType == 1 ? length(d) : max(abs(d.x), abs(d.y));
  float m = 1.0 - smoothstep(1.0 - winSoft, 1.0 + winSoft, r);
  return winInvert ? 1.0 - m : m;
}

void main() {
  vec4 s = texture(src, uv);
  vec3 c = unpremul(s);
  vec3 g = c * exp2(expo);
  g *= vec3(1.0 + temp * 0.004, 1.0 - tint * 0.003, 1.0 - temp * 0.004);
  g += offs.rgb + offs.a;
  vec3 L = lift.rgb + lift.a;
  vec3 K = 1.0 + gain.rgb + gain.a;
  vec3 G = max(vec3(0.05), 1.0 + gam.rgb + gam.a);
  g = K * (g + L * (1.0 - g));
  g = pow(max(g, 0.0), 1.0 / G);
  g = (g - pivot) * contrast + pivot;
  float y = dot(g, W709);
  g = y + (g - y) * sat;
  if (hue != 0.0) g = rotateHue(g, hue);
  g = clamp(g, 0.0, 1.0);
  if (useCurves) {
    g = vec3(texture(curves, vec2(g.r * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r,
             texture(curves, vec2(g.g * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).g,
             texture(curves, vec2(g.b * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).b);
  }
  if (useLut) {
    vec3 l = texture(lut, g * (lutSize - 1.0) / lutSize + 0.5 / lutSize).rgb;
    g = mix(g, l, lutMix);
  }
  c = mix(c, g, mixAmt * windowMask());
  o = vec4(clamp(c, 0.0, 1.0) * s.a, s.a);
}`,

  blur: `
uniform vec2 dir;
void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -7; i <= 7; i++) {
    float w = exp(-float(i * i) / 24.5);
    acc += texture(src, uv + dir * float(i)) * w;
    wsum += w;
  }
  o = acc / wsum;
}`,

  sharpen: `
uniform vec2 px;
uniform float amount;
void main() {
  vec4 c = texture(src, uv);
  vec4 n = texture(src, uv + vec2(px.x, 0.0)) + texture(src, uv - vec2(px.x, 0.0)) + texture(src, uv + vec2(0.0, px.y)) + texture(src, uv - vec2(0.0, px.y));
  vec4 r = c + (c - n * 0.25) * amount;
  o = vec4(clamp(r.rgb, 0.0, c.a), c.a);
}`,

  bw: `void main() { vec4 c = texture(src, uv); o = vec4(vec3(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))), c.a); }`,

  vignette: `
uniform float amount, size, softness;
uniform vec2 aspect;
void main() {
  vec4 c = texture(src, uv);
  float d = length((uv - 0.5) * aspect) * 1.4142;
  float v = smoothstep(size - softness, size + softness, d);
  vec3 rgb = amount >= 0.0 ? c.rgb * (1.0 - v * amount) : mix(c.rgb, vec3(c.a), v * -amount);
  o = vec4(rgb, c.a);
}`,

  chromakey: `
uniform vec3 key;
uniform float sim, smoothness, spill;
vec2 cbcr(vec3 c) { return vec2(dot(c, vec3(-0.1146, -0.3854, 0.5)), dot(c, vec3(0.5, -0.4542, -0.0458))); }
void main() {
  vec4 s = texture(src, uv);
  vec3 c = unpremul(s);
  float d = distance(cbcr(c), cbcr(key));
  float a = smoothstep(sim, sim + smoothness + 1e-4, d);
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sp = (1.0 - smoothstep(sim, sim + smoothness + 0.25, d)) * spill;
  c = mix(c, vec3(y), sp);
  float alpha = s.a * a;
  o = vec4(c * alpha, alpha);
}`,

  mosaic: `
uniform vec2 block;
void main() { o = texture(src, (floor(uv / block) + 0.5) * block); }`,

  grain: `
uniform float amount, seed;
uniform vec2 cells;
void main() {
  vec4 c = texture(src, uv);
  float n = fract(sin(dot(floor(uv * cells) + seed, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  o = vec4(clamp(c.rgb + n * amount * c.a, 0.0, c.a), c.a);
}`,

  bright: `
uniform float threshold;
void main() {
  vec4 c = texture(src, uv);
  vec3 rgb = unpremul(c);
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(rgb * smoothstep(threshold, threshold + 0.1, y) * c.a, c.a);
}`,

  add: `
uniform sampler2D other;
uniform float amount;
void main() { vec4 c = texture(src, uv); vec4 g = texture(other, uv); o = vec4(min(c.rgb + g.rgb * amount, vec3(c.a)), c.a); }`,

  composite: `
uniform sampler2D dst;
uniform vec2 seq;
uniform vec2 pos;
uniform float scale, rot, opacity;
uniform vec4 crop;
uniform int mode;
uniform int wipe;
uniform float wipeP;
uniform bool useSolid;
uniform vec4 solid;

vec3 blendFn(vec3 b, vec3 s) {
  if (mode == 1) return b * s;
  if (mode == 2) return b + s - b * s;
  if (mode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (mode == 4) return min(b + s, 1.0);
  if (mode == 5) return min(b, s);
  if (mode == 6) return max(b, s);
  if (mode == 7) return abs(b - s);
  return s;
}

void main() {
  vec4 d = texture(dst, uv);
  vec4 s;
  if (useSolid) {
    s = vec4(solid.rgb * solid.a, solid.a);
  } else {
    vec2 P = vec2(uv.x, 1.0 - uv.y) * seq;
    vec2 C = seq * 0.5;
    vec2 q = P - C - pos;
    float cs = cos(-rot), sn = sin(-rot);
    q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) / scale + C;
    bool inside = q.x >= crop.x * seq.x && q.x <= seq.x * (1.0 - crop.y) && q.y >= crop.z * seq.y && q.y <= seq.y * (1.0 - crop.w);
    s = inside ? texture(src, vec2(q.x / seq.x, 1.0 - q.y / seq.y)) : vec4(0.0);
  }
  float m = opacity;
  if (wipe == 1) m *= 1.0 - smoothstep(wipeP - 0.01, wipeP + 0.01, uv.x);
  if (wipe == 2) m *= smoothstep(1.0 - wipeP - 0.01, 1.0 - wipeP + 0.01, uv.x);
  s *= m;
  vec3 B = blendFn(unpremul(d), unpremul(s));
  vec3 rgb = (1.0 - d.a) * s.rgb + (1.0 - s.a) * d.rgb + s.a * d.a * B;
  o = vec4(rgb, s.a + d.a * (1.0 - s.a));
}`,

  output: `
void main() { vec4 a = texture(src, uv); o = vec4(a.rgb + (1.0 - a.a) * vec3(0.0), 1.0); }`,
};

const BLEND_INDEX = { normal: 0, multiply: 1, screen: 2, overlay: 3, add: 4, darken: 5, lighten: 6, difference: 7 };

const GL = {
  canvas: null,
  gl: null,
  programs: {},
  pool: [],
  textures: new WeakMap(),
  keyed: new Map(),
  lastScope: null,

  init(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    for (const [name, body] of Object.entries(SHADERS)) this.programs[name] = this.program(FRAG_HEAD + body);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.blank = this.makeTexture(1, 1, new Uint8Array([0, 0, 0, 0]));
    this.offline = this.canvasTexture(this.offlineSlate());
  },

  program(fragSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.bindAttribLocation(p, 0, 'pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name] = { loc: gl.getUniformLocation(p, info.name), type: info.type };
    }
    return { p, uniforms };
  },

  // ---------- Textures & framebuffers ----------
  makeTexture(w, h, data = null) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  },

  upload(tex, source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  },

  // Texture for an object (video element, bitmap); re-uploaded when asked.
  textureFor(obj, refresh) {
    let t = this.textures.get(obj);
    if (!t) { t = this.makeTexture(1, 1); this.textures.set(obj, t); refresh = true; }
    if (refresh) this.upload(t, obj);
    return t;
  },

  canvasTexture(canvas) {
    const t = this.makeTexture(1, 1);
    this.upload(t, canvas);
    return t;
  },

  // Cached by string key (titles, color mattes, curve tables).
  keyedTexture(id, key, build) {
    const e = this.keyed.get(id);
    if (e && e.key === key) return e.tex;
    if (e) this.gl.deleteTexture(e.tex);
    const tex = build();
    this.keyed.set(id, { key, tex });
    return tex;
  },

  curveTexture(node) {
    return this.keyedTexture(`curves:${node.id}`, JSON.stringify(node.curves), () => {
      const y = curveTable(node.curves.y);
      const ch = ['r', 'g', 'b'].map((k) => curveTable(node.curves[k]));
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        data[i * 4] = ch[0][y[i]];
        data[i * 4 + 1] = ch[1][y[i]];
        data[i * 4 + 2] = ch[2][y[i]];
        data[i * 4 + 3] = 255;
      }
      return this.makeTexture(256, 1, data);
    });
  },

  lutTexture(lutId) {
    const rt = LutRT.get(lutId);
    if (!rt) return null;
    const gl = this.gl;
    return this.keyedTexture(`lut:${lutId}`, String(rt.size), () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, rt.size, rt.size, rt.size, 0, gl.RGBA, gl.FLOAT, rt.data);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      return t;
    });
  },

  target(w, h) {
    let t = this.pool.find((x) => !x.busy && x.w === w && x.h === h);
    if (!t) {
      const gl = this.gl;
      const tex = this.makeTexture(w, h);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      t = { fb, tex, w, h };
      this.pool.push(t);
    }
    t.busy = true;
    return t;
  },

  release(...targets) {
    for (const t of targets) if (t) t.busy = false;
  },

  // Free buffers of sizes no longer in use (e.g. after changing preview quality).
  trimPool(w, h) {
    this.pool = this.pool.filter((t) => {
      if (t.busy || (t.w === w && t.h === h)) return true;
      this.gl.deleteFramebuffer(t.fb);
      this.gl.deleteTexture(t.tex);
      return false;
    });
  },

  // Run a shader from source texture(s) into a target (or the canvas when target is null).
  pass(name, target, uniforms, textures) {
    const gl = this.gl;
    const prog = this.programs[name];
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    let unit = 0;
    for (const [uname, tex] of Object.entries(textures)) {
      const u = prog.uniforms[uname];
      if (!u) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(u.type === gl.SAMPLER_3D ? gl.TEXTURE_3D : gl.TEXTURE_2D, tex);
      gl.uniform1i(u.loc, unit++);
    }
    for (const [uname, v] of Object.entries(uniforms)) {
      const u = prog.uniforms[uname];
      if (!u) continue;
      switch (u.type) {
        case gl.FLOAT: gl.uniform1f(u.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, typeof v === 'boolean' ? +v : v); break;
        default: break;
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  },

  clear(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  offlineSlate() {
    const c = makeCanvas(640, 360);
    const x = ctxOf(c);
    x.fillStyle = '#b3141b';
    x.fillRect(0, 0, 640, 360);
    x.fillStyle = '#fff';
    x.font = '700 34px Inter, sans-serif';
    x.textAlign = 'center';
    x.fillText('Media Offline', 320, 175);
    x.font = '18px Inter, sans-serif';
    x.fillText('Relink it from the Project panel', 320, 210);
    return c;
  },

  // ---------- Frame rendering ----------
  // Sources for each layer must already be prepared (see Compose.prepare).
  render(frame, { scopes = false } = {}) {
    const W = this.canvas.width, H = this.canvas.height;
    const seq = Model.seq;
    let accum = this.target(W, H);
    this.clear(accum);
    const layers = Compose.layers(frame);
    for (const L of layers) {
      if (L.solid) {
        const next = this.target(W, H);
        this.pass('composite', next, { useSolid: true, solid: L.solid, opacity: 1, mode: 0, seq: [seq.width, seq.height], scale: 1, crop: [0, 0, 0, 0], pos: [0, 0], rot: 0, wipe: 0 }, { dst: accum.tex, src: this.blank });
        this.release(accum);
        accum = next;
        continue;
      }
      const c = L.clip;
      let work;
      if (c.kind === 'adjustment') {
        work = this.target(W, H);
        this.pass('copy', work, {}, { src: accum.tex });
      } else {
        const srcTex = this.sourceTexture(L, W, H);
        if (!srcTex) continue;
        work = this.target(W, H);
        this.pass('place', work, { rect: srcTex.rect, flip: [0, 0] }, { src: srcTex.tex });
      }
      work = this.processClip(c, L.rel, work, W, H);
      const next = this.target(W, H);
      const isAdj = c.kind === 'adjustment';
      this.pass('composite', next, {
        seq: [seq.width, seq.height],
        pos: isAdj ? [0, 0] : [Param.at(c, 'motion.x', L.rel) + (L.dx || 0) * seq.width, Param.at(c, 'motion.y', L.rel)],
        scale: isAdj ? 1 : Math.max(0.001, (Param.at(c, 'motion.scale', L.rel) / 100) * (L.scale ?? 1)),
        rot: isAdj ? 0 : (Param.at(c, 'motion.rotation', L.rel) * Math.PI) / 180,
        crop: isAdj ? [0, 0, 0, 0] : [c.crop.l / 100, c.crop.r / 100, c.crop.t / 100, c.crop.b / 100],
        opacity: clamp((Param.at(c, 'opacity', L.rel) / 100) * (L.alpha ?? 1), 0, 1),
        mode: BLEND_INDEX[c.blend] || 0,
        wipe: L.wipe || 0,
        wipeP: L.wipeP || 0,
        useSolid: false,
      }, { dst: accum.tex, src: work.tex });
      this.release(accum, work);
      accum = next;
    }
    this.pass('output', null, {}, { src: accum.tex });
    if (scopes) this.captureScope(accum);
    this.release(accum);
  },

  // Texture + placement rect (in uv) for a layer's source.
  sourceTexture(L, W, H) {
    const c = L.clip;
    const seq = Model.seq;
    const full = [0, 0, 1, 1];
    if (c.kind === 'title') {
      const t = titleCanvas(c, W, H);
      return { tex: this.keyedTexture(`title:${c.id}`, t.key, () => this.canvasTexture(t.canvas)), rect: full };
    }
    if (c.kind === 'color') {
      return { tex: this.keyedTexture(`color:${c.id}`, c.fill, () => { const cv = makeCanvas(2, 2); const x = ctxOf(cv); x.fillStyle = c.fill; x.fillRect(0, 0, 2, 2); return this.canvasTexture(cv); }), rect: full };
    }
    const m = Model.media(c.mediaId);
    const rt = MediaRT.get(c.mediaId);
    if (!m || rt?.status !== 'ready') return { tex: this.offline, rect: full };
    let tex;
    if (m.kind === 'image') tex = this.textureFor(rt.image, false);
    else {
      const el = L.el;
      if (!el || el.readyState < 2) return L.lastTex ? { tex: L.lastTex, rect: this.fitRect(c, m) } : null;
      tex = this.textureFor(el, true);
    }
    return { tex, rect: this.fitRect(c, m) };
  },

  // Where the source sits in the frame before Motion: fitted or at native size.
  fitRect(c, m) {
    const seq = Model.seq;
    const k = c.motion.fit ? Math.min(seq.width / m.width, seq.height / m.height) : 1;
    const w = (m.width * k) / seq.width, h = (m.height * k) / seq.height;
    return [(1 - w) / 2, (1 - h) / 2, w, h];
  },

  // Color nodes then the effect stack.
  processClip(c, rel, work, W, H) {
    const swap = (name, uniforms, extra = {}) => {
      const out = this.target(W, H);
      this.pass(name, out, uniforms, { src: work.tex, ...extra });
      this.release(work);
      work = out;
    };
    for (const n of c.grade?.nodes || []) {
      if (!n.enabled || nodeIsNeutral(n)) continue;
      const lutTex = n.lutId ? this.lutTexture(n.lutId) : null;
      const w = n.window;
      swap('grade', {
        lift: n.lift, gam: n.gamma, gain: n.gain, offs: n.offset,
        contrast: n.contrast, pivot: n.pivot, sat: n.saturation, hue: (n.hue * Math.PI) / 180,
        temp: n.temperature, tint: n.tint, expo: n.exposure, mixAmt: n.mix,
        useCurves: true, useLut: !!lutTex, lutMix: n.lutMix, lutSize: LutRT.get(n.lutId)?.size || 2,
        winType: { none: 0, circle: 1, rect: 2 }[w.type], win: [w.x, 1 - w.y, w.w, w.h], winSoft: w.softness, winInvert: w.invert,
      }, { curves: this.curveTexture(n), lut: lutTex || this.dummy3d() });
    }
    const px = [1 / W, 1 / H];
    const k = W / Model.seq.width;
    for (const fx of c.effects || []) {
      if (!fx.enabled) continue;
      const p = (key) => Param.at(c, `fx.${fx.id}.${key}`, rel);
      switch (fx.type) {
        case 'blur': {
          const r = p('radius') * k;
          if (r < 0.5) break;
          const passes = r > 40 ? 2 : 1;
          for (let i = 0; i < passes; i++) {
            swap('blur', { dir: [(r / 7 / passes) / W, 0] });
            swap('blur', { dir: [0, (r / 7 / passes) / H] });
          }
          break;
        }
        case 'sharpen': swap('sharpen', { px, amount: p('amount') / 100 }); break;
        case 'bw': swap('bw', {}); break;
        case 'vignette': swap('vignette', { amount: p('amount') / 100, size: p('size') / 100, softness: p('softness') / 200, aspect: [W / H, 1] }); break;
        case 'chromakey': {
          const kc = hexToRgb(fx.params.color);
          swap('chromakey', { key: [kc.r / 255, kc.g / 255, kc.b / 255], sim: (p('similarity') / 100) * 0.4, smoothness: (p('smoothness') / 100) * 0.3, spill: p('spill') / 100 });
          break;
        }
        case 'mosaic': swap('mosaic', { block: [(p('blocks') * k) / W, (p('blocks') * k) / H] }); break;
        case 'grain': swap('grain', { amount: p('amount') / 100, seed: (Model.seq.playhead % 97) + 0.37, cells: [W / (p('size') * k || 1), H / (p('size') * k || 1)] }); break;
        case 'flipH': case 'flipV': {
          const out = this.target(W, H);
          this.pass('place', out, { rect: [0, 0, 1, 1], flip: fx.type === 'flipH' ? [1, 0] : [0, 1] }, { src: work.tex });
          this.release(work);
          work = out;
          break;
        }
        case 'glow': {
          const original = work;
          let g = this.target(W, H);
          this.pass('bright', g, { threshold: p('threshold') / 100 }, { src: original.tex });
          const r = p('radius') * k;
          for (const dir of [[r / 7 / W, 0], [0, r / 7 / H]]) {
            const out = this.target(W, H);
            this.pass('blur', out, { dir }, { src: g.tex });
            this.release(g);
            g = out;
          }
          const out = this.target(W, H);
          this.pass('add', out, { amount: p('intensity') / 100 }, { src: original.tex, other: g.tex });
          this.release(original, g);
          work = out;
          break;
        }
        default: break;
      }
    }
    return work;
  },

  dummy3d() {
    if (this._dummy3d) return this._dummy3d;
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this._dummy3d = t;
    return t;
  },

  // Small readback of the finished frame for the video scopes.
  captureScope(accum) {
    const w = 320, h = Math.max(1, Math.round((320 * accum.h) / accum.w));
    const t = this.target(w, h);
    this.pass('output', t, {}, { src: accum.tex });
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    this.release(t);
    this.lastScope = { px, w, h };
    Bus.emit('scope');
  },
};

// Parsed LUT data per LUT id (runtime only).
const LutRT = new Map();

// ---------- What's on screen at a frame ----------
const Compose = {
  // Layers bottom → top. Each: { clip, rel (frame within clip), srcTime, alpha, wipe, dx, scale, el } or { solid }.
  layers(frame) {
    const out = [];
    for (const track of Model.tracks('video')) {
      if (track.hidden) continue;
      out.push(...this.trackLayers(track, frame));
    }
    return out;
  },

  trackLayers(track, f) {
    const clips = Model.clipsOn(track.id).filter((c) => c.enabled);
    const layers = [];
    const solids = [];
    const add = (c, role, p, trans, twoSided) => {
      const L = { clip: c, rel: f - c.start, srcTime: Model.srcTime(c, f), alpha: 1, role };
      if (trans) {
        const type = trans.type;
        if (role === 'in') {
          if (type === 'cross-dissolve') L.alpha = p;
          if (type === 'zoom') { L.alpha = p; L.scale = 0.2 + 0.8 * p; }
          if (type === 'wipe-left') { L.wipe = 1; L.wipeP = p; }
          if (type === 'wipe-right') { L.wipe = 2; L.wipeP = p; }
          if (type === 'push' || type === 'slide') L.dx = 1 - p;
          if (type.startsWith('dip')) {
            if (twoSided && p < 0.5) return;
            solids.push({ solid: type === 'dip-white' ? [1, 1, 1, twoSided ? 2 - 2 * p : 1 - p] : [0, 0, 0, twoSided ? 2 - 2 * p : 1 - p] });
          }
        } else {
          if (!twoSided) {
            if (type === 'cross-dissolve' || type === 'zoom') L.alpha = 1 - p;
            if (type === 'wipe-left') { L.wipe = 2; L.wipeP = 1 - p; }
            if (type === 'wipe-right') { L.wipe = 1; L.wipeP = 1 - p; }
            if (type === 'push' || type === 'slide') L.dx = -p;
            if (type.startsWith('dip')) solids.push({ solid: type === 'dip-white' ? [1, 1, 1, p] : [0, 0, 0, p] });
          } else {
            if (type === 'push') L.dx = -p;
            if (type.startsWith('dip')) {
              if (p >= 0.5) return;
              solids.push({ solid: type === 'dip-white' ? [1, 1, 1, 2 * p] : [0, 0, 0, 2 * p] });
            }
          }
        }
      }
      layers.push(L);
    };
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const prev = clips[i - 1] && Model.end(clips[i - 1]) === c.start ? clips[i - 1] : null;
      const next = clips[i + 1] && clips[i + 1].start === Model.end(c) ? clips[i + 1] : null;
      const s = c.start, e = Model.end(c);
      // Transition into this clip from the previous one (centered on the cut).
      const tin = c.transIn;
      const tinHalf = tin ? Math.round(tin.duration / 2) : 0;
      if (tin && prev && f >= s - tinHalf && f < s) add(c, 'in', (f - (s - tinHalf)) / tin.duration, tin, true);
      // Outgoing part of a transition into the next clip.
      const tnext = next?.transIn;
      const tnHalf = tnext ? Math.round(tnext.duration / 2) : 0;
      if (tnext && f >= e && f < e - tnHalf + tnext.duration) { add(c, 'out', (f - (e - tnHalf)) / tnext.duration, tnext, true); continue; }
      if (f < s || f >= e) continue;
      if (tin && prev && f < s + tin.duration - tinHalf) add(c, 'in', (f - (s - tinHalf)) / tin.duration, tin, true);
      else if (tin && !prev && f < s + tin.duration) add(c, 'in', (f - s) / tin.duration, tin, false);
      else if (tnext && f >= e - tnHalf) add(c, 'out', (f - (e - tnHalf)) / tnext.duration, tnext, true);
      else if (c.transOut && !next && f >= e - c.transOut.duration) add(c, 'out', (f - (e - c.transOut.duration)) / c.transOut.duration, c.transOut, false);
      else add(c, 'normal');
    }
    layers.sort((a, b) => (a.role === 'out' ? 0 : a.role === 'normal' ? 1 : 2) - (b.role === 'out' ? 0 : b.role === 'normal' ? 1 : 2));
    for (const L of layers) {
      const m = L.clip.mediaId && Model.media(L.clip.mediaId);
      if (m?.kind === 'video') {
        L.srcTime = clamp(L.srcTime, 0, Math.max(0, m.duration - 0.001));
        L.el = Pool.get('video', m.id, L.clip.id)?.el;
      }
    }
    return [...layers, ...solids];
  },

  // Seek every video element on screen to its exact frame (for paused frames and export).
  async prepare(frame) {
    const layers = this.layers(frame);
    Pool.sweep();
    await Promise.all(layers.filter((L) => L.el).map((L) => {
      if (!L.el.paused) L.el.pause();
      return seekTo(L.el, L.srcTime).catch(() => {});
    }));
  },
};
