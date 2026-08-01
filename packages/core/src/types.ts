export type Family = 'TOP' | 'CHOP' | 'COMP' | 'DAT' | 'SOP' | 'MAT';

export type ParamScalar = number | string | boolean;
export type ParamVal = ParamScalar | number[];

export type ParamType = 'float' | 'int' | 'toggle' | 'menu' | 'string' | 'color' | 'xy';

export interface ParamSpec {
  key: string;
  label?: string;
  type: ParamType;
  default: ParamVal;
  min?: number;
  max?: number;
  step?: number;
  menu?: string[];
  /** parameter page (panel renders a section header per page) */
  page?: string;
}

export type ParamMode = 'const' | 'expr' | 'disabled-expr';

/** A parameter's stored state. `expr` is a WebToe expression; `tdExpr` preserves
 *  an untranslatable imported TouchDesigner expression for display only. */
export interface ParamValue {
  mode: ParamMode;
  value: ParamVal;
  expr?: string;
  tdExpr?: string;
}

export interface Channel {
  name: string;
  data: Float32Array;
}

export interface ChannelSet {
  kind: 'chop';
  channels: Channel[];
  /** samples per second; 60 for control-rate v1 */
  rate: number;
}

export interface TextureOut {
  kind: 'top';
  tex: import('./passes').TextureHandle;
}

export interface TextOut {
  kind: 'dat';
  text: string;
}

/** SOP geometry payload — typed-array-first (see docs/R3-3D-PLAN.md §1) */
export interface GeometryData {
  P: Float32Array;
  N?: Float32Array;
  uv?: Float32Array;
  Cd?: Float32Array;
  triangles?: Uint32Array;
  lineStrips?: Uint32Array[];
  renderPoints?: boolean;
  version: number;
}

export interface MaterialSpec {
  shading: 'constant' | 'lit' | 'line' | 'points' | 'wireframe';
  color: [number, number, number, number];
  map?: import('./passes').TextureHandle | null;
  pointSize?: number;
  lineWidth?: number;
  metallic?: number;
  roughness?: number;
  emit?: [number, number, number];
}

export interface SceneLight {
  kind: 'point' | 'directional' | 'ambient';
  color: [number, number, number];
  intensity: number;
  position: [number, number, number];
  direction: [number, number, number];
}

export interface SceneObject {
  role: 'geo' | 'camera' | 'light';
  model: Float32Array;
  geo?: GeometryData;
  geoKey?: string;
  material?: MaterialSpec;
  instances?: { count: number; translate: Float32Array; color?: Float32Array; scale?: Float32Array };
  camera?: { view: Float32Array; proj: Float32Array };
  light?: SceneLight;
}

export interface SopOut { kind: 'sop'; geo: GeometryData; }
export interface MatOut { kind: 'mat'; mat: MaterialSpec; }
export interface ObjOut { kind: 'obj'; obj: SceneObject; }

export type OpOutput = ChannelSet | TextureOut | TextOut | SopOut | MatOut | ObjOut | null;

export interface TimeContext {
  seconds: number;
  frame: number;
  delta: number;
  fps: number;
}

export interface InputState {
  mouse: { x: number; y: number; down: boolean };
}

// ---------- project JSON (versioned; see serialize.ts for migrations) ----------

export interface ParamValueJSON {
  mode: ParamMode;
  value: ParamVal;
  expr?: string;
  tdExpr?: string;
}

export interface NodeJSON {
  name: string;
  type: string;
  /** family hint — lets loaders fall back to the right stub when `type` is unknown */
  family?: Family;
  pos: [number, number];
  flags?: { display?: boolean; bypass?: boolean };
  params?: Record<string, ParamValueJSON>;
  /** import fallback: original foreign type label, shown on stub nodes */
  foreignType?: string;
  /** DAT payload */
  text?: string;
  children?: NodeJSON[];
  wires?: WireJSON[];
}

/** Wire within one network level: "srcName:outIndex" → "dstName:inIndex" */
export interface WireJSON {
  from: string;
  to: string;
}

export interface GraphJSON {
  app: 'webtoe';
  version: number;
  root: { nodes: NodeJSON[]; wires: WireJSON[] };
  meta?: Record<string, unknown>;
}

export interface ImportReport {
  nodesTotal: number;
  nodesMapped: number;
  nodesStubbed: number;
  exprTranslated: number;
  exprDisabled: number;
  notes: string[];
}
