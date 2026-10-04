---
title: NDI bridge
description: Receive and send NDI video from the browser through a small local bridge, with the pixel conversion running in a 1 KB WebAssembly kernel.
---

Browsers cannot join an NDI network: there is no mDNS discovery and no raw TCP or UDP in a web page, and the NDI SDK is closed source. WebToe therefore splits the job in two. A small local bridge owns the NDI side using **your own** NDI runtime, and the `ndi in` / `ndi out` TOPs do the pixel work in the browser, talking to the bridge over a WebSocket on localhost.

```text
NDI network ⇄ packages/ndi-bridge (Node; ws, optional grandiose)
            ⇄ ws://127.0.0.1:9980   JSON control + binary frames
            ⇄ ndi in / ndi out TOPs ⇄ video kernels (WASM, JS fallback) ⇄ GPU textures
```

## Try it without NDI {#mock}

From a checkout of the repository (after `npm install`):

```bash
node packages/ndi-bridge/index.mjs --mock
```

Mock mode needs nothing from NDI: the bridge generates an animated UYVY test pattern as a source called *WebToe Mock (Pattern)* and accepts frames sent from the browser. In the editor, add an **ndi in** TOP: it connects to `ws://127.0.0.1:9980` and shows the pattern. Add an **ndi out** TOP after any image and the bridge logs the frames it receives.

## Real NDI {#real}

1. Install the NDI runtime from Vizrt.
2. Install the optional binding in the bridge package: `npm i grandiose` inside `packages/ndi-bridge`.
3. Run `node packages/ndi-bridge/index.mjs` (no `--mock`). Without `grandiose` it falls back to mock behaviour and says so.

| Operator | Parameters |
|---|---|
| **ndi in** | `bridge url` (default `ws://127.0.0.1:9980`), `ndi source` (blank = the first source found) |
| **ndi out** | `bridge url`, `sender name` (default *WebToe Out*), `active`, `send rate` (default 30 fps), `send width` × `send height` (default 1280 × 720) |

Bridge options: `--port <n>` (default 9980), `--mock`, `--mock-name <name>`.

## The protocol {#protocol}

Version 1, kept in sync between `packages/ndi-bridge/index.mjs` and `packages/ops/src/video/protocol.ts`:

- **Control** messages are JSON text: `hello` (version and mode), `sources` (list of names), `subscribe` `{ source }`, `send-open` `{ name, w, h, fps }`.
- **Frames** are binary: a 24-byte header (magic `WTNF`, `u32` width, `u32` height, a fourcc `RGBA` or `UYVY`, an `f64` timestamp) followed by the pixels.

## Why WebAssembly here {#wasm}

Converting UYVY to RGBA (BT.601) and swizzling BGRA, every pixel of every frame, is the one place in the engine where a WASM kernel pays for itself. The kernel is written in AssemblyScript (`packages/wasm-kernels`), compiled to a 1 KB `.wasm` that the app loads at startup; the JavaScript implementation is the permanent fallback and the unit-tested reference. The console says which one is running (`video kernels: wasm`).

## Limits {#limits}

`ndi out` reads pixels back synchronously on WebGL2 (throttled by its send rate); an asynchronous readback for WebGPU and compressed transport are listed follow-ups. Source discovery is by name in the `ndi source` parameter.

NDI® is a trademark of Vizrt NDI AB. WebToe ships no part of the NDI SDK; real mode uses the runtime you install.
