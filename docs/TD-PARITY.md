# TD parity charter — the full evolution map

*What "self-evolving fully toward TouchDesigner" means for WebToe, measured. Sources: the official operator categories on [docs.derivative.ca](https://docs.derivative.ca/Main_Page) (crawled 2026-06-11), the verified research in [RESEARCH.md](RESEARCH.md)/[ROADMAP.md](ROADMAP.md), and the 60-project/28,698-node production corpus. This page is the standing checklist; [ROADMAP.md](ROADMAP.md) holds the phase order and measured results.*

## Scope philosophy

A browser engine can reach **creative-semantics parity** — networks, cooking, operators, expressions, rendering, interaction — but not native-device parity. Every official operator falls into one of three classes:

- **Portable** — pure compute/render semantics (most TOPs/CHOPs/SOPs/POPs/MATs): implementable as-is.
- **Web-equivalent** — device/IO ops with a browser counterpart: Video Device In → getUserMedia ✅, MIDI In → WebMIDI, OSC/TCP/UDP → WebSocket bridges, Audio Device In/Out → WebAudio, Screen Grab → getDisplayMedia, Web Render → iframe texture.
- **Web-equivalent via local bridge** — device/network I/O with no browser primitive gets a small local bridge process (the user-installs-it pattern, like toeexpand): **NDI In/Out shipped this way** (`packages/ndi-bridge` + WASM pixel kernels; mock mode needs nothing, real mode uses the user's NDI runtime). The same pattern can serve Art-Net, Syphon/Spout capture, and serial.
- **Native-only** — declared out of scope honestly: DirectX/SDI/ST2110, vendor SDKs (Kinect/ZED/Oculus/NVIDIA-specific), CPlusPlus ops, Notch/Substance hosts.

## Operator inventory vs official TouchDesigner (2026 docs)

| Family | Official ops | WebToe today | Corpus-relevant¹ | Parity tier targets |
|---|---|---|---|---|
| TOP | ~147 | **24** | ~45 | T1: lookup, slope, luma blur/level, threshold, chroma/rgb key, cache(+select), circle, text, layout, tile, crop, resolution, remap, mirror, add/sub/mult/over/under (combine aliases), CHOP-to, normal map · T2: convolve, emboss, difference, function, SSAO-lite, render pass/select (with R3) · web-equiv: screen grab, web render |
| CHOP | 172 | **13** | ~40 | T1: trail, null, filter, resample (needs multi-sample), pattern, timer, count, trigger, logic, hold, delay, rename, shuffle, expression, keyboard in, constant-pulse · T2: audio file/device/spectrum/filter (WebAudio bundle), envelope, slope, spring, wave, beat, clock, timecode · web-equiv: MIDI in (WebMIDI), OSC in (WS bridge), panel |
| SOP | 115 | **0** | ~20 | R3 set: line, circle, rectangle, grid, sphere, box, tube, torus, merge, transform, copy, skin, add, point, noise, facet, convert, resample, switch, null/in/out · then text, sweep, revolve, twist, lattice |
| MAT | 13 | **0** | 6 | R3: constant, line, point sprite, wireframe, phong-lite → pbr-lite; later GLSL MAT |
| COMP | 45 | **1** | ~12 | R3: geometry, camera, light, ambient light, null(3D) · R6: replicator, table-driven select · R7: button, slider, container-panels, list · later: animation (keyframes), engine?, window=perform view |
| DAT | 77 | **7** | ~15 | T1: merge, transpose, sort, evaluate-lite (expressions, no Python), reorder, insert, substitute, JSON, folder?, info · web-equiv: web client (fetch), websocket, web server (within page), keyboard in · Python-execute family stays inert by policy |
| POP | 106 | **0** | ~30 | R5 on WebGPU compute: point generator, primitive, sphere/box/line/grid/circle, noise, math/math-mix/math-combine, attribute(+combine/convert), transform, copy, merge, delete, select, lookup texture/channel/attribute, normal, random, pattern, sort, sprinkle, feedback, ray, proximity, trail, in/out/null/switch/cache |

¹ types observed in the production corpus (60 projects) plus their direct dependencies.

## Engine-concept gaps (the architecture work between op counts)

| Concept | TD semantics | WebToe status → plan |
|---|---|---|
| **Multi-sample CHOPs + time slicing** | channels are sample arrays over time; time-sliced cooking guarantees gapless control/audio data between frames | single-sample control rate today; ChannelSet already carries `length/rate` — introduce sliced cooking + per-op sample semantics before audio/trail/resample/wave (prereq for the CHOP T1 tier) |
| **Audio pipeline** | audio-rate CHOPs, device IO, spectrum, VST | WebAudio backend: AudioWorklet bridge ↔ multi-sample CHOPs; spectrum via AnalyserNode; file in via decodeAudioData (PLAN §5 wasm gate applies to DSP kernels) |
| **3D render pipeline** | geo/cam/light COMPs, SOP geometry, MATs, Render TOP, instancing | R3 (researched, specced in ROADMAP): typed-array geometry + minimal forward renderer on the pass contract; instancing required by corpus (115 instanced geos) |
| **GLSL TOP** | headerless desktop GLSL 4.60 with injected contract | R4 — full injected-contract table verified and documented in ROADMAP §R4 |
| **POPs** | GPU particle/point compute family | R5 — compute pass type on the WebGPU backend (the reason the dual-backend exists) |
| **Parameter system depth** | pulse params, binding/export (CHOP→par links), sequential (multi-block) params, custom pages on COMPs | pages ✅ · pulse: add `'pulse'` param type with cook-side event flag · binding: expressions cover reads; add a bind UI affordance · custom COMP pars (`.cparm` import) unlocks control panels |
| **Panels/Widgets** | UI COMPs rendered as control surfaces; `panel.*` expression values | R7: button/slider/container-panel rendering into DOM overlay; `panel` scope in expressions |
| **Perform mode** | windowed presentation of an output COMP | cheap on the web: a `?perform` route that fullscreens the display node viewer — schedule with R7 |
| **Timeline & keyframes** | global timeline, Animation COMP | engine `time` already centralized; add transport UI (play/pause/rate/loop range) then an animation COMP with keyframe channels (multi-sample prereq) |
| **Python** | scripting everywhere | permanent boundary: imported Python stays inert; the road is a sandboxed **JS callback DAT** with a TD-shaped API (`onValueChange(par)` etc.) — opt-in, never auto-running imported code |
| **Palette** | curated reusable .tox library | WebToe equivalent: example/component gallery of `.webtoe.json` comps once COMP custom pars land |
| **Locked media / .tox** | embedded binary payloads, component files | importer: parse locked TOP payloads if format proves readable; `.tox` = same expansion pipeline (toeexpand handles it already) |

## Fidelity — TOPs that reproduce TouchDesigner's numbers

Op counts say what exists; fidelity says whether an imported network renders the *same pixels*. The operators below follow behaviour measured black-box against TouchDesigner 2025 (known inputs in, outputs read back) in the author's own production web port of two TouchDesigner shows, and ported here by the author. Nothing was taken from TD binaries or docs text. CPU references for every formula live in `tests/top-fidelity-ref.ts`; `tests/top-fidelity.test.ts` pins the rules, `tests/top-fidelity-gpu.test.ts` renders the real shaders in Chrome and compares them with those references (set `WEBTOE_GPU_URL`), and `tests/td-golden.test.ts` compares the references with TD itself once goldens are captured (below).

| TOP | Behaviour now (TD-measured) | Measured vs TD (production port) |
|---|---|---|
| Level | invert → blacklevel (no clamp) → brightness1 → clamp (8-bit input) → gamma1 (x^(1/γ)) → contrast (pivot 0.5) → in/out range → per-channel low/high → gamma2 → brightness2 → post clamp → premultiply → opacity on RGB **and** alpha | 14 sets × 2 clamp modes ≤ 1e-3 |
| Edge | e = clamp(√(1−bl)·√strength·\|Sobel\|/√offset − bl); taps ±offset px, bilinear hold, channel selected after sampling (Rec.709 luminance default, TD select menu incl. rgbmax/max); compinput = edge **over** input; default strength 1 | 65 cases ≤ 1.2e-7 |
| Monochrome / Lookup | luminance = Rec.709 everywhere (was Rec.601); Monochrome rgb/alpha menus, clamp on | exact formula |
| Ramp | keys wrap (last key interpolates toward first key + 1), up to 32 keys; horizontal/vertical t = (u − phase)/period, radial/circular t = base/period − phase (inferred for those two); position moves only the radial/circular centre; extend left/right, step/linear/ease/hermite, fit aspect, premultiply | 35 sets: median ≤ 1e-5; TD's antialias (supersampling at seams) is not reproduced — ≤ 2% seam pixels differ |
| Blur | generated kernel: `size` = full width S taps at (i − (S−1)/2)·step, weight = continuous kernel integrated per texel (catmull positive lobe 1−2.5v²+1.5v³, gaussian exp(−(1.5v)²), box; 1/1024 coordinate inset); preshrink = one bilinear tap; separable; bilinear back up; TD's three extend modes all behave as hold | 52 images ≤ 7.5e-7 (non-dividing preshrink ≤ 0.4%) |
| Noise | Gustavson 2004 table Perlin/simplex 2D–4D (tables as constant arrays, indexed exactly as the texture fetches resolve); P = 4·px/max(w,h) − 2 (bottom-left); transform page with translate subtracted and not divided by period; per-seed per-channel offsets (TD table, channel 1 = 2·channel 0 − (½,½,0)); octaves = harmon + 1; Σ basis·gain^j → sign·\|amp·n\|^exp + offset; rough no effect; period 0 → white noise; TD defaults | 6 types × 9 sets ≤ 3.7e-3, 99.9% ≤ 6e-4 |
| Composite | premultiplied (over = A + B·(1 − A.a)); all **46** TD operations; left fold with input 0 on top (TD's subtract is A − B — WebToe's was reversed); transform page for input 0 (forward R·S·(p + t)), overlay extend zero with half-texel fade | 37 ops verified ≤ 1e-7, 9 fitted ≤ 3e-5 |

Inferred or approximate (not pixel-faithful): Blur bartlette/sinc/hanning/blackman (standard window shapes); Noise sparse/hermite/harmonic/alligator (quantile-mapped statistical stand-ins for TD's CPU noises); unmeasured noise seeds (hashed offsets: same statistics, different pattern); `random` noise (uniform per pixel, our hash); Ramp antialias; Composite multi-input transform (the production port applied it per fold step — WebToe transforms input 0 only, exact for two inputs) and TD's `size`/`prefit` choice (WebToe keeps its own resolution rule; inputs are fitted with `fill`).

Importer fixes in the same pass: vertical ramps no longer import as horizontal; TD `harmon` keeps TD's meaning (WebToe's `harmonics` param now *is* harmon, octaves = harmonics + 1); TD noise imports static (`speed` 0); Composite imports TD's default operand `multiply` and maps all 46 operand tokens; Subtract/Screen/Inside/Outside/Difference TOPs map onto Composite; Monochrome is no longer a stub; Level/Edge/Ramp/Blur/Noise transform-page tokens are mapped.

WebToe-authored examples were adjusted where a semantic change would alter their look (Blur size is now full width, Edge uses √strength, Noise uses TD coordinates, Level opacity now scales RGB too, and the old ramp shader had `radial` and `circular` swapped): 01/08 (noise period), 02 (fade opacity → 1, blur size 3), 03 (ramp types swapped back to what rendered before), 04 (edge strength 25, noise period 1.35 / harmonics 1), 05 (ramp type name), 09 (edge strength squared, noise periods, ramp type, fade opacity → 1), 10 (blur size 16 gaussian). The imported sketches 06–08 keep their TD parameters — they now render with TD semantics.

Backend parity: every pass of the new shaders was rendered on both backends from the same graph and compared pixel by pixel (ramp all types, noise all 11 types, level, edge, monochrome, blur all 7 kernels + preshrink, composite all 46 operations + transform/extend/swap): identical within 1/255, except that the WebGPU backend writes each pass vertically flipped relative to WebGL2 (a backend coordinate convention, independent of the shaders — odd-length chains come out mirrored) and Composite `vividlight` at 0/0 pixels (NaN, backend-defined).

**Capturing TD goldens.** With TouchDesigner open (e.g. through touchdesigner-mcp `execute_python_script`): `exec(open('tools/td-golden/capture.py').read()); capture('/path/to/golden')`, then `TD_GOLDEN_DIR=/path/to/golden npx vitest run tests/td-golden.test.ts`. Goldens are never committed; jobs using a parameter name TD rejects are listed and skipped rather than failing.

## The standing self-evolution loop

1. **Measure** — run the corpus analyzer (private lab tooling) → coverage % + stub histograms; import any new real project and read its report.
2. **Pick** — highest projects-affected × lowest effort from the tier tables above; respect phase prerequisites (multi-sample before audio; R3 before render-dependent TOPs).
3. **Implement** — ops register via the public API; shaders in both backend languages; importer TYPE/PARAM tables extended; honest stubs for everything else.
4. **Verify** — unit tests + fixture round-trip + real-sketch imports in the browser; per-feature regression tests for every bug a real project exposes (two found so far: composite layer order, quoted string constants).
5. **Record** — ROADMAP measured-results line + WORKLOG entry; re-run step 1. Coverage so far: 32.3% → **47.1%** after cycle 1.

Current standing order of the big rocks: **R3 (3D) → CHOP multi-sample+T1 → R4 (GLSL) → R5 (POPs) → R6/R7 (data/panels)** — full reasoning and measured gates in [ROADMAP.md](ROADMAP.md).
