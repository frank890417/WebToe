---
title: TouchDesigner parity
description: What "toward TouchDesigner" means for a browser engine, how it is measured on 60 real projects, where WebToe stands, and what comes next.
---

WebToe aims at **creative-semantics parity** with TouchDesigner (networks, cooking, operators, expressions, rendering, interaction), not native-device parity. Progress is measured, not estimated: on a corpus of real projects, and against the official operator inventory.

## How it is measured {#method}

The corpus is 60 real TouchDesigner projects from a daily generative-art practice, 2022–2026, sampled across eras from 199 available: **28,698 nodes**, expanded with the official `toeexpand` and counted by operator type, parameter mode and expression. The analyzer lives outside this repository because it reads private files; only aggregate numbers are published.

The family mix of the corpus: TOP 7,536 · DAT 6,332 · COMP 5,417 · POP 3,148 · SOP 2,942 · CHOP 2,663 · MAT 660. 13,708 parameters carry live Python expressions, plus about 7,000 more in flagged expression modes.

| Step | What shipped | Corpus nodes runnable |
|---|---|--:|
| v1 | first release: core TOPs and CHOPs, importer | **32.3%** |
| Cycle 1 | expressions v2 (`parent()`, `.par`, Python conditionals), routing TOPs (switch, select, math, reorder, flip), CHOP switch/speed/parameter, DAT tables, parameter-mode bitfield | **47.1%** |
| R3 | the 3D pipeline: SOPs, MATs, Geometry/Camera/Light COMPs, Render TOP, instancing | **62.3%** |

On a 213-node reference project the same steps took runnable nodes from 56 to 71 to 88. After R3, a 2022 sketch of a DNA helix went from 55% to 71% runnable and another from 65% to 74%; mapping POPs onto the SOP implementations took a POP-heavy 2025 project from 43% to 73%.

## Operators against the official inventory {#inventory}

<!-- PARITY-TABLE -->

The official counts come from the operator categories on docs.derivative.ca (crawled 2026-06-11). Not every official operator should exist in a browser; each one falls into one of four classes:

- **Portable**: pure compute or render semantics (most TOPs, CHOPs, SOPs, POPs, MATs). Implementable as they are.
- **Web-equivalent**: device or network I/O with a browser counterpart: Video Device In → `getUserMedia` (shipped as camera in), MIDI In → Web MIDI, Audio Device In/Out → Web Audio, Screen Grab → `getDisplayMedia`.
- **Web-equivalent through a local bridge**: I/O with no browser primitive gets a small local process the user runs, the pattern of the import bridge. [NDI in/out](ndi.md) shipped this way; Art-Net, Syphon/Spout capture and serial would follow it.
- **Native-only**, declared out of scope: DirectX/SDI/ST 2110, vendor SDKs (Kinect, ZED, Oculus), C++ operators, Notch and Substance hosts.

## Engine concepts {#concepts}

| Concept | Status in WebToe |
|---|---|
| 3D: geometry, materials, cameras, lights, Render TOP, instancing | shipped (R3) on WebGL2; WebGPU scene pass pending |
| Multi-sample CHOPs and time slicing | not yet: channels are single-sample at control rate. The prerequisite for audio, trail, resample and wave |
| Audio | planned on Web Audio (AudioWorklet ↔ multi-sample CHOPs, AnalyserNode for spectra) |
| GLSL TOP | specified: TouchDesigner's injected contract (headerless GLSL, `sTD2DInputs`, `vUV`, `uTD2DInfos`, `TDOutputSwizzle`) shimmed onto GLSL ES 3.00. Used by 32 of the 60 corpus projects |
| POPs | import and run their geometry through the SOP implementations; dynamics (forces, solvers) are stubs. Native POPs are planned on WebGPU compute |
| Parameters | pages and expressions shipped; pulse parameters, binding and custom COMP parameters to come |
| Panels | button, slider and container panels planned as a DOM overlay |
| Replicator | planned with table-driven templates; `COMP:replicator` appears in all 60 corpus projects |
| Python | **permanent boundary**: imported Python is kept and shown, never executed. The planned answer is an opt-in JavaScript callback DAT with a TouchDesigner-shaped API |

## The loop {#loop}

1. **Measure**: run the corpus analyzer; read the coverage and the histogram of stubbed types.
2. **Pick**: the highest *projects affected × low effort*, respecting prerequisites (multi-sample before audio, 3D before render-dependent TOPs).
3. **Implement** on the public contracts: `registerOp`, shaders for both backends, importer tables, honest stubs for the rest.
4. **Verify**: unit tests, fixture round-trips, and real sketches in the browser. Every bug a real project exposes gets a regression test.
5. **Record** the new number in docs/ROADMAP.md, then measure again.

## Next {#next}

In order: **multi-sample CHOPs and time slicing → GLSL TOP → POPs on WebGPU compute → WebGPU 3D scene pass → replicator, tables and panels.** The full reasoning and measured gates are in [docs/ROADMAP.md](https://github.com/frank890417/WebToe/blob/main/docs/ROADMAP.md) and [docs/TD-PARITY.md](https://github.com/frank890417/WebToe/blob/main/docs/TD-PARITY.md).
