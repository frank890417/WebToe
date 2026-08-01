# Publishing & deployment checklist

Three independent switches, in order. Each is a decision of the repo owner — none happen automatically.

## 1. npm: make `npx webtoe` real (one-time per version)

The package name `webtoe` was free on the registry as of 2026-08-01 (verified 404). The tarball is self-contained: it carries the built app in `public/`, which `findAppDist` already checks — verified end-to-end by installing the packed tarball into a clean prefix and running `npx webtoe` (serves the app, expands a `.toe`).

```bash
npm run release:prep                              # build + stage app into packages/bridge/public
npm publish -w packages/bridge --access public    # needs npm login
```

After publishing, push the string-flip commit (README + guide modal say `npx webtoe`). Publish **before** pushing that commit, or the site will instruct a command that 404s.

Version bumps: `npm version patch -w packages/bridge`, re-run both lines.

## 2. GitHub: push = deploy

Push to `main` deploys GitHub Pages via Actions. The hosted page probes `127.0.0.1:9881` (CORS + `Access-Control-Allow-Private-Network`, verified reachable from the live HTTPS origin on 2026-08-01), so hosted-app + local-bridge works the moment both are out.

## 3. Optional: a shared converter (zero-install for visitors)

The bridge can serve beyond loopback — this is what `--host`/`--token` and the 429 concurrency cap exist for:

```bash
node packages/bridge/index.mjs --host 0.0.0.0 --token <secret>   # LAN / Tailscale / behind a tunnel
# visitors open: https://<app-url>/WebToe/?bridge=https://<tunnel>&bridgeToken=<secret>
```

Read these before flipping that switch:

- **Do not run it on a primary machine.** `toeexpand` is a native binary parsing untrusted uploads in an undocumented format — a malformed file is a plausible exploit vector. Use a disposable VM or a machine you can reimage (the Windows fleet node qualifies; the daily-driver Mac does not).
- **EULA**: RESEARCH §6 flags Derivative's terms for server/cloud use as *unverified*. Read the current EULA before offering conversion to the public, especially anything commercial.
- **Privacy story changes**: the local bridge's pitch is "files never leave your machine". A shared converter receives other people's project files — say so on the page, keep nothing (the bridge already deletes every upload in `finally`), and prefer a token-gated link over an open endpoint.
- HTTPS end to end (tunnel), or browsers will block the mixed-content fetch — only `127.0.0.1` is exempt.

## The one thing none of this buys

Pure-web zero-install `.toe` reading. The container is proprietary compression (three brute-force campaigns, RESEARCH §1); the only paths are reverse-engineering `libUT` (weeks, gray zone, disposable the day Derivative ships their announced JSON format) or waiting for that format. The importer already sits behind a `ProjectLoader` adapter so the official JSON slots in with zero engine changes.
