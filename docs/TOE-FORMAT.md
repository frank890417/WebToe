# The `.toe` / `.tox` container — native decoding

> **Research use only.** WebToe's native `.toe` decoder is provided for research
> into interoperability with project files you own. It is not affiliated with or
> endorsed by Derivative Inc. The container is Derivative's format and may change
> in any TouchDesigner release; Derivative has announced an official JSON project
> format, and WebToe's `ProjectLoader` interface is ready to load it beside this
> decoder. The bridge path — your own TouchDesigner's `toeexpand` — remains the
> reference and the automatic fallback.

Implementation: [`packages/io/src/toeBinary.ts`](../packages/io/src/toeBinary.ts) ·
tests: [`tests/toe-native.test.ts`](../tests/toe-native.test.ts)

## What it does

Drop a `.toe` or `.tox` on the editor (or link one with `?project=…toe`) and it is
decoded in the browser into exactly the file set `toeexpand` writes — node
files (`.n`), parameters (`.parm`), DAT bodies, layout — then imported by the same
`toedirLoader` the bridge path uses. No TouchDesigner install, no local service,
no network.

## Measured

Validated against the official `toeexpand` (TouchDesigner 2025.33070) on a corpus
of 125 production project files, 3 KB to 151 MB, saved by builds from 2021.16410
to 2025:

| | |
|---|---|
| identical file set, byte for byte | **125 / 125** (553,230 files) |
| of which needed case-folding emulation | 9 — see *Filenames* below |
| total decode time, native (Node, zlib) | **17.7 s** |
| total time, `toeexpand` | 266.5 s |
| 151 MB show file | 4.2 s native vs 20.2 s `toeexpand` |
| 21 MB show file with a chunked segment | 1.0 s native vs 6.3 s `toeexpand` |
| a daily sketch (4 KB) in the browser | 1–6 ms |

## Format

All integers are big-endian unless noted.

```
file = SEGMENT+

SEGMENT kind "10"
  "10"                  2 bytes   kind
  payloadLen            u32       bytes of payload, padded to a multiple of 8
  rawLen                u32       inflated size
  payload               payloadLen

SEGMENT kind "12"       large archives, split into chunks of ≤ 128 MiB output
  "12"                  2 bytes   kind
  chunks                u32
  8                     u32       size of a chunk header
  payloadLen₀  rawLen₀  u32 u32
  payload₀
  repeat for i = 1 … chunks−1:
    payloadLenᵢ rawLenᵢ u32 u32   (8-byte chunk header, not encrypted)
    payloadᵢ

payload = TEA-ECB( zlib stream ), padded to 8 bytes
```

**TEA** is the standard Tiny Encryption Algorithm: 32 rounds, delta `0x9E3779B9`,
little-endian 32-bit word pairs, ECB over 8-byte blocks, with the 128-bit key
(little-endian words) `9241fa3a 59f32012 c612aa09 a98123d4`. The zlib stream is
stock RFC 1950.

**Inflated payloads** concatenate (in order, across chunks *and* segments) into one
archive of records; a record may straddle a chunk boundary:

```
0x34  file   [tag] [u8 nameLen] [u32 contentLen] [name \0] [content]
0x36  push   [tag] [0x34] [u8 nameLen] [name \0]       enter a subdirectory
0x35  pop    [tag]                                     leave it
```

A file record named `TRAILER!!!` closes the archive.

### Rules that matter

1. **The directory stack persists across segments.** Resetting it per segment
   silently flattens large projects.
2. **Check every chunk.** The decoder verifies each chunk's inflated size against
   `rawLen` and that the next segment starts where the lengths say. Should a
   segment's fields not check out (an unseen variant), it is *recovered* without
   them: zlib streams are walked on the TEA block grid, each one's end located by
   its Adler-32 trailer and confirmed by what follows at the next block boundary
   (end of file, a segment, or another chunk). No file in the corpus needed it.
3. **Filenames.** TouchDesigner allows sibling operators whose names differ only
   in case (`geo_I` and `geo_i`). `toeexpand` writes to the file system, so on
   macOS and Windows those collide and it appends `.2`, `.3` and merges
   directories — the expansion no longer matches the project. The native decoder
   keeps the original names; the 9 corpus files above match `toeexpand` once its
   case-insensitive collisions are emulated in the comparison.

## In the app

| path | when |
|---|---|
| native decode | first, for every dropped / linked `.toe` / `.tox` |
| bridge + `toeexpand` | if native decoding fails or the result does not look like a TouchDesigner expansion; `?toe=bridge` forces it |
| guide | neither works (no bridge running) |

The import report states which path was used and how long it took.

## Provenance

The format description above was established by studying project files and
TouchDesigner's own command-line tools, and is validated byte for byte against
`toeexpand` output. WebToe contains no Derivative code, binaries or assets.
