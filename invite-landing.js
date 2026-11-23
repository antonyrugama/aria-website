/*
 * Coach-code landing for runwitharia.com/invites/<code> and /i/<code>.
 *
 * GitHub Pages has no server routes, so 404.html loads this file for every missing path. A path that
 * is a coach invite link renders the landing; anything else keeps the plain not-found view. The code
 * rules mirror Stadiora/Aria packages/contracts coach-code.ts and the app's handleInviteLink, which
 * accept exactly /invites/<code> or /i/<code> and nothing deeper.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.start(root);
})(typeof window !== 'undefined' ? window : this, function () {
  var COPY = {
    es: {
      title: 'Tu código de entrenador | Aria',
      eyebrow: 'Código de tu entrenador',
      heading: 'Únete a tu entrenador en Aria',
      copy: 'Copiar código',
      copied: 'Código copiado',
      copyFailed: 'Selecciona el código y cópialo',
      open: 'Abrir en Aria',
      openHint: '¿No se abrió Aria? Instálala aquí abajo y vuelve a abrir este enlace, o ingresa el código a mano.',
      ios: 'Descargar en App Store',
      android: 'Descargar en Google Play',
      stepsHeading: 'Cómo unirte',
      steps: [
        'Instala Aria.',
        'Ábrela y elige «Entrenar con mi entrenador».',
        'Ingresa este código.'
      ],
      langLabel: 'Idioma'
    },
    en: {
      title: 'Your coach code | Aria',
      eyebrow: 'Your coach code',
      heading: 'Join your coach on Aria',
      copy: 'Copy code',
      copied: 'Code copied',
      copyFailed: 'Select the code and copy it',
      open: 'Open in Aria',
      openHint: "Didn't Aria open? Install it below and open this link again, or enter the code by hand.",
      ios: 'Download on the App Store',
      android: 'Get it on Google Play',
      stepsHeading: 'How to join',
      steps: [
        'Install Aria.',
        'Open it and choose "Train with my coach".',
        'Enter this code.'
      ],
      langLabel: 'Language'
    }
  };

  function isValidCode(code) {
    if (code.length > 64) return false;
    if (/^[A-Z0-9]{3,24}(?:-[A-Z])?$/.test(code)) return true;
    return /^(?:[A-Z0-9]{6}|[A-Z0-9]{8})$/.test(code.replace(/[-\s]/g, ''));
  }

  function parseInvitePath(pathname) {
    var segments = String(pathname).split('/').filter(function (s) { return s.length > 0; });
    if (segments.length !== 2) return null;
    if (segments[0] !== 'invites' && segments[0] !== 'i') return null;
    var code;
    try {
      code = decodeURIComponent(segments[1]).trim().toUpperCase();
    } catch (e) {
      return null;
    }
    return isValidCode(code) ? code : null;
  }

  function pickLanguage(search) {
    var match = /(?:^|[?&])lang=(es|en)(?:&|$)/.exec(search || '');
    return match ? match[1] : 'es';
  }

  function platformOf(nav) {
    var ua = nav.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && nav.maxTouchPoints > 1)) return 'ios';
    return 'desktop';
  }

  // Android Chrome does not hand a same-site https link to the installed app, so name the app in an
  // intent URL and fall back to the store page when it is missing. iOS gets the plain universal link.
  function androidIntentUrl(host, code, playUrl) {
    var packageId = /[?&]id=([^&]+)/.exec(playUrl);
    if (!packageId) return null;
    return 'intent://' + host + '/invites/' + encodeURIComponent(code) + '?o=1#Intent;scheme=https;package=' +
      packageId[1] + ';S.browser_fallback_url=' + encodeURIComponent(playUrl) + ';end';
  }

  function start(win) {
    var doc = win.document;
    var loc = win.location;
    var code = parseInvitePath(loc.pathname);
    if (!code) return;

    var lang = pickLanguage(loc.search);
    var platform = platformOf(win.navigator);
    var q = function (id) { return doc.getElementById(id); };
    var playUrl = q('store-android').getAttribute('href');
    var canonical = loc.origin + '/invites/' + encodeURIComponent(code);

    q('code').textContent = code;
    q('open').href = platform === 'android'
      ? androidIntentUrl(loc.host, code, playUrl) || canonical
      : canonical + '?o=1';
    q('open').hidden = platform === 'desktop';
    q('open-hint').hidden = !(platform === 'ios' && /(?:^|[?&])o=1(?:&|$)/.test(loc.search));

    if (platform === 'ios') {
      var banner = doc.createElement('meta');
      banner.name = 'apple-itunes-app';
      banner.content = 'app-id=6760048203, app-argument=' + canonical;
      doc.head.appendChild(banner);
    }

    function render(next) {
      var t = COPY[next];
      lang = next;
      doc.documentElement.lang = next;
      doc.title = t.title;
      q('eyebrow').textContent = t.eyebrow;
      q('heading').textContent = t.heading;
      q('copy-label').textContent = t.copy;
      q('open-label').textContent = t.open;
      q('open-hint').textContent = t.openHint;
      q('store-ios-label').textContent = t.ios;
      q('store-android-label').textContent = t.android;
      q('steps-heading').textContent = t.stepsHeading;
      var items = doc.querySelectorAll('#steps li span');
      for (var i = 0; i < items.length; i += 1) items[i].textContent = t.steps[i];
      q('lang').setAttribute('aria-label', t.langLabel);
      var buttons = doc.querySelectorAll('#lang button');
      for (var j = 0; j < buttons.length; j += 1) {
        buttons[j].setAttribute('aria-pressed', String(buttons[j].getAttribute('data-lang') === next));
      }
      q('copy-status').textContent = '';
    }

    function announce(message) {
      q('copy-status').textContent = message;
    }

    q('copy').addEventListener('click', function () {
      var t = COPY[lang];
      var clip = win.navigator.clipboard;
      if (clip && clip.writeText) {
        clip.writeText(code).then(function () { announce(t.copied); }, function () { announce(t.copyFailed); });
        return;
      }
      var range = doc.createRange();
      range.selectNodeContents(q('code'));
      var selection = win.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      announce(doc.execCommand && doc.execCommand('copy') ? t.copied : t.copyFailed);
    });

    q('lang').addEventListener('click', function (event) {
      var next = event.target.getAttribute && event.target.getAttribute('data-lang');
      if (next && COPY[next]) render(next);
    });

    render(lang);
    q('lang').hidden = false;
    q('not-found').hidden = true;
    q('invite').hidden = false;
  }

  return { parseInvitePath: parseInvitePath, pickLanguage: pickLanguage, platformOf: platformOf, androidIntentUrl: androidIntentUrl, start: start };
});
