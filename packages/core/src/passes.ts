/**
 * Backend-agnostic GPU contract. `core` never imports WebGL or WebGPU types;
 * `@webtoe/gpu` implements this facade per backend. TOP ops describe their work
 * as TexturePassSpecs and the backend owns resources, pipelines and pooling.
 */
import type { NodeInst } from './node';

export interface TextureHandle {
  readonly id: number;
  readonly width: number;
  readonly height: number;
}

export type UniformValue = number | number[];

export interface TexturePassSpec {
  /** shader registered via GpuFacade.registerShader */
  shaderId: string;
  uniforms: Record<string, UniformValue>;
  inputs: (TextureHandle | null)[];
  output: { width: number; height: number };
}

export interface ShaderSources {
  /** WebGL2 GLSL 300 es fragment source */
  glsl?: string;
  /** WebGPU WGSL fragment source */
  wgsl?: string;
}

export type BackendName = 'webgl2' | 'webgpu';

/** Target rectangle for canvas compositing, in CSS pixels from the top-left. */
export interface BlitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  clip?: { x: number; y: number; w: number; h: number };
  /** 1 = opaque (default). Below 1 the blit is dimmed and does NOT clear the
   *  region first — used for the TouchDesigner-style network backdrop. */
  opacity?: number;
  /** 'contain' (default) letterboxes; 'cover' fills the rect. */
  fit?: 'contain' | 'cover';
}

export interface GpuFacade {
  readonly name: BackendName;
  /** engine forwards time each frame so backends can inject `u_time` */
  setTime(seconds: number): void;
  registerShader(id: string, sources: ShaderSources): void;
  /** Run one fullscreen pass into the node's pooled target. `slot` lets one op
   *  own several targets (e.g. separable blur ping-pong); default 'main'. */
  runPass(node: NodeInst, spec: TexturePassSpec, slot?: string): TextureHandle;
  /** Previous-frame 'main' output of `node` (ping-pong) — feedback's escape hatch. */
  previousFrame(node: NodeInst): TextureHandle | null;
  /** Upload image/video/canvas pixels into node's pooled texture. */
  uploadMedia(node: NodeInst, source: TexImageSource, flipY?: boolean): TextureHandle;
  /** Clear the visible canvas to transparent — call once per frame before
   *  compositing viewer/preview rects. */
  clearCanvas(): void;
  /** Draw a texture to the visible canvas. With no rect: full-canvas letterbox.
   *  With rect (CSS px, top-left origin): letterbox inside that rect, optionally
   *  clipped to `clip` (e.g. the network panel bounds). */
  blitToCanvas(tex: TextureHandle, rect?: BlitRect): void;
  /** Read back a small RGBA8 thumbnail (perf: throttled by caller). */
  readPixels(tex: TextureHandle, w: number, h: number): Uint8ClampedArray;
  /** Render a 3D scene into the node's pooled target (depth-buffered).
   *  Backends may not support it (v1: WebGL2 only) — they throw a clear error
   *  the engine surfaces as a node error badge. */
  renderScene(node: NodeInst, spec: ScenePassSpec): TextureHandle;
  /** Drop pooled resources owned by a deleted node. */
  releaseNode(node: NodeInst): void;
  dispose(): void;
}

export interface SceneDraw {
  geo: import('./types').GeometryData;
  /** stable cache key (node path); pairs with geo.version for VAO caching */
  geoKey: string;
  model: Float32Array;
  material: import('./types').MaterialSpec;
  instances?: { count: number; translate: Float32Array; color?: Float32Array };
}

export interface ScenePassSpec {
  camera: { view: Float32Array; proj: Float32Array };
  lights: import('./types').SceneLight[];
  draws: SceneDraw[];
  output: { width: number; height: number };
  clear: [number, number, number, number];
}
