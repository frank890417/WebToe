---
title: Architecture
description: The packages and their one dependency rule, the GPU pass contract behind both backends, the cook model, the file format and the decisions behind them.
---

WebToe is an original engine for the web. It implements the TouchDesigner workflow (operator families, wired networks, expression-driven parameters, a live cook loop) on WebGL2 and WebGPU, in TypeScript, with no runtime dependencies.

## Packages and the dependency rule {#packages}

```text
apps/web ──▶ @webtoe/editor ──▶ @webtoe/ops ──┐
                       │            │          ├──▶ @webtoe/core
                       ├──▶ @webtoe/gpu ───────┤
                       └──▶ @webtoe/io ────────┘
@webtoe/cli  (standalone node script; mirrors io's tables)
```

**Imports flow downward only, and `core` imports nothing.** No package touches the DOM except the editor, the app, and the media operators (image, video, camera). `core` and the CHOP side of `ops` run headless in the test suite.

| Package | Role |
|---|---|
| `@webtoe/core` | graph model, pull-based cook engine, expressions, the backend-agnostic GPU pass contract, versioned serialization, `registerOp` |
| `@webtoe/ops` | operator definitions; CHOP kernels behind a WASM-ready interface; TOP shaders written per backend (GLSL and WGSL, by hand) |
| `@webtoe/gpu` | the WebGL2 and WebGPU backends: texture pools, ping-pong feedback, scene rendering, readback |
| `@webtoe/io` | `.webtoe.json` load/save and the TouchDesigner importer, behind a `ProjectLoader` adapter |
| `@webtoe/editor` | the framework-free editor, `mountEditor(el, options)` |
| `webtoe` (packages/bridge) | the local import bridge behind `npx webtoe` |
| `webtoe-ndi-bridge` | the local NDI bridge |

## The contracts everything rests on {#contracts}

1. **The GPU pass contract** (`core/passes.ts`). TOPs never touch WebGL or WebGPU. They describe work as passes (`TexturePassSpec`: shader id, uniforms, inputs, output; `ScenePassSpec` for 3D) against a `GpuFacade`, and each backend owns resources, pipeline caches, per-node texture pools, media upload, blits and readback. This is what makes two backends possible, and what a compute pass will extend.
2. **The registry** (`core/registry.ts`). `registerOp(spec)` is the public plugin surface. The palette, the parameter panel and the serializer discover operators through it; type keys are namespaced `family:name`.
3. **`ProjectLoader`** (`io`). Importers are adapters (`canLoad` / `load` → graph + import report). The TouchDesigner importer is one; an official JSON format from Derivative would slot in beside it without engine changes.
4. **The kernel seam** (`ops/chop/kernels.ts`). CPU kernels sit behind an interface with the TypeScript implementation as the permanent fallback; a WASM build is adopted only on a profiled win of at least 2×.
5. **Versioned files** (`serialize.ts`). `.webtoe.json` carries a version and a chain of migrations; every saved node carries its family, so unknown types degrade to the right stub.

## Cook model {#cook}

- Pull-based and memoized per frame, with a cycle guard. Expressions can pull other nodes (`op('x')`) re-entrantly.
- **Feedback** is the deliberate cycle-breaker: its input is not pre-cooked, and it returns the input's previous-frame texture from the backend's pool (transparent black on the first frame).
- Operators driven by time, media or input are flagged to cook every frame.

## GPU backends {#gpu}

| | WebGL2 | WebGPU |
|---|---|---|
| Status | complete: every TOP, plus the 3D scene renderer | 2D parity: every shader-driven TOP ships WGSL; the 3D scene pass is pending |
| Passes | fullscreen triangle, per-shader program and uniform-location caches | one shared explicit bind-group layout: globals @0, operator uniforms @1 (256-byte aligned), sampler @2, textures @3+ |
| Uniforms | by name | sorted by name, one `vec4f` each; enforced by a test |
| Readback | synchronous `readPixels` | asynchronous buffer copy, one frame latent |

WebGL2 is the default; `?backend=webgpu` opts in and falls back to WebGL2 if initialisation fails. Previews are painted by one transparent compositor canvas over the editor, which blits the viewer and every visible TOP thumbnail each frame; there are no CPU readbacks for previews.

## 3D {#3d}

SOPs produce typed-array geometry, versioned so the renderer can cache vertex arrays. Geometry COMPs pick their display SOP, apply a material, and instance over SOP points or CHOP channels; the Render TOP gathers matching Geometry COMPs, a camera and lights, and draws them through four original shaders with depth, instancing and a translucent-last sort. Declared limits of this first version: the scene pass is WebGL2-only, lines are 1 px, and parent transforms are not inherited.

## Editor {#editor}

DOM node boxes over an SVG wire layer, pan and zoom with CSS transforms, a palette, a parameter panel with per-parameter expressions and pages, and a viewer that shows a TOP, scopes a CHOP or prints a DAT. DOM was chosen over a canvas-drawn network for free hit-testing and text; it holds up to a few hundred visible nodes, and a canvas renderer could replace it behind the same interface.

## Decisions {#decisions}

- **WebGL2 floor, WebGPU ceiling.** Compute shaders are the path for the particle (POP) family, hence the pass contract.
- **Hand-written shaders for both backends, no transpiler.** Auditability and clean provenance over brevity; a contract test enforces that both exist.
- **Expressions are JavaScript against a fixed scope.** The trust model of a patching tool, not a sandbox. Imported Python never executes.
- **Zero runtime dependencies.** For longevity, for embedding, and so the whole system stays readable.
- **No Derivative code, binaries, sample files or UI assets in the repository.** Shaders and UI are original; the importer reads files you open with your own TouchDesigner.
