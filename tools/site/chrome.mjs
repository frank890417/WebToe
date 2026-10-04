// The frame every page of the site shares: <head> (SEO, social, favicon,
// analytics), the top bar, the footer. One copy, so the homepage and the docs
// never drift — and the editor at /app/ gets its head from here too
// (editorHead, injected by apps/web/vite.config.ts).
//
//   const c = pageCtx('docs/operators/', 'zh');   // urls + relative hrefs for this page
//   `${head(t, c, { title, description, ld })} … ${topBar(t, c)} … ${siteFooter(t, c)}`
//
// Page keys are paths below the site root without the language prefix:
// '' (home), 'docs/', 'docs/<slug>/'. Chinese lives under zh/.

import { SITE, REPO, OAV, INK, ACCENT } from './config.mjs';
import { analyticsSnippet } from './analytics.mjs';
import { shimScript } from './shim.mjs';
import { esc, attr } from './md.mjs';

export { esc, attr };

export const LOCALES = {
  en: { prefix: '', htmlLang: 'en', hreflang: 'en', ogLocale: 'en_US', ldLanguage: 'en' },
  zh: { prefix: 'zh/', htmlLang: 'zh-Hant-TW', hreflang: 'zh-Hant', ogLocale: 'zh_TW', ldLanguage: 'zh-Hant-TW' },
};

export const OG_IMAGE = SITE + 'assets/og.png';

/** The mark: an operator box (TOP-violet family strip) with its output wire. */
export const LOGO = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect class="mark-box" x="4" y="9" width="13" height="14" rx="2.5"/><rect class="mark-fam" x="4" y="9" width="3.6" height="14" rx="1.4"/><path class="mark-wire" d="M17 16c4.5 0 4.5-7 9-7"/><circle class="mark-dot" cx="26.5" cy="9" r="2.6"/></svg>`;

export const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${INK}"/><rect x="4" y="9" width="13" height="14" rx="2.5" fill="none" stroke="#edebe5" stroke-width="2.2"/><rect x="4" y="9" width="3.6" height="14" rx="1.4" fill="${ACCENT}"/><path d="M17 16c4.5 0 4.5-7 9-7" fill="none" stroke="#edebe5" stroke-width="2.2" stroke-linecap="round"/><circle cx="26.5" cy="9" r="2.6" fill="${ACCENT}"/></svg>`);

/** Relative href from page `fromKey` (a directory path, '' = root) to site path `to`. */
export function rel(fromKey, to) {
  const depth = fromKey.split('/').filter(Boolean).length;
  const up = depth ? '../'.repeat(depth) : '';
  const out = up + to;
  return out === '' ? './' : out;
}

/**
 * Everything a page needs to place itself.
 * @param {string} key page key without language prefix ('', 'docs/', 'docs/x/')
 * @param {'en'|'zh'} locale
 */
export function pageCtx(key, locale) {
  const L = LOCALES[locale];
  const path = L.prefix + key;                         // this page, relative to the site root
  const url = { en: SITE + key, zh: SITE + 'zh/' + key };
  return {
    key, locale, other: locale === 'en' ? 'zh' : 'en', path, L,
    self: url[locale], url,
    /** relative href to a site path that has no language (assets, app/, llms.txt) */
    asset: (p) => rel(path, p),
    /** relative href to another page key in this language */
    to: (k, hash = '') => rel(path, L.prefix + k) + hash,
    /** the same page in each language */
    lang: { en: rel(path, key), zh: rel(path, 'zh/' + key) },
  };
}

/** Full <head> contents. `ld` is a JSON-LD object; `shim` adds the /app/ forwarder (homepages). */
export function head(t, c, { title, description, ogDescription = description, ld, shim = false, stamp = (p) => p }) {
  return `<meta charset="utf-8">
${shim ? shimScript(c.asset('app/')) + '\n' : ''}<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(description)}">
<link rel="canonical" href="${c.self}">
<link rel="alternate" hreflang="en" href="${c.url.en}">
<link rel="alternate" hreflang="zh-Hant" href="${c.url.zh}">
<link rel="alternate" hreflang="x-default" href="${c.url.en}">
<link rel="alternate" type="text/markdown" href="${c.asset('llms.txt')}" title="llms.txt">
<meta name="theme-color" content="${INK}">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="WebToe">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(ogDescription)}">
<meta property="og:url" content="${c.self}">
<meta property="og:locale" content="${c.L.ogLocale}">
<meta property="og:locale:alternate" content="${LOCALES[c.other].ogLocale}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${attr(t.meta.ogImageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(ogDescription)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<link rel="icon" href="${FAVICON}">
<link rel="preload" href="${c.asset('assets/fonts/archivo-var-latin.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${stamp(c.asset('assets/site.css'))}">
${analyticsSnippet() ? analyticsSnippet() + '\n' : ''}<script type="application/ld+json">
${JSON.stringify(ld, null, 2).replace(/</g, '\\u003c')}
</script>`;
}

/** Skip link + sticky top bar: brand, nav, language switch, GitHub, the editor. */
export function topBar(t, c) {
  const homeHash = (h) => (c.key === '' ? h : c.to('', h));
  const nav = [
    [t.ui.nav.toe, homeHash('#toe')],
    [t.ui.nav.how, homeHash('#how')],
    [t.ui.nav.parity, homeHash('#parity')],
    [t.ui.nav.docs, c.to('docs/'), c.key.startsWith('docs/')],
  ];
  return `<a class="skip" href="#main">${t.ui.skip}</a>

<header class="top">
  <a class="brand" href="${c.to('')}" aria-label="${attr(t.ui.home)}">${LOGO}<span>WebToe</span></a>
  <nav class="nav" aria-label="${attr(t.ui.navLabel)}">
    ${nav.map(([label, href, cur]) => `<a href="${href}"${cur ? ' aria-current="page"' : ''}>${label}</a>`).join('\n    ')}
  </nav>
  <div class="top-end">
    <div class="langs" role="group" aria-label="${attr(t.ui.langLabel)}">
      <a href="${c.lang.en}" hreflang="en" lang="en" data-lang="en"${c.locale === 'en' ? ' aria-current="true"' : ''}>EN</a><span aria-hidden="true">|</span><a href="${c.lang.zh}" hreflang="zh-Hant" lang="zh-Hant-TW" data-lang="zh"${c.locale === 'zh' ? ' aria-current="true"' : ''}>中文</a>
    </div>
    <a class="gh" href="${REPO}">GitHub</a>
    <a class="open" href="${c.asset('app/')}">${t.ui.openEditor}</a>
  </div>
</header>`;
}

/** Footer: wordmark, disclaimer, license, the site's pages, machine-readable files. */
export function siteFooter(t, c) {
  return `<footer class="foot">
  <p class="foot-mark" aria-hidden="true">WebToe</p>
  <div class="foot-grid">
    <div class="foot-legal">
      <p>${t.footer.disclaimer}</p>
      <p class="note">${t.footer.license}</p>
    </div>
    <nav aria-label="${attr(t.footer.pages)}">
      <a href="${c.to('')}">${t.footer.home}</a>
      <a href="${c.asset('app/')}">${t.footer.editor}</a>
      <a href="${c.to('docs/')}">${t.footer.docs}</a>
      <a href="${OAV}">open-audiovisual</a>
    </nav>
    <nav aria-label="${attr(t.footer.machine)}">
      <a href="${REPO}">GitHub</a>
      <a href="${c.asset('llms.txt')}">llms.txt</a>
      <a href="${c.asset('llms-full.txt')}">llms-full.txt</a>
      <a href="${c.asset('sitemap.xml')}">sitemap.xml</a>
    </nav>
  </div>
</footer>`;
}

/** Site script: language memory + copy buttons. Deferred, optional (pages work without it). */
export function siteScript(c, stamp = (p) => p) {
  return `<script src="${stamp(c.asset('assets/site.js'))}" defer></script>`;
}

/**
 * <head> additions for the editor's own index.html (apps/web). The editor has
 * one language and no hreflang twins; it is canonical at /app/.
 */
export function editorHead({ analytics = true } = {}) {
  const title = 'WebToe editor — patch operators in the browser';
  const description = 'The WebToe editor: a node-based dataflow engine for real-time visuals running in your browser on WebGL2 or WebGPU. Load an example, patch operators, drop a TouchDesigner .toe.';
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: 'WebToe editor', url: SITE + 'app/',
    applicationCategory: 'MultimediaApplication', operatingSystem: 'Any (web browser with WebGL2)',
    browserRequirements: 'Requires WebGL2; WebGPU optional', isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: 'https://opensource.org/licenses/MIT', image: OG_IMAGE, sameAs: REPO,
  };
  return `<title>${esc(title)}</title>
<meta name="description" content="${attr(description)}">
<link rel="canonical" href="${SITE}app/">
<meta name="theme-color" content="${INK}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="WebToe">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:url" content="${SITE}app/">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${FAVICON}">
${analytics && analyticsSnippet() ? analyticsSnippet() + '\n' : ''}<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
}
