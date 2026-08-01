# webtoe

Open TouchDesigner `.toe` files in the browser — one command, then drag and drop.

```bash
npx webtoe
```

That serves the [WebToe](https://github.com/frank890417/WebToe) editor at `http://127.0.0.1:9881/WebToe/` and opens it. Drop any `.toe`/`.tox` on the page: the file is expanded with **your own** TouchDesigner install's official `toeexpand` and imported as a live node graph. Requires TouchDesigner (any recent build; files from TD 2017 onward verified) and Node ≥ 20.

- **Nothing of Derivative's is bundled** — the bridge only locates and runs the `toeexpand` you already have. NDI® and TouchDesigner® are trademarks of their respective owners; WebToe is an independent open-source project.
- **Your files never leave your machine** — the service binds to `127.0.0.1` by default and has zero dependencies.
- Also works as a companion for the hosted app at [frank890417.github.io/WebToe](https://frank890417.github.io/WebToe/): keep `npx webtoe` running and the hosted page will find it.

## Flags

| Flag | Meaning |
|---|---|
| `--port <n>` | listen port (default 9881) |
| `--no-open` | don't open a browser |
| `--toeexpand <path>` | explicit toeexpand path (else auto-discovered) |
| `--host <addr>` | bind beyond loopback (LAN/Tailscale) — set `--token` too |
| `--token <secret>` | require `Authorization: Bearer` on `/expand`; pair with `?bridgeToken=` in the app URL |

Full project, docs and source: https://github.com/frank890417/WebToe
