# Third-party notices

WebToe is MIT licensed (see `LICENSE`). A few algorithms in the TOP shaders
come from third parties under permissive terms; their notices are reproduced
here and in the headers of the files that carry them. The shader strings that
ship to the browser keep the notices inline as well.

The TouchDesigner-faithful TOP behaviour (Level, Edge, Monochrome, Ramp, Blur,
Noise, Composite) was measured black-box against TouchDesigner by the author's
own EOI "dream engine" project and ported here by the author. No code or data
was extracted from TouchDesigner itself.

---

## Stefan Gustavson — GLSL noise (2004)

Used in: `packages/ops/src/top/noiselib.ts` (Noise TOP Perlin/simplex 2D–4D,
GLSL and a WGSL translation), lookup tables `GRAD3`, `GRAD4`, `SIMPLEX4` in
`packages/ops/src/top/tdmath.ts`.

Source: `GLSL-noise-old.zip`, http://staffwww.itn.liu.se/~stegu/simplexnoise/
(archived at https://web.archive.org/web/20060503235618/http://staffwww.itn.liu.se:80/~stegu/simplexnoise/GLSL-noise-old.zip)

> Author: Stefan Gustavson ITN-LiTH (stegu@itn.liu.se) 2004-12-05
> You may use, modify and redistribute this code free of charge,
> provided that my name and this notice appears intact.

Modifications: function renames (`noise` → `TDPerlinNoise`, `snoise` →
`TDSimplexNoise`, `fade` → `tdnFade`), the 256×256 lookup textures replaced by
the same tables as constant arrays indexed exactly the way the texture lookups
resolve (including the 8-bit gradient encoding and the wrap of a coordinate of
1.0 to texel 0), and a WGSL translation.

## Ken Perlin — Improved Noise permutation table (2002)

Used in: `PERM` in `packages/ops/src/top/tdmath.ts` (the 256-entry permutation
that Gustavson's tables are built from).

Source: Ken Perlin, "Improved Noise reference implementation",
https://mrl.cs.nyu.edu/~perlin/noise/ — the same table appears in Stefan
Gustavson's public-domain `noise1234.c` (https://github.com/stegu/perlin-noise).

## David Hoskins — "Hash without Sine" (2014)

Used in: `h31` in `packages/ops/src/top/noiselib.ts` (white noise for
`period 0`, the `random` noise type, the cell function of the approximate
`alligator` type) and its CPU mirror in `tests/top-fidelity-ref.ts`.

Source: https://www.shadertoy.com/view/4djSRW (hash13 variant)

> MIT License
>
> Copyright (c) 2014 David Hoskins.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Sam Hocevar — branchless RGB↔HSV in GLSL (2013)

Used in: `packages/ops/src/top/complib.ts` (Composite `hue` and
`chromadifference` operations, GLSL and WGSL) and the CPU mirror in
`tests/top-fidelity-ref.ts`.

Source: "Fast branchless RGB to HSV conversion in GLSL", Lol Engine blog,
2013-07-27, http://lolengine.net/blog/2013/07/27/rgb-to-hsv-in-glsl (ternary
form suggested there by Emil Persson). Licensed under the WTFPL v2:

> DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
> Version 2, December 2004
>
> Copyright (C) 2004 Sam Hocevar <sam@hocevar.net>
>
> Everyone is permitted to copy and distribute verbatim or modified
> copies of this license document, and changing it is allowed as long
> as the name is changed.
>
> DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
> TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION
>
> 0. You just DO WHAT THE FUCK YOU WANT TO.

## Abramowitz & Stegun — erf approximation 7.1.26

Used in: the Blur TOP's in-shader Gaussian kernel weights (`glsl.ts`,
`wgsl.ts`). From *Handbook of Mathematical Functions* (US National Bureau of
Standards, 1964), a US government work in the public domain.
