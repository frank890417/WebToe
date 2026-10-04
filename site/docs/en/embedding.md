---
title: Embedding and external control
description: Put the editor in an iframe or mount it in your own page, load projects by URL, and drive patches from outside with postMessage and ext().
---

There are two ways to put WebToe in another page: embed the hosted editor in an iframe and talk to it with `postMessage`, or mount the editor package directly.

## Load a project by URL {#project}

```text
https://webtoe.openaudiovisual.com/app/?project=https://example.com/patch.webtoe.json
```

`?project=` takes any URL the browser can fetch; a project on another origin must be served with CORS headers that allow it. Relative URLs resolve against `/app/`, which is how the bundled examples are linked: `/app/?project=examples/03-lfo-garden.webtoe.json`.

## Drive a patch from outside {#ext}

Inside a patch, `ext('name', fallback)` reads a number set from outside. The host page sends values with `postMessage`; any parameter expression can read them:

```html
<iframe id="webtoe" src="https://webtoe.openaudiovisual.com/app/?project=https://example.com/patch.webtoe.json"
        allow="camera; microphone" style="width:100%;aspect-ratio:16/9;border:0"></iframe>
<script>
  const frame = document.getElementById('webtoe');

  // every frame, or whenever something changes
  function send(values) {
    frame.contentWindow.postMessage({ type: 'webtoe:ext', values }, '*');
  }
  send({ energy: 0.8, hue: 0.25 });

  // swap the project without reloading the iframe
  frame.contentWindow.postMessage({ type: 'webtoe:load', url: 'https://example.com/other.webtoe.json' }, '*');
</script>
```

In the patch, set a parameter to an expression such as `ext('energy', 0.5) * 2`. The fallback is used until the first value arrives.

| Message | Shape | Effect |
|---|---|---|
| `webtoe:ext` | `{ type: 'webtoe:ext', values: { [name]: number } }` | sets external values; non-numbers and non-finite numbers are dropped; names not sent keep their last value |
| `webtoe:load` | `{ type: 'webtoe:load', url: string }` | loads the project at `url` and replaces the current one |

Messages are accepted from any origin. That is deliberate and matches the trust model of the patch itself: a message can only set numbers that expressions read, or load a project the page could load from a link anyway.

## The open-audiovisual adapter {#oav}

[open-audiovisual](https://openaudiovisual.com/) uses exactly this. Its `@openav/world-webtoe` package wraps an embedded WebToe editor as an openav *world*: the show's mapping layer resolves inputs (MIDI, audio, chords, hands, a timeline) into parameters, and the adapter posts them to the patch each frame as `webtoe:ext` values, sending only when something changed. In the patch they are plain `ext()` reads, so the same network runs standalone with its fallbacks or performed by a show.

## Mount the editor in your page {#mount}

The editor package is framework-free and has no dependencies, so it can be mounted into any element:

```ts
import { registerAllOps } from '@webtoe/ops';
import { mountEditor } from '@webtoe/editor';
import { setExternals } from '@webtoe/core';

registerAllOps();
const editor = await mountEditor(document.getElementById('app')!, {
  examples: [{ name: 'my patch', url: '/patches/my.webtoe.json' }],  // toolbar menu
  backend: 'webgl2',          // or 'webgpu'; ?backend= in the URL still wins
  starterPatch: false,        // start empty instead of with the default patch
  repoUrl: 'https://github.com/you/your-fork',
});

await editor.loadUrl('/patches/my.webtoe.json');
setExternals({ energy: 0.8 });   // what webtoe:ext does
```

The packages are workspace packages in the repository today, not yet published to npm; build from the monorepo (`apps/web/src/main.ts` is the complete reference host, including the `postMessage` listener).

## Compatibility with old links {#compat}

Until the site moved the editor to `/app/`, it lived at the site root. Links and embeds that still point at `https://webtoe.openaudiovisual.com/` keep working: when the root page is opened inside an iframe, or with a query such as `?project=`, `?bridge=` or `?backend=`, it forwards to `/app/` with the same query and hash before rendering. Campaign-tracking parameters alone (`utm_*`, `fbclid`, `gclid` …) do not trigger the forward.
