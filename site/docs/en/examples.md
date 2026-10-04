---
title: Examples
description: The ten projects bundled with the editor, what each one shows, and a link that opens it.
---

Ten projects ship with the editor. Load them from the toolbar's *examples…* menu, or open one directly with the links below. They are ordinary `.webtoe.json` files in [`apps/web/public/examples`](https://github.com/frank890417/WebToe/tree/main/apps/web/public/examples): save one, change it, load it back.

## Authored patches {#authored}

### 01 · hello noise {#hello-noise}

Animated fBm noise; an LFO drives the level's brightness through an expression. The smallest complete patch: four operators, one expression. [Open in the editor](/app/?project=examples/01-hello-noise.webtoe.json)

### 02 · feedback trails {#feedback-trails}

Move the mouse over the viewer. A feedback loop with a fading level leaves trails behind a mouse-driven rectangle. [Open in the editor](/app/?project=examples/02-feedback-trails.webtoe.json)

### 03 · lfo garden {#lfo-garden}

Three ramp chains, each rotated by its own LFO through an expression, composited additively with the hue slowly drifting. [Open in the editor](/app/?project=examples/03-lfo-garden.webtoe.json)

### 04 · webcam displace {#webcam-displace}

The webcam displaced by animated noise, with an edge overlay. Allow camera access; without a camera a placeholder shows instead. [Open in the editor](/app/?project=examples/04-webcam-displace.webtoe.json)

### 05 · chop playground {#chop-playground}

Select `merge1` to scope the channels: a raw sum against its lagged copy. The lagged sum rotates the ramp. [Open in the editor](/app/?project=examples/05-chop-playground.webtoe.json)

## Imported from TouchDesigner {#imported}

Three 2022 daily sketches, converted from their original `.toe` files by the importer, lightly adapted for the web (a movie source swapped for noise, for example). Both engine bugs they exposed (composite layer order, quoted string constants) were fixed and have regression tests.

### 06 · sketch: pseudo voronoi (2022) {#voronoi}

A pseudo-voronoi pattern from animated noise. [Open in the editor](/app/?project=examples/06-sketch-voronoi.webtoe.json)

### 07 · sketch: fractals (2022) {#fractals}

Fractal-like feedback noise. [Open in the editor](/app/?project=examples/07-sketch-fractals.webtoe.json)

### 08 · sketch: chop study (2022) {#chop-study}

Click and move in the viewer: lagged mouse channels scale the composite. [Open in the editor](/app/?project=examples/08-sketch-chop-study.webtoe.json)

## Showcases {#showcases}

### 09 · showcase {#showcase}

Every family at once, in 27 nodes: camera through edge detection, a kaleidoscope COMP with in/out tunnels, colour noise, a mouse-driven source switch, noise displacement, hue-drifting feedback trails, and a CHOP rig (lag, speed integrator, parameter reader, full math pipeline) driving it through live expressions. Move the mouse over the viewer: x switches the source, y sets the displacement. [Open in the editor](/app/?project=examples/09-showcase.webtoe.json)

### 10 · 3d lines {#3d-lines}

The 3D pipeline end to end: skinned, wobbling line ribbons (SOPs inside a Geometry COMP with a line MAT), noise-scattered instanced spheres, an orbiting look-at camera, point and ambient lights, a Render TOP, and a 2D glow chain after it. Uses the WebGL2 backend. [Open in the editor](/app/?project=examples/10-3d-lines.webtoe.json)

## Raw TouchDesigner files {#raw-toe}

Two of the author's own 2022 daily sketches as the original `.toe` files, saved by TouchDesigner 2021.16410. Picking one decodes the container natively in the browser (a few milliseconds) and imports it; the import report says what ran and what was kept as a stub. Native .toe decoding is provided for research purposes only.

### 11 · raw .toe: pseudo voronoi {#raw-voronoi}

Pseudo-voronoi cells from animated noise, as saved in TouchDesigner. [Open in the editor](/app/?project=examples/toe/2022-pseudo-voronoi.toe)

### 12 · raw .toe: fractals {#raw-fractals}

A fractal feedback sketch, as saved in TouchDesigner. [Open in the editor](/app/?project=examples/toe/2022-fractals.toe)
