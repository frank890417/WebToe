import { initVideoKernelsWasm, registerAllOps } from '@webtoe/ops';
import { mountEditor } from '@webtoe/editor';

registerAllOps();

const base = import.meta.env.BASE_URL;
void initVideoKernelsWasm(`${base}wasm/video-kernels.wasm`).then((mode) => {
  console.log(`[webtoe] video kernels: ${mode}`);
});

document.body.style.margin = '0';
const app = document.getElementById('app')!;
app.style.cssText = 'position:fixed;inset:0;';


const editorPromise = mountEditor(app, {
  examples: [
    { name: '01 hello noise', url: `${base}examples/01-hello-noise.webtoe.json` },
    { name: '02 feedback trails', url: `${base}examples/02-feedback-trails.webtoe.json` },
    { name: '03 lfo garden', url: `${base}examples/03-lfo-garden.webtoe.json` },
    { name: '04 webcam displace', url: `${base}examples/04-webcam-displace.webtoe.json` },
    { name: '05 chop playground', url: `${base}examples/05-chop-playground.webtoe.json` },
    { name: '06 sketch: voronoi (2022, imported)', url: `${base}examples/06-sketch-voronoi.webtoe.json` },
    { name: '07 sketch: fractals (2022, imported)', url: `${base}examples/07-sketch-fractals.webtoe.json` },
    { name: '08 sketch: chop study (2022, imported)', url: `${base}examples/08-sketch-chop-study.webtoe.json` },
    { name: '09 showcase (camera + everything)', url: `${base}examples/09-showcase.webtoe.json` },
    { name: '10 3d lines (SOPs + render)', url: `${base}examples/10-3d-lines.webtoe.json` },
  ],
});

// external control bridge — a host page (e.g. the open-audiovisual show
// chassis) embeds this app in an iframe and drives patch expressions that
// read ext('name'). Values are plain numbers; shape-checked, origin-agnostic
// (same trust model as user-authored patches: numbers into expressions).
import { setExternals } from '@webtoe/core';
window.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as { type?: string; values?: Record<string, unknown>; url?: string };
  if (m?.type === 'webtoe:ext' && m.values && typeof m.values === 'object') {
    const clean: Record<string, number> = {};
    for (const k of Object.keys(m.values)) {
      const v = m.values[k];
      if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
    }
    setExternals(clean);
  }
  if (m?.type === 'webtoe:load' && typeof m.url === 'string') {
    const url = m.url;                       // narrow before the async hop
    void editorPromise.then((ed) => ed.loadUrl(url));
  }
});

// ?project=<url> — load a project straight from a link (CORS permitting)
const projectUrl = new URLSearchParams(location.search).get('project');
if (projectUrl) {
  void editorPromise.then((ed) => ed.loadUrl(projectUrl));
}

// debug/testing handle
void editorPromise.then((editor) => {
  (window as unknown as { __webtoe: unknown }).__webtoe = editor;
});
