/**
 * TouchDesigner Composite operations (all 46 menu entries) as GLSL and WGSL.
 *
 * Premultiplied RGBA; A = the upper layer (first input), B = the lower one.
 * 37 operations reproduce reference implementations that were verified
 * against TouchDesigner outputs (four input sets, ≤1e-7); 9 (burncolor,
 * chromadifference, color, divide, freeze, hue, luminancedifference, yfilm,
 * zfilm) were fitted to the same data (≤3e-5). Measured by the author's EOI
 * dream-engine research, ported with permission; see docs/TD-PARITY.md.
 *
 * The "blend mode" group (overlay, hardlight, softlight, darker/lighter
 * colour, burnlinear, linearlight, pinlight, hardmix, vividlight, inverse,
 * glow, reflect, heat, color, hue) un-premultiplies and clamps B, applies the
 * mode against A (still premultiplied, unclamped) and lays the result back
 * over A with B's alpha as opacity.
 *
 * Third-party: RGB↔HSV by Sam Hocevar (2013), WTFPL v2 — see
 * THIRD_PARTY_NOTICES.md.
 */
import { COMP_COLOR_B, COMP_COLOR_Y, COMP_LUMDIFF_A, COMP_OPS, type CompOp } from './tdmath';

const C = Object.fromEntries(COMP_OPS.map((o, i) => [o, i])) as Record<CompOp, number>;
const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
/** row-major 3×3 → column vectors (GLSL/WGSL matrices are built from columns) */
const cols = (m: readonly (readonly number[])[]) => [0, 1, 2].map((c) => [m[0][c], m[1][c], m[2][c]].map(f).join(', '));

const HSV_NOTICE = '// RGB <-> HSV: Sam Hocevar, "Fast branchless RGB to HSV conversion in GLSL" (2013), WTFPL v2.';

export const COMP_LIB_GLSL = `
${HSV_NOTICE}
vec3 cRGB2HSV(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = c.g < c.b ? vec4(c.bg, K.wz) : vec4(c.gb, K.xy);
  vec4 q = c.r < p.x ? vec4(p.xyw, c.r) : vec4(c.r, p.yzx);
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 cHSV2RGB(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
const vec3 cColorY = vec3(${COMP_COLOR_Y.map(f).join(', ')});
const mat3 cColorB = mat3(${cols(COMP_COLOR_B).map((c) => `vec3(${c})`).join(', ')});
const mat3 cLumDiffA = mat3(${cols(COMP_LUMDIFF_A).map((c) => `vec3(${c})`).join(', ')});
float cL3(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
float cT709(vec3 c) { return clamp((dot(c, vec3(0.2125, 0.7154, 0.0721)) - 0.45) / 0.1, 0.0, 1.0); }
vec3 cUB(vec4 B) { return B.a != 0.0 ? clamp(B.rgb / B.a, 0.0, 1.0) : vec3(0.0); }
vec4 cMixB(vec4 A, vec4 B, vec3 f) { return vec4(A.rgb * (1.0 - B.a) + f * B.a, A.a); }
vec4 tdComp(vec4 A, vec4 B, int op) {
  float ca = clamp(A.a, 0.0, 1.0), cb = clamp(B.a, 0.0, 1.0);
  vec3 X = A.rgb, Y = cUB(B);
  if (op == ${C.add}) return A + B;
  if (op == ${C.subtract}) return A - B;
  if (op == ${C.multiply}) return A * B;
  if (op == ${C.screen}) return A + B - A * B;
  if (op == ${C.average}) return (A + B) * 0.5;
  if (op == ${C.maximum}) return max(A, B);
  if (op == ${C.minimum}) return min(A, B);
  if (op == ${C.over}) return A + B * (1.0 - ca);
  if (op == ${C.under}) return B + A * (1.0 - cb);
  if (op == ${C.atop}) return vec4(A.rgb * B.a + B.rgb * (1.0 - ca), B.a);
  if (op == ${C.inside}) return A * cb;
  if (op == ${C.outside}) return A * (1.0 - cb);
  if (op == ${C.xor}) return A * (1.0 - cb) + B * (1.0 - ca);
  if (op == ${C.difference}) return vec4(abs(A.rgb - B.rgb), 1.0);
  if (op == ${C.negate}) return vec4(1.0 - abs(1.0 - A.rgb - B.rgb), 1.0);
  if (op == ${C.exclude}) return vec4(A.rgb + B.rgb - 2.0 * A.rgb * B.rgb, 1.0);
  if (op == ${C.dodge}) return vec4(A.rgb / (1.0 - B.rgb), 1.0);
  if (op == ${C.brightest}) return cL3(A.rgb) > cL3(B.rgb) ? A : B;
  if (op == ${C.dimmest}) return cL3(A.rgb) < cL3(B.rgb) ? A : B;
  if (op == ${C.insideluminance}) return A * clamp(cL3(B.rgb), 0.0, 1.0);
  if (op == ${C.outsideluminance}) return A * (1.0 - clamp(cL3(B.rgb), 0.0, 1.0));
  if (op == ${C.stencilluminance}) return vec4(A.rgb, clamp(cL3(B.rgb), 0.0, 1.0));
  if (op == ${C.subtractive}) return vec4(A.rgb - B.rgb * B.a, A.a + B.a);
  if (op == ${C.overlay}) { vec3 m = 2.0 * X * Y + (1.0 - 2.0 * (1.0 - X) * (1.0 - Y) - 2.0 * X * Y) * cT709(X); return vec4(cMixB(A, B, m).rgb, 1.0); }
  if (op == ${C.hardlight}) { vec3 m = 2.0 * X * Y + (1.0 - 2.0 * (1.0 - X) * (1.0 - Y) - 2.0 * X * Y) * cT709(Y); return cMixB(A, B, m); }
  if (op == ${C.softlight}) return cMixB(A, B, (1.0 - 2.0 * Y) * X * X + 2.0 * X * Y);
  if (op == ${C.darkercolor}) return cMixB(A, B, cL3(X) < cL3(Y) ? X : Y);
  if (op == ${C.lightercolor}) return cMixB(A, B, cL3(X) > cL3(Y) ? X : Y);
  if (op == ${C.burnlinear}) return cMixB(A, B, clamp(X + Y - 1.0, 0.0, 1.0));
  if (op == ${C.linearlight}) return cMixB(A, B, X + 2.0 * Y - 1.0);
  if (op == ${C.pinlight}) return cMixB(A, B, mix(max(X, 2.0 * Y - 1.0), min(X, 2.0 * Y), vec3(lessThan(Y, vec3(0.5)))));
  if (op == ${C.hardmix}) return cMixB(A, B, vec3(greaterThanEqual(X + Y, vec3(1.0))));
  if (op == ${C.vividlight}) return cMixB(A, B, clamp(mix(X / (2.0 * (1.0 - Y)), 1.0 - (1.0 - X) / (2.0 * Y), vec3(lessThan(Y, vec3(0.5)))), 0.0, 1.0));
  if (op == ${C.inverse}) return cMixB(A, B, Y / (1.0 - X));
  if (op == ${C.glow}) return cMixB(A, B, Y * Y / (1.0 - X));
  if (op == ${C.reflect}) return cMixB(A, B, X * X / (1.0 - Y));
  if (op == ${C.heat}) return cMixB(A, B, 1.0 - (1.0 - Y) * (1.0 - Y) / X);
  // fitted to TD outputs
  if (op == ${C.color} || op == ${C.burncolor}) return cMixB(A, B, dot(A.rgb, cColorY) + cColorB * Y);
  if (op == ${C.hue}) { vec3 a = cRGB2HSV(A.rgb); return cMixB(A, B, cHSV2RGB(vec3(cRGB2HSV(Y).x, a.yz))); }
  if (op == ${C.chromadifference}) { vec3 a = cRGB2HSV(A.rgb); return vec4(cHSV2RGB(vec3(fract(a.x - cRGB2HSV(B.rgb).x), a.yz)), 1.0); }
  if (op == ${C.luminancedifference}) return vec4(abs(cL3(A.rgb) - cL3(B.rgb)) + cLumDiffA * A.rgb, 1.0);
  if (op == ${C.divide}) return A / mix(B, vec4(1.0), vec4(equal(B, vec4(0.0))));
  if (op == ${C.freeze}) return vec4(1.0 - (1.0 - A.rgb) * (1.0 - A.rgb) / B.rgb, 1.0);
  if (op == ${C.yfilm}) return vec4(2.0 * A.rgb - A.rgb * A.rgb / (1.0 - B.rgb), 1.0);
  if (op == ${C.zfilm}) return vec4(4.0 * A.rgb - 9.0 * B.rgb + 6.0 * (1.0 - abs(1.0 - A.rgb - B.rgb)), 1.0);
  return A;
}
`;

/** WGSL version: vector selects replace GLSL's mix(…, bvec) idiom. */
export const COMP_LIB_WGSL = `
${HSV_NOTICE}
fn cRGB2HSV(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4f(c.gb, K.xy), vec4f(c.bg, K.wz), c.g < c.b);
  let q = select(vec4f(c.r, p.yzx), vec4f(p.xyw, c.r), c.r < p.x);
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn cHSV2RGB(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}
const cColorY = vec3f(${COMP_COLOR_Y.map(f).join(', ')});
const cColorB = mat3x3f(${cols(COMP_COLOR_B).map((c) => `vec3f(${c})`).join(', ')});
const cLumDiffA = mat3x3f(${cols(COMP_LUMDIFF_A).map((c) => `vec3f(${c})`).join(', ')});
fn cL3(c: vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }
fn cT709(c: vec3f) -> f32 { return clamp((dot(c, vec3f(0.2125, 0.7154, 0.0721)) - 0.45) / 0.1, 0.0, 1.0); }
fn cUB(B: vec4f) -> vec3f { if (B.a != 0.0) { return clamp(B.rgb / B.a, vec3f(0.0), vec3f(1.0)); } return vec3f(0.0); }
fn cMixB(A: vec4f, B: vec4f, f: vec3f) -> vec4f { return vec4f(A.rgb * (1.0 - B.a) + f * B.a, A.a); }
fn tdComp(A: vec4f, B: vec4f, op: i32) -> vec4f {
  let ca = clamp(A.a, 0.0, 1.0);
  let cb = clamp(B.a, 0.0, 1.0);
  let X = A.rgb;
  let Y = cUB(B);
  let lowY = Y < vec3f(0.5);
  if (op == ${C.add}) { return A + B; }
  if (op == ${C.subtract}) { return A - B; }
  if (op == ${C.multiply}) { return A * B; }
  if (op == ${C.screen}) { return A + B - A * B; }
  if (op == ${C.average}) { return (A + B) * 0.5; }
  if (op == ${C.maximum}) { return max(A, B); }
  if (op == ${C.minimum}) { return min(A, B); }
  if (op == ${C.over}) { return A + B * (1.0 - ca); }
  if (op == ${C.under}) { return B + A * (1.0 - cb); }
  if (op == ${C.atop}) { return vec4f(A.rgb * B.a + B.rgb * (1.0 - ca), B.a); }
  if (op == ${C.inside}) { return A * cb; }
  if (op == ${C.outside}) { return A * (1.0 - cb); }
  if (op == ${C.xor}) { return A * (1.0 - cb) + B * (1.0 - ca); }
  if (op == ${C.difference}) { return vec4f(abs(A.rgb - B.rgb), 1.0); }
  if (op == ${C.negate}) { return vec4f(1.0 - abs(1.0 - A.rgb - B.rgb), 1.0); }
  if (op == ${C.exclude}) { return vec4f(A.rgb + B.rgb - 2.0 * A.rgb * B.rgb, 1.0); }
  if (op == ${C.dodge}) { return vec4f(A.rgb / (1.0 - B.rgb), 1.0); }
  if (op == ${C.brightest}) { return select(B, A, cL3(A.rgb) > cL3(B.rgb)); }
  if (op == ${C.dimmest}) { return select(B, A, cL3(A.rgb) < cL3(B.rgb)); }
  if (op == ${C.insideluminance}) { return A * clamp(cL3(B.rgb), 0.0, 1.0); }
  if (op == ${C.outsideluminance}) { return A * (1.0 - clamp(cL3(B.rgb), 0.0, 1.0)); }
  if (op == ${C.stencilluminance}) { return vec4f(A.rgb, clamp(cL3(B.rgb), 0.0, 1.0)); }
  if (op == ${C.subtractive}) { return vec4f(A.rgb - B.rgb * B.a, A.a + B.a); }
  if (op == ${C.overlay}) { let m = 2.0 * X * Y + (1.0 - 2.0 * (1.0 - X) * (1.0 - Y) - 2.0 * X * Y) * cT709(X); return vec4f(cMixB(A, B, m).rgb, 1.0); }
  if (op == ${C.hardlight}) { let m = 2.0 * X * Y + (1.0 - 2.0 * (1.0 - X) * (1.0 - Y) - 2.0 * X * Y) * cT709(Y); return cMixB(A, B, m); }
  if (op == ${C.softlight}) { return cMixB(A, B, (1.0 - 2.0 * Y) * X * X + 2.0 * X * Y); }
  if (op == ${C.darkercolor}) { return cMixB(A, B, select(Y, X, cL3(X) < cL3(Y))); }
  if (op == ${C.lightercolor}) { return cMixB(A, B, select(Y, X, cL3(X) > cL3(Y))); }
  if (op == ${C.burnlinear}) { return cMixB(A, B, clamp(X + Y - 1.0, vec3f(0.0), vec3f(1.0))); }
  if (op == ${C.linearlight}) { return cMixB(A, B, X + 2.0 * Y - 1.0); }
  if (op == ${C.pinlight}) { return cMixB(A, B, select(max(X, 2.0 * Y - 1.0), min(X, 2.0 * Y), lowY)); }
  if (op == ${C.hardmix}) { return cMixB(A, B, select(vec3f(0.0), vec3f(1.0), X + Y >= vec3f(1.0))); }
  if (op == ${C.vividlight}) { return cMixB(A, B, clamp(select(X / (2.0 * (1.0 - Y)), 1.0 - (1.0 - X) / (2.0 * Y), lowY), vec3f(0.0), vec3f(1.0))); }
  if (op == ${C.inverse}) { return cMixB(A, B, Y / (1.0 - X)); }
  if (op == ${C.glow}) { return cMixB(A, B, Y * Y / (1.0 - X)); }
  if (op == ${C.reflect}) { return cMixB(A, B, X * X / (1.0 - Y)); }
  if (op == ${C.heat}) { return cMixB(A, B, 1.0 - (1.0 - Y) * (1.0 - Y) / X); }
  if (op == ${C.color} || op == ${C.burncolor}) { return cMixB(A, B, vec3f(dot(A.rgb, cColorY)) + cColorB * Y); }
  if (op == ${C.hue}) { let a = cRGB2HSV(A.rgb); return cMixB(A, B, cHSV2RGB(vec3f(cRGB2HSV(Y).x, a.yz))); }
  if (op == ${C.chromadifference}) { let a = cRGB2HSV(A.rgb); return vec4f(cHSV2RGB(vec3f(fract(a.x - cRGB2HSV(B.rgb).x), a.yz)), 1.0); }
  if (op == ${C.luminancedifference}) { return vec4f(vec3f(abs(cL3(A.rgb) - cL3(B.rgb))) + cLumDiffA * A.rgb, 1.0); }
  if (op == ${C.divide}) { return A / select(B, vec4f(1.0), B == vec4f(0.0)); }
  if (op == ${C.freeze}) { return vec4f(1.0 - (1.0 - A.rgb) * (1.0 - A.rgb) / B.rgb, 1.0); }
  if (op == ${C.yfilm}) { return vec4f(2.0 * A.rgb - A.rgb * A.rgb / (1.0 - B.rgb), 1.0); }
  if (op == ${C.zfilm}) { return vec4f(4.0 * A.rgb - 9.0 * B.rgb + 6.0 * (1.0 - abs(1.0 - A.rgb - B.rgb)), 1.0); }
  return A;
}
`;
