import type {
  BlitRect, GpuFacade, NodeInst, ScenePassSpec, ShaderSources, TextureHandle, TexturePassSpec,
} from '@webtoe/core';
import { SceneRenderer } from './scene';

/**
 * WebGL2 implementation of the backend-agnostic pass contract.
 * Conventions injected per pass: `u_res` (output size), `u_time` (seconds),
 * inputs bound as `u_tex0..u_tex3`. Each (node, slot) owns a ping-pong texture
 * pair pooled by resolution; `previousFrame` exposes last frame's 'main'.
 */

interface Target {
  curr: WebGLTexture;
  prev: WebGLTexture;
  fbo: WebGLFramebuffer;
  depth: WebGLRenderbuffer | null;
  w: number;
  h: number;
  currHandle: TextureHandle;
  prevHandle: TextureHandle;
  /** true once at least one pass has rendered into prev */
  seeded: boolean;
}

interface Program {
  prog: WebGLProgram;
  locs: Map<string, WebGLUniformLocation | null>;
}

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex0;
uniform float u_opacity;   // 1.0 for normal blits; <1 dims the network backdrop
void main() { fragColor = texture(u_tex0, v_uv) * u_opacity; }`;

let nextHandleId = 1;

export class WebGL2Backend implements GpuFacade {
  readonly name = 'webgl2' as const;
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly sources = new Map<string, ShaderSources>();
  private readonly programs = new Map<string, Program>();
  private readonly targets = new Map<string, Target>();
  private readonly textures = new Map<number, WebGLTexture>();
  private readonly mediaTargets = new Map<string, { tex: WebGLTexture; handle: TextureHandle; w: number; h: number }>();
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true, // the canvas acts as a transparent compositor overlay
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    // fullscreen triangle-strip quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.registerShader('__blit', { glsl: BLIT_FRAG });
  }

  setTime(seconds: number): void {
    this.time = seconds;
  }

  registerShader(id: string, sources: ShaderSources): void {
    if (!this.sources.has(id)) this.sources.set(id, sources);
  }

  runPass(node: NodeInst, spec: TexturePassSpec, slot = 'main'): TextureHandle {
    const gl = this.gl;
    const t = this.ensureTarget(node, slot, spec.output.width, spec.output.height);
    const prog = this.program(spec.shaderId);
    gl.useProgram(prog.prog);

    // swap: render into prev, then flip so curr is the fresh frame
    const renderTo = t.prev;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTo, 0);
    gl.viewport(0, 0, t.w, t.h);

    this.setUniform(prog, 'u_res', [t.w, t.h]);
    this.setUniform(prog, 'u_time', this.time);
    for (const [k, v] of Object.entries(spec.uniforms)) this.setUniform(prog, k, v);
    spec.inputs.forEach((input, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, input ? this.textures.get(input.id) ?? null : null);
      const loc = this.loc(prog, `u_tex${i}`);
      if (loc) gl.uniform1i(loc, i);
    });

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // flip roles
    const oldCurr = t.curr, oldCurrHandle = t.currHandle;
    t.curr = renderTo;
    t.currHandle = t.prevHandle;
    t.prev = oldCurr;
    t.prevHandle = oldCurrHandle;
    t.seeded = true;
    return t.currHandle;
  }

  previousFrame(node: NodeInst): TextureHandle | null {
    const t = this.targets.get(`${node.id}:main`);
    if (!t || !t.seeded) return null;
    return t.prevHandle;
  }

  private scene: SceneRenderer | null = null;

  renderScene(node: NodeInst, spec: ScenePassSpec): TextureHandle {
    const gl = this.gl;
    this.scene ??= new SceneRenderer(gl);
    const t = this.ensureTarget(node, 'main', spec.output.width, spec.output.height);
    const depth = this.ensureDepth(t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.prev, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.viewport(0, 0, t.w, t.h);
    this.scene.render(spec, (id) => this.textures.get(id) ?? null);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const oldCurr = t.curr, oldCurrHandle = t.currHandle;
    t.curr = t.prev;
    t.currHandle = t.prevHandle;
    t.prev = oldCurr;
    t.prevHandle = oldCurrHandle;
    t.seeded = true;
    return t.currHandle;
  }

  uploadMedia(node: NodeInst, source: TexImageSource, flipY = true): TextureHandle {
    const gl = this.gl;
    const w = (source as { videoWidth?: number }).videoWidth
      ?? (source as { naturalWidth?: number }).naturalWidth
      ?? (source as { width: number }).width;
    const h = (source as { videoHeight?: number }).videoHeight
      ?? (source as { naturalHeight?: number }).naturalHeight
      ?? (source as { height: number }).height;
    const key = `${node.id}:media`;
    let m = this.mediaTargets.get(key);
    if (!m || m.w !== w || m.h !== h) {
      if (m) {
        gl.deleteTexture(m.tex);
        this.textures.delete(m.handle.id);
      }
      const tex = this.makeTexture(w, h);
      m = { tex, handle: this.handleFor(tex, w, h), w, h };
      this.mediaTargets.set(key, m);
    }
    gl.bindTexture(gl.TEXTURE_2D, m.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return m.handle;
  }

  clearCanvas(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  blitToCanvas(tex: TextureHandle, rect?: BlitRect): void {
    const gl = this.gl;
    const cw = this.canvas.width, ch = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // device-pixel rect (CSS top-left origin → GL bottom-left)
    const s = this.canvas.clientWidth > 0 ? cw / this.canvas.clientWidth : 1;
    const r = rect
      ? { x: rect.x * s, y: rect.y * s, w: rect.w * s, h: rect.h * s }
      : { x: 0, y: 0, w: cw, h: ch };
    let clip = r;
    if (rect?.clip) {
      const c = { x: rect.clip.x * s, y: rect.clip.y * s, w: rect.clip.w * s, h: rect.clip.h * s };
      const x0 = Math.max(r.x, c.x), y0 = Math.max(r.y, c.y);
      const x1 = Math.min(r.x + r.w, c.x + c.w), y1 = Math.min(r.y + r.h, c.y + c.h);
      if (x1 <= x0 || y1 <= y0) return;
      clip = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.round(clip.x), Math.round(ch - clip.y - clip.h), Math.round(clip.w), Math.round(clip.h));
    const opacity = rect?.opacity ?? 1;
    if (opacity >= 1) {
      gl.clearColor(0.06, 0.06, 0.08, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // cover (network backdrop) or contain-fit letterbox (viewer/thumbs)
    const scale = rect?.fit === 'cover'
      ? Math.max(r.w / tex.width, r.h / tex.height)
      : Math.min(r.w / tex.width, r.h / tex.height);
    const w = Math.max(1, Math.round(tex.width * scale));
    const h = Math.max(1, Math.round(tex.height * scale));
    const vx = Math.round(r.x + (r.w - w) / 2);
    const vyTop = r.y + (r.h - h) / 2;
    gl.viewport(vx, Math.round(ch - vyTop - h), w, h);
    const prog = this.program('__blit');
    gl.useProgram(prog.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.get(tex.id) ?? null);
    const loc = this.loc(prog, 'u_tex0');
    if (loc) gl.uniform1i(loc, 0);
    const oloc = this.loc(prog, 'u_opacity');
    if (oloc) gl.uniform1f(oloc, opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }

  readPixels(tex: TextureHandle, w: number, h: number): Uint8ClampedArray {
    const gl = this.gl;
    const scratchTex = this.makeTexture(w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scratchTex, 0);
    gl.viewport(0, 0, w, h);
    const prog = this.program('__blit');
    gl.useProgram(prog.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.get(tex.id) ?? null);
    const loc = this.loc(prog, 'u_tex0');
    if (loc) gl.uniform1i(loc, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(scratchTex);
    return new Uint8ClampedArray(out.buffer);
  }

  releaseNode(node: NodeInst): void {
    const gl = this.gl;
    for (const [key, t] of this.targets) {
      if (key.startsWith(`${node.id}:`)) {
        gl.deleteTexture(t.curr);
        gl.deleteTexture(t.prev);
        if (t.depth) gl.deleteRenderbuffer(t.depth);
        gl.deleteFramebuffer(t.fbo);
        this.textures.delete(t.currHandle.id);
        this.textures.delete(t.prevHandle.id);
        this.targets.delete(key);
      }
    }
    const m = this.mediaTargets.get(`${node.id}:media`);
    if (m) {
      gl.deleteTexture(m.tex);
      this.textures.delete(m.handle.id);
      this.mediaTargets.delete(`${node.id}:media`);
    }
  }

  dispose(): void {
    const gl = this.gl;
    this.scene?.dispose();
    for (const t of this.targets.values()) {
      gl.deleteTexture(t.curr);
      gl.deleteTexture(t.prev);
      if (t.depth) gl.deleteRenderbuffer(t.depth);
      gl.deleteFramebuffer(t.fbo);
    }
    for (const m of this.mediaTargets.values()) gl.deleteTexture(m.tex);
    for (const p of this.programs.values()) gl.deleteProgram(p.prog);
    this.targets.clear();
    this.mediaTargets.clear();
    this.programs.clear();
    this.textures.clear();
  }

  // ---------------------------------------------------------------- private

  private ensureTarget(node: NodeInst, slot: string, w: number, h: number): Target {
    const gl = this.gl;
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    const key = `${node.id}:${slot}`;
    let t = this.targets.get(key);
    if (t && (t.w !== W || t.h !== H)) {
      gl.deleteTexture(t.curr);
      gl.deleteTexture(t.prev);
      gl.deleteFramebuffer(t.fbo);
      this.textures.delete(t.currHandle.id);
      this.textures.delete(t.prevHandle.id);
      t = undefined;
    }
    if (!t) {
      const curr = this.makeTexture(W, H);
      const prev = this.makeTexture(W, H);
      const fbo = gl.createFramebuffer()!;
      t = {
        curr, prev, fbo, depth: null, w: W, h: H,
        currHandle: this.handleFor(curr, W, H),
        prevHandle: this.handleFor(prev, W, H),
        seeded: false,
      };
      this.targets.set(key, t);
    }
    return t;
  }

  private ensureDepth(t: Target): WebGLRenderbuffer {
    if (t.depth) return t.depth;
    const gl = this.gl;
    const rb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, t.w, t.h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    t.depth = rb;
    return rb;
  }

  private makeTexture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private handleFor(tex: WebGLTexture, w: number, h: number): TextureHandle {
    const handle = { id: nextHandleId++, width: w, height: h };
    this.textures.set(handle.id, tex);
    return handle;
  }

  private program(shaderId: string): Program {
    let p = this.programs.get(shaderId);
    if (p) return p;
    const src = this.sources.get(shaderId);
    if (!src?.glsl) throw new Error(`no GLSL source registered for shader '${shaderId}'`);
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, VERT, shaderId);
    const fs = this.compile(gl.FRAGMENT_SHADER, src.glsl, shaderId);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`shader link failed (${shaderId}): ${info}`);
    }
    p = { prog, locs: new Map() };
    this.programs.set(shaderId, p);
    return p;
  }

  private compile(kind: number, source: string, id: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(kind)!;
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`shader compile failed (${id}): ${info}`);
    }
    return sh;
  }

  private loc(p: Program, name: string): WebGLUniformLocation | null {
    if (!p.locs.has(name)) p.locs.set(name, this.gl.getUniformLocation(p.prog, name));
    return p.locs.get(name) ?? null;
  }

  private setUniform(p: Program, name: string, v: number | number[]): void {
    const gl = this.gl;
    const loc = this.loc(p, name);
    if (!loc) return;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else if (v.length === 4) gl.uniform4fv(loc, v);
    else gl.uniform1fv(loc, v);
  }
}
