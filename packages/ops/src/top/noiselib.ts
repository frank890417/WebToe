/**
 * Noise basis functions for the TouchDesigner-faithful Noise TOP, as GLSL and
 * WGSL source snippets.
 *
 * TD's GPU noise types are Stefan Gustavson's 2004 table-driven Perlin and
 * simplex noise (measured: 6 types × 9 parameter sets within 3.7e-3, 99.9%
 * within 6e-4, several sets bit-identical). The original samples three lookup
 * textures; here the same tables are constant arrays indexed exactly the way
 * those NEAREST/REPEAT texture fetches resolve:
 *   - permutation texel (x, y) = PERM[(x + PERM[y & 255]) & 255]
 *   - gradients are the 8-bit texels (g·64+64)/255·4 − 1 (so 1/255 and 257/255,
 *     not 0 and 1)
 *   - a permutation value reused as a texture coordinate (v/255) addresses
 *     texel v, except 255 → 1.0, which wraps to texel 0
 * so no data textures (and no new backend capability) are needed.
 *
 * Third-party code (see THIRD_PARTY_NOTICES.md):
 *   Stefan Gustavson, GLSL noise (2004) — "You may use, modify and
 *   redistribute this code free of charge, provided that my name and this
 *   notice appears intact." (notice also kept inside the shader strings)
 *   David Hoskins, "Hash without Sine" (2014), MIT — h31.
 */
import { GRAD3, GRAD4, NOISE_Q, PERM, SIMPLEX4 } from './tdmath';

const GUSTAVSON_NOTICE = `/*
 * 2D, 3D and 4D Perlin noise, classic and simplex, in a GLSL fragment shader.
 * Author: Stefan Gustavson ITN-LiTH (stegu@itn.liu.se) 2004-12-05
 * You may use, modify and redistribute this code free of charge,
 * provided that my name and this notice appears intact.
 *
 * Modified for WebToe (MIT): noise -> TDPerlinNoise, snoise -> TDSimplexNoise,
 * fade -> tdnFade; the permutation/gradient/simplex lookup textures replaced by
 * constant tables indexed the way the texture fetches resolve; WGSL translation.
 */`;

const HOSKINS_NOTICE = `// h31: David Hoskins, "Hash without Sine" (hash13 variant), https://www.shadertoy.com/view/4djSRW
// MIT License, Copyright (c) 2014 David Hoskins.`;

const byte = (g: number) => g * 64 + 64;
const list = (a: readonly number[]) => a.join(', ');
const Q_ROWS = [NOISE_Q.perlin3, NOISE_Q.cell, NOISE_Q.sparse, NOISE_Q.hermite, NOISE_Q.alligator];
const qf = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// ---------------------------------------------------------------- GLSL

const TABLES_GLSL = `
const int TD_PERM[256] = int[256](${list(PERM)});
const ivec3 TD_G3B[16] = ivec3[16](${GRAD3.map((g) => `ivec3(${g.map(byte).join(', ')})`).join(', ')});
const ivec4 TD_G4B[32] = ivec4[32](${GRAD4.map((g) => `ivec4(${g.map(byte).join(', ')})`).join(', ')});
const ivec4 TD_SIMPLEX[64] = ivec4[64](${SIMPLEX4.map((s) => `ivec4(${s.join(', ')})`).join(', ')});
int tdPT(int x, int y) { return TD_PERM[(x + TD_PERM[y & 255]) & 255]; }  // permutation texel (x, y)
int tdIdx(int v) { return v == 255 ? 0 : v; }                              // v/255 used as a coordinate
vec3 tdG3(int v) { return vec3(TD_G3B[v & 15]) / 255.0 * 4.0 - 1.0; }
vec4 tdG4(int v) { return vec4(TD_G4B[v & 31]) / 255.0 * 4.0 - 1.0; }
float tdnFade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
`;

const PERLIN_GLSL = `
float TDPerlinNoise(vec2 P) {
  ivec2 I = ivec2(floor(P));
  vec2 Pf = fract(P);
  float n00 = dot(tdG3(tdPT(I.x, I.y)).xy, Pf);
  float n10 = dot(tdG3(tdPT(I.x + 1, I.y)).xy, Pf - vec2(1.0, 0.0));
  float n01 = dot(tdG3(tdPT(I.x, I.y + 1)).xy, Pf - vec2(0.0, 1.0));
  float n11 = dot(tdG3(tdPT(I.x + 1, I.y + 1)).xy, Pf - vec2(1.0, 1.0));
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), tdnFade(Pf.x));
  return mix(n_x.x, n_x.y, tdnFade(Pf.y));
}
float TDPerlinNoise(vec3 P) {
  ivec3 I = ivec3(floor(P));
  vec3 Pf = fract(P);
  int perm00 = tdIdx(tdPT(I.x, I.y));
  float n000 = dot(tdG3(tdPT(perm00, I.z)), Pf);
  float n001 = dot(tdG3(tdPT(perm00, I.z + 1)), Pf - vec3(0.0, 0.0, 1.0));
  int perm01 = tdIdx(tdPT(I.x, I.y + 1));
  float n010 = dot(tdG3(tdPT(perm01, I.z)), Pf - vec3(0.0, 1.0, 0.0));
  float n011 = dot(tdG3(tdPT(perm01, I.z + 1)), Pf - vec3(0.0, 1.0, 1.0));
  int perm10 = tdIdx(tdPT(I.x + 1, I.y));
  float n100 = dot(tdG3(tdPT(perm10, I.z)), Pf - vec3(1.0, 0.0, 0.0));
  float n101 = dot(tdG3(tdPT(perm10, I.z + 1)), Pf - vec3(1.0, 0.0, 1.0));
  int perm11 = tdIdx(tdPT(I.x + 1, I.y + 1));
  float n110 = dot(tdG3(tdPT(perm11, I.z)), Pf - vec3(1.0, 1.0, 0.0));
  float n111 = dot(tdG3(tdPT(perm11, I.z + 1)), Pf - vec3(1.0, 1.0, 1.0));
  vec4 n_x = mix(vec4(n000, n001, n010, n011), vec4(n100, n101, n110, n111), tdnFade(Pf.x));
  vec2 n_xy = mix(n_x.xy, n_x.zw, tdnFade(Pf.y));
  return mix(n_xy.x, n_xy.y, tdnFade(Pf.z));
}
float tdP4(int xy, int zw, vec4 Pf, vec4 o) { return dot(tdG4(tdPT(xy, zw)), Pf - o); }
float TDPerlinNoise(vec4 P) {
  ivec4 I = ivec4(floor(P));
  vec4 Pf = fract(P);
  int p00xy = tdIdx(tdPT(I.x, I.y)), p01xy = tdIdx(tdPT(I.x, I.y + 1));
  int p10xy = tdIdx(tdPT(I.x + 1, I.y)), p11xy = tdIdx(tdPT(I.x + 1, I.y + 1));
  int p00zw = tdIdx(tdPT(I.z, I.w)), p01zw = tdIdx(tdPT(I.z, I.w + 1));
  int p10zw = tdIdx(tdPT(I.z + 1, I.w)), p11zw = tdIdx(tdPT(I.z + 1, I.w + 1));
  float n0000 = tdP4(p00xy, p00zw, Pf, vec4(0.0, 0.0, 0.0, 0.0));
  float n0001 = tdP4(p00xy, p01zw, Pf, vec4(0.0, 0.0, 0.0, 1.0));
  float n0010 = tdP4(p00xy, p10zw, Pf, vec4(0.0, 0.0, 1.0, 0.0));
  float n0011 = tdP4(p00xy, p11zw, Pf, vec4(0.0, 0.0, 1.0, 1.0));
  float n0100 = tdP4(p01xy, p00zw, Pf, vec4(0.0, 1.0, 0.0, 0.0));
  float n0101 = tdP4(p01xy, p01zw, Pf, vec4(0.0, 1.0, 0.0, 1.0));
  float n0110 = tdP4(p01xy, p10zw, Pf, vec4(0.0, 1.0, 1.0, 0.0));
  float n0111 = tdP4(p01xy, p11zw, Pf, vec4(0.0, 1.0, 1.0, 1.0));
  float n1000 = tdP4(p10xy, p00zw, Pf, vec4(1.0, 0.0, 0.0, 0.0));
  float n1001 = tdP4(p10xy, p01zw, Pf, vec4(1.0, 0.0, 0.0, 1.0));
  float n1010 = tdP4(p10xy, p10zw, Pf, vec4(1.0, 0.0, 1.0, 0.0));
  float n1011 = tdP4(p10xy, p11zw, Pf, vec4(1.0, 0.0, 1.0, 1.0));
  float n1100 = tdP4(p11xy, p00zw, Pf, vec4(1.0, 1.0, 0.0, 0.0));
  float n1101 = tdP4(p11xy, p01zw, Pf, vec4(1.0, 1.0, 0.0, 1.0));
  float n1110 = tdP4(p11xy, p10zw, Pf, vec4(1.0, 1.0, 1.0, 0.0));
  float n1111 = tdP4(p11xy, p11zw, Pf, vec4(1.0, 1.0, 1.0, 1.0));
  float fadex = tdnFade(Pf.x);
  vec4 n_x0 = mix(vec4(n0000, n0001, n0010, n0011), vec4(n1000, n1001, n1010, n1011), fadex);
  vec4 n_x1 = mix(vec4(n0100, n0101, n0110, n0111), vec4(n1100, n1101, n1110, n1111), fadex);
  vec4 n_xy = mix(n_x0, n_x1, tdnFade(Pf.y));
  vec2 n_xyz = mix(n_xy.xy, n_xy.zw, tdnFade(Pf.z));
  return mix(n_xyz.x, n_xyz.y, tdnFade(Pf.w));
}
`;

const SIMPLEX_GLSL = `
float tdCorner(float r2, vec2 g, vec2 f) { float t = r2 - dot(f, f); if (t < 0.0) return 0.0; t *= t; return t * t * dot(g, f); }
float tdCorner(float r2, vec3 g, vec3 f) { float t = r2 - dot(f, f); if (t < 0.0) return 0.0; t *= t; return t * t * dot(g, f); }
float tdCorner(float r2, vec4 g, vec4 f) { float t = r2 - dot(f, f); if (t < 0.0) return 0.0; t *= t; return t * t * dot(g, f); }
float TDSimplexNoise(vec2 P) {
  const float F2 = 0.366025403784, G2 = 0.211324865405;
  float s = (P.x + P.y) * F2;
  vec2 Pi = floor(P + s);
  float t = (Pi.x + Pi.y) * G2;
  vec2 Pf0 = P - (Pi - t);
  ivec2 I = ivec2(Pi);
  ivec2 o1 = Pf0.x > Pf0.y ? ivec2(1, 0) : ivec2(0, 1);
  float n0 = tdCorner(0.5, tdG3(tdPT(I.x, I.y)).xy, Pf0);
  float n1 = tdCorner(0.5, tdG3(tdPT(I.x + o1.x, I.y + o1.y)).xy, Pf0 - vec2(o1) + G2);
  float n2 = tdCorner(0.5, tdG3(tdPT(I.x + 1, I.y + 1)).xy, Pf0 - vec2(1.0 - 2.0 * G2));
  return 70.0 * (n0 + n1 + n2);
}
float TDSimplexNoise(vec3 P) {
  const float F3 = 0.333333333333, G3 = 0.166666666667;
  float s = (P.x + P.y + P.z) * F3;
  vec3 Pi = floor(P + s);
  float t = (Pi.x + Pi.y + Pi.z) * G3;
  vec3 Pf0 = P - (Pi - t);
  ivec3 I = ivec3(Pi);
  ivec4 off = TD_SIMPLEX[(Pf0.x > Pf0.y ? 32 : 0) + (Pf0.x > Pf0.z ? 16 : 0) + (Pf0.y > Pf0.z ? 8 : 0)];
  ivec3 o1 = ivec3(greaterThanEqual(off.xyz, ivec3(96)));
  ivec3 o2 = ivec3(greaterThanEqual(off.xyz, ivec3(32)));
  float n0 = tdCorner(0.6, tdG3(tdPT(tdIdx(tdPT(I.x, I.y)), I.z)), Pf0);
  float n1 = tdCorner(0.6, tdG3(tdPT(tdIdx(tdPT(I.x + o1.x, I.y + o1.y)), I.z + o1.z)), Pf0 - vec3(o1) + G3);
  float n2 = tdCorner(0.6, tdG3(tdPT(tdIdx(tdPT(I.x + o2.x, I.y + o2.y)), I.z + o2.z)), Pf0 - vec3(o2) + 2.0 * G3);
  float n3 = tdCorner(0.6, tdG3(tdPT(tdIdx(tdPT(I.x + 1, I.y + 1)), I.z + 1)), Pf0 - vec3(1.0 - 3.0 * G3));
  return 32.0 * (n0 + n1 + n2 + n3);
}
vec4 tdS4grad(ivec4 I, ivec4 o) { return tdG4(tdPT(tdIdx(tdPT(I.x + o.x, I.y + o.y)), tdIdx(tdPT(I.z + o.z, I.w + o.w)))); }
float TDSimplexNoise(vec4 P) {
  const float F4 = 0.309016994375, G4 = 0.138196601125;
  float s = (P.x + P.y + P.z + P.w) * F4;
  vec4 Pi = floor(P + s);
  float t = (Pi.x + Pi.y + Pi.z + Pi.w) * G4;
  vec4 Pf0 = P - (Pi - t);
  ivec4 I = ivec4(Pi);
  int idx = (Pf0.x > Pf0.y ? 32 : 0) + (Pf0.x > Pf0.z ? 16 : 0) + (Pf0.y > Pf0.z ? 8 : 0)
          + (Pf0.x > Pf0.w ? 4 : 0) + (Pf0.y > Pf0.w ? 2 : 0) + (Pf0.z > Pf0.w ? 1 : 0);
  ivec4 off = TD_SIMPLEX[idx];
  ivec4 o1 = ivec4(greaterThanEqual(off, ivec4(160)));
  ivec4 o2 = ivec4(greaterThanEqual(off, ivec4(96)));
  ivec4 o3 = ivec4(greaterThanEqual(off, ivec4(32)));
  float n0 = tdCorner(0.6, tdS4grad(I, ivec4(0)), Pf0);
  float n1 = tdCorner(0.6, tdS4grad(I, o1), Pf0 - vec4(o1) + G4);
  float n2 = tdCorner(0.6, tdS4grad(I, o2), Pf0 - vec4(o2) + 2.0 * G4);
  float n3 = tdCorner(0.6, tdS4grad(I, o3), Pf0 - vec4(o3) + 3.0 * G4);
  float n4 = tdCorner(0.6, tdS4grad(I, ivec4(1)), Pf0 - vec4(1.0 - 4.0 * G4));
  return 27.0 * (n0 + n1 + n2 + n3 + n4);
}
`;

const EXTRA_GLSL = `
${HOSKINS_NOTICE}
float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
// Approximate CPU types: quantile tables 0 perlin3 (source), 1 cell (source), 2 sparse, 3 hermite, 4 alligator
const float TD_Q[165] = float[165](${Q_ROWS.flat().map(qf).join(', ')});
float tdQmap(float v, int src, int dst) {
  if (v <= TD_Q[src * 33]) return TD_Q[dst * 33];
  for (int i = 1; i < 33; i++) {
    float a = TD_Q[src * 33 + i - 1], b = TD_Q[src * 33 + i];
    if (v <= b) return mix(TD_Q[dst * 33 + i - 1], TD_Q[dst * 33 + i], (v - a) / max(b - a, 1e-6));
  }
  return TD_Q[dst * 33 + 32];
}
// cell bumps (alligator base): nearest feature point gets a random height, falling to 0 at the cell border
float tdCellBump(vec3 t) {
  vec3 c = floor(t), fr = fract(t);
  float F1 = 9.0, F2 = 9.0, r = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z)), cc = c + o;
    vec3 q = o + vec3(h31(cc), h31(cc + 17.1), h31(cc + 31.7)) - fr;
    float d = length(q);
    if (d < F1) { F2 = F1; F1 = d; r = h31(cc + 5.3); } else F2 = min(F2, d);
  }
  return r * clamp((F2 - F1) / 0.5, 0.0, 1.0);
}
`;

/** Full GLSL noise library: Gustavson Perlin/simplex 2D–4D (TDPerlinNoise / TDSimplexNoise), h31, CPU-type helpers. */
export const NOISE_LIB_GLSL = `${GUSTAVSON_NOTICE}${TABLES_GLSL}${PERLIN_GLSL}${SIMPLEX_GLSL}${EXTRA_GLSL}`;

// ---------------------------------------------------------------- WGSL

const TABLES_WGSL = `
var<private> TD_PERM: array<i32, 256> = array<i32, 256>(${list(PERM)});
var<private> TD_G3B: array<vec3i, 16> = array<vec3i, 16>(${GRAD3.map((g) => `vec3i(${g.map(byte).join(', ')})`).join(', ')});
var<private> TD_G4B: array<vec4i, 32> = array<vec4i, 32>(${GRAD4.map((g) => `vec4i(${g.map(byte).join(', ')})`).join(', ')});
var<private> TD_SIMPLEX: array<vec4i, 64> = array<vec4i, 64>(${SIMPLEX4.map((s) => `vec4i(${s.join(', ')})`).join(', ')});
fn tdPT(x: i32, y: i32) -> i32 { return TD_PERM[(x + TD_PERM[y & 255]) & 255]; }
fn tdIdx(v: i32) -> i32 { return select(v, 0, v == 255); }
fn tdG3(v: i32) -> vec3f { return vec3f(TD_G3B[v & 15]) / 255.0 * 4.0 - 1.0; }
fn tdG4(v: i32) -> vec4f { return vec4f(TD_G4B[v & 31]) / 255.0 * 4.0 - 1.0; }
fn tdnFade(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
`;

const PERLIN_WGSL = `
fn tdPerlin2(P: vec2f) -> f32 {
  let I = vec2i(floor(P));
  let Pf = fract(P);
  let n00 = dot(tdG3(tdPT(I.x, I.y)).xy, Pf);
  let n10 = dot(tdG3(tdPT(I.x + 1, I.y)).xy, Pf - vec2f(1.0, 0.0));
  let n01 = dot(tdG3(tdPT(I.x, I.y + 1)).xy, Pf - vec2f(0.0, 1.0));
  let n11 = dot(tdG3(tdPT(I.x + 1, I.y + 1)).xy, Pf - vec2f(1.0, 1.0));
  let n_x = mix(vec2f(n00, n01), vec2f(n10, n11), tdnFade(Pf.x));
  return mix(n_x.x, n_x.y, tdnFade(Pf.y));
}
fn tdPerlin3(P: vec3f) -> f32 {
  let I = vec3i(floor(P));
  let Pf = fract(P);
  let perm00 = tdIdx(tdPT(I.x, I.y));
  let n000 = dot(tdG3(tdPT(perm00, I.z)), Pf);
  let n001 = dot(tdG3(tdPT(perm00, I.z + 1)), Pf - vec3f(0.0, 0.0, 1.0));
  let perm01 = tdIdx(tdPT(I.x, I.y + 1));
  let n010 = dot(tdG3(tdPT(perm01, I.z)), Pf - vec3f(0.0, 1.0, 0.0));
  let n011 = dot(tdG3(tdPT(perm01, I.z + 1)), Pf - vec3f(0.0, 1.0, 1.0));
  let perm10 = tdIdx(tdPT(I.x + 1, I.y));
  let n100 = dot(tdG3(tdPT(perm10, I.z)), Pf - vec3f(1.0, 0.0, 0.0));
  let n101 = dot(tdG3(tdPT(perm10, I.z + 1)), Pf - vec3f(1.0, 0.0, 1.0));
  let perm11 = tdIdx(tdPT(I.x + 1, I.y + 1));
  let n110 = dot(tdG3(tdPT(perm11, I.z)), Pf - vec3f(1.0, 1.0, 0.0));
  let n111 = dot(tdG3(tdPT(perm11, I.z + 1)), Pf - vec3f(1.0, 1.0, 1.0));
  let n_x = mix(vec4f(n000, n001, n010, n011), vec4f(n100, n101, n110, n111), tdnFade(Pf.x));
  let n_xy = mix(n_x.xy, n_x.zw, tdnFade(Pf.y));
  return mix(n_xy.x, n_xy.y, tdnFade(Pf.z));
}
fn tdP4(xy: i32, zw: i32, Pf: vec4f, o: vec4f) -> f32 { return dot(tdG4(tdPT(xy, zw)), Pf - o); }
fn tdPerlin4(P: vec4f) -> f32 {
  let I = vec4i(floor(P));
  let Pf = fract(P);
  let p00xy = tdIdx(tdPT(I.x, I.y)); let p01xy = tdIdx(tdPT(I.x, I.y + 1));
  let p10xy = tdIdx(tdPT(I.x + 1, I.y)); let p11xy = tdIdx(tdPT(I.x + 1, I.y + 1));
  let p00zw = tdIdx(tdPT(I.z, I.w)); let p01zw = tdIdx(tdPT(I.z, I.w + 1));
  let p10zw = tdIdx(tdPT(I.z + 1, I.w)); let p11zw = tdIdx(tdPT(I.z + 1, I.w + 1));
  let n0000 = tdP4(p00xy, p00zw, Pf, vec4f(0.0, 0.0, 0.0, 0.0));
  let n0001 = tdP4(p00xy, p01zw, Pf, vec4f(0.0, 0.0, 0.0, 1.0));
  let n0010 = tdP4(p00xy, p10zw, Pf, vec4f(0.0, 0.0, 1.0, 0.0));
  let n0011 = tdP4(p00xy, p11zw, Pf, vec4f(0.0, 0.0, 1.0, 1.0));
  let n0100 = tdP4(p01xy, p00zw, Pf, vec4f(0.0, 1.0, 0.0, 0.0));
  let n0101 = tdP4(p01xy, p01zw, Pf, vec4f(0.0, 1.0, 0.0, 1.0));
  let n0110 = tdP4(p01xy, p10zw, Pf, vec4f(0.0, 1.0, 1.0, 0.0));
  let n0111 = tdP4(p01xy, p11zw, Pf, vec4f(0.0, 1.0, 1.0, 1.0));
  let n1000 = tdP4(p10xy, p00zw, Pf, vec4f(1.0, 0.0, 0.0, 0.0));
  let n1001 = tdP4(p10xy, p01zw, Pf, vec4f(1.0, 0.0, 0.0, 1.0));
  let n1010 = tdP4(p10xy, p10zw, Pf, vec4f(1.0, 0.0, 1.0, 0.0));
  let n1011 = tdP4(p10xy, p11zw, Pf, vec4f(1.0, 0.0, 1.0, 1.0));
  let n1100 = tdP4(p11xy, p00zw, Pf, vec4f(1.0, 1.0, 0.0, 0.0));
  let n1101 = tdP4(p11xy, p01zw, Pf, vec4f(1.0, 1.0, 0.0, 1.0));
  let n1110 = tdP4(p11xy, p10zw, Pf, vec4f(1.0, 1.0, 1.0, 0.0));
  let n1111 = tdP4(p11xy, p11zw, Pf, vec4f(1.0, 1.0, 1.0, 1.0));
  let fadex = tdnFade(Pf.x);
  let n_x0 = mix(vec4f(n0000, n0001, n0010, n0011), vec4f(n1000, n1001, n1010, n1011), fadex);
  let n_x1 = mix(vec4f(n0100, n0101, n0110, n0111), vec4f(n1100, n1101, n1110, n1111), fadex);
  let n_xy = mix(n_x0, n_x1, tdnFade(Pf.y));
  let n_xyz = mix(n_xy.xy, n_xy.zw, tdnFade(Pf.z));
  return mix(n_xyz.x, n_xyz.y, tdnFade(Pf.w));
}
`;

const SIMPLEX_WGSL = `
fn tdCorner2(r2: f32, g: vec2f, f: vec2f) -> f32 { var t = r2 - dot(f, f); if (t < 0.0) { return 0.0; } t = t * t; return t * t * dot(g, f); }
fn tdCorner3(r2: f32, g: vec3f, f: vec3f) -> f32 { var t = r2 - dot(f, f); if (t < 0.0) { return 0.0; } t = t * t; return t * t * dot(g, f); }
fn tdCorner4(r2: f32, g: vec4f, f: vec4f) -> f32 { var t = r2 - dot(f, f); if (t < 0.0) { return 0.0; } t = t * t; return t * t * dot(g, f); }
fn tdSimplex2(P: vec2f) -> f32 {
  let F2 = 0.366025403784; let G2 = 0.211324865405;
  let s = (P.x + P.y) * F2;
  let Pi = floor(P + s);
  let t = (Pi.x + Pi.y) * G2;
  let Pf0 = P - (Pi - t);
  let I = vec2i(Pi);
  let o1 = select(vec2i(0, 1), vec2i(1, 0), Pf0.x > Pf0.y);
  let n0 = tdCorner2(0.5, tdG3(tdPT(I.x, I.y)).xy, Pf0);
  let n1 = tdCorner2(0.5, tdG3(tdPT(I.x + o1.x, I.y + o1.y)).xy, Pf0 - vec2f(o1) + G2);
  let n2 = tdCorner2(0.5, tdG3(tdPT(I.x + 1, I.y + 1)).xy, Pf0 - vec2f(1.0 - 2.0 * G2));
  return 70.0 * (n0 + n1 + n2);
}
fn tdSimplex3(P: vec3f) -> f32 {
  let F3 = 0.333333333333; let G3 = 0.166666666667;
  let s = (P.x + P.y + P.z) * F3;
  let Pi = floor(P + s);
  let t = (Pi.x + Pi.y + Pi.z) * G3;
  let Pf0 = P - (Pi - t);
  let I = vec3i(Pi);
  let off = TD_SIMPLEX[select(0, 32, Pf0.x > Pf0.y) + select(0, 16, Pf0.x > Pf0.z) + select(0, 8, Pf0.y > Pf0.z)];
  let o1 = vec3i(off.xyz >= vec3i(96));
  let o2 = vec3i(off.xyz >= vec3i(32));
  let n0 = tdCorner3(0.6, tdG3(tdPT(tdIdx(tdPT(I.x, I.y)), I.z)), Pf0);
  let n1 = tdCorner3(0.6, tdG3(tdPT(tdIdx(tdPT(I.x + o1.x, I.y + o1.y)), I.z + o1.z)), Pf0 - vec3f(o1) + G3);
  let n2 = tdCorner3(0.6, tdG3(tdPT(tdIdx(tdPT(I.x + o2.x, I.y + o2.y)), I.z + o2.z)), Pf0 - vec3f(o2) + 2.0 * G3);
  let n3 = tdCorner3(0.6, tdG3(tdPT(tdIdx(tdPT(I.x + 1, I.y + 1)), I.z + 1)), Pf0 - vec3f(1.0 - 3.0 * G3));
  return 32.0 * (n0 + n1 + n2 + n3);
}
fn tdS4grad(I: vec4i, o: vec4i) -> vec4f { return tdG4(tdPT(tdIdx(tdPT(I.x + o.x, I.y + o.y)), tdIdx(tdPT(I.z + o.z, I.w + o.w)))); }
fn tdSimplex4(P: vec4f) -> f32 {
  let F4 = 0.309016994375; let G4 = 0.138196601125;
  let s = (P.x + P.y + P.z + P.w) * F4;
  let Pi = floor(P + s);
  let t = (Pi.x + Pi.y + Pi.z + Pi.w) * G4;
  let Pf0 = P - (Pi - t);
  let I = vec4i(Pi);
  let idx = select(0, 32, Pf0.x > Pf0.y) + select(0, 16, Pf0.x > Pf0.z) + select(0, 8, Pf0.y > Pf0.z)
          + select(0, 4, Pf0.x > Pf0.w) + select(0, 2, Pf0.y > Pf0.w) + select(0, 1, Pf0.z > Pf0.w);
  let off = TD_SIMPLEX[idx];
  let o1 = vec4i(off >= vec4i(160));
  let o2 = vec4i(off >= vec4i(96));
  let o3 = vec4i(off >= vec4i(32));
  let n0 = tdCorner4(0.6, tdS4grad(I, vec4i(0)), Pf0);
  let n1 = tdCorner4(0.6, tdS4grad(I, o1), Pf0 - vec4f(o1) + G4);
  let n2 = tdCorner4(0.6, tdS4grad(I, o2), Pf0 - vec4f(o2) + 2.0 * G4);
  let n3 = tdCorner4(0.6, tdS4grad(I, o3), Pf0 - vec4f(o3) + 3.0 * G4);
  let n4 = tdCorner4(0.6, tdS4grad(I, vec4i(1)), Pf0 - vec4f(1.0 - 4.0 * G4));
  return 27.0 * (n0 + n1 + n2 + n3 + n4);
}
`;

const EXTRA_WGSL = `
${HOSKINS_NOTICE}
fn h31(p0: vec3f) -> f32 {
  var p = fract(p0 * vec3f(0.1031, 0.1030, 0.0973));
  p = p + dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
var<private> TD_Q: array<f32, 165> = array<f32, 165>(${Q_ROWS.flat().map(qf).join(', ')});
fn tdQmap(v: f32, src: i32, dst: i32) -> f32 {
  if (v <= TD_Q[src * 33]) { return TD_Q[dst * 33]; }
  for (var i = 1; i < 33; i++) {
    let a = TD_Q[src * 33 + i - 1];
    let b = TD_Q[src * 33 + i];
    if (v <= b) { return mix(TD_Q[dst * 33 + i - 1], TD_Q[dst * 33 + i], (v - a) / max(b - a, 1e-6)); }
  }
  return TD_Q[dst * 33 + 32];
}
fn tdCellBump(t: vec3f) -> f32 {
  let c = floor(t);
  let fr = fract(t);
  var F1 = 9.0;
  var F2 = 9.0;
  var r = 0.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let o = vec3f(f32(x), f32(y), f32(z));
        let cc = c + o;
        let q = o + vec3f(h31(cc), h31(cc + 17.1), h31(cc + 31.7)) - fr;
        let d = length(q);
        if (d < F1) { F2 = F1; F1 = d; r = h31(cc + 5.3); } else { F2 = min(F2, d); }
      }
    }
  }
  return r * clamp((F2 - F1) / 0.5, 0.0, 1.0);
}
`;

/** Full WGSL noise library (same functions; Gustavson basis named tdPerlin2/3/4 and tdSimplex2/3/4). */
export const NOISE_LIB_WGSL = `${GUSTAVSON_NOTICE}${TABLES_WGSL}${PERLIN_WGSL}${SIMPLEX_WGSL}${EXTRA_WGSL}`;
