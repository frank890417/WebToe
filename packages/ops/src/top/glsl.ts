/**
 * Original GLSL 300 es fragment shaders for the TOP family — written fresh
 * for WebToe. Noise/hash/sdf/color-space functions are our own renditions of
 * standard, well-known graphics techniques.
 *
 * Conventions (enforced by the WebGL2 backend): `v_uv` in, `fragColor` out,
 * `u_res`/`u_time` injected, inputs bound as `u_tex0..u_tex3`.
 */

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

export const rampGlsl = `${PRE}
uniform float u_type;
uniform float u_phase;
uniform vec4 u_colora;
uniform vec4 u_colorb;
// Multi-stop gradient from a TouchDesigner keys DAT. u_stopCount == 0 falls
// back to the simple two-colour ramp, so hand-built patches are unaffected.
// Separate float arrays on purpose: the backend's generic uniform setter maps
// number[] of length 2/3/4 to vecN and anything else to uniform1fv, so a
// vec4[8] would be uploaded wrongly. Four float[8] arrays always work.
uniform float u_stopCount;
uniform float u_stopPos[8];
uniform float u_stopR[8];
uniform float u_stopG[8];
uniform float u_stopB[8];
uniform float u_stopA[8];
void main() {
  float t;
  if (u_type < 0.5) {
    t = v_uv.x;
  } else if (u_type < 1.5) {
    t = clamp(length(v_uv - 0.5) * 2.0, 0.0, 1.0);
  } else {
    t = atan(v_uv.y - 0.5, v_uv.x - 0.5) / 6.28318530718 + 0.5;
  }
  t = fract(t + u_phase);
  if (u_stopCount > 0.5) {
    int n = int(u_stopCount);
    vec4 c = vec4(u_stopR[0], u_stopG[0], u_stopB[0], u_stopA[0]);
    for (int i = 0; i < 7; i++) {
      if (i + 1 >= n) break;
      float a = u_stopPos[i], b = u_stopPos[i + 1];
      if (t >= a) {
        float f = clamp((t - a) / max(b - a, 1e-5), 0.0, 1.0);
        vec4 c0 = vec4(u_stopR[i], u_stopG[i], u_stopB[i], u_stopA[i]);
        vec4 c1 = vec4(u_stopR[i + 1], u_stopG[i + 1], u_stopB[i + 1], u_stopA[i + 1]);
        c = mix(c0, c1, f);
      }
    }
    fragColor = c;
  } else {
    fragColor = mix(u_colora, u_colorb, t);
  }
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

export const levelGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_gamma;
uniform float u_opacity;
uniform float u_invert;
void main() {
  vec4 c = texture(u_tex0, v_uv);
  vec3 rgb = c.rgb * u_brightness;
  rgb = (rgb - 0.5) * u_contrast + 0.5;
  rgb = pow(max(rgb, 0.0), vec3(1.0 / max(u_gamma, 1e-4)));
  rgb = mix(rgb, 1.0 - rgb, u_invert);
  fragColor = vec4(rgb, c.a * u_opacity);
}
`;

export const monochromeGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform vec3 u_weights;
void main() {
  vec4 c = texture(u_tex0, v_uv);
  float lum = dot(c.rgb, u_weights / max(u_weights.x + u_weights.y + u_weights.z, 1e-6));
  fragColor = vec4(vec3(lum), c.a);
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
          : dot(src.rgb, vec3(0.299, 0.587, 0.114));
  float u = clamp(i + u_offset, 0.0, 1.0);
  vec4 c = texture(u_tex1, vec2(u, 0.5));
  fragColor = vec4(c.rgb, c.a * src.a);
}
`;

export const edgeGlsl = `${PRE}
uniform sampler2D u_tex0;
uniform float u_strength;
uniform vec4 u_edgecolor;
uniform float u_compinput;
float lum(vec2 uv) { return dot(texture(u_tex0, uv).rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 t = 1.0 / u_res;
  float tl = lum(v_uv + vec2(-t.x,  t.y)), tc = lum(v_uv + vec2(0.0,  t.y)), tr = lum(v_uv + vec2( t.x,  t.y));
  float ml = lum(v_uv + vec2(-t.x,  0.0)),                                   mr = lum(v_uv + vec2( t.x,  0.0));
  float bl = lum(v_uv + vec2(-t.x, -t.y)), bc = lum(v_uv + vec2(0.0, -t.y)), br = lum(v_uv + vec2( t.x, -t.y));
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
  float e = clamp(length(vec2(gx, gy)) * u_strength, 0.0, 1.0);
  vec4 src = texture(u_tex0, v_uv);
  vec4 edges = u_edgecolor * e;
  fragColor = u_compinput > 0.5 ? vec4(mix(src.rgb, u_edgecolor.rgb, e), max(src.a, edges.a)) : edges;
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
