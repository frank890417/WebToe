/**
 * The website (homepage + docs, English and Traditional Chinese) is generated
 * by tools/site/build.mjs. These tests keep it honest: the two languages have
 * the same shape, every docs page exists in both, every internal link and
 * anchor resolves, and the metadata (canonical, hreflang, JSON-LD, sitemap)
 * matches the pages that exist.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, TABLES, DOC_SLUGS, buildSite, validateSite, shapeDiff, fill, loadDocs, scanOps, opCounts, type SiteFiles,
} from '../tools/site/build.mjs';
import { analyticsSnippet } from '../tools/site/analytics.mjs';

const SITE = 'https://webtoe.openaudiovisual.com/';
let files: SiteFiles;
const html = (p: string): string => {
  const v = files.get(p);
  if (typeof v !== 'string') throw new Error(`${p} not built`);
  return v;
};
const all = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => m[1]);
const body = (s: string) => s.slice(s.indexOf('<body'));
const pageKeys = ['', 'docs/', ...DOC_SLUGS.map((s) => `docs/${s}/`)];

beforeAll(() => {
  files = buildSite({ bundle: { kb: 188, gzipKb: 55 } }).files;
});

/** bundled example files, relative to apps/web/public/examples (incl. raw .toe in toe/) */
function exampleFiles(): string[] {
  const base = join(ROOT, 'apps/web/public/examples');
  return readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.(webtoe\.json|toe|tox)$/.test(d.name))
    .map((d) => join(d.parentPath, d.name).slice(base.length + 1).split('\\').join('/'));
}

describe('two languages, one structure', () => {
  it('string tables have the same shape (every key, every array length)', () => {
    expect(shapeDiff(TABLES.en, TABLES.zh)).toEqual([]);
  });

  it('shapeDiff reports what differs', () => {
    expect(shapeDiff({ a: 1, b: [1, 2] }, { a: 'x', b: [1], c: 0 }))
      .toEqual(['.a: number vs string', '.b: length 2 vs 1', '.c: missing in en']);
  });

  it('fill replaces {tokens}, leaves {{TOE_*}} placeholders, and refuses unknown tokens', () => {
    expect(fill({ s: '{n} ops, {{TOE_X}}' }, { n: 81 })).toEqual({ s: '81 ops, {{TOE_X}}' });
    expect(() => fill({ s: '{nope}' }, {})).toThrow(/unknown token/);
  });

  it('every docs page exists in English and Chinese, with a title and a description', () => {
    const { docs, errors } = loadDocs(ROOT);
    expect(errors).toEqual([]);
    for (const lang of ['en', 'zh']) {
      for (const slug of ['index', ...DOC_SLUGS]) {
        expect(docs[lang][slug]?.title, `${lang}/${slug}`).toBeTruthy();
        expect(docs[lang][slug]?.description, `${lang}/${slug}`).toBeTruthy();
      }
    }
    for (const lang of ['en', 'zh']) {
      const onDisk = readdirSync(join(ROOT, 'site/docs', lang)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
      expect(onDisk).toEqual(['index', ...DOC_SLUGS].sort());
    }
  });

  it('builds a page for every key in both languages', () => {
    for (const k of pageKeys) {
      expect(files.has(`${k}index.html`), k).toBe(true);
      expect(files.has(`zh/${k}index.html`), `zh/${k}`).toBe(true);
    }
  });

  it('both homepages have the same sections, in the same order, and the same heading counts', () => {
    const ids = (s: string) => all(/<section[^>]*\sid="([^"]+)"/g, s);
    expect(ids(html('index.html'))).toEqual(['top', 'shots', 'toe', 'how', 'parity', 'engine', 'oav', 'start']);
    expect(ids(html('zh/index.html'))).toEqual(ids(html('index.html')));
    for (const lvl of [1, 2, 3]) {
      const n = (s: string) => (body(s).match(new RegExp(`<h${lvl}[\\s>]`, 'g')) ?? []).length;
      expect(n(html('zh/index.html')), `h${lvl}`).toBe(n(html('index.html')));
    }
    expect((html('index.html').match(/<h1[\s>]/g) ?? []).length).toBe(1);
  });

  it('every page links to the same places as its twin, one to one', () => {
    for (const k of pageKeys) {
      const links = (p: string, base: string) => all(/<a\s[^>]*href="([^"]+)"/g, body(html(p)))
        .filter((h) => !h.includes('/blob/main/site/docs/'))       // "edit this page" points at the page's own source
        .map((h) => new URL(h.replace(/&amp;/g, '&'), base).href.replace(/^(https:\/\/[^/]+)\/zh(\/|$)/, '$1/'));
      expect(links(`zh/${k}index.html`, `${SITE}zh/${k}`), k).toEqual(links(`${k}index.html`, `${SITE}${k}`));
    }
  });
});

describe('links, anchors, assets', () => {
  it('every local link, image and #anchor resolves to a built file', () => {
    expect(validateSite(files)).toEqual([]);
  });

  it('the validator catches a broken link and a missing anchor', () => {
    const broken: SiteFiles = new Map([['index.html', '<a href="docs/nope/">x</a><a href="#missing">y</a>']]);
    expect(validateSite(broken)).toHaveLength(2);
  });

  it('keeps /bridge.py, /examples/ and /wasm/ at the root for links that predate /app/', () => {
    expect(files.has('bridge.py')).toBe(true);
    expect(files.has('wasm/video-kernels.wasm')).toBe(true);
    for (const f of exampleFiles()) expect(files.has(`examples/${f}`), f).toBe(true);
  });

  it('the examples page opens every bundled example in the editor, in both languages', () => {
    const examples = exampleFiles();
    expect(examples.length).toBeGreaterThanOrEqual(12);
    for (const p of ['docs/examples/index.html', 'zh/docs/examples/index.html']) {
      for (const f of examples) expect(html(p), `${p} → ${f}`).toContain(`app/?project=examples/${f}"`);
    }
  });
});

describe('metadata', () => {
  it('every page has lang, canonical, the hreflang trio and parseable JSON-LD', () => {
    for (const k of pageKeys) {
      for (const [lang, prefix, htmlLang] of [['en', '', 'en'], ['zh', 'zh/', 'zh-Hant-TW']]) {
        const s = html(`${prefix}${k}index.html`);
        expect(s, `${lang} ${k}`).toContain(`<html lang="${htmlLang}">`);
        expect(s).toContain(`<link rel="canonical" href="${SITE}${prefix}${k}">`);
        expect(s).toContain(`<link rel="alternate" hreflang="en" href="${SITE}${k}">`);
        expect(s).toContain(`<link rel="alternate" hreflang="zh-Hant" href="${SITE}zh/${k}">`);
        expect(s).toContain(`<link rel="alternate" hreflang="x-default" href="${SITE}${k}">`);
        expect(s).toContain(`<meta property="og:image" content="${SITE}assets/og.png">`);
        expect(s).toContain('<meta name="twitter:card" content="summary_large_image">');
        const ld = JSON.parse(s.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
        expect(ld['@context']).toBe('https://schema.org');
      }
    }
    const ld = JSON.parse(html('index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(ld['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['SoftwareApplication', 'SoftwareSourceCode', 'WebSite']);
  });

  it('every page carries the trademark disclaimer and makes no claim of endorsement', () => {
    for (const [p, v] of files) {
      if (!p.endsWith('.html') || p === '404.html' || typeof v !== 'string') continue;
      expect(v.includes('not affiliated with or endorsed by Derivative Inc.') || v.includes('與 Derivative Inc. 無隸屬關係'), p).toBe(true);
      expect(v.includes('TouchDesigner is a trademark of Derivative Inc.') || v.includes('TouchDesigner 是 Derivative Inc. 的商標'), p).toBe(true);
    }
  });

  it('native .toe decoding is described with the research-purposes notice, everywhere it is described', () => {
    for (const p of ['index.html', 'docs/importing/index.html', 'docs/toe-format/index.html']) {
      expect(html(p), p).toContain('Native .toe decoding is provided for research purposes only.');
    }
    for (const p of ['zh/index.html', 'zh/docs/importing/index.html', 'zh/docs/toe-format/index.html']) {
      expect(html(p), p).toContain('原生 .toe 解碼僅供研究用途。');
    }
    for (const p of ['docs/importing/index.html', 'zh/docs/importing/index.html']) expect(html(p)).toContain('<!-- TOE-NATIVE -->');
  });

  it('sitemap lists every page with its alternates, plus the editor', () => {
    const map = files.get('sitemap.xml') as string;
    for (const k of pageKeys) {
      expect(map).toContain(`<loc>${SITE}${k}</loc>`);
      expect(map).toContain(`<loc>${SITE}zh/${k}</loc>`);
    }
    expect(map).toContain(`<loc>${SITE}app/</loc>`);
    expect(map).toContain('hreflang="zh-Hant"');
    expect(files.get('robots.txt')).toContain(`Sitemap: ${SITE}sitemap.xml`);
  });

  it('llms.txt indexes both languages and every docs page; llms-full.txt has every page', () => {
    const llms = files.get('llms.txt') as string;
    expect(llms).toMatch(/^# WebToe\n\n> /);
    expect(llms).toContain(`${SITE}zh/`);
    for (const s of DOC_SLUGS) expect(llms).toContain(`${SITE}docs/${s}/`);
    const full = files.get('llms-full.txt') as string;
    for (const s of DOC_SLUGS) expect(full).toContain(`source: site/docs/en/${s}.md`);
    expect(full).not.toContain('<!-- OPS-TABLE -->');
  });
});

describe('numbers come from the code', () => {
  it('the operator inventory is scanned from packages/ops and shown on the operators page', () => {
    const fams = scanOps(ROOT);
    const counts = opCounts(fams);
    expect(fams.map((f) => f.family)).toEqual(['TOP', 'CHOP', 'SOP', 'MAT', 'COMP', 'DAT']);
    expect(counts.total).toBe(fams.reduce((n, f) => n + f.ops.length, 0));
    for (const f of fams) expect(f.ops.every((o) => !o.type.endsWith(':stub'))).toBe(true);
    const page = html('docs/operators/index.html');
    expect(page).toContain('class="ops-table"');
    expect(page).toContain(`<td style="text-align:right">${counts.total}</td>`);
    expect(html('index.html')).toContain(`${counts.total} operator types`);
  });
});

describe('analytics snippet', () => {
  it('emits nothing until an ID is configured', () => {
    expect(analyticsSnippet({ ga4: '', gsc: '' })).toBe('');
  });

  it('emits gtag for a GA4 ID and the Search Console meta for a token', () => {
    const s = analyticsSnippet({ ga4: 'G-ABC123', gsc: 'tok_en-1' });
    expect(s).toContain('https://www.googletagmanager.com/gtag/js?id=G-ABC123');
    expect(s).toContain("gtag('config','G-ABC123')");
    expect(s).toContain('<meta name="google-site-verification" content="tok_en-1">');
  });

  it('refuses malformed IDs instead of injecting them', () => {
    expect(() => analyticsSnippet({ ga4: 'UA-1"><script>', gsc: '' })).toThrow();
    expect(() => analyticsSnippet({ ga4: '', gsc: 'a"b' })).toThrow();
  });
});
