// The one analytics/verification head partial, shared by every site page and
// by the editor's index.html (via the vite plugin in apps/web/vite.config.ts).
// Emits nothing until an ID is set in tools/site/config.mjs.

import { GA4_ID, GSC_VERIFICATION } from './config.mjs';

const ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * @param {{ ga4?: string, gsc?: string }} [ids] overrides, for tests
 * @returns {string} HTML for <head>, or '' when nothing is configured
 */
export function analyticsSnippet({ ga4 = GA4_ID, gsc = GSC_VERIFICATION } = {}) {
  const out = [];
  if (gsc) {
    if (!ID_RE.test(gsc)) throw new Error(`GSC_VERIFICATION has unexpected characters: ${gsc}`);
    out.push(`<meta name="google-site-verification" content="${gsc}">`);
  }
  if (ga4) {
    if (!/^G-[A-Z0-9]+$/.test(ga4)) throw new Error(`GA4_ID must look like G-XXXXXXXXXX, got: ${ga4}`);
    out.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga4}');</script>`);
  }
  return out.join('\n');
}
