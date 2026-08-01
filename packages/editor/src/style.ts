/** Editor styles, injected once — keeps the editor embeddable with no CSS pipeline. */

export const FAMILY_COLORS: Record<string, string> = {
  TOP: '#7c6cff',
  CHOP: '#4fb286',
  COMP: '#8a8a93',
  DAT: '#d2699e',
  SOP: '#5e8bb8',
  MAT: '#c9a84c',
};

const CSS = `
.wt-root { position: relative; width: 100%; height: 100%; display: grid;
  grid-template-rows: 40px 1fr; grid-template-columns: 1fr 400px;
  grid-template-areas: "bar bar" "net side";
  background: #141417; color: #d6d6dc; overflow: hidden;
  font: 13px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; }
.wt-root *, .wt-root *::before, .wt-root *::after { box-sizing: border-box; }

.wt-bar { grid-area: bar; display: flex; align-items: center; gap: 8px; padding: 0 10px;
  background: #1d1d22; border-bottom: 1px solid #2c2c33; z-index: 30; }
.wt-bar .wt-title { font-weight: 600; letter-spacing: 0.4px; color: #fff; margin-right: 4px; }
.wt-bar input.wt-projname { background: #26262d; border: 1px solid #34343c; color: #d6d6dc;
  border-radius: 5px; padding: 3px 8px; width: 150px; }
.wt-bar button, .wt-bar select, .wt-bar label.wt-filebtn { background: #2a2a31; color: #cfcfd6;
  border: 1px solid #3a3a44; border-radius: 5px; padding: 4px 10px; cursor: pointer; font: inherit; }
.wt-bar button:hover, .wt-bar label.wt-filebtn:hover { background: #34343d; }
.wt-bar .wt-spacer { flex: 1; }
.wt-bar .wt-hud { color: #8a8a93; font-family: ui-monospace, monospace; font-size: 11px; }
.wt-bar a.wt-repo { color: #9a9aa3; display: inline-flex; align-items: center; padding: 4px; border-radius: 5px; }
.wt-bar a.wt-repo:hover { color: #fff; background: #2a2a31; }

.wt-net { grid-area: net; position: relative; overflow: hidden; outline: none;
  background:
    radial-gradient(circle at 1px 1px, #232329 1px, transparent 1.5px) 0 0 / 28px 28px,
    #17171b; }
.wt-crumb { position: absolute; left: 10px; top: 8px; z-index: 20; color: #9a9aa3;
  font-family: ui-monospace, monospace; font-size: 12px; user-select: none; }
.wt-crumb span { cursor: pointer; }
.wt-crumb span:hover { color: #fff; text-decoration: underline; }
.wt-hint { position: absolute; right: 12px; top: 8px; z-index: 20; color: #6a6a73; font-size: 11px; user-select: none; }

.wt-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; z-index: 1; }
.wt-backdrop { position: absolute; inset: 0; width: 100%; height: 100%;
  z-index: 0; pointer-events: none; }
.wt-wires { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.wt-wires path { fill: none; stroke: #8f8f9a; stroke-width: 1.6; opacity: 0.85; }
.wt-wires path.wt-preview { stroke: #ffd166; stroke-dasharray: 5 4; }

.wt-node { position: absolute; width: 132px; background: #232329; border: 1px solid #3a3a44;
  border-radius: 7px; user-select: none; cursor: grab; }
.wt-node.wt-selected { border-color: #ffd166; box-shadow: 0 0 0 1px #ffd166; }
.wt-node .wt-fam { position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  border-radius: 7px 0 0 7px; }
.wt-node .wt-thumb { margin: 5px 6px 0 10px; height: 64px; background: #101013;
  border-radius: 4px; overflow: hidden; display: none; }
.wt-node.wt-has-thumb .wt-thumb { display: block; }
.wt-compositor { position: absolute; inset: 0; width: 100%; height: 100%;
  pointer-events: none; z-index: 5; }
.wt-node .wt-label { padding: 4px 8px 1px 12px; font-weight: 600; color: #fff;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wt-node .wt-typ { padding: 0 8px 5px 12px; color: #84848d; font-size: 11px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wt-node .wt-err { position: absolute; right: 5px; top: 4px; width: 9px; height: 9px;
  border-radius: 50%; background: #e24b4a; display: none; }
.wt-node.wt-haserr .wt-err { display: block; }
.wt-node .wt-flag { position: absolute; right: 5px; bottom: 5px; width: 10px; height: 10px;
  border-radius: 50%; border: 1.5px solid #6a6a73; }
.wt-node.wt-display .wt-flag { background: #ffd166; border-color: #ffd166; }

.wt-stub { position: absolute; width: 12px; height: 12px; border-radius: 50%;
  background: #55555f; border: 2px solid #17171b; cursor: crosshair; z-index: 5; }
.wt-stub:hover { background: #ffd166; }
.wt-stub.wt-out { right: -7px; top: 50%; margin-top: -6px; }
.wt-stub.wt-in { left: -7px; }

.wt-side { grid-area: side; display: grid; grid-template-rows: auto 1fr; min-height: 0;
  border-left: 1px solid #2c2c33; background: #1a1a1f; }
.wt-viewer { position: relative; background: #101013; aspect-ratio: 16/9; border-bottom: 1px solid #2c2c33; }
.wt-viewer canvas.wt-gl { position: absolute; inset: 0; width: 100%; height: 100%; }
.wt-viewer canvas.wt-scope { position: absolute; inset: 0; width: 100%; height: 100%; }
.wt-viewer pre.wt-dattext { position: absolute; inset: 0; margin: 0; padding: 10px; overflow: auto;
  font: 11px ui-monospace, monospace; color: #c5e1a5; }
.wt-viewer .wt-viewname { position: absolute; left: 8px; bottom: 6px; color: #9a9aa3;
  font: 11px ui-monospace, monospace; pointer-events: none; }

.wt-params { overflow-y: auto; min-height: 0; padding-bottom: 30px; }
.wt-params .wt-phead { padding: 9px 12px 7px; border-bottom: 1px solid #2c2c33;
  display: flex; align-items: center; gap: 8px; position: sticky; top: 0; background: #1a1a1f; z-index: 2; }
.wt-params .wt-phead .wt-pname { font-weight: 700; color: #fff; }
.wt-params .wt-phead .wt-ptype { color: #84848d; font-size: 11px; }
.wt-params .wt-phead .wt-perr { color: #e24b4a; font-size: 11px; margin-left: auto;
  max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wt-ppage { padding: 9px 12px 3px; color: #6a6a73; font-size: 10px; text-transform: uppercase;
  letter-spacing: 1.2px; border-top: 1px solid #232329; margin-top: 5px; }
.wt-prow { display: grid; grid-template-columns: 96px 1fr 26px; gap: 6px; align-items: center;
  padding: 4px 12px; }
.wt-prow:hover { background: #1f1f25; }
.wt-prow .wt-plabel { color: #a9a9b2; font-size: 12px; white-space: nowrap; overflow: hidden; }
.wt-prow input[type="text"], .wt-prow input[type="number"], .wt-prow select {
  width: 100%; background: #26262d; border: 1px solid #34343c; color: #e6e6ec;
  border-radius: 4px; padding: 2px 6px; font: 12px ui-monospace, monospace; }
.wt-prow input.wt-exprfield { color: #ffd166; }
.wt-prow input.wt-exprfield.wt-badexpr { color: #e24b4a; border-color: #e24b4a; }
.wt-prow .wt-sliderwrap { display: flex; gap: 6px; align-items: center; }
.wt-prow input[type="range"] { flex: 1; accent-color: #7c6cff; }
.wt-prow input.wt-num { width: 64px; flex: none; }
.wt-prow .wt-exprbtn { width: 24px; height: 22px; border-radius: 4px; border: 1px solid #34343c;
  background: #26262d; color: #84848d; cursor: pointer; font: 11px ui-monospace, monospace; }
.wt-prow .wt-exprbtn.wt-on { color: #ffd166; border-color: #ffd166; }
.wt-prow .wt-colorrow { display: flex; gap: 4px; }
.wt-prow .wt-colorrow input[type="number"] { width: 0; flex: 1; }
.wt-prow .wt-swatch { width: 22px; height: 22px; border-radius: 4px; border: 1px solid #34343c; flex: none; }

.wt-palette { position: absolute; z-index: 50; width: 552px; max-height: 410px; background: #202027;
  border: 1px solid #3a3a44; border-radius: 10px; box-shadow: 0 12px 36px rgba(0,0,0,0.55);
  display: flex; flex-direction: column; overflow: hidden; }
.wt-palette .wt-phead2 { display: flex; align-items: center; gap: 10px; padding: 9px 12px 4px; }
.wt-palette .wt-ptitle { color: #8a8a93; font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; }
.wt-palette input { flex: 1; padding: 6px 9px; background: #17171b; color: #fff;
  border: 1px solid #34343c; border-radius: 6px; font: inherit; }
.wt-palette .wt-ptabs { display: flex; gap: 2px; padding: 6px 12px 0; border-bottom: 1px solid #2c2c33; }
.wt-palette .wt-ptabs button { background: transparent; color: #9a9aa3; border: none;
  border-bottom: 2px solid transparent; padding: 5px 14px 7px; cursor: pointer; font: inherit;
  font-weight: 600; letter-spacing: 0.4px; }
.wt-palette .wt-ptabs button:hover { color: #fff; }
.wt-palette .wt-ptabs button.wt-on { color: #fff; border-bottom-color: var(--fam); }
.wt-palette .wt-pgrid { overflow-y: auto; padding: 8px 10px 12px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px 8px; align-content: start; }
.wt-palette .wt-pitem { padding: 5px 9px; cursor: pointer; display: flex; gap: 8px;
  align-items: center; border-radius: 5px; min-width: 0; }
.wt-palette .wt-pitem span:nth-child(2) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wt-palette .wt-pitem .wt-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.wt-palette .wt-pitem .wt-pfam { margin-left: auto; color: #6a6a73; font-size: 10px; }
.wt-palette .wt-pitem.wt-active, .wt-palette .wt-pitem:hover { background: #2e2e37; }

.wt-toast { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
  background: #26262d; border: 1px solid #3a3a44; color: #d6d6dc; padding: 8px 14px;
  border-radius: 7px; z-index: 60; font-size: 12px; max-width: 70%; }
`;

let injected = false;

export function injectStyles(): void {
  if (injected) return;
  const el = document.createElement('style');
  el.dataset.webtoe = 'editor';
  el.textContent = CSS;
  document.head.appendChild(el);
  injected = true;
}
