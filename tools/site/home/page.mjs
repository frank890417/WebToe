// The homepage template — one structure, rendered once per language
// (strings: en.mjs / zh.mjs, which must have the same shape). Everything that
// must not drift between languages lives HERE: section order, ids, links,
// code, the screenshots, the measured numbers' order.
//
// Output is static HTML: crawlers and AI agents read every word without
// running JavaScript. site.js only adds language memory and copy buttons.

import { head, topBar, siteFooter, siteScript, esc, attr } from '../chrome.mjs';
import { SITE, REPO, OAV, AUTHOR, FAMILY_COLORS } from '../config.mjs';
import { DOC_GROUPS, docKey, termBlock } from '../docs.mjs';

const ex = (file) => `app/?project=examples/${file}.webtoe.json`;

/**
 * Every screenshot on the page: site/assets/shots/<name>-{800,1600}.webp, 16:7,
 * made by tools/site/make-shots.mjs. `media`: cropped from docs/media/<name>.png
 * at source offset `y`; `capture`: [example file, toolbar name] captured fresh
 * from the built editor.
 */
export const SHOTS = [
  { name: 'lfo-garden', capture: ['03-lfo-garden.webtoe.json', '03 lfo garden'], keys: ['d'], href: ex('03-lfo-garden') },
  { name: '3d-lines', capture: ['10-3d-lines.webtoe.json', '10 3d lines'], href: ex('10-3d-lines'), strip: true },
  { name: 'showcase', capture: ['09-showcase.webtoe.json', '09 showcase'], pointer: [0.85, 0.55], href: ex('09-showcase'), strip: true },
  { name: 'feedback-trails', media: true, href: ex('02-feedback-trails'), strip: true },
  { name: 'chop-scope', media: true, href: ex('05-chop-playground'), strip: true },
  { name: 'palette', media: true, y: 110, href: 'app/', strip: true },
  { name: 'webgpu', media: true, href: 'app/?backend=webgpu&project=examples/03-lfo-garden.webtoe.json', strip: true },
  { name: 'import-report', media: true },
];
const HERO_SHOT = SHOTS[0];
const STRIP = SHOTS.filter((s) => s.strip);
const IMPORT_SHOT = SHOTS[SHOTS.length - 1];
export const SHOT_NAMES = SHOTS.map((s) => s.name);

const FAMILIES = ['TOP', 'CHOP', 'SOP', 'MAT', 'COMP', 'DAT'];

// ---------- code shown on the page (identical in both languages) ----------
const EXPRESSIONS = `op('lfo1')['chan1']          // a CHOP channel, by name
parent().par.speed * 0.5     // a parameter up the hierarchy
time.seconds * 0.2           // engine time
ext('energy', 0.5)           // a value the host page sends in`;

const CMD_NPX = `npx webtoe        # → http://127.0.0.1:9881/app/`;
const CMD_DEV = `git clone https://github.com/frank890417/WebToe.git
cd WebToe && npm install
npm run dev       # → http://localhost:8643/app/`;

const POST_MESSAGE = `// the host page drives the patch; expressions read ext('energy')
frame.contentWindow.postMessage(
  { type: 'webtoe:ext', values: { energy: 0.8 } }, '*');

// swap the project
frame.contentWindow.postMessage(
  { type: 'webtoe:load', url: 'https://example.com/patch.webtoe.json' }, '*');`;

const DEPS = `apps/web ──▶ @webtoe/editor ──▶ @webtoe/ops ──┐
                       │            │          ├──▶ @webtoe/core
                       ├──▶ @webtoe/gpu ───────┤
                       └──▶ @webtoe/io ────────┘`;

/** Coverage of the 60-project corpus after each measured cycle (docs/ROADMAP.md). */
const COVERAGE = [32.3, 47.1, 62.3];

/** Responsive <img> for a 16:7 screenshot. */
function shot(root, name, alt, { eager = false, sizes = '100vw' } = {}) {
  return `<img src="${root}assets/shots/${name}-1600.webp" srcset="${root}assets/shots/${name}-800.webp 800w, ${root}assets/shots/${name}-1600.webp 1600w" sizes="${sizes}" width="1600" height="700" alt="${attr(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`;
}

/**
 * @param {any} t string table
 * @param {any} c page context (pageCtx('', locale))
 * @param {{ net: string, docs: Record<string, {title: string, description: string}>, stamp: (p: string) => string, vars: Record<string, string|number> }} d
 */
export function renderHome(t, c, d) {
  const root = c.asset('');
  const r = (p) => (p === './' ? root : c.asset(p));
  const sec = (id, eyebrow, title, lede = '') => `
    <header class="sec-head">
      <p class="eyebrow">${eyebrow}</p>
      <h2 id="${id}-title">${title}</h2>
      ${lede ? `<p class="sec-lede">${lede}</p>` : ''}
    </header>`;

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication', '@id': SITE + '#app', name: 'WebToe', url: SITE + 'app/',
        description: t.meta.ld, inLanguage: c.L.ldLanguage,
        applicationCategory: 'MultimediaApplication', applicationSubCategory: 'Node-based visual programming',
        operatingSystem: 'Any (web browser with WebGL2)', browserRequirements: 'Requires WebGL2; WebGPU optional',
        isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://opensource.org/licenses/MIT', image: SITE + 'assets/og.png',
        author: { '@type': 'Person', ...AUTHOR },
      },
      {
        '@type': 'SoftwareSourceCode', name: 'WebToe', codeRepository: REPO, url: c.self,
        description: t.meta.ld, inLanguage: c.L.ldLanguage,
        license: 'https://opensource.org/licenses/MIT', programmingLanguage: ['TypeScript', 'GLSL', 'WGSL'],
        runtimePlatform: 'Web browser', targetProduct: { '@id': SITE + '#app' },
        author: { '@type': 'Person', ...AUTHOR },
        keywords: ['dataflow', 'node-based', 'real-time visuals', 'WebGL2', 'WebGPU', 'TouchDesigner import', 'creative coding'],
      },
      { '@type': 'WebSite', name: 'WebToe', url: c.self, inLanguage: c.L.ldLanguage },
    ],
  };

  const maxCov = 100;
  return `<!DOCTYPE html>
<html lang="${c.L.htmlLang}">
<head>
${head(t, c, { title: t.meta.title, description: t.meta.description, ogDescription: t.meta.ogDescription, ld, shim: true, stamp: d.stamp })}
</head>
<body class="page-home">
${topBar(t, c)}

<main id="main">

  <!-- ═════ hero ═════ -->
  <section class="hero" id="top" aria-labelledby="hero-title">
    <div class="hero-text">
      <h1 id="hero-title"><span class="wordmark">WebToe</span> <span class="h1-sub">${t.hero.sub}</span></h1>
      <p class="lede">${t.hero.lede}</p>
      <div class="ctas">
        <a class="btn btn-primary" href="${r('app/')}">${t.hero.ctaEditor}<span aria-hidden="true">→</span></a>
        <a class="btn" href="${c.to('docs/')}">${t.hero.ctaDocs}</a>
      </div>
      <p class="eyebrow facts">${t.hero.facts}</p>
    </div>
    <figure class="hero-net">
      ${d.net}
      <ul class="legend" aria-label="${attr(t.hero.legendLabel)}">
        ${t.hero.legend.map((l, i) => `<li class="lg lg-${i + 1}">${l}</li>`).join('\n        ')}
      </ul>
      <figcaption><span class="cap-n">03</span> ${t.hero.netCaption} <a href="${r(HERO_SHOT.href)}">${t.hero.netOpen} →</a></figcaption>
    </figure>
    <figure class="hero-shot">
      <a class="shot-frame" href="${r(HERO_SHOT.href)}">${shot(root, HERO_SHOT.name, t.hero.shotAlt, { eager: true, sizes: '(min-width: 1500px) 1440px, 100vw' })}</a>
      <figcaption>${t.hero.shotCaption}</figcaption>
    </figure>
  </section>

  <!-- ═════ screenshots ═════ -->
  <section class="strip" id="shots" aria-labelledby="shots-title">
    <h2 class="strip-title eyebrow" id="shots-title">${t.shots.title}</h2>
    <ol class="shots">
      ${STRIP.map((s, i) => `<li class="shot-card">
        <a class="shot-frame" href="${r(s.href)}">${shot(root, s.name, t.shots.items[i].alt, { sizes: '(min-width: 1080px) 33vw, (min-width: 640px) 50vw, 100vw' })}</a>
        <h3>${t.shots.items[i].title}</h3>
        <p>${t.shots.items[i].text}</p>
      </li>`).join('\n      ')}
    </ol>
  </section>

  <!-- ═════ 01 · import ═════ -->
  <section class="sec" id="toe" aria-labelledby="toe-title">
    ${sec('toe', t.toe.eyebrow, t.toe.title, t.toe.lede)}
    <div class="toe-grid">
      <div class="toe-native">
        <h3>${t.toe.nativeTitle}</h3>
        <p>${t.toe.nativeText}</p>
        <dl class="stats stats-native">
          ${t.toe.nativeStats.map((s) => `<div><dt>${s.label}</dt><dd>${s.value}</dd></div>`).join('\n          ')}
        </dl>
        <p class="research">${t.toe.research}</p>
        <h3>${t.toe.fallbackTitle}</h3>
        <p>${t.toe.fallbackText}</p>
        ${termBlock(CMD_NPX, 'bash', t, 'terminal')}
        <p class="note">${t.toe.fallbackNote}</p>
      </div>
      <div class="toe-measured">
        <h3>${t.toe.measuredTitle}</h3>
        <p class="note">${t.toe.measuredNote}</p>
        <dl class="stats">
          ${t.toe.measured.map((s) => `<div><dt>${s.label}</dt><dd>${s.value}</dd></div>`).join('\n          ')}
        </dl>
        <figure class="toe-shot">
          <div class="shot-frame">${shot(root, IMPORT_SHOT.name, t.toe.shotAlt, { sizes: '(min-width: 1080px) 45vw, 100vw' })}</div>
          <figcaption>${t.toe.shotCaption}</figcaption>
        </figure>
        <p>${t.toe.recovers}</p>
        <p><a class="more" href="${c.to('docs/importing/')}">${t.toe.docsLink} →</a></p>
      </div>
    </div>
  </section>

  <!-- ═════ 02 · dataflow ═════ -->
  <section class="sec" id="how" aria-labelledby="how-title">
    ${sec('how', t.how.eyebrow, t.how.title, t.how.lede)}
    <ul class="families">
      ${FAMILIES.map((f, i) => `<li class="family" style="--c:${FAMILY_COLORS[f]}">
        <p class="fam-head"><span class="fam-name">${f}</span><span class="fam-count">${d.vars[f]}</span></p>
        <p>${t.how.families[i]}</p>
      </li>`).join('\n      ')}
    </ul>
    <p class="note fam-note">${t.how.familiesNote} <a href="${c.to('docs/operators/')}">${t.how.opsLink} →</a></p>
    <div class="how-grid">
      <div>
        <h3>${t.how.exprTitle}</h3>
        <p>${t.how.exprText}</p>
        <p><a class="more" href="${c.to('docs/expressions/')}">${t.how.exprLink} →</a></p>
      </div>
      ${termBlock(EXPRESSIONS, 'js', t, 'expressions')}
    </div>
  </section>

  <!-- ═════ 03 · parity ═════ -->
  <section class="sec" id="parity" aria-labelledby="parity-title">
    ${sec('parity', t.parity.eyebrow, t.parity.title, t.parity.lede)}
    <div class="parity-grid">
      <figure class="coverage">
        <figcaption>${t.parity.chartTitle}</figcaption>
        <ol class="bars">
          ${COVERAGE.map((v, i) => `<li style="--v:${(v / maxCov).toFixed(3)}"><span class="bar-label"><b>${t.parity.stages[i].name}</b> ${t.parity.stages[i].text}</span><span class="bar"><i></i></span><span class="bar-v">${v.toFixed(1)}%</span></li>`).join('\n          ')}
        </ol>
        <p class="note">${t.parity.chartNote}</p>
      </figure>
      <dl class="stats stats-parity">
        ${t.parity.facts.map((s) => `<div><dt>${s.label}</dt><dd>${s.value}</dd></div>`).join('\n        ')}
      </dl>
    </div>
    <div class="parity-next">
      <h3>${t.parity.nextTitle}</h3>
      <ol class="next">
        ${t.parity.next.map((n) => `<li>${n}</li>`).join('\n        ')}
      </ol>
      <p class="note">${t.parity.boundary}</p>
      <p><a class="more" href="${c.to('docs/td-parity/')}">${t.parity.link} →</a></p>
    </div>
  </section>

  <!-- ═════ 04 · engine ═════ -->
  <section class="sec" id="engine" aria-labelledby="engine-title">
    ${sec('engine', t.engine.eyebrow, t.engine.title, t.engine.lede)}
    <dl class="facts-grid">
      ${t.engine.facts.map((f) => `<div><dt>${f.title}</dt><dd>${f.text}</dd></div>`).join('\n      ')}
    </dl>
    <figure class="deps">
      <pre class="diagram" aria-label="${attr(t.engine.depsLabel)}">${esc(DEPS)}</pre>
      <figcaption>${t.engine.depsCaption} <a class="more" href="${c.to('docs/architecture/')}">${t.engine.archLink} →</a></figcaption>
    </figure>
  </section>

  <!-- ═════ 05 · engine ↔ show ═════ -->
  <section class="sec" id="oav" aria-labelledby="oav-title">
    ${sec('oav', t.oav.eyebrow, t.oav.title)}
    <div class="oav-grid">
      <div class="prose-lg">
        <p>${t.oav.p1}</p>
        <p>${t.oav.p2}</p>
        <p class="links"><a class="more" href="${OAV}">openaudiovisual.com ↗</a> <a class="more" href="${c.to('docs/embedding/')}">${t.oav.docsLink} →</a></p>
      </div>
      ${termBlock(POST_MESSAGE, 'js', t, 'host page')}
    </div>
  </section>

  <!-- ═════ 06 · start ═════ -->
  <section class="sec" id="start" aria-labelledby="start-title">
    ${sec('start', t.start.eyebrow, t.start.title)}
    <ol class="ways">
      <li class="way">
        <h3>${t.start.browserTitle}</h3>
        <p>${t.start.browserText}</p>
        <p><a class="btn btn-primary" href="${r('app/')}">${t.hero.ctaEditor}<span aria-hidden="true">→</span></a></p>
      </li>
      <li class="way">
        <h3>${t.start.localTitle}</h3>
        <p>${t.start.localText}</p>
        ${termBlock(CMD_NPX, 'bash', t, 'terminal')}
      </li>
      <li class="way">
        <h3>${t.start.sourceTitle}</h3>
        <p>${t.start.sourceText}</p>
        ${termBlock(CMD_DEV, 'bash', t, 'terminal')}
      </li>
    </ol>
    <h3 class="docs-title">${t.start.docsTitle}</h3>
    <ul class="doc-list">
      ${DOC_GROUPS.flatMap((g) => g.pages).map((s) => `<li><a href="${c.to(docKey(s))}">${esc(d.docs[s].title)}</a><span>${esc(d.docs[s].description)}</span></li>`).join('\n      ')}
    </ul>
  </section>

</main>

${siteFooter(t, c)}
${siteScript(c, d.stamp)}
</body>
</html>
`;
}

