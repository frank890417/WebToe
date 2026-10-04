// Compatibility shim for / and /zh/.
//
// Until 2026-10 the editor itself lived at the site root, so links in the wild
// look like https://webtoe.openaudiovisual.com/?project=… (also ?bridge=,
// ?bridgeToken=, ?backend=), and open-audiovisual's @openav/world-webtoe embeds
// the root URL in an iframe and drives it over postMessage (webtoe:ext,
// webtoe:load). The homepage now owns /, so it forwards those visitors to the
// editor at /app/ before anything renders.
//
// Rule: forward when the page is framed, or when the query has any parameter
// that is not pure campaign/click tracking. Tracking-only queries (utm_*,
// fbclid, gclid, …) are what social sites append to a shared homepage link;
// sending those visitors into the editor would be wrong.
//
// shimTarget is inlined into the page with Function#toString, so the code the
// tests exercise is byte-for-byte the code that ships. Keep it ES5 and free of
// outside references.

/**
 * @param {string} search  location.search ('' or '?a=b')
 * @param {string} hash    location.hash
 * @param {boolean} framed window.self !== window.top
 * @param {string} app     URL of the editor, relative to the current page
 * @returns {string|null}  where to go, or null to stay on the homepage
 */
export function shimTarget(search, hash, framed, app) {
  var tracking = /^(utm_[a-z0-9_]+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|twclid|li_fat_id|mc_cid|mc_eid|igshid|_ga|_gl|ref)$/i;
  var forward = !!framed;
  var pairs = (search || '').replace(/^\?/, '').split('&');
  for (var i = 0; i < pairs.length && !forward; i++) {
    if (!pairs[i]) continue;
    var key = pairs[i].split('=')[0].replace(/\+/g, ' ');
    try { key = decodeURIComponent(key); } catch (e) { /* keep the raw key */ }
    if (!tracking.test(key)) forward = true;
  }
  return forward ? app + (search || '') + (hash || '') : null;
}

/** The inline <script> for the top of <head>. `app` is the editor URL relative to the page. */
export function shimScript(app) {
  if (!/^(\.\.\/)*app\/$|^\/app\/$/.test(app)) throw new Error(`unexpected app path ${app}`);
  return `<script>(function(){var f;try{f=window.self!==window.top}catch(e){f=true}` +
    `var t=(${shimTarget.toString()})(location.search,location.hash,f,${JSON.stringify(app)});` +
    `if(t)location.replace(t)})()</script>`;
}
