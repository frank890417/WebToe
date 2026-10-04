---
title: Getting started
description: Open the editor in a browser, run WebToe locally with npx webtoe, or set up the monorepo for development.
---

## Try it in the browser {#online}

Open **[the editor](/app/)**. It needs a browser with WebGL2 (any current Chrome, Edge, Firefox or Safari). Nothing is installed and nothing is uploaded: projects load and run in the page.

- **Examples.** The toolbar's *examples…* menu loads ten bundled projects, from a four-node noise patch to a 3D scene. See [Examples](examples.md).
- **Your files.** *load* opens a `.webtoe.json`; *save* downloads the current network as one. You can also drop a file anywhere on the page: a `.webtoe.json`, a TouchDesigner `.toe` / `.tox`, or a `.toe.dir` folder produced by `toeexpand`. See [Importing TouchDesigner projects](importing.md).
- **Links.** `/app/?project=<url>` loads a project from a URL (the server has to allow it with CORS). Relative paths resolve against `/app/`, so `/app/?project=examples/01-hello-noise.webtoe.json` opens the first example.

### Working in the network {#keys}

| Action | How |
|---|---|
| Add an operator | <kbd>Tab</kbd> or double-click the network: family tabs, one search across all families |
| Wire | drag from an output dot to an input dot |
| Select | click a node; the parameter panel and the viewer follow the selection |
| Expression on a parameter | the **ƒ** button next to the parameter |
| Enter a COMP / go up | <kbd>i</kbd> / <kbd>u</kbd> |
| Display flag (what the viewer shows) | <kbd>Shift</kbd> + <kbd>D</kbd> |
| Show the output behind the network | <kbd>d</kbd> |
| Delete | <kbd>Backspace</kbd> or <kbd>Delete</kbd> |

### URL parameters {#url}

| Parameter | Effect |
|---|---|
| `?project=<url>` | load a `.webtoe.json` on start |
| `?backend=webgpu` | use the WebGPU backend instead of WebGL2 (falls back to WebGL2 if WebGPU fails to start) |
| `?bridge=<url>` | use an import bridge at this address instead of `http://127.0.0.1:9881` |
| `?bridgeToken=<token>` | bearer token for a shared bridge; remembered in this browser after the first visit |

## Run it on your machine {#local}

```bash
npx webtoe
```

This starts the WebToe bridge on `127.0.0.1:9881`, serves the editor at `http://127.0.0.1:9881/app/` and opens it. The bridge is what lets the page use your own TouchDesigner's `toeexpand` (see [Importing](importing.md#bridge)). It needs Node 20 or newer and has no dependencies.

| Flag | Default | Meaning |
|---|---|---|
| `--port <n>` | `9881` | port to listen on |
| `--no-open` | | do not open a browser (bridge only, for the hosted editor) |
| `--host <addr>` | `127.0.0.1` | bind address; anything beyond loopback should use `--token` |
| `--token <secret>` | | require `Authorization: Bearer <secret>` on `/expand` |
| `--toeexpand <path>` | auto | path to `toeexpand` if it is not in the standard install location |
| `--app <dir>` | built app | serve a different build of the site |

## Work on the source {#dev}

WebToe is an npm-workspaces monorepo written in TypeScript. The shipped app has no runtime dependencies; development uses Vite, Vitest, TypeScript and playwright-core.

```bash
git clone https://github.com/frank890417/WebToe.git
cd WebToe
npm install
npm run dev          # editor at http://localhost:8643/app/
npm run check        # type check + test suite
npm run build        # apps/web/dist: the site at /, the editor at /app/
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server for the editor (`apps/web`) |
| `npm run check` | `tsc --noEmit`, then every Vitest suite under `tests/` |
| `npm run build` | builds the editor into `apps/web/dist/app/`, then this site around it |
| `npm run site:check` | builds the site in memory and fails on any broken link or missing translation |
| `npm run bridge` | the local bridge from the checkout (serves `apps/web/dist` once built) |

Start with [Architecture](architecture.md) before changing the engine: the package dependency rule and the GPU pass contract are the two things everything else rests on.
