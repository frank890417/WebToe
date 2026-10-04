/**
 * The root shim. The editor used to live at the site root, so shared links
 * (`/?project=…`, `?bridge=`, `?backend=`) and open-audiovisual's iframe embed
 * (`@openav/world-webtoe`, driven over postMessage) still point there. The
 * homepage forwards those to /app/ before rendering; tracking-only queries
 * stay on the homepage.
 */
import { describe, expect, it } from 'vitest';
import { shimTarget, shimScript } from '../tools/site/shim.mjs';
import { buildSite } from '../tools/site/build.mjs';

describe('shimTarget', () => {
  const go = (search: string, hash = '', framed = false) => shimTarget(search, hash, framed, 'app/');

  it('stays on the homepage without a query', () => {
    expect(go('')).toBeNull();
    expect(go('?')).toBeNull();
    expect(go('', '#parity')).toBeNull();
  });

  it('forwards editor parameters with the query and hash intact', () => {
    expect(go('?project=examples/01-hello-noise.webtoe.json')).toBe('app/?project=examples/01-hello-noise.webtoe.json');
    expect(go('?bridge=http://10.0.0.2:9881&bridgeToken=s3cret')).toBe('app/?bridge=http://10.0.0.2:9881&bridgeToken=s3cret');
    expect(go('?backend=webgpu', '#x')).toBe('app/?backend=webgpu#x');
    expect(go('?ext=1')).toBe('app/?ext=1');
  });

  it('forwards any non-tracking parameter, so unknown editor parameters keep working', () => {
    expect(go('?somethingNew=1')).toBe('app/?somethingNew=1');
    expect(go('?%E4%B8%AD=1')).toBe('app/?%E4%B8%AD=1');
    expect(go('?%E0%A4%A=1')).toBe('app/?%E0%A4%A=1');     // malformed escape: still forwarded
  });

  it('keeps tracking-only queries on the homepage, but not when an editor parameter rides along', () => {
    expect(go('?utm_source=x&utm_medium=social&fbclid=abc')).toBeNull();
    expect(go('?gclid=1&ref=hn')).toBeNull();
    expect(go('?utm_source=x&project=a.json')).toBe('app/?utm_source=x&project=a.json');
  });

  it('forwards whenever the page is framed (the open-audiovisual embed)', () => {
    expect(go('', '', true)).toBe('app/');
    expect(go('?project=https://example.com/p.webtoe.json', '', true)).toBe('app/?project=https://example.com/p.webtoe.json');
    expect(go('?utm_source=x', '', true)).toBe('app/?utm_source=x');
  });

  it('only accepts an editor path as its target', () => {
    expect(() => shimScript('https://evil.example/')).toThrow();
    expect(shimScript('../app/')).toContain('"../app/"');
  });
});

describe('the shim on the built homepages', () => {
  const { files } = buildSite({ bundle: { kb: 188, gzipKb: 55 } });

  /** Run the page's inline shim against a fake window/location. */
  function run(page: string, search: string, hash = '', framed = false): string | null {
    const s = files.get(page) as string;
    const head = s.slice(s.indexOf('<head>'), s.indexOf('</head>'));
    const first = head.match(/<script>([\s\S]*?)<\/script>/)!;
    expect(head.indexOf('<script'), 'the shim is the first script in <head>').toBe(head.indexOf(first[0]));
    let went: string | null = null;
    const location = { search, hash, replace: (u: string) => { went = u; } };
    const win = framed ? { self: {}, top: {} } : (() => { const w = {}; return { self: w, top: w }; })();
    new Function('window', 'location', first[1])(win, location);
    return went;
  }

  it('/ forwards to app/ and /zh/ to ../app/', () => {
    expect(run('index.html', '?project=examples/03-lfo-garden.webtoe.json', '#a')).toBe('app/?project=examples/03-lfo-garden.webtoe.json#a');
    expect(run('zh/index.html', '?backend=webgpu')).toBe('../app/?backend=webgpu');
    expect(run('index.html', '', '', true)).toBe('app/');
  });

  it('a plain visit, or one from a social share, stays', () => {
    expect(run('index.html', '')).toBeNull();
    expect(run('zh/index.html', '?utm_source=twitter')).toBeNull();
  });

  it('docs pages have no shim', () => {
    expect((files.get('docs/index.html') as string)).not.toContain('shimTarget');
  });
});
