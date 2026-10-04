---
title: Importing TouchDesigner projects
description: Drop a .toe or .tox on the editor. What comes across, what becomes a stub, how expressions are translated, and the bridge and toeexpand paths.
---

Drag a `.toe` or `.tox` onto the editor (or pick it with *load*). WebToe rebuilds the network: supported operators run immediately, everything else is kept as a stub, and an import report says exactly how much of each.

## Native decoding {#native}

<!-- TOE-NATIVE -->
WebToe decodes `.toe` / `.tox` files **natively in the browser**: no TouchDesigner install, no bridge, and the file never leaves your machine. A 20 MB show file decodes in 0.35 s (33,923 files) and the whole drop-to-running-graph takes about half a second in Chrome. The decoder is validated byte for byte against TouchDesigner's own `toeexpand` on 125 production project files. If native decoding fails, the bridge and `toeexpand` path below takes over automatically; add `?toe=bridge` to the editor URL to force it. Details: [The .toe format](toe-format.md).

Try it: [open a raw 2022 project file](/app/?project=/examples/toe/2022-fractals.toe), saved by TouchDesigner 2021.16410.

Native .toe decoding is provided for research purposes only.
<!-- /TOE-NATIVE -->

## What comes across {#recovered}

- **Operators and hierarchy.** Node types are mapped through a conservative type table (about 90 TouchDesigner types today); COMP networks nest as they do in TouchDesigner.
- **Wires**, including wires across COMP boundaries and through `in` / `out` operators (TouchDesigner's tunnels; the input index comes from the name, `in2` → index 1).
- **Parameters**, with token-accurate value maps for the operators WebToe implements (menu tokens, colour components gathered into one colour, TouchDesigner's own parameter names).
- **Node flags.** Render, display and bypass flags come across; the Render TOP only draws Geometry COMPs whose render flag is on, as in TouchDesigner.
- **Expressions.** Live Python expressions are translated when the translation is faithful, and kept inert otherwise (see [below](#expressions)). The parameter mode field is a bitfield (bit 0 = expression), so flagged expression modes import too.
- **DAT text and tables.** TouchDesigner stores DAT bodies in a framed binary sidecar, not plain text; WebToe decodes the frame.
- **Layout.** Node positions are kept, and the network view frames the imported content on entry.

## What does not {#stubs}

- **Unmapped operators become stubs** of the right family. A stub keeps the node's name, wires, layout, parameters and Python code, and passes its input through so the chain downstream still cooks. The original type is shown on the node.
- **Imported Python never runs.** Untranslatable expressions stay visible on the parameter's ƒ field, inactive. Python DATs (parameter execute, panel execute, script) are a permanent boundary.
- **Media paths** become placeholders; image and movie files are not inside a `.toe`.
- **Wires between different networks** that are not COMP tunnels are skipped and counted in the report (a listed follow-up).

## The import report {#report}

Every import ends with a report: nodes imported, how many run, how many are stubs, expressions translated and kept inert, and a histogram of the stubbed types. That histogram is how WebToe decides what to implement next ([TouchDesigner parity](td-parity.md)).

Measured on a real 20 MB production show file through the bridge: **14,710 nodes, 10,239 runnable (70%), 2,244 expressions translated, 2,251 DAT bodies recovered, 8.0 s** from drop to a running graph, 4.6 s of it in `toeexpand` (WORKLOG, 2026-08-01).

## Expression translation {#expressions}

The translator rewrites a known subset of TouchDesigner Python into WebToe's expression language, then compiles the result and dry-runs it against an inert scope. Anything that fails either step stays inert.

| TouchDesigner | WebToe |
|---|---|
| `absTime.seconds`, `me.time.seconds` | `time.seconds` |
| `absTime.frame`, `me.time.frame` | `time.frame` |
| `math.sin(x)`, `mod.math.sin(x)` | `sin(x)` |
| `math.pi` | `PI` |
| `a if cond else b` | `cond ? a : b` (one level) |
| `and`, `or`, `not` | `&&`, `\|\|`, `!` |
| `int(x)`, `float(x)` | `trunc(x)`, `(x)` |
| `True`, `False`, `None` | `true`, `false`, `null` |
| `op('lfo1')['chan1']`, `parent().par.speed`, `me.par.x` | unchanged: the same forms exist in WebToe |

Kept inert on purpose: f-strings, `lambda`, loops, `mod(...)` module calls, `tdu.*`, `ext.*`, `project.*`, `.menuIndex`, `panel.*`, `me.digits`, floor division `//`, and nested conditionals.

## The bridge {#bridge}

The bridge is a small local service that runs **your own** TouchDesigner's `toeexpand` (the official command-line tool that ships with every install) and hands the expansion to the page. It binds to `127.0.0.1`, has no dependencies, contains nothing of Derivative's, and deletes each upload when it is done. The editor looks for it automatically when a `.toe` is dropped.

```bash
npx webtoe              # serves the editor and the bridge, opens http://127.0.0.1:9881/app/
npx webtoe --no-open    # bridge only, for the hosted editor at webtoe.openaudiovisual.com
```

No Node? Every TouchDesigner install ships Python, so the same bridge exists as one standard-library file, protocol-identical. Download [`bridge.py`](/bridge.py) and run it:

```bash
# macOS: any Python 3.8+, including the one inside TouchDesigner
python3 ~/Downloads/bridge.py
```

```text
REM Windows: TouchDesigner's own Python (adjust the install path if needed)
"C:\Program Files\Derivative\TouchDesigner\bin\python.exe" %USERPROFILE%\Downloads\bridge.py
```

If no bridge is running, dropping a `.toe` opens a guide with these commands, and the guide keeps watching: start a bridge and it continues on its own.

### Sharing one bridge {#shared}

A bridge can serve other machines (TouchDesigner on one computer, the browser on another):

```bash
npx webtoe --host 0.0.0.0 --token <secret>
# then open: https://webtoe.openaudiovisual.com/app/?bridge=http://<host>:9881&bridgeToken=<secret>
```

Read this before doing it: `toeexpand` is a native program parsing files in an undocumented format, so a bridge that accepts uploads from others belongs on a machine you can wipe. Use HTTPS (a tunnel) for anything beyond your LAN, since browsers only exempt `127.0.0.1` from mixed-content rules. The bridge caps concurrent expansions at three.

## Without any bridge {#manual}

Expand the file yourself and drop the resulting folder on the page (or use *import .toe.dir*):

```bash
# macOS
"/Applications/TouchDesigner.app/Contents/MacOS/toeexpand" myproject.toe
```

```text
REM Windows
"C:\Program Files\Derivative\TouchDesigner\bin\toeexpand.exe" myproject.toe
```

For batch conversion there is a command-line converter that writes a `.webtoe.json`:

```bash
node packages/cli/toe-convert.mjs myproject.toe     # → myproject.webtoe.json
```

`toeexpand` cannot open file names that are not plain ASCII (it reads the path as Latin-1). The bridge and the converter stage a copy under an ASCII name, so projects named in Chinese, Japanese or Korean import normally.

## How it is tested {#tests}

The import pipeline is covered by an original committed fixture: a real binary `.toe` authored for this repository plus its canonical `toeexpand` expansion ([provenance](https://github.com/frank890417/WebToe/blob/main/tests/fixtures/README.md)). A CI layer asserts the reconstructed graph (types, COMP-boundary and tunnel wires, parameter modes, translated expressions evaluated in the engine, stubs, report numbers); a second layer, skipped where TouchDesigner is not installed, expands the binary with the real `toeexpand` and runs the converter and the bridge end to end, including a project whose file name is not English.

WebToe reads project files that you open with your own licensed TouchDesigner, for interoperability. It contains no Derivative code, binaries or assets.
