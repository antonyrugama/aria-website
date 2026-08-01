/* Theme, applied before first paint.

   This is a separate blocking script rather than an inline one purely so the
   page can keep a Content-Security-Policy of script-src 'self' with no hash
   and no 'unsafe-inline'. A classic script in <head> runs before the document
   body is parsed, so the attribute is on <html> before anything is painted and
   navigating between panes never flashes the wrong theme.

   With no stored choice the dashboard follows the operating system. */
(function () {
  'use strict';

  var KEY = 'ops-theme';

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function resolve() {
    var t = stored();
    if (t === 'light' || t === 'dark') return t;
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  apply(resolve());

  window.OpsTheme = {
    current: function () {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    },
    toggle: function () {
      var next = this.current() === 'light' ? 'dark' : 'light';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      return next;
    }
  };
})();
