import type {
  BlitRect, GpuFacade, NodeInst, ShaderSources, TextureHandle, TexturePassSpec,
} from '@webtoe/core';

/**
 * WebGPU implementation of the pass contract — v1 ships pilot coverage to
 * prove the contract is backend-neutral (PLAN §4); full TOP parity is M7.
 *
 * Uniform packing rule (binding 1): op uniforms sorted by name, each padded
 * to one vec4<f32> (scalar→x, vec2→xy, vec3/4→xyzw). Binding 0 is globals
 * { res: vec4f, time: vec4f }. Inputs: sampler at 2, textures at 3+i.
 * WGSL op shaders declare matching structs; a unit test enforces presence.
 *
 * Known v1 limits: readPixels returns empty (GPU readback is async — thumbs
 * are disabled on this backend until M7), media upload supported.
 */

interface Target {
  curr: GPUTexture;
  prev: GPUTexture;
  w: number;
  h: number;
  currHandle: TextureHandle;
  prevHandle: TextureHandle;
  /** cook step of the latest render, and how many renders so far */
  writtenStep: number;
  renders: number;
  /** persistent uniform buffer, grown on demand (was one leaked buffer per pass) */
  ubo: GPUBuffer | null;
  uboSize: number;
}

const FORMAT: GPUTextureFormat = 'rgba8unorm';
const MAX_INPUTS = 4;

const BLIT_WGSL = `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  // targets hold WebGL's row order (row 0 = uv.y 0), so the top of the
  // canvas samples uv.y = 1 — no flip here
  o.uv = p[i] * 0.5 + 0.5;
  return o;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  return textureSample(tex, samp, in.uv);
}`;

const COPY_WGSL = `
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  return textureSample(tex0, samp, in.uv);
}`;

const PASS_VERT_WGSL = `
struct Globals { res: vec4f, time: vec4f }
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  // WebGPU's framebuffer row 0 is the top (NDC y = +1); WebGL's is the bottom.
  // Writing uv.y = 0 into row 0 keeps every target in WebGL's row order, so a
  // pass that samples its input at uv reads the same texel on both backends
  // (otherwise each input sample flips the image and odd chains look mirrored),
  // and @builtin(position) matches gl_FragCoord texel for texel.
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}`;

let nextHandleId = 1_000_000; // distinct range from webgl2 for debuggability

export class WebGPUBackend implements GpuFacade {
  readonly name = 'webgpu' as const;
  private time = 0;
  /** cook step counter — one setTime per step */
  private step = 0;
  private readonly sources = new Map<string, ShaderSources>();
  private readonly pipelines = new Map<string, GPURenderPipeline>();
  private readonly targets = new Map<string, Target>();
  private readonly textures = new Map<number, GPUTexture>();
  private readonly mediaTargets = new Map<string, { tex: GPUTexture; handle: TextureHandle; w: number; h: number }>();
  private blitPipeline: GPURenderPipeline | null = null;

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly canvasFormat: GPUTextureFormat,
    private readonly sampler: GPUSampler,
  ) {}

  static async create(canvas: HTMLCanvasElement): Promise<WebGPUBackend> {
    if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this browser');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('no webgpu canvas context');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat, alphaMode: 'premultiplied' });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    return new WebGPUBackend(device, context, canvasFormat, sampler);
  }

  setTime(seconds: number): void {
    this.time = seconds;
    this.step++;
  }

  registerShader(id: string, sources: ShaderSources): void {
    if (!this.sources.has(id)) this.sources.set(id, sources);
  }

  runPass(node: NodeInst, spec: TexturePassSpec, slot = 'main'): TextureHandle {
    const t = this.ensureTarget(node, slot, spec.output.width, spec.output.height);
    const pipeline = this.pipeline(spec.shaderId, spec.inputs.length);

    // pack uniforms: globals at offset 0, sorted vec4-padded op uniforms at 256
    // (uniform buffer offsets must be 256-aligned)
    const keys = Object.keys(spec.uniforms).sort();
    const opsBytes = Math.max(16, keys.length * 16);
    if (!t.ubo || t.uboSize < 256 + opsBytes) {
      t.ubo?.destroy();
      t.uboSize = 256 + opsBytes;
      t.ubo = this.device.createBuffer({ size: t.uboSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    const ubo = t.ubo;
    const globals = new Float32Array([t.w, t.h, 0, 0, this.time, 0, 0, 0]);
    this.device.queue.writeBuffer(ubo, 0, globals);
    const ops = new Float32Array(opsBytes / 4);
    keys.forEach((k, i) => {
      const v = spec.uniforms[k];
      const arr = typeof v === 'number' ? [v] : v;
      ops.set(arr.slice(0, 4), i * 4);
    });
    this.device.queue.writeBuffer(ubo, 256, ops);

    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: ubo, offset: 0, size: 32 } },
      { binding: 1, resource: { buffer: ubo, offset: 256, size: opsBytes } },
      { binding: 2, resource: this.sampler },
    ];
    for (let i = 0; i < MAX_INPUTS; i++) {
      const input = spec.inputs[i] ?? null;
      const tex = input ? this.textures.get(input.id) : null;
      entries.push({ binding: 3 + i, resource: (tex ?? this.dummyTexture()).createView() });
    }
    const bindGroup = this.device.createBindGroup({ layout: this.sharedLayout(), entries });

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: t.prev.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);

    const oldCurr = t.curr, oldCurrHandle = t.currHandle;
    t.curr = t.prev;
    t.currHandle = t.prevHandle;
    t.prev = oldCurr;
    t.prevHandle = oldCurrHandle;
    t.writtenStep = this.step;
    t.renders++;
    return t.currHandle;
  }

  /** The node's output from the previous cook step (see the WebGL2 backend). */
  previousFrame(node: NodeInst): TextureHandle | null {
    const t = this.targets.get(`${node.id}:main`);
    if (!t || t.renders === 0) return null;
    if (t.writtenStep === this.step) return t.renders >= 2 ? t.prevHandle : null;
    return t.currHandle;
  }

  renderScene(): TextureHandle {
    throw new Error('3D rendering requires the WebGL2 backend in v1 — open with ?backend=webgl2');
  }

  uploadMedia(node: NodeInst, source: TexImageSource, flipY = true): TextureHandle {
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
        m.tex.destroy();
        this.textures.delete(m.handle.id);
      }
      const tex = this.device.createTexture({
        size: [w, h],
        format: FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const handle = { id: nextHandleId++, width: w, height: h };
      this.textures.set(handle.id, tex);
      m = { tex, handle, w, h };
      this.mediaTargets.set(key, m);
    }
    this.device.queue.copyExternalImageToTexture(
      { source: source as GPUCopyExternalImageSource, flipY },
      { texture: m.tex },
      [w, h],
    );
    return m.handle;
  }

  clearCanvas(): void {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    });
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.frameCleared = true;
  }

  private frameCleared = false;

  blitToCanvas(tex: TextureHandle, rect?: BlitRect): void {
    if (!this.blitPipeline) {
      const mod = this.device.createShaderModule({ code: BLIT_WGSL });
      this.blitPipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: mod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] },
        primitive: { topology: 'triangle-list' },
      });
    }
    const src = this.textures.get(tex.id);
    if (!src) return;
    const target = this.context.getCurrentTexture();
    const cw = target.width, ch = target.height;
    const canvasEl = this.context.canvas as HTMLCanvasElement;
    const s = canvasEl.clientWidth > 0 ? cw / canvasEl.clientWidth : 1;
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
    // clamp to attachment bounds (validation requires it)
    const cx = Math.max(0, Math.round(clip.x));
    const cy = Math.max(0, Math.round(clip.y));
    const cwid = Math.min(cw - cx, Math.round(clip.w));
    const chei = Math.min(ch - cy, Math.round(clip.h));
    if (cwid <= 0 || chei <= 0) return;

    const bindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: src.createView() },
      ],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: target.createView(),
        loadOp: rect && this.frameCleared ? 'load' : 'clear',
        clearValue: { r: 0.07, g: 0.07, b: 0.09, a: 1 },
        storeOp: 'store',
      }],
    });
    const scale = Math.min(r.w / tex.width, r.h / tex.height);
    const w = Math.max(1, Math.floor(tex.width * scale));
    const h = Math.max(1, Math.floor(tex.height * scale));
    const vx = Math.max(0, Math.min(cw - 1, Math.floor(r.x + (r.w - w) / 2)));
    const vy = Math.max(0, Math.min(ch - 1, Math.floor(r.y + (r.h - h) / 2)));
    pass.setViewport(vx, vy, Math.min(w, cw - vx), Math.min(h, ch - vy), 0, 1);
    pass.setScissorRect(cx, cy, cwid, chei);
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** Async-readback thumbnails: returns the latest completed readback for this
   *  texture's owner slot and kicks off the next one. Empty until first completes. */
  readPixels(tex: TextureHandle, w: number, h: number): Uint8ClampedArray {
    const key = `${tex.id}:${w}x${h}`;
    const cached = this.thumbCache.get(key);
    if (!this.thumbPending.has(key)) {
      this.thumbPending.add(key);
      void this.captureThumb(tex, w, h, key).finally(() => this.thumbPending.delete(key));
    }
    return cached ?? new Uint8ClampedArray(0);
  }

  private readonly thumbCache = new Map<string, Uint8ClampedArray>();
  private readonly thumbPending = new Set<string>();
  private thumbScratch: { tex: GPUTexture; w: number; h: number } | null = null;

  private async captureThumb(src: TextureHandle, w: number, h: number, key: string): Promise<void> {
    const srcTex = this.textures.get(src.id);
    if (!srcTex) return;
    if (!this.thumbScratch || this.thumbScratch.w !== w || this.thumbScratch.h !== h) {
      this.thumbScratch?.tex.destroy();
      this.thumbScratch = {
        tex: this.device.createTexture({
          size: [w, h],
          format: FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
        }),
        w, h,
      };
    }
    // resize pass into scratch via the shared layout pipeline
    this.registerShader('__copy', { wgsl: COPY_WGSL });
    const pipeline = this.pipeline('__copy', 1);
    const ubo = this.device.createBuffer({ size: 256 + 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(ubo, 0, new Float32Array([w, h, 0, 0, this.time, 0, 0, 0]));
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: ubo, offset: 0, size: 32 } },
      { binding: 1, resource: { buffer: ubo, offset: 256, size: 16 } },
      { binding: 2, resource: this.sampler },
      { binding: 3, resource: srcTex.createView() },
    ];
    for (let i = 1; i < MAX_INPUTS; i++) entries.push({ binding: 3 + i, resource: this.dummyTexture().createView() });
    const bindGroup = this.device.createBindGroup({ layout: this.sharedLayout(), entries });

    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const buf = this.device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.thumbScratch.tex.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    enc.copyTextureToBuffer({ texture: this.thumbScratch.tex }, { buffer: buf, bytesPerRow }, [w, h]);
    this.device.queue.submit([enc.finish()]);

    try {
      await buf.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(buf.getMappedRange());
      // tight-pack rows, flipping vertically to match the GL readback convention
      const out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        const srcRow = y * bytesPerRow;
        out.set(mapped.subarray(srcRow, srcRow + w * 4), (h - 1 - y) * w * 4);
      }
      this.thumbCache.set(key, out);
    } finally {
      buf.destroy();
      ubo.destroy();
    }
  }

  releaseNode(node: NodeInst): void {
    for (const [key, t] of this.targets) {
      if (key.startsWith(`${node.id}:`)) {
        t.curr.destroy();
        t.ubo?.destroy();
        t.prev.destroy();
        this.textures.delete(t.currHandle.id);
        this.textures.delete(t.prevHandle.id);
        this.targets.delete(key);
      }
    }
    const m = this.mediaTargets.get(`${node.id}:media`);
    if (m) {
      m.tex.destroy();
      this.textures.delete(m.handle.id);
      this.mediaTargets.delete(`${node.id}:media`);
    }
  }

  dispose(): void {
    for (const t of this.targets.values()) {
      t.curr.destroy();
      t.ubo?.destroy();
      t.prev.destroy();
    }
    for (const m of this.mediaTargets.values()) m.tex.destroy();
    this.thumbScratch?.tex.destroy();
    this.thumbCache.clear();
    this.targets.clear();
    this.mediaTargets.clear();
    this.textures.clear();
    this.device.destroy();
  }

  // ---------------------------------------------------------------- private

  private dummy: GPUTexture | null = null;
  private layout: GPUBindGroupLayout | null = null;

  /** One shared layout for all op pipelines; shaders may use a subset. */
  private sharedLayout(): GPUBindGroupLayout {
    if (!this.layout) {
      const entries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ];
      for (let i = 0; i < MAX_INPUTS; i++) {
        entries.push({ binding: 3 + i, visibility: GPUShaderStage.FRAGMENT, texture: {} });
      }
      this.layout = this.device.createBindGroupLayout({ entries });
    }
    return this.layout;
  }

  private dummyTexture(): GPUTexture {
    if (!this.dummy) {
      this.dummy = this.device.createTexture({
        size: [1, 1],
        format: FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }
    return this.dummy;
  }

  private ensureTarget(node: NodeInst, slot: string, w: number, h: number): Target {
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    const key = `${node.id}:${slot}`;
    let t = this.targets.get(key);
    if (t && (t.w !== W || t.h !== H)) {
      t.curr.destroy();
      t.ubo?.destroy();
      t.prev.destroy();
      this.textures.delete(t.currHandle.id);
      this.textures.delete(t.prevHandle.id);
      t = undefined;
    }
    if (!t) {
      const make = () =>
        this.device.createTexture({
          size: [W, H],
          format: FORMAT,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
      const curr = make();
      const prev = make();
      const currHandle = { id: nextHandleId++, width: W, height: H };
      const prevHandle = { id: nextHandleId++, width: W, height: H };
      this.textures.set(currHandle.id, curr);
      this.textures.set(prevHandle.id, prev);
      t = { curr, prev, w: W, h: H, currHandle, prevHandle, writtenStep: -1, renders: 0, ubo: null, uboSize: 0 };
      this.targets.set(key, t);
    }
    return t;
  }

  private pipeline(shaderId: string, _inputCount: number): GPURenderPipeline {
    let p = this.pipelines.get(shaderId);
    if (p) return p;
    const src = this.sources.get(shaderId);
    if (!src?.wgsl) throw new Error(`no WGSL source registered for shader '${shaderId}' (webgpu backend)`);
    const mod = this.device.createShaderModule({ code: PASS_VERT_WGSL + '\n' + src.wgsl });
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.sharedLayout()] });
    p = this.device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: FORMAT }] },
      primitive: { topology: 'triangle-list' },
    });
    this.pipelines.set(shaderId, p);
    return p;
  }
}
