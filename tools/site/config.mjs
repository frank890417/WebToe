// Site-wide constants for webtoe.openaudiovisual.com.
//
// The two IDs below are filled in by the repo owner. Empty = the snippet is
// not emitted at all (no request to Google, no cookie), on every page of the
// site and in the editor at /app/ (injected by apps/web/vite.config.ts).

/** Google Analytics 4 measurement ID, e.g. 'G-XXXXXXXXXX'. */
export const GA4_ID = '';

/** Google Search Console HTML-tag verification token (the `content` value only). */
export const GSC_VERIFICATION = '';

export const SITE = 'https://webtoe.openaudiovisual.com/';
export const REPO = 'https://github.com/frank890417/WebToe';
export const BLOB = REPO + '/blob/main/';
export const TREE = REPO + '/tree/main/';
export const OAV = 'https://openaudiovisual.com/';
export const AUTHOR = { name: 'Che-Yu Wu', alternateName: '吳哲宇', url: 'https://cheyuwu.com' };

/**
 * Editor bundle size shown on the homepage. tools/build-site.mjs replaces it
 * with a live measurement of apps/web/dist/app/assets/*.js whenever the editor
 * has been built (npm run build always has), so this is only the fallback for
 * `npm run site` / tests without a build. Last measured 2026-10-04 (vite 8).
 */
export const BUNDLE_FALLBACK = { kb: 188, gzipKb: 55 };

/** Brand colours. The accent is the editor's TOP colour; family colours are the editor's own. */
export const ACCENT = '#7c6cff';
export const INK = '#0b0b0c';
export const FAMILY_COLORS = {
  TOP: '#7c6cff', CHOP: '#4fb286', SOP: '#5e8bb8', MAT: '#c9a84c', COMP: '#8a8a93', DAT: '#d2699e',
};
