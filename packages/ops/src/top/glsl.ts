/**
 * GLSL 300 es fragment shaders for the TOP family.
 *
 * Most shaders are written fresh for WebToe. The TouchDesigner-faithful ones
 * (level, edge, monochrome, ramp, blur, noise, composite) reproduce behaviour
 * measured black-box against TouchDesigner by the author's EOI project (ported
 * with permission; see docs/TD-PARITY.md "Fidelity"). Third-party algorithm
 * code (Gustavson noise, Hocevar HSV, Hoskins hash) lives in noiselib.ts /
 * complib.ts with its notices; see THIRD_PARTY_NOTICES.md.
 *
 * Conventions (enforced by the WebGL2 backend): `v_uv` in, `fragColor` out,
 * `u_res`/`u_time` injected, inputs bound as `u_tex0..u_tex3`. Scalar uniforms
 * are always `float` (the backend uploads numbers with uniform1f) and every
 * uniform is at most a vec4, so the same set packs for WGSL too.
 */
import { RAMP_KC, RAMP_KP, RAMP_MAX_KEYS } from './tdmath';

const PRE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_res;
uniform float u_time;
`;

export const constantGlsl = `${PRE}
uniform vec4 u_color;
void main() { fragColor = u_color; }
`;

const NOISE_LIB = `
float hash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1, 0, 0));
  float n010 = hash3(i + vec3(0, 1, 0));
  float n110 = hash3(i + vec3(1, 1, 0));
  float n001 = hash3(i + vec3(0, 0, 1));
  float n101 = hash3(i + vec3(1, 0, 1));
  float n011 = hash3(i + vec3(0, 1, 1));
  float n111 = hash3(i + vec3(1, 1, 1));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}
float fbm(vec3 p, float harmonics) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 8; o++) {
    if (float(o) >= harmonics) break;
    sum += vnoise(p) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2.03;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}
`;

export const noiseGlsl = `${PRE}
uniform float u_period;
uniform float u_harmonics;
uniform vec2 u_offset;
uniform float u_speed;
uniform float u_mono;
uniform float u_exponent;
${NOISE_LIB}
void main() {
  vec2 uv = (v_uv + u_offset) * max(u_res.x / u_res.y, 1.0);
  vec3 p = vec3(uv / max(u_period, 1e-4), u_time * u_speed);
  float n = pow(clamp(fbm(p, u_harmonics), 0.0, 1.0), max(u_exponent, 1e-4));
  vec3 rgb = u_mono > 0.5
    ? vec3(n)
    : vec3(n,
           pow(clamp(fbm(p + vec3(13.7, 7.3, 5.1), u_harmonics), 0.0, 1.0), max(u_exponent, 1e-4)),
           pow(clamp(fbm(p + vec3(29.1, 17.9, 11.3), u_harmonics), 0.0, 1.0), max(u_exponent, 1e-4)));
  fragColor = vec4(rgb, 1.0);
}
`;

/**
 * Ramp TOP, TouchDesigner-faithful (measured, see docs/TD-PARITY.md
 * "Fidelity"). Keys arrive pre-sorted with TD's wrap keys added on the CPU
 * (tdmath.rampKeys) as one vec4 colour per key (u_kc00..) and four positions
 * per vec4 (u_kp0..) — every uniform is ≤ vec4 so the WGSL packing rule holds.
 *   horizontal/vertical: t = (u − phase) / period
 *   radial/circular:     t = base / period − phase
 * position only moves the radial/circular centre. No antialiasing (TD's
 * supersampling could not be reproduced, only seams differ).
 */
const RAMP_KEY_UNIFORMS_GLSL = `${RAMP_KC.map((n) => `uniform vec4 ${n};`).join('\n')}
${RAMP_KP.map((n) => `uniform vec4 ${n};`).join('\n')}`;

export const rampGlsl = `${PRE}
uniform float u_type;      // 0 horizontal, 1 vertical, 2 radial, 3 circular
uniform float u_phase;
uniform float u_repeat;    // 1 / period
uniform vec2 u_pos;        // radial/circular centre offset (fraction)
uniform vec2 u_aspect;     // fitaspect scale for radial/circular
uniform float u_extl;      // extend codes: 0 hold, 1 zero, 2 repeat, 3 mirror, 4 black
uniform float u_extr;
uniform float u_interp;    // 0 step, 1 linear, 2 ease in/out, 3 hermite
uniform float u_tension;
uniform float u_n;         // key count after wrap keys
uniform float u_premul;
${RAMP_KEY_UNIFORMS_GLSL}
vec4 KC[${RAMP_MAX_KEYS}];
float KP[${RAMP_MAX_KEYS}];
void loadKeys() {
${RAMP_KC.map((n, i) => `  KC[${i}] = ${n};`).join('\n')}
${RAMP_KP.map((n, i) => `  KP[${i * 4}] = ${n}.x; KP[${i * 4 + 1}] = ${n}.y; KP[${i * 4 + 2}] = ${n}.z; KP[${i * 4 + 3}] = ${n}.w;`).join('\n')}
}
vec4 rampColor(float t) {
  int n = int(u_n + 0.5);
  int k0 = 0;                                   // last key with pos <= t
  for (int i = 1; i < ${RAMP_MAX_KEYS}; i++) { if (i >= n) break; if (KP[i] <= t) k0 = i; }
  int last = n - 1;
  int k1 = min(k0 + 1, last);
  float span = KP[k1] - KP[k0];
  float f = t - KP[k0];
  if (span > 0.0) f /= span;
  vec4 c0 = KC[k0], c1 = KC[k1];
  int mode = int(u_interp + 0.5);
  if (mode == 0) return c0;
  if (mode == 3) {                              // cardinal spline, tangent (1 − tension)·Δ/2
    vec4 m0 = (1.0 - u_tension) * 0.5 * (c1 - KC[max(k0 - 1, 0)]);
    vec4 m1 = (1.0 - u_tension) * 0.5 * (KC[min(k0 + 2, last)] - c0);
    float f2 = f * f, f3 = f2 * f;
    return (2.0 * f3 - 3.0 * f2 + 1.0) * c0 + (f3 - 2.0 * f2 + f) * m0 + (f3 - f2) * m1 + (3.0 * f2 - 2.0 * f3) * c1;
  }
  if (mode == 2) f = 0.5 - 0.5 * cos(3.14159265 * clamp(f, 0.0, 1.0));
  return mix(c0, c1, f);
}
float rampFold(float t, int ext) {
  if (ext == 2) return t - floor(t);
  if (ext == 3) { float m = mod(abs(t), 2.0); return m > 1.0 ? 2.0 - m : m; }
  return clamp(t, 0.0, 1.0);
}
vec4 rampOutside(float t, int ext) {
  if (ext == 1) return vec4(0.0);
  if (ext == 4) return vec4(0.0, 0.0, 0.0, 1.0);
  return rampColor(rampFold(t, ext));
}
void main() {
  loadKeys();
  int type = int(u_type + 0.5);
  float t;
  if (type == 0) t = v_uv.x;
  else if (type == 1) t = v_uv.y;
  else {
    vec2 d = (v_uv - 0.5 - u_pos) * u_aspect;
    if (type == 2) { t = atan(d.y, d.x) / 6.28318530; if (t < 0.0) t += 1.0; }
    else t = 2.0 * length(d);
  }
  t = type <= 1 ? (t - u_phase) * u_repeat : t * u_repeat - u_phase;
  vec4 c = t < 0.0 ? rampOutside(t, int(u_extl + 0.5)) : t > 1.0 ? rampOutside(t, int(u_extr + 0.5)) : rampColor(t);
  if (u_premul > 0.5) c.rgb *= c.a;
  fragColor = c;
}
`;

export const rectangleGlsl = `${PRE}
uniform vec2 u_size;
uniform vec2 u_center;
uniform vec4 u_color;
uniform vec4 u_bgcolor;
uniform float u_softness;
void main() {
  vec2 p = v_uv - u_center;
  vec2 d2 = abs(p) - u_size * 0.5;
  float d = max(d2.x, d2.y);
  float aa = max(u_softness, 1.5 / u_res.y);
  float m = 1.0 - smoothstep(0.0, aa, d);
  fragColor = mix(u_bgcolor, u_color, m);
}
`;

export const transformGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform vec2 u_translate;
uniform float u_rotate;
uniform vec2 u_scale;
uniform vec2 u_pivot;
uniform float u_extend;
void main() {
  // inverse-map output uv back into input space
  vec2 uv = v_uv - u_pivot - u_translate;
  float a = radians(-u_rotate);
  float c = cos(a), s = sin(a);
  uv = mat2(c, -s, s, c) * uv;
  uv /= max(abs(u_scale), vec2(1e-6)) * sign(u_scale + vec2(1e-9));
  uv += u_pivot;
  float inside = 1.0;
  if (u_extend < 0.5) {
    uv = clamp(uv, 0.0, 1.0);               // hold
  } else if (u_extend < 1.5) {
    uv = fract(uv);                          // cycle
  } else if (u_extend < 2.5) {
    vec2 t = abs(fract(uv * 0.5) * 2.0 - 1.0); // mirror
    uv = t;
  } else {
    inside = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 0.0 : 1.0; // zero
    uv = clamp(uv, 0.0, 1.0);
  }
  fragColor = texture(u_tex0, uv) * inside;
}
`;

/**
 * Level TOP, TouchDesigner order (measured: 14 parameter sets × 2 clamp modes
 * within 1e-3). Works on premultiplied RGB; alpha only sees lowa/higha/opacity.
 *   invert → blacklevel (no clamp) → brightness1 → [clamp] → gamma1 → contrast
 *   (pivot 0.5) → in/out range → per-channel low/high → gamma2 → brightness2
 *   → post clamp → premultiply → opacity (multiplies RGB and alpha).
 * WebToe textures are 8-bit fixed, so TD's automatic input clamp is always on:
 * the input is clamped and clamped again after brightness1, never after.
 */
export const levelGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform vec4 u_pre;      // invert, blacklevel, brightness1, gamma1
uniform float u_contrast;
uniform vec4 u_range;    // inlow, inhigh, outlow, outhigh
uniform vec4 u_low;      // lowr, lowg, lowb, lowa
uniform vec4 u_high;     // highr, highg, highb, higha
uniform vec4 u_post;     // gamma2, brightness2, post clamp on, premultiply on
uniform vec2 u_clamp2;   // clamplow2, clamphigh2
uniform float u_opacity;
vec3 lvGamma(vec3 x, float g) { return g == 1.0 ? x : pow(max(x, 0.0), vec3(1.0 / max(g, 1e-6))); }
void main() {
  vec4 a = texture(u_tex0, v_uv);
  vec3 x = clamp(a.rgb, 0.0, 1.0);
  x = x + u_pre.x * (1.0 - 2.0 * x);
  x = u_pre.y >= 1.0 ? vec3(0.0) : (x - u_pre.y) / (1.0 - u_pre.y);
  x = x * u_pre.z;
  x = clamp(x, 0.0, 1.0);
  x = lvGamma(x, u_pre.w);
  x = (x - 0.5) * u_contrast + 0.5;
  x = (x - u_range.x) / (u_range.y == u_range.x ? 1.0 : u_range.y - u_range.x);
  x = u_range.z + x * (u_range.w - u_range.z);
  x = u_low.rgb + x * (u_high.rgb - u_low.rgb);
  x = lvGamma(x, u_post.x);
  x = x * u_post.y;
  float al = u_low.a + a.a * (u_high.a - u_low.a);
  if (u_post.z > 0.5) x = clamp(x, u_clamp2.x, u_clamp2.y);
  if (u_post.w > 0.5) x *= al;
  fragColor = vec4(x * u_opacity, al * u_opacity);
}
`;

/** Channel selector shared by Monochrome/Edge (TD menu order):
 *  0 luminance (Rec.709), 1 red, 2 green, 3 blue, 4 alpha, 5 rgbaverage,
 *  6 average, 7 rgbmax, 8 max, 9 zero, 10 one. */
const TD_CHANNEL_GLSL = `
float tdChannel(vec4 c, int s) {
  if (s == 1) return c.r;
  if (s == 2) return c.g;
  if (s == 3) return c.b;
  if (s == 4) return c.a;
  if (s == 5) return (c.r + c.g + c.b) / 3.0;
  if (s == 6) return (c.r + c.g + c.b + c.a) * 0.25;
  if (s == 7) return max(c.r, max(c.g, c.b));
  if (s == 8) return max(max(c.r, c.g), max(c.b, c.a));
  if (s == 9) return 0.0;
  if (s == 10) return 1.0;
  return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
}
`;

/** Monochrome TOP: RGB and alpha each pick a channel (TD menu; luminance is
 *  Rec.709), 'custom' (11) uses the normalised weights; clamp defaults on. */
export const monochromeGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform float u_rgb;
uniform float u_alpha;
uniform float u_clamp;
uniform vec3 u_weights;
${TD_CHANNEL_GLSL}
float monoPick(vec4 c, int s) {
  if (s == 11) return dot(c.rgb, u_weights / max(u_weights.x + u_weights.y + u_weights.z, 1e-6));
  return tdChannel(c, s);
}
void main() {
  vec4 c = texture(u_tex0, v_uv);
  float l = monoPick(c, int(u_rgb + 0.5));
  float a = monoPick(c, int(u_alpha + 0.5));
  if (u_clamp > 0.5) { l = clamp(l, 0.0, 1.0); a = clamp(a, 0.0, 1.0); }
  fragColor = vec4(vec3(l), a);
}
`;

const HSV_LIB = `
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

export const hsvadjustGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform float u_hueoffset;
uniform float u_satmult;
uniform float u_valmult;
${HSV_LIB}
void main() {
  vec4 c = texture(u_tex0, v_uv);
  vec3 hsv = rgb2hsv(c.rgb);
  hsv.x = fract(hsv.x + u_hueoffset);
  hsv.y = clamp(hsv.y * u_satmult, 0.0, 1.0);
  hsv.z = hsv.z * u_valmult;
  fragColor = vec4(hsv2rgb(hsv), c.a);
}
`;

export const blurGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform vec2 u_dir;
uniform float u_size;
void main() {
  float radius = max(u_size, 0.0);
  if (radius < 0.01) { fragColor = texture(u_tex0, v_uv); return; }
  float sigma = max(radius / 2.0, 0.5);
  vec2 texel = u_dir / u_res;
  vec4 sum = vec4(0.0);
  float norm = 0.0;
  for (int i = -15; i <= 15; i++) {
    float x = float(i);
    if (abs(x) > radius) continue;
    float w = exp(-(x * x) / (2.0 * sigma * sigma));
    sum += texture(u_tex0, v_uv + texel * x) * w;
    norm += w;
  }
  fragColor = sum / max(norm, 1e-6);
}
`;

export const compositeGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_tex3;
uniform float u_op;
uniform float u_count;
vec4 blend(vec4 base, vec4 layer) {
  if (u_op < 0.5)      return vec4(mix(base.rgb, layer.rgb, layer.a), max(base.a, layer.a)); // over
  else if (u_op < 1.5) return vec4(base.rgb + layer.rgb, max(base.a, layer.a));              // add
  else if (u_op < 2.5) return vec4(base.rgb * layer.rgb, base.a);                            // multiply
  else if (u_op < 3.5) return vec4(1.0 - (1.0 - base.rgb) * (1.0 - layer.rgb), max(base.a, layer.a)); // screen
  else if (u_op < 4.5) return vec4(base.rgb - layer.rgb, base.a);                            // subtract
  else                 return vec4(abs(base.rgb - layer.rgb), max(base.a, layer.a));         // difference
}
void main() {
  // TD-compatible layer order: input 0 is the TOP layer, the last input is the base
  vec4 t0 = texture(u_tex0, v_uv);
  vec4 t1 = texture(u_tex1, v_uv);
  vec4 t2 = texture(u_tex2, v_uv);
  vec4 t3 = texture(u_tex3, v_uv);
  vec4 c;
  if (u_count > 3.5)      { c = t3; c = blend(c, t2); c = blend(c, t1); c = blend(c, t0); }
  else if (u_count > 2.5) { c = t2; c = blend(c, t1); c = blend(c, t0); }
  else if (u_count > 1.5) { c = t1; c = blend(c, t0); }
  else                    { c = t0; }
  fragColor = c;
}
`;

export const displaceGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform float u_weight;
uniform vec2 u_offset;
void main() {
  vec2 d = (texture(u_tex1, v_uv).rg - 0.5) * u_weight + u_offset;
  fragColor = texture(u_tex0, clamp(v_uv + d, 0.0, 1.0));
}
`;

export const lookupGlsl = `${PRE}
uniform sampler2D u_tex0;   // source
uniform sampler2D u_tex1;   // lookup ramp (sampled across its width)
uniform float u_offset;
uniform int u_source;       // 0 = luminance, 1 = red, 2 = alpha
void main() {
  vec4 src = texture(u_tex0, v_uv);
  float i = u_source == 1 ? src.r
          : u_source == 2 ? src.a
          : dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));   // TD luminance = Rec.709
  float u = clamp(i + u_offset, 0.0, 1.0);
  vec4 c = texture(u_tex1, vec2(u, 0.5));
  fragColor = vec4(c.rgb, c.a * src.a);
}
`;

/**
 * Edge TOP, TouchDesigner-faithful (measured: 65 cases within 1.2e-7):
 *   e = clamp(√(1−bl)·√strength·|∇| / √offset − bl, 0, 1)
 * ∇ = 3×3 Sobel (1-2-1) of the selected channel; the 8 taps sit ±offset
 * pixels away (bilinear, hold) and the channel is selected AFTER sampling
 * (rgbmax/max need that). Unequal x/y offsets divide each axis by its own
 * step (inferred). RGB = e·edge colour (pre-multiplied by its alpha when
 * premultrgbbyalpha), alpha = e·edge alpha; compinput = edge OVER input.
 */
export const edgeGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform float u_strength;
uniform vec4 u_edgecolor;  // already multiplied by its alpha on the CPU when premultrgbbyalpha
uniform float u_compinput;
uniform vec2 u_offset;     // sample step in input pixels (x, y)
uniform float u_blacklevel;
uniform float u_select;
uniform float u_alphamode; // 0 edge, 1 one, 2 zero
${TD_CHANNEL_GLSL}
vec2 edgeTexel;
float tap(float dx, float dy) {
  return tdChannel(texture(u_tex0, v_uv + vec2(dx, dy) * u_offset * edgeTexel), int(u_select + 0.5));
}
void main() {
  edgeTexel = 1.0 / vec2(textureSize(u_tex0, 0));
  float lb = tap(-1.0, -1.0), lm = tap(-1.0, 0.0), lt = tap(-1.0, 1.0);
  float mb = tap(0.0, -1.0), mt = tap(0.0, 1.0);
  float rb = tap(1.0, -1.0), rm = tap(1.0, 0.0), rt = tap(1.0, 1.0);
  float gx = (rb + 2.0 * rm + rt) - (lb + 2.0 * lm + lt);
  float gy = (lt + 2.0 * mt + rt) - (lb + 2.0 * mb + rb);
  vec2 inv = 1.0 / max(abs(u_offset), vec2(1e-3));
  float g = sqrt(max(u_strength, 0.0) * (gx * gx * inv.x + gy * gy * inv.y));
  float e = clamp(g * sqrt(max(1.0 - u_blacklevel, 0.0)) - u_blacklevel, 0.0, 1.0);
  vec4 col = vec4(e * u_edgecolor.rgb, e * u_edgecolor.a);
  int am = int(u_alphamode + 0.5);
  if (am == 1) col.a = 1.0; else if (am == 2) col.a = 0.0;
  if (u_compinput > 0.5) {
    vec4 src = texture(u_tex0, v_uv);
    col = col + src * (1.0 - clamp(col.a, 0.0, 1.0));   // premultiplied over
  }
  fragColor = col;
}
`;

export const mathGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_tex3;
uniform float u_op;
uniform float u_count;
uniform float u_gain;
uniform float u_offset;
vec3 combine(vec3 a, vec3 b) {
  if (u_op < 0.5)      return a + b;
  else if (u_op < 1.5) return a - b;
  else if (u_op < 2.5) return a * b;
  else if (u_op < 3.5) return a + b;          // average (divided after)
  else if (u_op < 4.5) return max(a, b);
  else if (u_op < 5.5) return min(a, b);
  else                 return pow(max(a, vec3(0.0)), b);
}
void main() {
  vec4 c0 = texture(u_tex0, v_uv);
  vec3 c = c0.rgb;
  if (u_count > 1.5) c = combine(c, texture(u_tex1, v_uv).rgb);
  if (u_count > 2.5) c = combine(c, texture(u_tex2, v_uv).rgb);
  if (u_count > 3.5) c = combine(c, texture(u_tex3, v_uv).rgb);
  if (u_op > 2.5 && u_op < 3.5) c /= max(u_count, 1.0);
  fragColor = vec4(c * u_gain + u_offset, c0.a);
}
`;

export const reorderGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform vec4 u_sel;
float pick(vec4 c, float k) {
  if (k < 0.5) return c.r;
  else if (k < 1.5) return c.g;
  else if (k < 2.5) return c.b;
  else if (k < 3.5) return c.a;
  else if (k < 4.5) return 0.0;
  return 1.0;
}
void main() {
  vec4 c = texture(u_tex0, v_uv);
  fragColor = vec4(pick(c, u_sel.x), pick(c, u_sel.y), pick(c, u_sel.z), pick(c, u_sel.w));
}
`;

export const flipGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform float u_flipx;
uniform float u_flipy;
void main() {
  vec2 uv = v_uv;
  if (u_flipx > 0.5) uv.x = 1.0 - uv.x;
  if (u_flipy > 0.5) uv.y = 1.0 - uv.y;
  fragColor = texture(u_tex0, uv);
}
`;

export const placeholderGlsl = `${PRE}
uniform vec4 u_tint;
void main() {
  // diagonal hatch so "no signal" is visibly distinct from black output
  float d = fract((v_uv.x + v_uv.y) * 12.0);
  float band = step(0.5, d) * 0.08 + 0.06;
  fragColor = vec4(vec3(band) + u_tint.rgb * 0.15, 1.0);
}
`;
