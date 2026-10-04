/**
 * WGSL shaders, kept in parity with glsl.ts (same uniforms, same math).
 *
 * Packing rule: binding 0 = Globals { res, time } (vec4 each); binding 1 =
 * op uniforms sorted by name, one vec4f per uniform (scalar in .x, vec2 in
 * .xy, color in .xyzw); binding 2 = sampler; bindings 3..6 = input textures.
 * New shaders sample with textureSampleLevel(…, 0) so taps inside data-
 * dependent branches stay valid under WGSL's uniformity rules.
 */
import { RAMP_KC, RAMP_KP, rampKeySelect } from './tdmath';
import { NOISE_LIB_WGSL } from './noiselib';
import { COMP_LIB_WGSL } from './complib';

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
fn rampColor(t: f32) -> vec4f {
  let n = i32(P.u_n.x + 0.5);
  let last = n - 1;
  var k0 = 0;
  var c0 = vec4f(0.0);
  var c1 = vec4f(0.0);
  var cm = vec4f(0.0);
  var c2 = vec4f(0.0);
  var p0 = 0.0;
  var p1 = 0.0;
${rampKeySelect('wgsl', (n) => `P.${n}`)}
  let span = p1 - p0;
  var f = t - p0;
  if (span > 0.0) { f = f / span; }
  let mode = i32(P.u_interp.x + 0.5);
  if (mode == 0) { return c0; }
  if (mode == 3) {
    let m0 = (1.0 - P.u_tension.x) * 0.5 * (c1 - cm);
    let m1 = (1.0 - P.u_tension.x) * 0.5 * (c2 - c0);
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

/** Noise TOP — see glsl.ts noiseGlsl for the measured TD rules. */
export const noiseWgsl = `${NOISE_LIB_WGSL}
${opsStruct(['u_type', 'u_m0', 'u_m1', 'u_m2', 'u_seed0', 'u_seed1', 'u_seed2', 'u_seed3', 'u_ps', 'u_amp', 'u_offset', 'u_gain', 'u_lac', 'u_exp', 'u_oct', 'u_rough', 'u_mono', 'u_alpha', 'u_tiny', 'u_seedr'])}
@group(0) @binding(1) var<uniform> P: Ops;
fn basis(ty: i32, t: vec4f) -> f32 {
  if (ty == 0) { return tdPerlin2(t.xy); }
  if (ty == 1) { return tdPerlin3(t.xyz); }
  if (ty == 2) { return tdPerlin4(t); }
  if (ty == 3) { return tdSimplex2(t.xy); }
  if (ty == 5) { return tdSimplex4(t); }
  if (ty == 7 || ty == 9) { return tdQmap(tdPerlin3(t.xyz / 1.4), 0, 2); }
  if (ty == 8) { return tdQmap(tdPerlin3(t.xyz / 1.2), 0, 3); }
  if (ty == 10) { return tdQmap(tdCellBump(t.xyz / 1.7), 1, 4); }
  return tdSimplex3(t.xyz);
}
fn chan(c: i32, seed: vec4f, uv: vec2f, frag: vec2f) -> f32 {
  let ty = i32(P.u_type.x + 0.5);
  if (ty == 6) { return 2.0 * h31(vec3f(floor(frag), f32(c) * 131.0 + P.u_seedr.x)) - 1.0; }
  let Pp = vec4f(4.0 * uv * P.u_ps.xy - 2.0, 0.0, 1.0);
  var t = vec4f(dot(P.u_m0, Pp), dot(P.u_m1, Pp), dot(P.u_m2, Pp), 0.0) + seed;
  if (P.u_tiny.x > 0.5) {
    let q = floor(frag);
    t = vec4f(256.0 * vec3f(h31(vec3f(q, f32(c) * 7.0 + 1.0)), h31(vec3f(q, f32(c) * 7.0 + 2.0)), h31(vec3f(q, f32(c) * 7.0 + 3.0))), t.w);
  }
  var g = P.u_gain.x;
  if (ty == 7) { g = P.u_rough.x; } else if (ty == 9) { g = 1.0; }
  var n = 0.0;
  var amp = 1.0;
  var wsum = 0.0;
  let oct = i32(P.u_oct.x + 0.5);
  for (var j = 0; j < 16; j++) {
    if (j >= oct) { break; }
    n = n + basis(ty, t) * amp;
    wsum = wsum + amp;
    t = t * P.u_lac.x;
    amp = amp * g;
  }
  if (ty == 8 || ty == 10) { return n / wsum; }
  return n;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let frag = in.pos.xy;
  var n: vec4f;
  if (P.u_mono.x > 0.5) {
    n = vec4f(chan(0, P.u_seed0, in.uv, frag));
  } else {
    var a = 0.0;
    if (P.u_alpha.x > 1.5) { a = chan(3, P.u_seed3, in.uv, frag); }
    n = vec4f(chan(0, P.u_seed0, in.uv, frag), chan(1, P.u_seed1, in.uv, frag), chan(2, P.u_seed2, in.uv, frag), a);
  }
  if (i32(P.u_type.x + 0.5) == 6) {
    n = n * P.u_amp.x + P.u_offset.x;
  } else {
    n = n * P.u_amp.x;
    if (P.u_exp.x != 1.0) { n = sign(n) * pow(abs(n), vec4f(P.u_exp.x)); }
    n = n + P.u_offset.x;
  }
  var alpha = n.a;
  if (P.u_alpha.x < 0.5) { alpha = 0.0; } else if (P.u_alpha.x < 1.5) { alpha = 1.0; }
  return vec4f(n.rgb, alpha);
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

/** Blur TOP kernel — see glsl.ts blurGlsl (same weights, computed in-shader). */
export const blurWgsl = `
${opsStruct(['u_dir', 'u_taps', 'u_step', 'u_type'])}
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
fn blurErf(x0: f32) -> f32 {
  let s = sign(x0);
  let x = abs(x0);
  let t = 1.0 / (1.0 + 0.3275911 * x);
  return s * (1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x));
}
fn blurSi(x: f32) -> f32 {
  var sum = 0.0;
  var term = x;
  for (var n = 0; n < 30; n++) {
    sum = sum + term / f32(2 * n + 1);
    term = term * (-x * x / f32((2 * n + 2) * (2 * n + 3)));
  }
  return sum;
}
fn blurFk(v: f32, ty: i32) -> f32 {
  if (ty == 1) { return 0.59081795 * blurErf(1.5 * v); }
  if (ty == 2) { return v; }
  if (ty == 3) { return v - 0.5 * v * v; }
  if (ty == 4) { return blurSi(6.28318531 * v) / 6.28318531; }
  if (ty == 5) { return 0.5 * v + sin(3.14159265 * v) / 6.28318531; }
  if (ty == 6) { return 0.42 * v + sin(3.14159265 * v) / 6.28318531 + 0.08 / 6.28318531 * sin(6.28318531 * v); }
  return v - 0.83333333 * v * v * v + 0.375 * v * v * v * v;
}
fn blurF(u: f32, ty: i32) -> f32 {
  let d = 1.0 / 1024.0;
  let a = min(abs(u), 1.0);
  return sign(u) * (min(a, d) + (1.0 - d) * blurFk(max(a - d, 0.0) / (1.0 - d), ty));
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let S = i32(P.u_taps.x + 0.5);
  let ty = i32(P.u_type.x + 0.5);
  let texel = P.u_dir.xy / vec2f(textureDimensions(tex0));
  let R = 0.5 * f32(S);
  let c = 0.5 * f32(S - 1);
  let norm = 0.5 / blurF(1.0, ty);
  var fl = -blurF(1.0, ty);
  var sum = vec4f(0.0);
  for (var i = 0; i < 4096; i++) {
    if (i >= S) { break; }
    let x = f32(i) - c;
    let fr = blurF((x + 0.5) / R, ty);
    sum = sum + (fr - fl) * norm * textureSampleLevel(tex0, samp, in.uv + texel * (x * P.u_step.x), 0.0);
    fl = fr;
  }
  return sum;
}`;

/** One bilinear tap per output pixel (Blur preshrink / upsample). */
export const resampleWgsl = `
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  return textureSampleLevel(tex0, samp, in.uv, 0.0);
}`;

/** Composite TOP — see glsl.ts compositeGlsl (TD's 46 operations, left fold, transform page). */
export const compositeWgsl = `
${opsStruct(['u_op', 'u_count', 'u_swap', 'u_ext', 'u_xf', 'u_ovc'])}
@group(0) @binding(1) var<uniform> P: Ops;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex0: texture_2d<f32>;
@group(0) @binding(4) var tex1: texture_2d<f32>;
@group(0) @binding(5) var tex2: texture_2d<f32>;
@group(0) @binding(6) var tex3: texture_2d<f32>;
${COMP_LIB_WGSL}
fn overlaySample(uv: vec2f) -> vec4f {
  if (P.u_ovc.w > 0.5) { return textureSampleLevel(tex0, samp, uv, 0.0); }
  var d = (uv - P.u_ovc.xy) * vec2f(P.u_ovc.z, 1.0);
  d = vec2f(P.u_xf.x * d.x + P.u_xf.y * d.y, -P.u_xf.y * d.x + P.u_xf.x * d.y);
  var ov = vec2f(d.x / P.u_ovc.z * P.u_xf.z, d.y * P.u_xf.w) + 0.5;
  let ext = i32(P.u_ext.x + 0.5);
  if (ext == 0) {
    let sz = vec2f(textureDimensions(tex0));
    let lo = clamp(ov * sz + 0.5, vec2f(0.0), vec2f(1.0));
    let hi = clamp((1.0 - ov) * sz + 0.5, vec2f(0.0), vec2f(1.0));
    let cover = lo.x * lo.y * hi.x * hi.y;
    if (cover <= 0.0) { return vec4f(0.0); }
    return textureSampleLevel(tex0, samp, clamp(ov, vec2f(0.0), vec2f(1.0)), 0.0) * cover;
  }
  if (ext == 2) { ov = fract(ov); }
  else if (ext == 3) { ov = 1.0 - abs(ov - 2.0 * floor(ov * 0.5) - 1.0); }
  return textureSampleLevel(tex0, samp, clamp(ov, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn step2(acc: vec4f, next: vec4f, op: i32) -> vec4f {
  if (P.u_swap.x > 0.5) { return tdComp(next, acc, op); }
  return tdComp(acc, next, op);
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let n = i32(P.u_count.x + 0.5);
  let op = i32(P.u_op.x + 0.5);
  var c = overlaySample(in.uv);
  if (n > 1) { c = step2(c, textureSampleLevel(tex1, samp, in.uv, 0.0), op); }
  if (n > 2) { c = step2(c, textureSampleLevel(tex2, samp, in.uv, 0.0), op); }
  if (n > 3) { c = step2(c, textureSampleLevel(tex3, samp, in.uv, 0.0), op); }
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