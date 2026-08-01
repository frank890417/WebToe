/** WebGL2 scene renderer — original shaders, VAO cache, instancing, depth.
 *  Consumed by the backend's renderScene(); see docs/R3-3D-PLAN.md §5. */
import type { GeometryData, ScenePassSpec } from '@webtoe/core';

const VERT = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_n;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec4 a_cd;
layout(location=4) in vec3 i_off;
layout(location=5) in vec4 i_cd;
layout(location=6) in vec3 i_scale;
uniform mat4 u_model, u_view, u_proj;
uniform float u_hasInstance;
uniform float u_pointSize;
out vec3 v_n;
out vec2 v_uv;
out vec4 v_cd;
out vec3 v_wpos;
void main() {
  bool inst = u_hasInstance > 0.5;
  vec3 p = a_pos * (inst ? i_scale : vec3(1.0)) + (inst ? i_off : vec3(0.0));
  vec4 w = u_model * vec4(p, 1.0);
  v_wpos = w.xyz;
  v_n = mat3(u_model) * a_n;
  v_uv = a_uv;
  v_cd = a_cd * (inst ? i_cd : vec4(1.0));
  gl_Position = u_proj * u_view * w;
  // point sprites take their size from the instance scale too, which is how
  // CHOP-driven particle rigs vary dot size
  gl_PointSize = u_pointSize * (inst ? max(i_scale.x, 0.0) : 1.0);
}`;

const FRAG_UNLIT = `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform float u_hasMap;
uniform sampler2D u_map;
in vec2 v_uv;
in vec4 v_cd;
out vec4 o;
void main() {
  vec4 c = u_color * v_cd;
  if (u_hasMap > 0.5) c *= texture(u_map, v_uv);
  o = c;
}`;

const FRAG_POINTS = `#version 300 es
precision highp float;
uniform vec4 u_color;
in vec4 v_cd;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  o = u_color * v_cd;
}`;

const FRAG_LIT = `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform float u_hasMap;
uniform sampler2D u_map;
uniform float u_metallic;
uniform float u_roughness;
uniform vec3 u_emit;
uniform vec3 u_eye;
uniform int u_numLights;
uniform vec4 u_lightPosDir[4];
uniform vec3 u_lightColor[4];
uniform vec3 u_ambient;
in vec3 v_n;
in vec2 v_uv;
in vec4 v_cd;
in vec3 v_wpos;
out vec4 o;
void main() {
  vec4 basec = u_color * v_cd;
  if (u_hasMap > 0.5) basec *= texture(u_map, v_uv);
  vec3 base = basec.rgb;
  vec3 N = normalize(v_n);
  vec3 V = normalize(u_eye - v_wpos);
  if (dot(N, V) < 0.0) N = -N;
  float shininess = clamp(2.0 / (u_roughness * u_roughness), 2.0, 256.0);
  vec3 specTint = mix(vec3(0.04), base, u_metallic);
  vec3 col = u_ambient * base + u_emit;
  for (int i = 0; i < 4; i++) {
    if (i >= u_numLights) break;
    vec3 L;
    if (u_lightPosDir[i].w > 0.5) L = normalize(u_lightPosDir[i].xyz - v_wpos);
    else L = normalize(-u_lightPosDir[i].xyz);
    float ndl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), shininess) * (1.0 - u_roughness * 0.5);
    col += u_lightColor[i] * (base * mix(ndl, 1.0, u_metallic * 0.0) * ndl / max(ndl, 1e-5) * ndl + specTint * spec);
  }
  o = vec4(col, basec.a);
}`;

interface CachedGeo {
  vao: WebGLVertexArrayObject;
  triCount: number;
  triBuffer: WebGLBuffer | null;
  lineCount: number;
  lineBuffer: WebGLBuffer | null;
  wireCount: number;
  wireBuffer: WebGLBuffer | null;
  pointCount: number;
  instBuf: WebGLBuffer;
  buffers: WebGLBuffer[];
  version: number;
}

export class SceneRenderer {
  private progs = new Map<string, { prog: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> }>();
  private geos = new Map<string, CachedGeo>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  render(spec: ScenePassSpec, getTexture: (id: number) => WebGLTexture | null): void {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(...spec.clear);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const view = spec.camera.view;
    // camera eye = inverse(view) translation
    const eye: [number, number, number] = [
      -(view[0] * view[12] + view[1] * view[13] + view[2] * view[14]),
      -(view[4] * view[12] + view[5] * view[13] + view[6] * view[14]),
      -(view[8] * view[12] + view[9] * view[13] + view[10] * view[14]),
    ];

    const ordered = [...spec.draws].sort((a, b) => Number(a.material.color[3] < 1) - Number(b.material.color[3] < 1));

    for (const draw of ordered) {
      const cached = this.ensureGeo(draw.geoKey, draw.geo);
      const translucent = draw.material.color[3] < 1;
      gl.depthMask(!translucent);

      const shading = draw.material.shading;
      const progKind = shading === 'lit' ? 'lit' : shading === 'points' ? 'points' : 'unlit';
      const p = this.program(progKind);
      gl.useProgram(p.prog);
      const set = (n: string, v: number | number[] | Float32Array) => this.uniform(p, n, v);

      set('u_model', draw.model);
      set('u_view', view);
      set('u_proj', spec.camera.proj);
      set('u_color', draw.material.color);
      set('u_pointSize', draw.material.pointSize ?? 3);

      const map = draw.material.map ? getTexture(draw.material.map.id) : null;
      this.uniform(p, 'u_hasMap', map ? 1 : 0);
      if (map) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, map);
        const loc = this.loc(p, 'u_map');
        if (loc) gl.uniform1i(loc, 0);
      }

      if (progKind === 'lit') {
        set('u_metallic', draw.material.metallic ?? 0);
        set('u_roughness', Math.max(0.05, draw.material.roughness ?? 0.6));
        set('u_emit', draw.material.emit ?? [0, 0, 0]);
        set('u_eye', eye);
        const lights = spec.lights.filter((l) => l.kind !== 'ambient').slice(0, 4);
        const ambient = spec.lights.filter((l) => l.kind === 'ambient')
          .reduce((a, l) => [a[0] + l.color[0] * l.intensity, a[1] + l.color[1] * l.intensity, a[2] + l.color[2] * l.intensity], [0, 0, 0]);
        const posdir = new Float32Array(16);
        const lcol = new Float32Array(12);
        lights.forEach((l, i) => {
          const isPoint = l.kind === 'point';
          posdir.set(isPoint ? [...l.position, 1] : [...l.direction, 0], i * 4);
          lcol.set([l.color[0] * l.intensity, l.color[1] * l.intensity, l.color[2] * l.intensity], i * 3);
        });
        const nl = this.loc(p, 'u_numLights');
        if (nl) gl.uniform1i(nl, lights.length);
        const lp = this.loc(p, 'u_lightPosDir[0]');
        if (lp) gl.uniform4fv(lp, posdir);
        const lc = this.loc(p, 'u_lightColor[0]');
        if (lc) gl.uniform3fv(lc, lcol);
        set('u_ambient', ambient);
      }

      gl.bindVertexArray(cached.vao);

      // instance attributes
      const instanced = !!draw.instances && draw.instances.count > 0;
      this.uniform(p, 'u_hasInstance', instanced ? 1 : 0);
      if (instanced) {
        const inst = draw.instances!;
        const STRIDE_F = 10;                       // translate3 + colour4 + scale3
        const interleaved = new Float32Array(inst.count * STRIDE_F);
        for (let i = 0; i < inst.count; i++) {
          const b = i * STRIDE_F;
          interleaved.set(inst.translate.subarray(i * 3, i * 3 + 3), b);
          if (inst.color) interleaved.set(inst.color.subarray(i * 4, i * 4 + 4), b + 3);
          else interleaved.set([1, 1, 1, 1], b + 3);
          if (inst.scale) interleaved.set(inst.scale.subarray(i * 3, i * 3 + 3), b + 7);
          else interleaved.set([1, 1, 1], b + 7);
        }
        const STRIDE_B = STRIDE_F * 4;
        gl.bindBuffer(gl.ARRAY_BUFFER, cached.instBuf);
        gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 3, gl.FLOAT, false, STRIDE_B, 0);
        gl.vertexAttribDivisor(4, 1);
        gl.enableVertexAttribArray(5);
        gl.vertexAttribPointer(5, 4, gl.FLOAT, false, STRIDE_B, 12);
        gl.vertexAttribDivisor(5, 1);
        gl.enableVertexAttribArray(6);
        gl.vertexAttribPointer(6, 3, gl.FLOAT, false, STRIDE_B, 28);
        gl.vertexAttribDivisor(6, 1);
      } else {
        gl.disableVertexAttribArray(4);
        gl.vertexAttrib3f(4, 0, 0, 0);
        gl.disableVertexAttribArray(5);
        gl.vertexAttrib4f(5, 1, 1, 1, 1);
        gl.disableVertexAttribArray(6);
        gl.vertexAttrib3f(6, 1, 1, 1);
      }
      const count = instanced ? draw.instances!.count : 1;

      const drawElems = (buffer: WebGLBuffer, num: number, mode: number) => {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
        if (instanced) gl.drawElementsInstanced(mode, num, gl.UNSIGNED_INT, 0, count);
        else gl.drawElements(mode, num, gl.UNSIGNED_INT, 0);
      };

      if (shading === 'wireframe' && cached.wireBuffer) {
        drawElems(cached.wireBuffer, cached.wireCount, gl.LINES);
      } else if (shading === 'points') {
        if (instanced) gl.drawArraysInstanced(gl.POINTS, 0, cached.pointCount, count);
        else gl.drawArrays(gl.POINTS, 0, cached.pointCount);
      } else {
        if (cached.triBuffer && shading !== 'line') drawElems(cached.triBuffer, cached.triCount, gl.TRIANGLES);
        if (cached.lineBuffer) drawElems(cached.lineBuffer, cached.lineCount, gl.LINES);
        if (!cached.triBuffer && !cached.lineBuffer) {
          if (instanced) gl.drawArraysInstanced(gl.POINTS, 0, cached.pointCount, count);
          else gl.drawArrays(gl.POINTS, 0, cached.pointCount);
        }
      }
      gl.bindVertexArray(null);
    }
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    for (const g of this.geos.values()) this.releaseGeo(g);
    for (const p of this.progs.values()) gl.deleteProgram(p.prog);
    this.geos.clear();
    this.progs.clear();
  }

  // -------------------------------------------------------------- internals

  private releaseGeo(g: CachedGeo): void {
    const gl = this.gl;
    gl.deleteVertexArray(g.vao);
    for (const b of g.buffers) gl.deleteBuffer(b);
    if (g.triBuffer) gl.deleteBuffer(g.triBuffer);
    if (g.lineBuffer) gl.deleteBuffer(g.lineBuffer);
    if (g.wireBuffer) gl.deleteBuffer(g.wireBuffer);
    gl.deleteBuffer(g.instBuf);
  }

  private ensureGeo(key: string, geo: GeometryData): CachedGeo {
    const existing = this.geos.get(key);
    if (existing && existing.version === geo.version) return existing;
    if (existing) {
      this.releaseGeo(existing);
      this.geos.delete(key);
    }
    if (this.geos.size > 64) {
      const first = this.geos.keys().next().value as string;
      this.releaseGeo(this.geos.get(first)!);
      this.geos.delete(first);
    }
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    const attrib = (loc: number, data: Float32Array | undefined, size: number, fallback: number[]) => {
      if (data && data.length) {
        const b = gl.createBuffer()!;
        buffers.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(loc);
        if (size === 3) gl.vertexAttrib3fv(loc, fallback);
        else if (size === 2) gl.vertexAttrib2fv(loc, fallback);
        else gl.vertexAttrib4fv(loc, fallback);
      }
    };
    attrib(0, geo.P, 3, [0, 0, 0]);
    attrib(1, geo.N, 3, [0, 0, 1]);
    attrib(2, geo.uv, 2, [0, 0]);
    attrib(3, geo.Cd, 4, [1, 1, 1, 1]);

    const idx = (data: Uint32Array | null): WebGLBuffer | null => {
      if (!data || !data.length) return null;
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    };

    // line strips → segment pairs
    let linePairs: Uint32Array | null = null;
    if (geo.lineStrips?.length) {
      const segs: number[] = [];
      for (const s of geo.lineStrips) {
        for (let i = 0; i < s.length - 1; i++) segs.push(s[i], s[i + 1]);
      }
      linePairs = new Uint32Array(segs);
    }
    // wireframe edges from triangles
    let wire: Uint32Array | null = null;
    if (geo.triangles?.length) {
      const seen = new Set<string>();
      const edges: number[] = [];
      for (let t = 0; t < geo.triangles.length; t += 3) {
        const tri = [geo.triangles[t], geo.triangles[t + 1], geo.triangles[t + 2]];
        for (let e = 0; e < 3; e++) {
          const a = tri[e], b = tri[(e + 1) % 3];
          const k = a < b ? `${a}_${b}` : `${b}_${a}`;
          if (!seen.has(k)) {
            seen.add(k);
            edges.push(a, b);
          }
        }
      }
      wire = new Uint32Array(edges);
    }

    const cached: CachedGeo = {
      vao,
      buffers,
      triBuffer: idx(geo.triangles ?? null),
      triCount: geo.triangles?.length ?? 0,
      lineBuffer: idx(linePairs),
      lineCount: linePairs?.length ?? 0,
      wireBuffer: idx(wire),
      wireCount: wire?.length ?? 0,
      pointCount: geo.P.length / 3,
      instBuf: gl.createBuffer()!,
      version: geo.version,
    };
    gl.bindVertexArray(null);
    this.geos.set(key, cached);
    return cached;
  }

  private program(kind: string): { prog: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> } {
    let p = this.progs.get(kind);
    if (p) return p;
    const gl = this.gl;
    const frag = kind === 'lit' ? FRAG_LIT : kind === 'points' ? FRAG_POINTS : FRAG_UNLIT;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`scene shader (${kind}): ${gl.getShaderInfoLog(sh)}`);
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`scene link (${kind}): ${gl.getProgramInfoLog(prog)}`);
    }
    p = { prog, locs: new Map() };
    this.progs.set(kind, p);
    return p;
  }

  private loc(p: { prog: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> }, name: string) {
    if (!p.locs.has(name)) p.locs.set(name, this.gl.getUniformLocation(p.prog, name));
    return p.locs.get(name) ?? null;
  }

  private uniform(p: { prog: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> }, name: string, v: number | number[] | Float32Array): void {
    const gl = this.gl;
    const loc = this.loc(p, name);
    if (!loc) return;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else if (v.length === 4) gl.uniform4fv(loc, v);
  }
}
