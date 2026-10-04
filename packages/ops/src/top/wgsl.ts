/**
 * WGSL shaders, kept in parity with glsl.ts (same uniforms, same math).
 *
 * Packing rule: binding 0 = Globals { res, time } (vec4 each); binding 1 =
 * op uniforms sorted by name, one vec4f per uniform (scalar in .x, vec2 in
 * .xy, color in .xyzw); binding 2 = sampler; bindings 3..6 = input textures.
 * New shaders sample with textureSampleLevel(…, 0) so taps inside data-
 * dependent branches stay valid under WGSL's uniformity rules.
 */
import { RAMP_KC, RAMP_KP, RAMP_MAX_KEYS } from './tdmath';

/** `struct Ops` with the given uniform names in the backend's sorted order. */
export function opsStruct(names: readonly string[]): string {
  return `struct Ops { ${[...names].sort().map((n) => `${n}: vec4f`).join(', ')} }`;
}

export const constantWgsl = `
struct Ops { u_color: vec4f }
@group(0) @binding(1) var<uniform> P: Ops;
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  return P.u_color;
}`;

/** Ramp TOP — see glsl.ts rampGlsl for the measured TD rules. */
export const rampWgsl = `
${opsStruct(['u_type', 'u_phase', 'u_repeat', 'u_pos', 'u_aspect', 'u_extl', 'u_extr', 'u_interp', 'u_tension', 'u_n', 'u_premul', ...RAMP_KC, ...RAMP_KP])}
@group(0) @binding(1) var<uniform> P: Ops;
var<private> KC: array<vec4f, ${RAMP_MAX_KEYS}>;
var<private> KP: array<f32, ${RAMP_MAX_KEYS}>;
fn loadKeys() {
${RAMP_KC.map((n, i) => `  KC[${i}] = P.${n};`).join('\n')}
${RAMP_KP.map((n, i) => `  KP[${i * 4}] = P.${n}.x; KP[${i * 4 + 1}] = P.${n}.y; KP[${i * 4 + 2}] = P.${n}.z; KP[${i * 4 + 3}] = P.${n}.w;`).join('\n')}
}
fn rampColor(t: f32) -> vec4f {
  let n = i32(P.u_n.x + 0.5);
  var k0 = 0;
  for (var i = 1; i < ${RAMP_MAX_KEYS}; i++) {
    if (i >= n) { break; }
    if (KP[i] <= t) { k0 = i; }
  }
  let last = n - 1;
  let k1 = min(k0 + 1, last);
  let span = KP[k1] - KP[k0];
  var f = t - KP[k0];
  if (span > 0.0) { f = f / span; }
  let c0 = KC[k0];
  let c1 = KC[k1];
  let mode = i32(P.u_interp.x + 0.5);
  if (mode == 0) { return c0; }
  if (mode == 3) {
    let m0 = (1.0 - P.u_tension.x) * 0.5 * (c1 - KC[max(k0 - 1, 0)]);
    let m1 = (1.0 - P.u_tension.x) * 0.5 * (KC[min(k0 + 2, last)] - c0);
    let f2 = f * f;
    let f3 = f2 * f;
    return (2.0 * f3 - 3.0 * f2 + 1.0) * c0 + (f3 - 2.0 * f2 + f) * m0 + (f3 - f2) * m1 + (3.0 * f2 - 2.0 * f3) * c1;
  }
  if (mode == 2) { f = 0.5 - 0.5 * cos(3.14159265 * clamp(f, 0.0, 1.0)); }
  return mix(c0, c1, f);
}
fn rampFold(t: f32, ext: i32) -> f32 {
  if (ext == 2) { return t - floor(t); }
  if (ext == 3) {
    let m = abs(t) - 2.0 * floor(abs(t) * 0.5);
    return select(m, 2.0 - m, m > 1.0);
  }
  return clamp(t, 0.0, 1.0);
}
fn rampOutside(t: f32, ext: i32) -> vec4f {
  if (ext == 1) { return vec4f(0.0); }
  if (ext == 4) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  return rampColor(rampFold(t, ext));
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  loadKeys();
  let ty = i32(P.u_type.x + 0.5);
  var t: f32;
  if (ty == 0) {
    t = in.uv.x;
  } else if (ty == 1) {
    t = in.uv.y;
  } else {
    let d = (in.uv - 0.5 - P.u_pos.xy) * P.u_aspect.xy;
    if (ty == 2) {
      t = atan2(d.y, d.x) / 6.28318530;
      if (t < 0.0) { t = t + 1.0; }
    } else {
      t = 2.0 * length(d);
    }
  }
  if (ty <= 1) { t = (t - P.u_phase.x) * P.u_repeat.x; } else { t = t * P.u_repeat.x - P.u_phase.x; }
  var c: vec4f;
  if (t < 0.0) { c = rampOutside(t, i32(P.u_extl.x + 0.5)); }
  else if (t > 1.0) { c = rampOutside(t, i32(P.u_extr.x + 0.5)); }
  else { c = rampColor(t); }
  if (P.u_premul.x > 0.5) { c = vec4f(c.rgb * c.a, c.a); }
  return c;
}`;

/** Level TOP — TD order; see glsl.ts levelGlsl. */
export const levelWgsl = `
${opsStruct(['u_pre', 'u_contrast', 'u_range', 'u_low', 'u_high', 'u_post', 'u_clamp2', 'u_opacity'])}
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
fn lvGamma(x: vec3f, g: f32) -> vec3f {
  if (g == 1.0) { return x; }
  return pow(max(x, vec3f(0.0)), vec3f(1.0 / max(g, 1e-6)));
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let a = textureSampleLevel(tex0, samp, in.uv, 0.0);
  var x = clamp(a.rgb, vec3f(0.0), vec3f(1.0));
  x = x + P.u_pre.x * (1.0 - 2.0 * x);
  if (P.u_pre.y >= 1.0) { x = vec3f(0.0); } else { x = (x - P.u_pre.y) / (1.0 - P.u_pre.y); }
  x = x * P.u_pre.z;
  x = clamp(x, vec3f(0.0), vec3f(1.0));
  x = lvGamma(x, P.u_pre.w);
  x = (x - 0.5) * P.u_contrast.x + 0.5;
  let span = select(P.u_range.y - P.u_range.x, 1.0, P.u_range.y == P.u_range.x);
  x = (x - P.u_range.x) / span;
  x = P.u_range.z + x * (P.u_range.w - P.u_range.z);
  x = P.u_low.rgb + x * (P.u_high.rgb - P.u_low.rgb);
  x = lvGamma(x, P.u_post.x);
  x = x * P.u_post.y;
  let al = P.u_low.a + a.a * (P.u_high.a - P.u_low.a);
  if (P.u_post.z > 0.5) { x = clamp(x, vec3f(P.u_clamp2.x), vec3f(P.u_clamp2.y)); }
  if (P.u_post.w > 0.5) { x = x * al; }
  return vec4f(x * P.u_opacity.x, al * P.u_opacity.x);
}`;

/** Channel selector shared by Monochrome/Edge — same codes as glsl.ts. */
const TD_CHANNEL_WGSL = `
fn tdChannel(c: vec4f, s: i32) -> f32 {
  if (s == 1) { return c.r; }
  if (s == 2) { return c.g; }
  if (s == 3) { return c.b; }
  if (s == 4) { return c.a; }
  if (s == 5) { return (c.r + c.g + c.b) / 3.0; }
  if (s == 6) { return (c.r + c.g + c.b + c.a) * 0.25; }
  if (s == 7) { return max(c.r, max(c.g, c.b)); }
  if (s == 8) { return max(max(c.r, c.g), max(c.b, c.a)); }
  if (s == 9) { return 0.0; }
  if (s == 10) { return 1.0; }
  return dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
}`;

const NOISE_LIB_WGSL = `
fn hash3(p0: vec3f) -> f32 {
  var p = fract(p0 * vec3f(443.897, 441.423, 437.195));
  p = p + dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i);
  let n100 = hash3(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3f(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}
fn fbm(p0: vec3f, harmonics: f32) -> f32 {
  var p = p0;
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  for (var o = 0; o < 8; o++) {
    if (f32(o) >= harmonics) { break; }
    sum = sum + vnoise(p) * amp;
    norm = norm + amp;
    amp = amp * 0.5;
    p = p * 2.03;
  }
  return select(0.0, sum / norm, norm > 0.0);
}`;

export const noiseWgsl = `${NOISE_LIB_WGSL}
struct Ops { u_exponent: vec4f, u_harmonics: vec4f, u_mono: vec4f, u_offset: vec4f, u_period: vec4f, u_speed: vec4f }
@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var<uniform> P: Ops;
fn channel(p: vec3f, harmonics: f32, exponent: f32) -> f32 {
  return pow(clamp(fbm(p, harmonics), 0.0, 1.0), max(exponent, 1e-4));
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let uv = (in.uv + P.u_offset.xy) * max(G.res.x / G.res.y, 1.0);
  let p = vec3f(uv / max(P.u_period.x, 1e-4), G.time.x * P.u_speed.x);
  let h = P.u_harmonics.x;
  let e = P.u_exponent.x;
  let n = channel(p, h, e);
  var rgb = vec3f(n);
  if (P.u_mono.x < 0.5) {
    rgb = vec3f(n,
      channel(p + vec3f(13.7, 7.3, 5.1), h, e),
      channel(p + vec3f(29.1, 17.9, 11.3), h, e));
  }
  return vec4f(rgb, 1.0);
}`;

export const rectangleWgsl = `
struct Ops { u_bgcolor: vec4f, u_center: vec4f, u_color: vec4f, u_size: vec4f, u_softness: vec4f }
@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var<uniform> P: Ops;
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let p = in.uv - P.u_center.xy;
  let d2 = abs(p) - P.u_size.xy * 0.5;
  let d = max(d2.x, d2.y);
  let aa = max(P.u_softness.x, 1.5 / G.res.y);
  let m = 1.0 - smoothstep(0.0, aa, d);
  return mix(P.u_bgcolor, P.u_color, m);
}`;

export const transformWgsl = `
struct Ops { u_extend: vec4f, u_pivot: vec4f, u_rotate: vec4f, u_scale: vec4f, u_translate: vec4f }
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  var uv = in.uv - P.u_pivot.xy - P.u_translate.xy;
  let a = radians(-P.u_rotate.x);
  let c = cos(a);
  let s = sin(a);
  uv = mat2x2f(vec2f(c, s), vec2f(-s, c)) * uv;
  let sc = P.u_scale.xy;
  uv = uv / (max(abs(sc), vec2f(1e-6)) * sign(sc + vec2f(1e-9)));
  uv = uv + P.u_pivot.xy;
  var inside = 1.0;
  let mode = P.u_extend.x;
  if (mode < 0.5) {
    uv = clamp(uv, vec2f(0.0), vec2f(1.0));
  } else if (mode < 1.5) {
    uv = fract(uv);
  } else if (mode < 2.5) {
    uv = abs(fract(uv * 0.5) * 2.0 - 1.0);
  } else {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { inside = 0.0; }
    uv = clamp(uv, vec2f(0.0), vec2f(1.0));
  }
  return textureSample(tex0, samp, uv) * inside;
}`;

export const monochromeWgsl = `
${opsStruct(['u_rgb', 'u_alpha', 'u_clamp', 'u_weights'])}
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
${TD_CHANNEL_WGSL}
fn monoPick(c: vec4f, s: i32) -> f32 {
  if (s == 11) {
    let w = P.u_weights.xyz;
    return dot(c.rgb, w / max(w.x + w.y + w.z, 1e-6));
  }
  return tdChannel(c, s);
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let c = textureSampleLevel(tex0, samp, in.uv, 0.0);
  var l = monoPick(c, i32(P.u_rgb.x + 0.5));
  var a = monoPick(c, i32(P.u_alpha.x + 0.5));
  if (P.u_clamp.x > 0.5) { l = clamp(l, 0.0, 1.0); a = clamp(a, 0.0, 1.0); }
  return vec4f(vec3f(l), a);
}`;

export const hsvadjustWgsl = `
struct Ops { u_hueoffset: vec4f, u_satmult: vec4f, u_valmult: vec4f }
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
fn rgb2hsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let c = textureSample(tex0, samp, in.uv);
  var hsv = rgb2hsv(c.rgb);
  hsv.x = fract(hsv.x + P.u_hueoffset.x);
  hsv.y = clamp(hsv.y * P.u_satmult.x, 0.0, 1.0);
  hsv.z = hsv.z * P.u_valmult.x;
  return vec4f(hsv2rgb(hsv), c.a);
}`;

export const blurWgsl = `
struct Ops { u_dir: vec4f, u_size: vec4f }
@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let radius = max(P.u_size.x, 0.0);
  if (radius < 0.01) { return textureSample(tex0, samp, in.uv); }
  let sigma = max(radius / 2.0, 0.5);
  let texel = P.u_dir.xy / G.res.xy;
  var sum = vec4f(0.0);
  var norm = 0.0;
  for (var i = -15; i <= 15; i++) {
    let x = f32(i);
    let w = select(0.0, exp(-(x * x) / (2.0 * sigma * sigma)), abs(x) <= radius);
    sum = sum + textureSample(tex0, samp, in.uv + texel * x) * w;
    norm = norm + w;
  }
  return sum / max(norm, 1e-6);
}`;

export const compositeWgsl = `
struct Ops { u_count: vec4f, u_op: vec4f }
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
@group(0) @binding(4) var tex1: texture_2d<f32>;
@group(0) @binding(5) var tex2: texture_2d<f32>;
@group(0) @binding(6) var tex3: texture_2d<f32>;
fn blend(base: vec4f, layer: vec4f) -> vec4f {
  let op = P.u_op.x;
  if (op < 0.5)      { return vec4f(mix(base.rgb, layer.rgb, layer.a), max(base.a, layer.a)); }
  else if (op < 1.5) { return vec4f(base.rgb + layer.rgb, max(base.a, layer.a)); }
  else if (op < 2.5) { return vec4f(base.rgb * layer.rgb, base.a); }
  else if (op < 3.5) { return vec4f(1.0 - (1.0 - base.rgb) * (1.0 - layer.rgb), max(base.a, layer.a)); }
  else if (op < 4.5) { return vec4f(base.rgb - layer.rgb, base.a); }
  return vec4f(abs(base.rgb - layer.rgb), max(base.a, layer.a));
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let t0 = textureSample(tex0, samp, in.uv);
  let t1 = textureSample(tex1, samp, in.uv);
  let t2 = textureSample(tex2, samp, in.uv);
  let t3 = textureSample(tex3, samp, in.uv);
  var c: vec4f;
  if (P.u_count.x > 3.5)      { c = t3; c = blend(c, t2); c = blend(c, t1); c = blend(c, t0); }
  else if (P.u_count.x > 2.5) { c = t2; c = blend(c, t1); c = blend(c, t0); }
  else if (P.u_count.x > 1.5) { c = t1; c = blend(c, t0); }
  else                        { c = t0; }
  return c;
}`;

export const displaceWgsl = `
struct Ops { u_offset: vec4f, u_weight: vec4f }
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
@group(0) @binding(4) var tex1: texture_2d<f32>;
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let d = (textureSample(tex1, samp, in.uv).rg - 0.5) * P.u_weight.x + P.u_offset.xy;
  return textureSample(tex0, samp, clamp(in.uv + d, vec2f(0.0), vec2f(1.0)));
}`;

/** Edge TOP — TD formula; see glsl.ts edgeGlsl. */
export const edgeWgsl = `
${opsStruct(['u_strength', 'u_edgecolor', 'u_compinput', 'u_offset', 'u_blacklevel', 'u_select', 'u_alphamode'])}
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
${TD_CHANNEL_WGSL}
fn tap(uv: vec2f, texel: vec2f, dx: f32, dy: f32) -> f32 {
  let c = textureSampleLevel(tex0, samp, uv + vec2f(dx, dy) * P.u_offset.xy * texel, 0.0);
  return tdChannel(c, i32(P.u_select.x + 0.5));
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(tex0));
  let uv = in.uv;
  let lb = tap(uv, texel, -1.0, -1.0); let lm = tap(uv, texel, -1.0, 0.0); let lt = tap(uv, texel, -1.0, 1.0);
  let mb = tap(uv, texel, 0.0, -1.0);                                       let mt = tap(uv, texel, 0.0, 1.0);
  let rb = tap(uv, texel, 1.0, -1.0); let rm = tap(uv, texel, 1.0, 0.0);   let rt = tap(uv, texel, 1.0, 1.0);
  let gx = (rb + 2.0 * rm + rt) - (lb + 2.0 * lm + lt);
  let gy = (lt + 2.0 * mt + rt) - (lb + 2.0 * mb + rb);
  let inv = 1.0 / max(abs(P.u_offset.xy), vec2f(1e-3));
  let g = sqrt(max(P.u_strength.x, 0.0) * (gx * gx * inv.x + gy * gy * inv.y));
  let e = clamp(g * sqrt(max(1.0 - P.u_blacklevel.x, 0.0)) - P.u_blacklevel.x, 0.0, 1.0);
  var col = vec4f(e * P.u_edgecolor.rgb, e * P.u_edgecolor.a);
  let am = i32(P.u_alphamode.x + 0.5);
  if (am == 1) { col.a = 1.0; } else if (am == 2) { col.a = 0.0; }
  if (P.u_compinput.x > 0.5) {
    let src = textureSampleLevel(tex0, samp, uv, 0.0);
    col = col + src * (1.0 - clamp(col.a, 0.0, 1.0));
  }
  return col;
}`;

export const mathWgsl = `
struct Ops { u_count: vec4f, u_gain: vec4f, u_offset: vec4f, u_op: vec4f }
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
@group(0) @binding(4) var tex1: texture_2d<f32>;
@group(0) @binding(5) var tex2: texture_2d<f32>;
@group(0) @binding(6) var tex3: texture_2d<f32>;
fn combine(a: vec3f, b: vec3f) -> vec3f {
  let op = P.u_op.x;
  if (op < 0.5)      { return a + b; }
  else if (op < 1.5) { return a - b; }
  else if (op < 2.5) { return a * b; }
  else if (op < 3.5) { return a + b; }
  else if (op < 4.5) { return max(a, b); }
  else if (op < 5.5) { return min(a, b); }
  return pow(max(a, vec3f(0.0)), b);
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let c0 = textureSample(tex0, samp, in.uv);
  let l1 = textureSample(tex1, samp, in.uv).rgb;
  let l2 = textureSample(tex2, samp, in.uv).rgb;
  let l3 = textureSample(tex3, samp, in.uv).rgb;
  var c = c0.rgb;
  if (P.u_count.x > 1.5) { c = combine(c, l1); }
  if (P.u_count.x > 2.5) { c = combine(c, l2); }
  if (P.u_count.x > 3.5) { c = combine(c, l3); }
  if (P.u_op.x > 2.5 && P.u_op.x < 3.5) { c = c / max(P.u_count.x, 1.0); }
  return vec4f(c * P.u_gain.x + P.u_offset.x, c0.a);
}`;

export const reorderWgsl = `
struct Ops { u_sel: vec4f }
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
fn pick(c: vec4f, k: f32) -> f32 {
  if (k < 0.5) { return c.r; }
  else if (k < 1.5) { return c.g; }
  else if (k < 2.5) { return c.b; }
  else if (k < 3.5) { return c.a; }
  else if (k < 4.5) { return 0.0; }
  return 1.0;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let c = textureSample(tex0, samp, in.uv);
  return vec4f(pick(c, P.u_sel.x), pick(c, P.u_sel.y), pick(c, P.u_sel.z), pick(c, P.u_sel.w));
}`;

export const flipWgsl = `
struct Ops { u_flipx: vec4f, u_flipy: vec4f }
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  var uv = in.uv;
  if (P.u_flipx.x > 0.5) { uv.x = 1.0 - uv.x; }
  if (P.u_flipy.x > 0.5) { uv.y = 1.0 - uv.y; }
  return textureSample(tex0, samp, uv);
}`;

export const placeholderWgsl = `
struct Ops { u_tint: vec4f }
@group(0) @binding(1) var<uniform> P: Ops;
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let d = fract((in.uv.x + in.uv.y) * 12.0);
  let band = step(0.5, d) * 0.08 + 0.06;
  return vec4f(vec3f(band) + P.u_tint.rgb * 0.15, 1.0);
}`;