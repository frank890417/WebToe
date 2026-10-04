// WebToe site — the only script on the homepage and docs. Optional by design:
// every page is complete static HTML without it.
//   · remembers the language you picked (localStorage 'webtoe.lang'); no auto-redirect
//   · carries the section you are reading across the language switch (#anchor)
//   · copy buttons on code blocks
(function () {
  document.documentElement.classList.add('js');

  document.querySelectorAll('[data-lang]').forEach(function (a) {
    a.addEventListener('click', function () {
      try { localStorage.setItem('webtoe.lang', a.getAttribute('data-lang')); } catch (e) { /* private mode */ }
      if (location.hash && a.href.indexOf('#') < 0) a.href = a.href + location.hash;
    });
  });

  var lang = document.documentElement.lang.indexOf('zh') === 0 ? 'zh' : 'en';
  var labels = lang === 'zh' ? { copy: '複製', copied: '已複製' } : { copy: 'Copy', copied: 'Copied' };
  document.querySelectorAll('button[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pre = btn.closest('.term') && btn.closest('.term').querySelector('pre');
      if (!pre || !navigator.clipboard) return;
      navigator.clipboard.writeText(pre.innerText.replace(/\n$/, '')).then(function () {
        btn.textContent = labels.copied;
        btn.setAttribute('data-done', '');
        setTimeout(function () { btn.textContent = labels.copy; btn.removeAttribute('data-done'); }, 1400);
      });
    });
  });
})();
