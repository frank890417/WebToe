# Agent handoff — the complete project log

*Written 2026-06-11 by the agent that built WebToe v0→R3 in one continuous engagement, for whichever agent (Opus or other) continues it. This is the strategic memory: what was tried, what was measured, what bites, and where this is going. The tactical resume point is always `WORKLOG.md → ## NEXT`; the binding rules are `PLAN.md`. Read those two plus this file before changing anything.*

---

## 0. Resume protocol (do this first, every session)

1. `cd webtoe && npm install && npm run dev` → confirm http://localhost:8643/WebToe/ boots and the starter patch animates **before touching code**.
2. `npm run check` → typecheck + full test suite must be green at start and before every push.
3. Read `WORKLOG.md → ## NEXT`. Do that next unless the user redirects. Append a WORKLOG entry (what/evidence/NEXT) with every commit. Commit per milestone, push to `main`, watch CI.
4. The user reads progress through WORKLOG entries, commit messages, and chat reports at milestone boundaries. Report measured numbers, not adjectives.

## 1. State snapshot & the measured curve

- **Live**: https://frank890417.github.io/WebToe/ (GitHub Pages via Actions; deploy = push to main).
- **Engine**: TOP(24)+CHOP(13)+SOP(19)+MAT(7)+object-COMPs+DAT(7) on a dual-backend pass contract — WebGL2 complete (2D passes + 3D scene renderer), WebGPU at 2D parity (3D scene pass pending). Expressions v2 (`.par`, `parent()`, ternary translation). Importer with ~90 type mappings, parameter/expression translation, honest stubs + report.
- **The metric that matters** — corpus coverage (60 real projects, 28,698 nodes, private lab tooling):
  **32.3% (v1) → 47.1% (cycle 1: expressions v2 + routing ops + DAT-lite) → 62.3% (R3: 3D pipeline)**.
  Per-project spot checks: 213-node reference 56→71→88 runnable; DNA 55→71%; Fire Dance 65→74%.
- **Tests**: 60 across 10 suites incl. the two-layer `.toe` suite (committed fixture; binary layer auto-skips off-machine). CI green on every milestone commit to date.

## 2. Experiment ledger (what was actually tried, with verdicts)

| Experiment | Verdict / artifact |
|---|---|
| Parse `.toe` binary directly: brute-force zlib/deflate/gzip/lzma/bz2 at offsets 0–32, then **full-file scan for zlib magic across all bytes** | **Dead end, twice-confirmed.** Container = `"10\0\0"` magic + length-ish field + proprietary compression. Do not retry without new information; the official `toeexpand` path is the way. (RESEARCH.md §1) |
| Third attempt, 2026-08-01, with new information: 16,562-file corpus, per-byte-position entropy, raw deflate at **every** offset + all 7 bit shifts, linked-library inspection of `toeexpand` | **Dead end, third time — and the old header model was wrong.** Magic is 3 bytes `"10\0"`; the "length field at offset 4" does not survive contact with the corpus (ratio to filesize 0.00–14,053). Everything from offset 3 is opaque. `libUT` does link zlib, so any further attempt means disassembly, not codec guessing. **Do not brute-force codecs a fourth time.** |
| Make the expansion step invisible instead of decoding it (`packages/bridge`) | **Shipped 2026-08-01, and it is the real answer to "read `.toe` with no extra operation".** Loopback service runs the user's own `toeexpand`; the browser just drops the file. 20 MB / 14,710-node show file → 8 s drop-to-graph. Same shape as the NDI bridge — local process owns the thing the browser cannot do. |
| Import real (not fixture) projects and inspect DAT bodies | Found the **framed sidecar container** (RESEARCH §2.2): real `.text`/`.table` are length-prefixed binary, so every DAT body was previously garbage or dropped. 1,869 + 439 of them in one project. The fixture could never have caught this — hand-authored expansions are plain text. |
| toecollapse round-trip of hand-edited text | Works — basis of the committed fixture and of web-editability claims. Caveats: needs the `.toc` listing; **authored `.parm` lines must include the mode column** (`ty 0 0.5`), the tools preserve text verbatim and don't normalize. |
| Parameter "mode" field decoding | It's a **bitfield**: bit0 = expression active (`17, 49, 273…`), bit4 = string-with-default-expr. Decoded empirically from production files; importer relies on it; regression-tested. |
| Corpus analysis at scale (60 projects expanded per run) | The strategy engine. Private tooling lives outside this repo; publishes only aggregates (ROADMAP/TD-PARITY numbers). Re-run after every op-coverage change. |
| Real-sketch dogfooding (3 × 2022 sketches bundled as examples 06–08) | Found two real engine bugs unit tests missed: **composite layer order** (TD: input 0 on top) and **quoted string constants** kept literal quotes. Lesson: every real import is a test-case generator — when a sketch looks wrong, suspect WebToe before suspecting the sketch. |
| Official docs crawls | Operator inventories (~675 ops across 7 families → TD-PARITY.md tables) and exact parameter contracts (Render/Geometry/Camera COMP, Line MAT tokens → R3 importer maps; GLSL TOP injected contract → ROADMAP §R4 table, verified 3-0 by adversarial research). |
| WebGPU pilot → parity | The sorted-vec4 uniform packing rule + shared explicit bind-group layout (256-byte UBO offset alignment is mandatory) held up; parity for 2D took one pass. Pattern works — reuse it for the 3D scene pass. |
| GPU compositor for previews | One transparent overlay canvas scissor-blitting viewer+thumbs per frame replaced 6 Hz readPixels thumbnails. Massive UX win, no CPU readbacks. SOP/geo nodes preview via an auto-orbit scene into the same pool. |

## 3. Architecture invariants — do not break these

1. **Dependency arrow**: `apps/web → editor → {ops, gpu, io} → core`; `core` imports nothing. New capability = new contract in `core`, implementation in the right package.
2. **The pass contract is the product** (`core/passes.ts`): ops never touch WebGL/WebGPU types. 2D = `TexturePassSpec`; 3D = `ScenePassSpec`; future compute = a new spec type, same pattern. Backends own resources/caches/pooling, keyed `(node, slot, resolution)` with ping-pong (this is also how feedback works — `lazyInputs` + `previousFrame`).
3. **Registry keys are `family:name`**; ops self-register via `registerOp` (the public plugin surface). Stubs exist per family and must keep passing structure through.
4. **Importer honesty**: map only what's confident; everything else is a family stub with `foreignType` preserved; report numbers truthfully. Untranslatable Python stays inert (`tdExpr`) — **never execute imported code**.
5. **File format is versioned** with migrations; every saved node carries `family` so unknown types degrade to the right stub.
6. **Zero runtime dependencies in the web app.** Dev/test deps and *optional local tooling* (CLI, NDI bridge) may have deps; the shipped bundle may not.
7. **IP rules (PLAN §2) are absolute**: nothing of Derivative's in the repo (binaries, samples, doc text, UI pixels); original GLSL/WGSL; trademark disclaimer stays; no user-personal paths/artwork names in public files.
8. **Measured evolution**: a coverage claim without a fresh corpus number is not a claim. Update ROADMAP's measured lines.

## 4. Footgun catalog (each cost real debugging time)

**TouchDesigner format/semantics**
- `toeexpand` exits **non-zero on success** — check for the output dir, not the exit code.
- `toeexpand` **cannot open a non-ASCII filename**: it reads the path as Latin-1 and fails with `Error opening file: è¡¨æ¼”…`. Every project named in Chinese/Japanese/Korean — i.e. most of this user's corpus — fails unless you stage a copy under a plain-ASCII name first. Both the bridge and the CLI do; regression-tested in `tests/bridge.test.ts`.
- `.text`/`.table` sidecars are a **framed binary container**, not text (RESEARCH §2.2). Read them as bytes and run `decodeTdSidecar`; `File.text()` glues 27 bytes of frame onto every DAT body.
- Imported networks keep TD's own tile coordinates, which routinely sit thousands of pixels from the origin — the network view must frame content on entry or a correct import looks like an empty canvas.
- TD type tokens ≠ UI names (Composite TOP = `comp`, Video Device In = `videodevin`). Extend TYPE_MAP from import-report histograms, not guesses.
- Composite/over: **input 0 is the TOP layer**. Math CHOP order: pre-op → combine channels → combine CHOPs → post-op → mult-add → range.
- Parm values may be quoted (`channames 0 "tx ty"`) — unquote. BOM (`﻿`) appears before quoted paths.
- COMP param paths resolve relative to the COMP's network; `./x` means inside it (`resolveParamPath` in obj ops).
- Geo COMP renders its out-SOP child, else display-flagged, else last; cameras need aspect at render time (proj built in the Render TOP, not the cam cook).

**Platform/environment**
- **Hidden tabs pause requestAnimationFrame.** All headless verification drives frames manually via `window.__webtoe.loop()`. The 6 Hz-looking "bugs" in screenshots are usually just a paused loop.
- WebGL2 `readPixels` is bottom-up — flip rows. WebGPU buffer readbacks need 256-byte-aligned bytesPerRow and are async (thumb cache pattern in the webgpu backend).
- WebGPU: uniform-buffer bind offsets must be 256-aligned; with `layout:'auto'` you cannot bind entries the shader doesn't use — we use one shared explicit layout instead.
- GLSL ES 3.0 forbids dynamically-indexed sampler arrays (matters for the R4 GLSL-TOP shim: rewrite constant `sTD2DInputs[i]` accesses).
- Engine fps uses an EMA with a 4 ms delta floor — manual tight-loop driving reads ~250 fps by design.
- npm optional-deps corruption (rolldown native binding "load command extends beyond end of file") → `rm -rf node_modules package-lock.json && npm i`.
- `vitest --passWithNoTests` is set so empty suites don't fail scaffolding CI.

**Editor/compositor**
- The compositor canvas is `z-index: 5`, palette 50, toast 60 — GL paints land *under* dialogs only because of this ordering; keep it.
- Thumb rects are measured per frame via `getBoundingClientRect`; clipped against the network panel so paints never bleed over side panels.
- Node DOM rebuilds on structural change only; programmatic graph edits in tests/console need `ed.network.rebuild()`.

## 5. Strategy — the why behind the order

- **Corpus-driven**: the user's 199 real projects define "done". The loop: measure → pick by (projects-affected × low effort, respecting prerequisites) → implement on the contracts → verify against real sketches → record numbers. This loop has never missed.
- **Honesty as a feature**: stubs, import reports, declared v1 limitations with follow-up paths (1px lines, SOP-source instancing, WebGL2-only scene pass, no parent transforms). Users trust the tool because it never silently pretends.
- **Plan-first for big rocks**: R3 shipped clean because `R3-3D-PLAN.md` was written (with crawled token contracts) before code. Repeat for multi-sample CHOPs, GLSL TOP, POPs. Plans live in `docs/`, get linked from ROADMAP, and carry commit gates.
- **Two sources of truth for scope**: TD-PARITY.md (the full ~675-op map with portable/web-equivalent/native-only classes) and ROADMAP.md (phases + measured results). Update both when shipping.

## 6. The standing order (next big rocks, with design head-starts)

1. **CHOP multi-sample + time slicing** *(prerequisite for audio, trail, resample, wave, timeline)* — design sketch: `ChannelSet` already carries `length/rate`; introduce `sliceFrames` on the engine time context (samples to produce per cook = rate × delta, accumulated remainder), give each CHOP a per-sample cook path (kernels already take scalars — lift to loops), keep single-sample as the degenerate case so existing ops don't change behavior. Scope/viewer already draws arrays. Add `chop:trail`, `chop:resample`, `chop:pattern` as the proof set, then the WebAudio bundle (AudioWorklet bridge ↔ ChannelSet, AnalyserNode spectrum) — this unlocks the user's Audio Spectrum-era sketches.
2. **R4 GLSL TOP** — the injected-contract table in ROADMAP §R4 is verified and complete; build the shim (header/prelude, `sTD2DInputs[const]`→`u_texN` rewrite, `vUV`/`uTD*Infos`/`TDOutputSwizzle` synth), per-node error reporting for unsupported constructs, WGSL path marked unsupported initially. 32/60 corpus projects use it.
3. **R5 POPs on WebGPU compute** — extend the pass contract with `ComputePassSpec` + storage buffers; the dual-backend existed for this. Corpus POP histogram is in the lab stats.
4. **WebGPU 3D scene parity** — port `gpu/webgl2/scene.ts` semantics (depth texture instead of renderbuffer, instance step-mode vertex buffers).
5. **Importer round 3** — cross-network wire resolution (engine cooks them fine; serializer needs path-based wires), media relink-by-drop, more tokens from report histograms.
6. **NDI in/out via local bridge + WASM** — designed below (§8), foundation in the repo.
7. **Perform mode** (`?perform` fullscreen route — cheap, high demo value), replicator+table (R6), panels (R7), undo/redo + marquee select.

## 7. Long-term structure (12-month horizon)

- **Packages → npm**: the workspace boundaries are publish-ready (`@webtoe/core` etc.). Trigger: first external embedder (the user runs an education platform — `mountEditor` in course pages is the obvious first integration; keep it framework-free).
- **Plugin ecosystem**: `registerOp` is stable; document an op-pack template repo once ≥1 external consumer exists. Op specs carry `schemaVersion` + `migrate` for evolution.
- **Golden-image testing**: `tools/capture-screens.mjs` (playwright-core + system Chrome, drives `__webtoe.loop()`) is the seed of a visual regression suite — capture per-example hashes in CI-with-GPU when worth it.
- **Derivative watch**: the official JSON `.toe` format is targeted for the release after TD 2025 (verified statements). When it ships, write the second `ProjectLoader` — zero engine changes by design. Re-verify EULA pages before any commercial/server use.
- **Performance ceiling**: WASM only on measured ≥2× wins (kernel seams exist: CHOP `kernels.ts`, video kernels below); WebGPU compute usually beats WASM for data-parallel pixel/particle work — decide per workload.
- **Release hygiene**: tag milestones (`v0.x`), keep the README's measured-coverage line current — it is the project's public scoreboard.

## 8. NDI In/Out — design (foundation shipped this session)

**Hard truth first**: browsers cannot join NDI networks directly — no mDNS, no raw TCP/UDP, and the NDI SDK is closed-source (cannot be compiled to WASM, must not be bundled — NDI® is a trademark of Vizrt NDI AB). "NDI in WASM" therefore means: **a small local bridge** owns the NDI side (using the *user-installed* NDI runtime — exactly the toeexpand pattern), streams raw frames over localhost WebSocket, and **WASM does the per-pixel work in the browser** (UYVY⇄RGBA conversion + vertical flips at full frame rate — a genuine WASM-class hotspot, per the PLAN §5 seam policy).

```
NDI network ⇄ packages/ndi-bridge (Node CLI; optional deps: ws + grandiose[NDI SDK bindings])
            ⇄ ws://127.0.0.1:9980 (1 JSON control channel + binary frame messages)
            ⇄ top:ndiin / top:ndiout ops ⇄ video kernels (WASM w/ JS fallback) ⇄ texture pool
```

- **Protocol** (versioned, `docs/` + bridge source): JSON control (`hello`, `sources`, `subscribe {source}`, `send-open {name,w,h,fps}`) + binary frames: 24-byte header (magic `WTNF`, u32 w, u32 h, fourcc `RGBA`/`UYVY`, f64 timestamp) + payload.
- **`--mock` mode** (zero NDI deps): the bridge synthesizes an animated test pattern in UYVY — the entire path is verifiable on any machine, in CI-adjacent conditions, and was how this session verified end-to-end.
- **ndi-in op**: ws client in node state; frames → (UYVY → WASM convert) → `ImageData` → `uploadMedia`. **ndi-out op**: input TOP → `readPixels` (v1 sync on WebGL2; default 1280×720, throttled ~30 fps) → flip → ws → bridge `send`. Known v1 costs documented on the ops.
- **WASM kernels**: AssemblyScript source in `packages/wasm-kernels/` (devDep only), committed `.wasm` artifact served from the app, loaded best-effort at boot via `initVideoKernelsWasm(url)`; JS implementation is the permanent fallback and the unit-tested reference.
- **Licensing guardrails**: repo ships no NDI SDK bits; `grandiose` is an *optional* bridge dependency the user installs; README/bridge docs carry the NDI trademark notice. TD-PARITY's classification of NDI moves from "native-only" to **"web-equivalent via local bridge"** — this pattern (local bridge + WASM) generalizes to other device I/O (MIDI hardware beyond WebMIDI, Art-Net, Syphon/Spout capture via a grabber).

**Next agent's NDI checklist**: real-hardware pass with `grandiose` (receive + send against another NDI app), source discovery UI in the ndi-in params (sources list from control channel), compressed transport experiment (WebCodecs H.264 over the same protocol) if raw bandwidth becomes the bottleneck, async readback for ndi-out on WebGPU.

## 9. Verification techniques that work here

- Browser checks: load examples via the toolbar select (`option index`), drive `window.__webtoe.loop()` N times, read pixels through `engine.gpu.readPixels` (kick twice on webgpu — async), count node errors. Real pointer events for UI (palette/wire-drag/COMP-entry all tested this way).
- `.toe` checks: the committed fixture is regenerated by **authoring expanded text → toecollapse → toeexpand → commit the canonical re-expansion** (see tests/fixtures/README.md; keep parm mode columns!). Real-project checks run the CLI against local sketches — never commit those files.
- Screenshots: `node tools/capture-screens.mjs` (dev server running). fps shows ~250 under manual driving — expected.
