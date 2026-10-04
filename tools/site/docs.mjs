// Documentation pages: Markdown sources in site/docs/<lang>/<slug>.md, one
// template, the same nav in both languages. Every slug must exist in every
// language (the build refuses otherwise; Chinese may be shorter).

import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown, frontMatter, highlight, esc, attr } from './md.mjs';
import { head, topBar, siteFooter, siteScript } from './chrome.mjs';
import { SITE, BLOB, FAMILY_COLORS } from './config.mjs';

/** Nav order. Group labels live in the string tables (t.docs.groups). */
export const DOC_GROUPS = [
  { key: 'start', pages: ['getting-started', 'examples'] },
  { key: 'import', pages: ['importing', 'toe-format'] },
  { key: 'build', pages: ['operators', 'expressions'] },
  { key: 'integrate', pages: ['embedding', 'ndi'] },
  { key: 'engine', pages: ['architecture', 'td-parity'] },
];
export const DOC_SLUGS = DOC_GROUPS.flatMap((g) => g.pages);
export const DOC_LANGS = ['en', 'zh'];

/** Official operator counts per family: docs.derivative.ca categories, crawled 2026-06-11 (docs/TD-PARITY.md). */
export const OFFICIAL_OPS = { TOP: '~147', CHOP: '172', SOP: '115', MAT: '13', COMP: '45', DAT: '77', POP: '106' };

/** Read and parse every docs source. Returns { docs: {en: {slug: doc}}, errors } */
export function loadDocs(root) {
  const docs = {}, errors = [];
  for (const lang of DOC_LANGS) {
    docs[lang] = {};
    const dir = path.join(root, 'site/docs', lang);
    const present = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [];
    for (const slug of ['index', ...DOC_SLUGS]) {
      const file = path.join(dir, slug + '.md');
      if (!fs.existsSync(file)) { errors.push(`site/docs/${lang}/${slug}.md is missing`); continue; }
      const { data, body } = frontMatter(fs.readFileSync(file, 'utf8'));
      if (!data.title) errors.push(`site/docs/${lang}/${slug}.md has no title in its front matter`);
      if (!data.description) errors.push(`site/docs/${lang}/${slug}.md has no description in its front matter`);
      docs[lang][slug] = { slug, lang, title: data.title ?? slug, description: data.description ?? '', body, source: `site/docs/${lang}/${slug}.md` };
    }
    for (const extra of present) if (extra !== 'index' && !DOC_SLUGS.includes(extra)) errors.push(`site/docs/${lang}/${extra}.md is not in DOC_GROUPS (tools/site/docs.mjs)`);
  }
  return { docs, errors };
}

export const docKey = (slug) => (slug === 'index' ? 'docs/' : `docs/${slug}/`);

/** Resolve an authored href (relative to the docs tree) into this page's output href. */
export function docLink(c) {
  return (href) => {
    if (/^(https?:|mailto:|#|data:)/.test(href)) return href;
    const md = href.match(/^([\w-]+)\.md(#.*)?$/);
    if (md) return c.to(docKey(md[1]), md[2] ?? '');
    if (href.startsWith('/')) {
      const [p, rest = ''] = href.slice(1).split(/(?=[?#])/);
      if (p === '') return c.to('', rest);
      if (p.startsWith('docs/')) return c.to(p, rest);
      return c.asset(p) + rest;
    }
    return href;
  };
}

/** A fenced code block: labelled bar + copy button (the button works with site.js). */
export function termBlock(code, lang, t, label = lang) {
  return `<div class="term"><div class="term-bar"><span>${esc(label || 'text')}</span><button type="button" class="copy" data-copy>${t.ui.copy}</button></div><pre><code>${highlight(code, lang)}</code></pre></div>`;
}

/** Directives available to docs Markdown (`<!-- NAME -->` alone on a line). */
export function docDirectives(t, data) {
  return {
    'OPS-TABLE': () => `<div class="table"><table class="ops-table">
<thead><tr><th>${t.docs.opsFamily}</th><th style="text-align:right">${t.docs.opsCount}</th><th>${t.docs.opsList}</th></tr></thead>
<tbody>
${data.ops.map((f) => `<tr><td><span class="fam" style="--c:${FAMILY_COLORS[f.family] ?? '#8a8a93'}">${f.family}</span></td><td style="text-align:right">${f.ops.length}</td><td>${f.ops.map((o) => `<code title="${attr(o.type)}">${esc(o.label)}</code>`).join(' ')}</td></tr>`).join('\n')}
<tr class="total"><td>${t.docs.opsTotal}</td><td style="text-align:right">${data.counts.total}</td><td></td></tr>
</tbody></table></div>`,
    'OPS-TOTAL': () => `<p class="note">${t.docs.opsSource}</p>`,
    'PARITY-TABLE': () => `<div class="table"><table class="parity-table">
<thead><tr><th>${t.docs.opsFamily}</th><th style="text-align:right">${t.docs.parityOfficial}</th><th style="text-align:right">WebToe</th><th>${t.docs.parityNote}</th></tr></thead>
<tbody>
${Object.entries(OFFICIAL_OPS).map(([fam, n]) => `<tr><td><span class="fam" style="--c:${FAMILY_COLORS[fam] ?? '#8a8a93'}">${fam}</span></td><td style="text-align:right">${n}</td><td style="text-align:right">${data.counts[fam] ?? 0}</td><td>${fam === 'POP' ? t.docs.parityPop : ''}</td></tr>`).join('\n')}
<tr class="total"><td>${t.docs.opsTotal}</td><td style="text-align:right">~675</td><td style="text-align:right">${data.counts.total}</td><td></td></tr>
</tbody></table></div>`,
  };
}

function navHtml(t, c, docs, current) {
  return DOC_GROUPS.map((g) => `<div class="nav-group"><p class="nav-head">${t.docs.groups[g.key]}</p><ul>
${g.pages.map((s) => `<li><a href="${c.to(docKey(s))}"${s === current ? ' aria-current="page"' : ''}>${esc(docs[s].title)}</a></li>`).join('\n')}
</ul></div>`).join('\n');
}

function ldFor(t, c, doc) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'TechArticle', headline: doc.title, description: doc.description, inLanguage: c.L.ldLanguage, url: c.self,
        image: SITE + 'assets/og.png', isPartOf: { '@type': 'WebSite', name: 'WebToe', url: SITE },
        about: { '@type': 'SoftwareApplication', name: 'WebToe', url: SITE + 'app/' } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'WebToe', item: c.url[c.locale].replace(/docs\/.*$/, '') },
        { '@type': 'ListItem', position: 2, name: t.docs.title, item: c.url[c.locale].replace(/docs\/.*$/, 'docs/') },
        ...(doc.slug === 'index' ? [] : [{ '@type': 'ListItem', position: 3, name: doc.title, item: c.self }]),
      ] },
    ],
  };
}

/**
 * Render one docs page (or the docs home when doc.slug === 'index').
 * @returns {string} HTML
 */
export function renderDocPage(t, c, docs, doc, data, stamp) {
  const { html, headings } = renderMarkdown(doc.body, {
    link: docLink(c),
    directives: docDirectives(t, data),
    codeBlock: (code, lang) => termBlock(code, lang, t),
  });
  const i = DOC_SLUGS.indexOf(doc.slug);
  const prev = i > 0 ? DOC_SLUGS[i - 1] : doc.slug === 'index' ? null : 'index';
  const next = i >= 0 && i < DOC_SLUGS.length - 1 ? DOC_SLUGS[i + 1] : doc.slug === 'index' ? DOC_SLUGS[0] : null;
  const group = DOC_GROUPS.find((g) => g.pages.includes(doc.slug));
  const toc = headings.filter((h) => h.level === 2);
  const isIndex = doc.slug === 'index';

  const indexCards = isIndex ? `<div class="doc-cards">
${DOC_GROUPS.map((g) => `<section class="doc-card-group" aria-labelledby="g-${g.key}"><h2 id="g-${g.key}">${t.docs.groups[g.key]}</h2><ul>
${g.pages.map((s) => `<li><a href="${c.to(docKey(s))}"><span class="dc-title">${esc(docs[s].title)}</span><span class="dc-desc">${esc(docs[s].description)}</span></a></li>`).join('\n')}
</ul></section>`).join('\n')}
</div>` : '';

  const pager = (s, dir) => s ? `<a class="pg pg-${dir}" href="${c.to(docKey(s))}" rel="${dir}"><span>${dir === 'prev' ? t.docs.prev : t.docs.next}</span><b>${esc(docs[s].title)}</b></a>` : '<span></span>';

  return `<!DOCTYPE html>
<html lang="${c.L.htmlLang}">
<head>
${head(t, c, { title: isIndex ? `${t.docs.title} · WebToe` : `${doc.title} · ${t.docs.title} · WebToe`, description: doc.description, ld: ldFor(t, c, doc), stamp })}
</head>
<body class="page-docs">
${topBar(t, c)}

<div class="docs">
  <aside class="docs-side" aria-label="${attr(t.docs.navLabel)}">
    <a class="docs-home" href="${c.to('docs/')}"${isIndex ? ' aria-current="page"' : ''}>${t.docs.title}</a>
    <nav class="docs-nav">
${navHtml(t, c, docs, doc.slug)}
    </nav>
  </aside>

  <main id="main" class="doc">
    <details class="docs-menu">
      <summary>${t.docs.menu}${isIndex ? '' : ` <span>· ${esc(doc.title)}</span>`}</summary>
      <a class="docs-home" href="${c.to('docs/')}"${isIndex ? ' aria-current="page"' : ''}>${t.docs.title}</a>
      <nav class="docs-nav">
${navHtml(t, c, docs, doc.slug)}
      </nav>
    </details>
    <p class="crumbs"><a href="${c.to('')}">WebToe</a> <span aria-hidden="true">/</span> ${isIndex ? t.docs.title : `<a href="${c.to('docs/')}">${t.docs.title}</a> <span aria-hidden="true">/</span> ${t.docs.groups[group.key]}`}</p>
    <h1>${esc(isIndex ? t.docs.title : doc.title)}</h1>
    <p class="doc-lede">${esc(doc.description)}</p>
    <div class="prose">
${html}
    </div>
${indexCards}
    <nav class="pager" aria-label="${attr(t.docs.pagerLabel)}">${pager(prev, 'prev')}${pager(next, 'next')}</nav>
    <p class="doc-meta"><a href="${BLOB}${doc.source}">${t.docs.edit}</a></p>
  </main>

  ${toc.length > 1 ? `<nav class="toc" aria-label="${attr(t.docs.toc)}"><p>${t.docs.toc}</p><ul>
${toc.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('\n')}
</ul></nav>` : '<div class="toc" aria-hidden="true"></div>'}
</div>

${siteFooter(t, c)}
${siteScript(c, stamp)}
</body>
</html>
`;
}
