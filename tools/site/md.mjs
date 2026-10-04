// A small, deliberate Markdown → HTML renderer for the docs. No dependencies.
//
// Supported (and nothing else, on purpose — the docs are authored for it):
//   front matter (--- key: value ---) · # … #### headings, optional {#id}
//   paragraphs · **strong** · *em* · `code` · [text](href) · ![alt](src)
//   - / 1. lists (nested by indentation) · > blockquotes · --- rules
//   GFM pipe tables · ``` fenced code with a language
//   HTML comments (kept; `<!-- NAME -->` alone on a line runs a directive if one is registered)
//   raw HTML blocks (a line starting with a block tag, until a blank line)
//   inline HTML from a small whitelist (kbd, br, sup, sub, abbr, span, small, wbr, mark)

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const attr = (s) => esc(s).replace(/"/g, '&quot;');

/** GitHub-style slug; keeps CJK so Chinese headings get readable ids. */
export function slugify(text) {
  return String(text).toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

/** Split `---\nkey: value\n---` front matter off the top. */
export function frontMatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return { data, body: src.slice(m[0].length) };
}

// ---------------------------------------------------------------- code
const KW = new Set(['import', 'from', 'const', 'let', 'var', 'await', 'async', 'export', 'return', 'function',
  'new', 'if', 'else', 'for', 'of', 'true', 'false', 'null', 'typeof', 'window', 'def', 'True', 'False', 'None']);

/** Tiny highlighter: comments, strings, keywords. Escapes as it goes. */
export function highlight(code, lang) {
  if (lang === 'text' || lang === 'txt' || !lang) return esc(code);
  const hashComments = /^(bash|sh|shell|zsh|python|py|toml|yaml)$/.test(lang);
  const re = hashComments
    ? /(#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b([A-Za-z_]\w*)\b/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b([A-Za-z_]\w*)\b/g;
  let out = '', i = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(i, m.index));
    if (m[1]) {
      // a comment starts at line start or after whitespace, never mid-token (https://, #fff)
      const prev = m.index ? code[m.index - 1] : '\n';
      if (!/\s/.test(prev)) { out += esc(m[1][0]); re.lastIndex = m.index + 1; i = m.index + 1; continue; }
      out += `<span class="tc">${esc(m[1])}</span>`;
    } else if (m[2]) out += `<span class="ts">${esc(m[2])}</span>`;
    else if (lang !== 'json' && KW.has(m[3])) out += `<span class="tk">${m[3]}</span>`;
    else out += esc(m[3]);
    i = re.lastIndex;
  }
  return out + esc(code.slice(i));
}

// ---------------------------------------------------------------- inline
const INLINE_TAGS = /^<\/?(kbd|br|sup|sub|abbr|span|small|wbr|mark)(\s[^<>]*)?\/?>/i;

/**
 * @param {string} s
 * @param {(href: string) => string} link resolves authored hrefs to output hrefs
 */
export function inline(s, link = (h) => h) {
  const keep = [];
  const stash = (html) => `\u0000${keep.push(html) - 1}\u0000`;
  let t = '';
  // pass 1: protect code spans and whitelisted inline tags, escape everything else
  for (let i = 0; i < s.length;) {
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) { t += stash(`<code>${esc(s.slice(i + 1, end))}</code>`); i = end + 1; continue; }
    }
    if (s[i] === '<') {
      const m = s.slice(i).match(INLINE_TAGS);
      if (m) { t += stash(m[0]); i += m[0].length; continue; }
      const auto = s.slice(i).match(/^<(https?:\/\/[^\s>]+)>/);
      if (auto) { t += stash(`<a href="${attr(link(auto[1]))}">${esc(auto[1])}</a>`); i += auto[0].length; continue; }
    }
    t += esc(s[i]); i++;
  }
  // pass 2: images, links, emphasis (on escaped text — hrefs were escaped once, unescape before resolving)
  const unesc = (x) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
    stash(`<img src="${attr(link(unesc(src)))}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy" decoding="async">`));
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const h = link(unesc(href));
    const ext = /^https?:/.test(h) ? ' rel="noopener"' : '';
    return `<a href="${attr(h)}"${ext}>${text}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[+n]).replace(/\u0000(\d+)\u0000/g, (_, n) => keep[+n]);
}

// ---------------------------------------------------------------- blocks
const BLOCK_TAG = /^<(div|figure|table|details|section|aside|p|ul|ol|dl|blockquote|pre|nav|video|picture|svg|hr)[\s>]/i;
const isTableSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const listItem = (l) => l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);

/**
 * @param {string} src markdown (without front matter)
 * @param {{ link?: (href: string) => string,
 *           directives?: Record<string, () => string>,
 *           codeBlock?: (code: string, lang: string) => string }} [opts]
 * @returns {{ html: string, headings: { level: number, id: string, text: string }[] }}
 */
export function renderMarkdown(src, opts = {}) {
  const link = opts.link ?? ((h) => h);
  const directives = opts.directives ?? {};
  const headings = [];
  const usedIds = new Set();
  const codeBlock = opts.codeBlock ?? ((code, lang) =>
    `<pre class="code"${lang ? ` data-lang="${attr(lang)}"` : ''}><code>${highlight(code, lang)}</code></pre>`);

  function blocks(lines) {
    const out = [];
    let i = 0;
    const para = [];
    const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), link)}</p>`); para.length = 0; } };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) { flush(); i++; continue; }

      // fenced code
      const fence = trimmed.match(/^```\s*([\w+-]*)\s*$/);
      if (fence) {
        flush();
        const body = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push(codeBlock(body.join('\n'), fence[1].toLowerCase()));
        continue;
      }

      // comments and directives
      if (trimmed.startsWith('<!--')) {
        flush();
        const one = trimmed.match(/^<!--\s*([A-Z][A-Z0-9-]*)\s*-->$/);
        if (one && directives[one[1]]) { out.push(directives[one[1]]()); i++; continue; }
        const body = [];
        while (i < lines.length) { body.push(lines[i]); if (lines[i].includes('-->')) { i++; break; } i++; }
        out.push(body.join('\n'));
        continue;
      }

      // raw HTML block
      if (BLOCK_TAG.test(trimmed)) {
        flush();
        const body = [];
        while (i < lines.length && lines[i].trim()) body.push(lines[i++]);
        out.push(body.join('\n'));
        continue;
      }

      // heading
      const h = trimmed.match(/^(#{1,4})\s+(.*?)(?:\s+\{#([\w-]+)\})?\s*$/);
      if (h) {
        flush();
        const level = h[1].length;
        const html = inline(h[2], link);
        const text = html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        let id = h[3] || slugify(text) || `section-${headings.length + 1}`;
        for (let n = 2; usedIds.has(id); n++) id = `${h[3] || slugify(text)}-${n}`;
        usedIds.add(id);
        headings.push({ level, id, text });
        out.push(level === 1
          ? `<h1 id="${id}">${html}</h1>`
          : `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${html}</h${level}>`);
        i++;
        continue;
      }

      // rule
      if (/^(-{3,}|\*{3,})$/.test(trimmed)) { flush(); out.push('<hr>'); i++; continue; }

      // blockquote
      if (trimmed.startsWith('>')) {
        flush();
        const body = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) body.push(lines[i++].trim().replace(/^>\s?/, ''));
        out.push(`<blockquote>${blocks(body)}</blockquote>`);
        continue;
      }

      // table
      if (trimmed.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flush();
        const head = cells(trimmed);
        const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().includes('|')) rows.push(cells(lines[i++]));
        const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c, link)}</${tag}>`;
        out.push(`<div class="table"><table>\n<thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead>\n<tbody>\n${
          rows.map((r) => `<tr>${head.map((_, k) => td('td', r[k] ?? '', k)).join('')}</tr>`).join('\n')}\n</tbody></table></div>`);
        continue;
      }

      // list
      const li = listItem(line);
      if (li) {
        flush();
        const indent = li[1].length;
        const ordered = /\d/.test(li[2]);
        const items = [];
        while (i < lines.length) {
          const m = listItem(lines[i]);
          if (m && m[1].length === indent) { items.push([m[3]]); i++; continue; }
          // continuation: deeper-indented lines (incl. nested lists) or a lazy paragraph line
          if (lines[i].trim() && (lines[i].match(/^\s*/)[0].length > indent)) { items[items.length - 1].push(lines[i].slice(indent + 2)); i++; continue; }
          if (!lines[i].trim() && i + 1 < lines.length && lines[i + 1].match(/^\s*/)[0].length > indent && lines[i + 1].trim()) {
            items[items.length - 1].push(''); i++; continue;
          }
          break;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>\n${items.map((it) => {
          const [first, ...rest] = it;
          if (!rest.length) return `<li>${inline(first, link)}</li>`;
          const nestedAt = rest.findIndex((l) => l === '' || listItem(l));
          const lead = [first, ...(nestedAt < 0 ? rest : rest.slice(0, nestedAt))].join(' ');
          const tail = nestedAt < 0 ? '' : blocks(rest.slice(nestedAt));
          return `<li>${inline(lead, link)}${tail}</li>`;
        }).join('\n')}\n</${tag}>`);
        continue;
      }

      para.push(trimmed);
      i++;
    }
    flush();
    return out.join('\n');
  }

  return { html: blocks(src.replace(/\r\n?/g, '\n').split('\n')), headings };
}
