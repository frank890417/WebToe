# Reading & running TouchDesigner `.toe` files on the web — research report

*2026-06-11 · multi-source web research (21 claims confirmed 3-0 by adversarial verification, 23 sources) + hands-on experiments with TouchDesigner 2025.32460 on macOS. This document is the factual foundation for WebToe's design; personal file references from the original lab notes have been removed.*

---

## TL;DR

| Question | Verdict |
|---|---|
| Can a browser parse a raw `.toe` directly? | **No (today).** Proprietary compressed container; zlib/deflate/gzip/lzma/bz2 all fail at every offset (verified empirically). |
| Can a web app read a `.toe`'s full structure? | **Yes — verified end-to-end.** `toeexpand` → text files → JSON → browser. Nodes, wires, parameters, expressions, Python code all recoverable. |
| Can a web app *edit* and write back? | **Yes.** Round-trip via `toecollapse` verified (a text edit survived collapse → re-expand). |
| Can a browser *run* a `.toe` at full fidelity? | **No browser runtime exists or is possible** (closed-source native engine, no wasm). Full fidelity = real TD instance server-side streaming via WebRTC (built into TD, first-party React demo exists). |
| Can a browser run a *subset*? | Yes, by original re-implementation of an operator subset — this is what WebToe does. |
| Strategic timing | Derivative is shipping an **official JSON-syntax text format** for `.toe` — missed the 2025 release (POPs took priority), targeted for the next release. WebToe keeps its importer behind an adapter so the official format can slot in. |

## 1. The `.toe` container format (binary)

**Re-verified 2026-08-01** against a 16,562-file local corpus (previously: two samples). The 2026-06-11 model below the line was partly wrong and is corrected here.

Per-byte-position entropy across 590 randomly sampled real `.toe` files:

```
offset 0-2   31 30 00      constant in 590/590 → the magic is "10\0", three bytes
offset 3      23 distinct values, H=3.16 bits
offset 4-5    193 / 32 distinct, H=7.23 / 4.97
offset 6      3 distinct (00 in 560/590), H=0.30
offset 7      54 distinct, H=4.57
offset 8+     ~7.5 bits/byte — indistinguishable from random
```

- **The old "length field at offset 4" claim is false.** On the committed fixture it reads 6,148 against a 1,058-byte file; across the corpus the ratio to file size ranges from 0.00 to 14,053 with a median near 859. Several unrelated large files share near-identical values there (503,332,884 / 503,333,101 / 503,359,702), which is the signature of *similar compressed content*, not of a size header. Treat everything from offset 3 as opaque payload.
- Brute-forcing zlib / raw deflate (all window sizes) / gzip / lzma / lzma-alone / bz2 at **every** byte offset of a whole file, plus all seven sub-byte bit shifts for raw deflate: **zero hits**. (The 2026-06 pass scanned only for the zlib magic, which raw deflate does not have — this run closes that gap.)
- `toeexpand` links `/usr/lib/libz` and `libminizip` through `libUT.dylib`, so zlib *is* present in the process; it is evidently not what wraps the container. Decoding it would mean disassembling `libUT`/`libtools`, not guessing a codec.

**Verdict unchanged: no browser-side `.toe` decode.** What changed on 2026-08-01 is the *user-facing* consequence — the expansion step now runs automatically through the local bridge (`packages/bridge`), so "cannot decode in the browser" no longer means "the user does extra work". See README § Importing.

<details><summary>2026-06-11 original observations (superseded)</summary>

Observed on real files (a 770 B template, build 2023.11290; a 17.6 KB production project, build 2025.31500): magic `31 30 00 00`, "length-like" field at offset 4 matching filesize − 10 in both samples, high-entropy payload from ~offset 8. Brute-forcing zlib / raw deflate / gzip / lzma / lzma-alone / bz2 at offsets 0–32 matched nothing.

</details>
- Officially: "A TouchDesigner Environment file (.toe) … contains your networks, operators, parameters, Pane layouts and optionally MIDI settings" ([docs.derivative.ca/.toe](https://docs.derivative.ca/.toe)).
- The binary format internals are **undocumented by the vendor**; the official [Toeexpand doc page](https://docs.derivative.ca/Toeexpand) is minimal and was last edited 2022-10-03.

## 2. The official escape hatch: `toeexpand` / `toecollapse`

Official CLI tools shipped with every TD install — Windows: `<install>/bin/toeexpand.exe`; macOS: `TouchDesigner.app/Contents/MacOS/toeexpand`.

```
Usage: toeexpand [-b] filename [pattern]     # -b prints version/build only
```

- Round-trip is **officially sanctioned**: "A .toe file can be converted to ASCII-readable form using toeexpand. After editing in ASCII form, the .toe file can be recreated using toecollapse" ([docs.derivative.ca/.toe](https://docs.derivative.ca/.toe)).
- The *expanded format itself* is undocumented and hand-authoring "wasn't really their intention" — Derivative staff (robmc), [forum thread](https://forum.derivative.ca/t/toe-files-in-text-format/309048).
- Headless shell scripting of toeexpand is established community practice (git-diff workflows), e.g. [nariakiiwatani/toeexpand-git-pre-commit](https://github.com/nariakiiwatani/toeexpand-git-pre-commit).
- Cross-version: the 2025.32460 tool read both a 2023.11290 file and a 2025.31500 file without issue (verified).
- Platform constraint: **TD ships Windows + macOS only** → the expand step needs a Mac/Windows machine (the project author's own TD install; WebToe never bundles or hosts the tool).

### 2.1 Expanded format, as observed (undocumented — reverse-noted from our own files)

`project.toe` → `project.toe.dir/` (directory tree mirroring the network hierarchy) + `project.toe.toc` (file list).

Inventory from a large stock example (8,281 files): `.n` ×2739, `.parm` ×2652, `.panel` ×1879, `.cparm` ×607, `.text` ×303, `.table` ×55, plus `.fifo`, `.gnode`, `.ts`, `.network`, `.chop`, `.beat`, `.replicator`, `.opfind`, `.lod`, and root dotfiles (`.build`, `.start`, `.application`, `.grps`, `.root`).

| File | Contains |
|---|---|
| `X.n` | Node definition: `FAMILY:type` header (`CHOP:math`, `COMP:container`…), `tile x y w h` (network position), `flags`, `color r g b`, `comment`, and **`inputs { index  sourcePath }` — the wires**, incl. cross-level refs like `button1/out1` |
| `X.parm` | Non-default parameters, `name modeFlag value` between `?` delimiters. Mode `17` = **Python expression stored as text** (e.g. `tz 17 0 absTime.seconds*0.2`), mode `16` = string constant + default expression, mode `0` = constant |
| `X.cparm` | Custom parameter definitions (component custom pars) |
| `X.text` | DAT contents — full Python source of callbacks/scripts |
| `X.table` | Table DAT data (text; binary for things like ramp keys) |
| `X.panel`, `X.network` | Panel state / network-view state |
| `X/` (subdir) | Children of COMP `X` — recurse |
| `.build` | `version / build / time / osname / osversion` |

### 2.2 The sidecar container — `.text` and `.table` are **not** plain text (2026-08-01)

Hand-authored expansions (and therefore the committed fixture) hold DAT bodies as plain text, which is why this went unnoticed for two months. In genuine `toeexpand` output they are framed:

```
byte 0      "1" = table, "2" = text
bytes 1-2   "\n*"
bytes 3-18  u32be × 4:  1, rows, cols, 0        (a text sidecar uses 1,1,1,1)
then        values, each: u32be type (2 = utf-8 string) + u32be length + bytes
```

A text sidecar carries exactly one value; a table carries `rows × cols` in row-major order. Verified on two real projects — every declared length matched the bytes remaining, nothing left over.

Consequence: reading a real `.text` with `File.text()` prepends 27 bytes of binary garbage to every DAT body, and NUL-guarding drops the body entirely. One real 20 MB project contains **1,869 `.text` and 439 `.table` sidecars**. Decoder: `packages/io/src/tdContainer.ts`; genuinely binary payloads (`.lod` MIDI state, baked `.data`) still return null rather than mojibake.

Key consequences:
- **The complete logical graph is recoverable as text**: types, names, hierarchy, wires, parameter values *and* expressions, Python code, layout positions, comments.
- **Media is NOT embedded** (unless locked): `file` parms hold absolute/relative paths — a web importer must offer relink-or-placeholder for external assets. Locked/baked data appears as binary sidecars.
- Some payloads are binary (`.lod` MIDI state, binary `.table` ramp keys) — skippable for graph purposes.

## 3. Verified pipeline (proof of concept, pre-WebToe)

```
project.toe ──toeexpand──▶ project.toe.dir/ ──parser──▶ graph.json ──▶ browser viewer
                                  ▲                                        │
                                  └────────── toecollapse ◀── edit text ◀──┘   (round-trip verified)
```

A dependency-free parser + SVG viewer was built and verified against a real production project: **213 nodes, 144 wires** parsed — TOP ×73, POP ×64, COMP ×24, SOP ×20, CHOP ×14, DAT ×11, MAT ×7 — and rendered correctly in the browser (wires and layout match TD). The round-trip test (edit `tile` in text → `toecollapse` → re-expand) confirmed web-based *editing* is possible. That PoC's parsing logic is being productized as WebToe's `src/io/toedir.ts` and `tools/toe-convert.mjs`.

## 4. Ecosystem survey

| Project | What it is | Maturity / relevance |
|---|---|---|
| [toeexpand-git-pre-commit](https://github.com/nariakiiwatani/toeexpand-git-pre-commit) | Git hook auto-expanding `.toe` for diffs | Working; proves headless macOS automation |
| [td4llms](https://github.com/jcksncllwy/td4llms) | JSON export of networks for LLMs via **TDJSON inside a live TD** | Very immature (2026-03, 5★); not a standalone parser; verified to NOT capture complete wiring |
| TDJSON (built-in) | Official Python serializer inside TD | Solid, but requires a running TD instance |
| [touchdesigner-mcp](https://github.com/8beeeaaat/touchdesigner-mcp) | MCP server controlling live TD through a Web Server DAT | Working example of "TD as a live API server" |
| [TouchDesigner/WebRTC-Remote-Panel-Web-Demo](https://github.com/TouchDesigner/WebRTC-Remote-Panel-Web-Demo) | **First-party React app**: WebRTC video from TD + mouse/keyboard back | Official prior art for streaming architecture |
| [cables.gl](https://cables.gl) / [hydra](https://github.com/hydra-synth/hydra) | Browser-native node/livecoding visual engines | Prior art that a dataflow GPU graph runs fine in-browser — their existence validates WebToe's approach (original engines, no TD code) |

No mature open-source standalone `.toe` parser existed before this work.

## 5. Feasibility matrix — making a `.toe` "work" on the web

| Approach | Fidelity | Effort | Cost to serve | Verdict |
|---|---|---|---|---|
| **A. Read-only viewer** (expand → JSON → render graph) | Structure 100%, no live output | S — verified PoC | Static hosting | ✅ Subsumed into WebToe's importer |
| **B. Subset re-implementation** (original ops on WebGL/JS) | Medium, capped; per-op work | L–XL | Static hosting | ✅ **This is WebToe** |
| **C. Real TD server + WebRTC streaming** | 100% — it IS TouchDesigner | M | GPU box per concurrent session | ✅ Official path for full fidelity; complementary, out of WebToe's scope |
| **D. Pre-baked exports** | Output-only | S–M | Static/CDN | Fine for showcasing |
| **E. TouchEngine embedding** | High | M–L | Same as C | Native hosts only (Win/macOS SDK), loads `.tox` not `.toe`, no web/wasm target |

Approach C specifics (for completeness): TD has built-in WebRTC operators (Video Stream Out/In TOP, Audio Stream Out/In CHOP + WebRTC DAT, [UserGuide/WebRTC](https://derivative.ca/UserGuide/WebRTC)); `Video Stream Out TOP` requires **Windows + NVIDIA (NVENC)** ([docs](https://docs.derivative.ca/Video_Stream_Out_TOP)); scaling = one GPU render per interactive session.

## 6. Licensing & IP constraints adopted by WebToe

- Never bundle Derivative binaries (`toeexpand` stays on the user's machine), sample files, docs text, or UI assets.
- Original code/GLSL/design throughout; trademark disclaimer in README.
- Format interoperability via the user's own official tooling output is the established, community-practiced path.
- Unverified items (read primary sources before any commercial server-side use): exact EULA terms for cloud instances, TouchEngine royalty terms, non-commercial resolution caps — [EULA](https://derivative.ca/end-user-license-agreement-eula), [Licensing](https://derivative.ca/UserGuide/Licensing), [Floating Cloud Licenses](https://derivative.ca/UserGuide/Floating_Cloud_Licenses).

## 7. Strategic timing: official JSON format incoming

Derivative staff (robmc) on the [text-format thread](https://forum.derivative.ca/t/toe-files-in-text-format/309048), verified:
- 2025-02-06: "The text-based file format is one of our top priorities … The files use a straightforward JSON syntax so they can easily be edited and built using external tools — either AI-based or otherwise."
- 2025-10-24: it **won't be in the 2025 release** (POPs were prioritized) but is "hoped to be a major feature of the release after that."

WebToe consequence: the importer sits behind an adapter (`loadGraph(source) → Graph`); when the official JSON ships, a second loader slots in beside `toedir.ts` with no engine changes.

## Verified sources (selection)

- https://docs.derivative.ca/.toe · https://docs.derivative.ca/Toeexpand
- https://forum.derivative.ca/t/toe-files-in-text-format/309048 (Derivative staff statements, 2022→2025)
- https://derivative.ca/UserGuide/WebRTC · https://docs.derivative.ca/Video_Stream_Out_TOP
- https://docs.derivative.ca/TouchEngine
- https://github.com/TouchDesigner/WebRTC-Remote-Panel-Web-Demo
- https://github.com/nariakiiwatani/toeexpand-git-pre-commit · https://github.com/jcksncllwy/td4llms
