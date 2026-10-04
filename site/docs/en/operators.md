---
title: Operators
description: Every operator WebToe ships, by family, generated from the engine's registry, plus how cooking, stubs and custom operators work.
---

An operator is a node with a type such as `top:noise` or `chop:lfo`: a family, a name, typed parameters, a number of inputs, and a cook function. Families follow TouchDesigner's: what flows along a wire depends on the family of the operator that produced it.

| Family | Carries | Cooks on |
|---|---|---|
| **TOP** | images (textures) | the GPU, as render passes |
| **CHOP** | channels: named arrays of samples | the CPU, behind a WASM-ready kernel interface |
| **SOP** | geometry: typed-array points, primitives, normals, colours | the CPU |
| **MAT** | materials for the scene renderer | descriptions consumed by the Render TOP |
| **COMP** | networks (containers) and 3D objects (geometry, camera, lights) | their children / the scene |
| **DAT** | text and tables | the CPU |

## Every operator {#all}

<!-- OPS-TABLE -->

<!-- OPS-TOTAL -->

The names follow TouchDesigner's operators where WebToe implements the same idea, and the importer maps TouchDesigner's type tokens onto them (Composite TOP is `comp` in a project file, for example). Notable details:

- **render** draws the Geometry COMPs that match its pattern (`geo* ^geo7`, TouchDesigner's syntax) with a camera and lights; the scene pass runs on WebGL2.
- **geometry** COMPs instance their geometry over SOP points or over CHOP channels (one channel per transform component, a channel shorter than the instance count holds its last sample).
- **lookup** maps an image through a ramp; a **ramp** can read its colour keys from a table DAT.
- **feedback** returns its input's previous frame and is the one operator allowed to close a loop.
- **ndi in** / **ndi out** talk to the local [NDI bridge](ndi.md).
- **in** / **out** in TOP, CHOP, SOP and DAT tunnel data into and out of a COMP.

## How cooking works {#cooking}

Cooking is pull-based. Each frame the engine starts at the displayed output and asks each input for its result; every operator cooks at most once per frame (memoized), and a cycle guard reports loops instead of hanging. Operators that depend on time, media or input devices are always re-cooked. TOPs describe their work as passes against a backend-agnostic contract, so the same operator runs on WebGL2 and WebGPU ([Architecture](architecture.md)).

## Stubs {#stubs}

Every family has a stub operator. The importer uses it for any TouchDesigner type WebToe does not implement: the stub keeps the original type, name, wires, parameters and code, and passes its input through, so a partly supported network still cooks. Saved files carry each node's family, so an unknown type in a `.webtoe.json` also degrades to the right stub instead of failing.

## Writing your own {#custom}

Operators register through the public plugin API in `@webtoe/core`. A minimal CHOP:

```ts
import { registerOp } from '@webtoe/core';

registerOp({
  type: 'chop:sine',               // family:name, unique
  family: 'CHOP',
  label: 'sine',
  inputs: { min: 0, max: 0 },
  alwaysCook: true,                // depends on time
  params: [{ key: 'freq', type: 'float', default: 1, min: 0, max: 10 }],
  cook(ctx) {
    const v = Math.sin(ctx.time.seconds * ctx.paramNum('freq') * Math.PI * 2);
    return { kind: 'chop', rate: 60, channels: [{ name: 'chan1', data: new Float32Array([v]) }] };
  },
});
```

The palette, the parameter panel and the file format find registered operators through the registry; nothing else has to change. TOPs additionally ship a shader per backend (GLSL for WebGL2 and WGSL for WebGPU, written by hand), and a contract test checks that both exist.
