#!/usr/bin/env python3
"""webtoe bridge — single-file Python edition, for TouchDesigner users without Node.

Every TouchDesigner install ships a Python interpreter, so this needs nothing
beyond what a TD user already has:

  macOS:    python3 bridge.py            (any Python 3.8+; TD's bundled one works:
            "/Applications/TouchDesigner.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3")
  Windows:  "C:\\Program Files\\Derivative\\TouchDesigner\\bin\\python.exe" bridge.py

Then open https://frank890417.github.io/WebToe/ and drop a .toe on the page.

Protocol-identical to the Node bridge (`npx webtoe`): GET /health, POST
/expand?name=…, same JSON shape, same CORS + Private-Network-Access headers.
Standard library only. Binds 127.0.0.1 unless --host says otherwise; pair a
non-loopback bind with --token. Ships nothing of Derivative's — it only runs
the toeexpand you already have. Uploads are expanded in a temp dir and deleted.
"""
import argparse
import base64
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "0.1.0-py"
MAX_UPLOAD = 512 * 1024 * 1024
MAX_FILE = 8 * 1024 * 1024
MAX_BINARY = 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_CONCURRENT = 3

_active = 0
_active_lock = threading.Lock()


def find_toeexpand(explicit=None):
    if explicit:
        return explicit if os.path.exists(explicit) else None
    env = os.environ.get("WEBTOE_TOEEXPAND")
    if env and os.path.exists(env):
        return env
    patterns = [
        "/Applications/TouchDesigner*.app/Contents/MacOS/toeexpand",
        "/Applications/TouchDesigner/TouchDesigner*.app/Contents/MacOS/toeexpand",
        os.path.expanduser("~/Applications/TouchDesigner*.app/Contents/MacOS/toeexpand"),
        "C:/Program Files/Derivative/TouchDesigner*/bin/toeexpand.exe",
        "C:/Program Files (x86)/Derivative/TouchDesigner*/bin/toeexpand.exe",
    ]
    hits = []
    for p in patterns:
        hits.extend(glob.glob(p))
    hits = [h for h in hits if os.path.exists(h)]
    return sorted(hits)[-1] if hits else None


def td_build(tool_path):
    m = re.search(r"TouchDesigner[ _]?([0-9]{4}\.[0-9]+)", tool_path or "", re.I)
    return f"TouchDesigner {m.group(1)}" if m else None


def expand_toe(src_path, name, toeexpand):
    """Mirror of packages/bridge/expand.mjs — keep behaviors in sync."""
    started = time.time()
    work = tempfile.mkdtemp(prefix="webtoe-expand-")
    try:
        # ASCII staging name: toeexpand reads paths as Latin-1 and fails on
        # anything else — every non-English project name would break.
        ext = ".tox" if name.lower().endswith(".tox") else ".toe"
        staged = os.path.join(work, "input" + ext)
        shutil.copyfile(src_path, staged)
        try:
            # exits non-zero on success — only the output dir matters
            subprocess.run([toeexpand, staged], cwd=work, timeout=180,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"toeexpand timed out on {name}")
        out_dir = staged + ".dir"
        if not os.path.isdir(out_dir):
            raise RuntimeError(
                f"toeexpand produced no expansion for {name} — is the file a valid TouchDesigner project?")
        files, skipped, total = [], [], 0
        for root, _dirs, names in os.walk(out_dir):
            for fn in names:
                abs_p = os.path.join(root, fn)
                rel = os.path.relpath(abs_p, out_dir).replace(os.sep, "/")
                size = os.path.getsize(abs_p)
                if size > MAX_FILE:
                    skipped.append({"path": rel, "reason": "too large", "size": size})
                    continue
                if total + size > MAX_TOTAL:
                    skipped.append({"path": rel, "reason": "budget exceeded", "size": size})
                    continue
                with open(abs_p, "rb") as fh:
                    buf = fh.read()
                if b"\0" not in buf:
                    files.append({"path": rel, "text": buf.decode("utf-8", "replace")})
                elif size <= MAX_BINARY:
                    # framed .text/.table sidecars must reach the importer as
                    # bytes (decoded there); larger binaries are payload data
                    files.append({"path": rel, "b64": base64.b64encode(buf).decode("ascii")})
                else:
                    skipped.append({"path": rel, "reason": "binary", "size": size})
                    continue
                total += size
        return {"name": name, "files": files, "skipped": skipped, "bytes": total,
                "toeexpand": toeexpand, "ms": int((time.time() - started) * 1000)}
    finally:
        shutil.rmtree(work, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "webtoe-bridge-py/" + VERSION
    args = None  # set in main()

    def log_message(self, fmt, *a):  # quiet
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, code, body):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path == "/health":
            tool = find_toeexpand(self.args.toeexpand)
            self._json(200, {"ok": True, "service": "webtoe-bridge", "version": VERSION,
                             "toeexpand": tool, "tdBuild": td_build(tool) if tool else None,
                             "app": False, "tokenRequired": bool(self.args.token)})
        else:
            self._json(404, {"ok": False, "error": "not found (this bridge serves no app — use the hosted page)"})

    def do_POST(self):
        global _active
        split = urllib.parse.urlsplit(self.path)
        if split.path != "/expand":
            self._json(404, {"ok": False, "error": "not found"})
            return
        if self.args.token:
            if self.headers.get("Authorization", "") != f"Bearer {self.args.token}":
                self._json(401, {"ok": False, "error": "this bridge requires a token — open the app with ?bridgeToken=<token> once"})
                return
        with _active_lock:
            if _active >= MAX_CONCURRENT:
                self._json(429, {"ok": False, "error": "bridge is busy — try again in a moment"})
                return
            _active += 1
        tmp = None
        try:
            q = urllib.parse.parse_qs(split.query)
            raw_name = (q.get("name", ["project.toe"])[0]).split("/")[-1].split("\\")[-1]
            name = re.sub(r"[^\w.\-@ ()\u4e00-\u9fff]", "_", raw_name)
            if not re.search(r"\.(toe|tox)$", name, re.I):
                self._json(400, {"ok": False, "error": "name must end in .toe or .tox"})
                return
            tool = find_toeexpand(self.args.toeexpand)
            if not tool:
                self._json(501, {"ok": False, "error": "toeexpand not found — install TouchDesigner, or pass --toeexpand", "code": "NO_TOEEXPAND"})
                return
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > MAX_UPLOAD:
                self._json(400, {"ok": False, "error": "missing or oversized upload"})
                return
            fd, tmp = tempfile.mkstemp(prefix="webtoe-upload-", suffix=".toe")
            with os.fdopen(fd, "wb") as fh:
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    fh.write(chunk)
                    remaining -= len(chunk)
            out = expand_toe(tmp, name, tool)
            self._json(200, {"ok": True, **out})
        except Exception as e:  # noqa: BLE001 — everything becomes an honest JSON error
            self._json(500, {"ok": False, "error": str(e)})
        finally:
            with _active_lock:
                _active -= 1
            if tmp:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass


def main():
    ap = argparse.ArgumentParser(description="webtoe bridge (Python edition)")
    ap.add_argument("--port", type=int, default=int(os.environ.get("WEBTOE_BRIDGE_PORT", 9881)))
    ap.add_argument("--host", default=os.environ.get("WEBTOE_HOST", "127.0.0.1"))
    ap.add_argument("--token", default=os.environ.get("WEBTOE_TOKEN"))
    ap.add_argument("--toeexpand", default=None)
    args = ap.parse_args()
    Handler.args = args

    tool = find_toeexpand(args.toeexpand)
    loopback = args.host in ("127.0.0.1", "localhost", "::1")
    print(f"webtoe bridge (python) {VERSION} → http://{'127.0.0.1' if loopback else args.host}:{args.port}")
    print(f"  toeexpand: {tool}" if tool else "  toeexpand: NOT FOUND — install TouchDesigner, or pass --toeexpand <path>")
    print("  now open https://frank890417.github.io/WebToe/ and drop a .toe on the page")
    if not loopback and not args.token:
        print("  ⚠️  bound beyond loopback with NO --token: anyone who can reach this port can run")
        print("     your toeexpand on files they upload.")
    try:
        ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    except OSError as e:
        print(f"port {args.port} is busy — another bridge is probably already running" if e.errno in (48, 98) else str(e))
        sys.exit(1)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
