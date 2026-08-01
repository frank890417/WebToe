# WebToe

**A web-native, node-based dataflow engine for real-time visuals — patch operators together in the browser, TouchDesigner-style, and import your existing TouchDesigner projects.**

[![ci](https://github.com/frank890417/WebToe/actions/workflows/ci.yml/badge.svg)](https://github.com/frank890417/WebToe/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![live demo](https://img.shields.io/badge/live-frank890417.github.io%2FWebToe-7c6cff)](https://frank890417.github.io/WebToe/)

**▶ Try it now: [frank890417.github.io/WebToe](https://frank890417.github.io/WebToe/)** — no install, runs entirely in your browser.

![WebToe editor running the lfo-garden example](docs/media/hero-lfo-garden.png)

WebToe is an original engine and editor built from scratch for the web. It is not a TouchDesigner clone or port — it implements the workflow (operator families, wired networks, expression-driven parameters, a live cook loop) natively on **WebGL2 and WebGPU**, with **zero runtime dependencies** (the whole app is ~90 KB of JS), and it reads the structure of real TouchDesigner projects through the text expansion produced by your own TD installation.

## Highlights

- **Patch live in the browser** — network editor with a create-operator dialog (`Tab` / double-click: family tabs, searchable grid), wire dragging, container hierarchy with in/out tunneling, **real-time previews on every node** (one GPU compositor paints the viewer and all visible thumbnails at full frame rate — no CPU readbacks), and a parameter panel with sliders, menus, and per-parameter **expressions** (`op('lfo1')['chan1']`, `parent().par.speed`, `time.seconds * 0.2`, …).
- **Real-time GPU engine** — pull-based cook loop; TOPs run as GPU passes, CHOPs drive parameters; feedback loops, separable blur, 6-mode compositing, displacement, edge detection, webcam/video/image input.
- **Two GPU backends at parity** — WebGL2 (default, universal) and WebGPU (`?backend=webgpu`), both speaking one backend-agnostic pass contract; WebGPU's compute path is reserved for the upcoming particle family.
- **TouchDesigner import** — supported operators run live, everything else becomes a faithful stub preserving names, wires, layout, parameters, and Python code, with an honest report. Verified on real production projects.
- **Own versioned format** — lossless `.webtoe.json` save/load with migration hooks.

| Feedback trails (mouse-driven) | CHOP scope & channels |
|---|---|
| ![Feedback trails example](docs/media/feedback-trails.png) | ![CHOP playground with live scope](docs/media/chop-scope.png) |

| Operator palette | WebGPU backend |
|---|---|
| ![Searchable operator palette](docs/media/palette.png) | ![Same project on the WebGPU backend](docs/media/webgpu.png) |

## Importing your TouchDesigner projects

![Import report dialog after importing a 213-node production project](docs/media/import-report.png)

**Drop a `.toe` on the page and it opens.** No CLI step, no folder shuffling.

```bash
npx webtoe        # serves the app locally and opens it — then just drag your .toe in
```

A `.toe` is a proprietary compressed container that no browser can decode (see [RESEARCH §1](docs/RESEARCH.md)). The one step that genuinely needs TouchDesigner — the official `toeexpand` CLI, shipped with every TD install — therefore runs on your machine, through a small loopback service (`packages/bridge`). It binds to `127.0.0.1` only, has zero dependencies, and ships nothing of Derivative's: your project files never leave your computer.

**No Node?** Every TouchDesigner install ships Python, so the same bridge is one stdlib-only file. Download [`bridge.py`](https://frank890417.github.io/WebToe/bridge.py) (the guide modal links it), then `python3 bridge.py` (TD's bundled interpreter works too) and drop your `.toe` on the hosted page. Protocol-identical to `npx webtoe`.

Already using the hosted app with Node? Run the bridge alone in a terminal and the hosted page will find it. With no bridge at all, dropping a `.toe` opens a guide that keeps watching for one — and the manual routes below still work.

```bash
# bridge only, for the hosted app at frank890417.github.io/WebToe
npx webtoe --no-open

# share one bridge over LAN/Tailscale (e.g. TD on a Windows box, browsing elsewhere)
npx webtoe --host 0.0.0.0 --token <secret>   # page: ?bridge=…&bridgeToken=<secret>

# no Node? expand by hand, then drop the resulting .toe.dir folder on the page
"/Applications/TouchDesigner.app/Contents/MacOS/toeexpand" myproject.toe

# batch/scripted conversion to a project file
node packages/cli/toe-convert.mjs myproject.toe        # → myproject.webtoe.json
```

Measured on a real 20 MB show file (14,710 nodes): **8 seconds from drop to a running graph**, 70% of nodes runnable, 2,244 expressions translated.

What the importer recovers: node types and hierarchy, wires (including wires across COMP boundaries and in/out tunnels), parameter values, **live Python expressions** (translated to WebToe expressions where faithful — `absTime.seconds*0.2` → `time.seconds*0.2` — and kept inert otherwise), DAT text and Python source, and network layout. The parameter mode field is a bitfield decoded from production files (bit 0 = expression), so flagged expression modes import too.

### Tested, automatically

`.toe` reading is covered by a two-layer automated suite built on an **original committed fixture** — a real binary `.toe` plus its canonical `toeexpand` expansion, authored for this repo and round-tripped through the official tools ([provenance](tests/fixtures/README.md)):

1. a CI-safe layer asserts the full reconstructed graph — types, COMP-boundary and tunnel wires, parameter modes, translated expressions evaluated in the engine, honest stubs, report numbers, plus the sidecar container decoder;
2. an integration layer (auto-skipped where TD isn't installed) expands the committed binary with the real `toeexpand` and runs the CLI and the bridge end-to-end — including a project whose filename is not English.

## Operator set (v1)

| Family | Operators |
|---|---|
| TOP | constant, noise, ramp, rectangle, transform, level, monochrome, hsv adjust, blur, composite, math, switch, select, reorder, flip, displace, edge, feedback, **render**, **ndi in/out** (via the local bridge), null, in, out, image in, video in, camera in |
| CHOP | constant, lfo, noise, math (full TD pipeline), lag, merge, select, switch, speed, parameter, mouse in, in, out |
| SOP | line, circle, rectangle, grid, sphere, box, tube, torus, merge, transform, noise, copy, skin, add, point, facet, switch, null, in, out |
| MAT | constant, lit (phong/pbr), line, point sprite, wireframe, switch, null |
| COMP | container, **geometry** (SOP networks, materials, SOP-point instancing), **camera** (look-at), **light**, **ambient light** |
| DAT | text, table, select, null, in, out |

Plus per-family stub operators used by the importer. Expressions ship with `time`, `me`, `op()` channel access, and a math library (`sin`, `clamp`, `fract`, `lerp`, `rand(seed)`, …).

## Examples

Ten bundled projects load from the toolbar and run out of the box. The flagship is **09 showcase** — 27 nodes exercising every family at once: a webcam layer through edge detection, a kaleidoscope COMP with in/out tunnels, a mouse-position source switch, noise displacement, hue-drifting feedback trails, and a full CHOP rig (lag, speed integrator, parameter reader, full math pipeline) driving it through eight live expressions. Newest: **10 3d lines** — the full 3D pipeline: skinned line ribbons and noise-scattered instanced spheres inside geometry COMPs, an orbiting look-at camera, lights, a render TOP, and a glow post chain. Also: five authored 2D patches — **hello noise** (expression-driven brightness), **feedback trails** (move your mouse over the viewer), **lfo garden** (additive ramp chains with hue drift), **webcam displace** (allow camera access; degrades gracefully without one), **chop playground** (select `merge1` to scope raw vs lagged channels) — and three **real 2022 TouchDesigner daily sketches imported through the `.toe` pipeline** (pseudo-voronoi, fractal feedback, and a mouse-interactive CHOP study; lightly adapted for the web, e.g. movie sources swapped for noise).

## Quick start (development)

```bash
npm install
npm run dev        # editor at http://localhost:8643/WebToe/
npm run check      # typecheck + 60-test suite
npm run build      # production build (apps/web/dist)
node tools/capture-screens.mjs   # regenerate README screenshots (needs dev server + Chrome)
```

## Architecture

npm workspaces with a strict downward dependency rule — `apps/web → editor → {ops, gpu, io} → core`, where `core` imports nothing:

| Package | Role |
|---|---|
| `@webtoe/core` | graph model, pull-based cook engine, expression system, backend-agnostic GPU pass contract, versioned serialization, public `registerOp` plugin API |
| `@webtoe/ops` | operator definitions; CHOP kernels behind a WASM-ready interface; TOP shaders authored per backend (GLSL **and** WGSL, hand-written) |
| `@webtoe/gpu` | WebGL2 backend + WebGPU backend (parity), texture pools, ping-pong feedback, async readback thumbnails |
| `@webtoe/io` | `.webtoe.json` + the `toeexpand`-output importer behind a `ProjectLoader` adapter (Derivative's announced official JSON format slots in beside it) |
| `@webtoe/editor` | embeddable, framework-free editor — `mountEditor(el, opts)` |
| `@webtoe/cli` | `toe-convert.mjs` |
| `webtoe-bridge` | loopback service: serves the app and runs your own `toeexpand` so `.toe` is a plain drop target |

Deep dives: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · execution contract & milestones: [PLAN.md](PLAN.md) · build log: [WORKLOG.md](WORKLOG.md) · research foundation (file-format findings, feasibility, sources): [docs/RESEARCH.md](docs/RESEARCH.md)

## Roadmap — measured against real work

To define "complete", we analyzed **60 real TouchDesigner projects (28,698 nodes, 2022–2026)** from a daily-practice generative art portfolio and crawled the **official operator inventory (~675 operators across 7 families)**. Two documents drive the evolution: **[docs/ROADMAP.md](docs/ROADMAP.md)** (phased plan with measured results — corpus coverage: 32.3% → 47.1% → **62.3%** across two measured evolution cycles, the second being the full 3D pipeline) and **[docs/TD-PARITY.md](docs/TD-PARITY.md)** (the full parity charter: per-family op tiers, portable vs web-equivalent vs native-only classification, and the engine-concept gaps — time slicing, audio, 3D, GLSL, POPs, panels — with the standing measure→pick→implement→verify loop).

## NDI In/Out

Browsers can't join NDI networks directly, so WebToe pairs two pieces: a tiny local bridge (`packages/ndi-bridge`, WebSocket on localhost) that owns the NDI side with **your own NDI runtime**, and `ndi in`/`ndi out` TOPs that do the pixel work in the browser — UYVY⇄RGBA conversion runs in a **1 KB WASM kernel** (AssemblyScript source in `packages/wasm-kernels`, JS fallback always available). Try it with zero NDI dependencies: `node packages/ndi-bridge/index.mjs --mock` streams an animated test pattern; for real NDI install the NDI runtime plus `grandiose` in the bridge package. NDI® is a trademark of Vizrt NDI AB — this repo ships no NDI SDK bits.

## For contributors and future agents

[docs/HANDOFF.md](docs/HANDOFF.md) is the complete project log: every experiment with its verdict, the architecture invariants, a catalog of hard-won gotchas, the measured evolution curve, and the standing order of upcoming work with design head-starts.

## Disclaimer

WebToe is an independent open-source project, **not affiliated with or endorsed by Derivative Inc.** TouchDesigner is a trademark of Derivative Inc. WebToe contains no Derivative code, binaries, or assets; it reads the text expansion of project files that users generate locally with their own licensed TouchDesigner installation, for interoperability. All engine code, shaders, and UI design in this repository are original work.

## License

[MIT](LICENSE)
