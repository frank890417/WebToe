# webtoe

Open TouchDesigner `.toe` files in the browser — one command, then drag and drop.

```bash
npx webtoe
```

That serves the [WebToe](https://webtoe.openaudiovisual.com/) editor at `http://127.0.0.1:9881/app/` and opens it (the docs are served alongside, at `/docs/`). Drop any `.toe`/`.tox` on the page: the file is expanded with **your own** TouchDesigner install's official `toeexpand` and imported as a live node graph. Requires TouchDesigner (any recent build; files from TD 2017 onward verified) and Node ≥ 20.

- **Nothing of Derivative's is bundled** — the bridge only locates and runs the `toeexpand` you already have. NDI® and TouchDesigner® are trademarks of their respective owners; WebToe is an independent open-source project.
- **Your files never leave your machine** — the service binds to `127.0.0.1` by default and has zero dependencies.
- Also works as a companion for the hosted editor at [webtoe.openaudiovisual.com/app/](https://webtoe.openaudiovisual.com/app/): keep `npx webtoe --no-open` running and the hosted page will find it.

## Flags

| Flag | Meaning |
|---|---|
| `--port <n>` | listen port (default 9881) |
| `--no-open` | don't open a browser |
| `--toeexpand <path>` | explicit toeexpand path (else auto-discovered) |
| `--host <addr>` | bind beyond loopback (LAN/Tailscale) — set `--token` too |
| `--token <secret>` | require `Authorization: Bearer` on `/expand`; pair with `?bridgeToken=` in the app URL |

Docs: https://webtoe.openaudiovisual.com/docs/ · source: https://github.com/frank890417/WebToe
