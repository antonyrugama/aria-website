/* The sign-in page.

   Two phases in one page, because they are one errand. Phase one takes a
   credential. Phase two exists only for an account that is still carrying the
   password it was provisioned with, which the server refuses to let past
   itself: every route except reading your own session, signing out, and
   changing your password answers 403 ops_password_change_required until it is
   done. The client honours that flag, but it is not the thing enforcing it. */
(function (global) {
  'use strict';

  var api = global.OpsApi;
  var session = global.OpsSession;
  var icons = global.OpsIcons;

  var el = function (id) { return document.getElementById(id); };

  /* Why the operator is looking at this screen rather than a pane. Written
     from their point of view: a revoked session and an expired one need
     different words even though both end at the same form. */
  var REASONS = {
    required: { tone: 'is-warn', text: 'Sign in to open the operations dashboard.' },
    expired: { tone: 'is-warn', text: 'Your session expired. Sign in again to carry on.' },
    revoked: { tone: '', text: 'That session was revoked. Sign in again, and if you did not expect this, tell the other administrator.' },
    ended: { tone: 'is-warn', text: 'Your session has ended. Sign in again.' },
    inactive: { tone: '', text: 'This administrator account is not active. An owner has to re-enable it.' },
    signedout: { tone: 'is-ok', text: 'You are signed out.' }
  };

  var query = new URLSearchParams(global.location.search);

  /* Only a path inside this dashboard is ever followed after sign in, so a
     crafted ?next= cannot hand a freshly signed in administrator to another
     site. Anything else falls back to the overview. */
  function safeNext() {
    var next = query.get('next');
    if (!next) return 'index.html';
    /* '//' would start a protocol-relative URL, and '..' can climb back out of
       the dashboard directory after the prefix check has passed. */
    if (next.indexOf('..') !== -1) return 'index.html';
    if (next.indexOf('//') !== -1 || next.charAt(0) !== '/') {
      /* Relative and same-directory only. */
      if (/^[A-Za-z0-9_-]+\.html(\?[^#]*)?$/.test(next)) return next;
      return 'index.html';
    }
    var here = global.location.pathname.replace(/[^/]*$/, '');
    if (next.indexOf(here) === 0) return next;
    return 'index.html';
  }

  /* ------------------------------------------------------------- alerting */

  var alertBox = el('authAlert');
  var countdownTimer = null;

  function clearAlert() {
    if (countdownTimer) { global.clearInterval(countdownTimer); countdownTimer = null; }
    alertBox.className = 'form-alert';
    alertBox.textContent = '';
  }

  function setAlert(text, tone, focusIt) {
    if (countdownTimer) { global.clearInterval(countdownTimer); countdownTimer = null; }
    alertBox.className = 'form-alert' + (tone ? ' ' + tone : '');
    alertBox.textContent = '';
    alertBox.appendChild(icons.icon(tone === 'is-ok' ? 'check' : 'warn'));
    alertBox.appendChild(document.createTextNode(text));
    if (focusIt) alertBox.focus();
  }

  function setFieldError(fieldId, text) {
    var field = el(fieldId);
    var box = el(fieldId + 'Error');
    if (!box) return;
    box.textContent = '';
    if (text) {
      box.appendChild(icons.icon('warn'));
      box.appendChild(document.createTextNode(text));
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', fieldId + 'Error');
      }
    } else if (field) {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
    }
  }

  function clearFieldErrors(ids) {
    ids.forEach(function (id) { setFieldError(id, ''); });
  }

  /* -------------------------------------------------------- shared wiring */

  function wireThemeToggle() {
    var sun = el('themeSun');
    var moon = el('themeMoon');
    if (sun) sun.appendChild(icons.icon('sun'));
    if (moon) moon.appendChild(icons.icon('moon'));
    var btn = el('themeToggle');
    if (btn) btn.addEventListener('click', function () { global.OpsTheme.toggle(); });
  }

  /* A password field nobody can read back is a password field people mistype.
     The toggle is a real button carrying its own pressed state. */
  function wirePasswordToggles() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-pw-for]'), function (btn) {
      var input = el(btn.getAttribute('data-pw-for'));
      if (!input) return;
      btn.addEventListener('click', function () {
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.textContent = showing ? 'Show' : 'Hide';
        btn.setAttribute('aria-pressed', String(!showing));
        input.focus();
      });
    });
  }

  var rememberBtn = el('remember');

  function remembered() {
    return rememberBtn.getAttribute('aria-checked') === 'true';
  }

  function wireRemember() {
    rememberBtn.addEventListener('click', function () {
      rememberBtn.setAttribute('aria-checked', String(!remembered()));
    });
    /* Somebody who already chose to be remembered on this browser almost
       certainly means to again. */
    if (session.rememberedOnDevice()) rememberBtn.setAttribute('aria-checked', 'true');
  }

  function busy(button, on, busyText, idleText) {
    button.disabled = on;
    button.textContent = on ? busyText : idleText;
    button.setAttribute('aria-busy', String(on));
  }

  /* A 429 carries the seconds left in the body, because Retry-After is not a
     header cross-origin JavaScript is allowed to read. Counting it down beats
     an operator guessing when to try again. */
  function rateLimited(button, idleText, seconds) {
    var left = Math.max(1, Math.round(seconds || 60));

    function tick() {
      alertBox.className = 'form-alert is-warn';
      alertBox.textContent = '';
      alertBox.appendChild(icons.icon('clock'));
      alertBox.appendChild(document.createTextNode(
        'Too many attempts. Try again in ' + left + ' second' + (left === 1 ? '' : 's') + '.'
      ));
      if (left <= 0) {
        global.clearInterval(countdownTimer);
        countdownTimer = null;
        button.disabled = false;
        setAlert('You can try again now.', 'is-warn', false);
        return;
      }
      left -= 1;
    }

    button.disabled = true;
    button.textContent = idleText;
    if (countdownTimer) global.clearInterval(countdownTimer);
    tick();
    countdownTimer = global.setInterval(tick, 1000);
    alertBox.focus();
  }

  /* ------------------------------------------------------------- phase one */

  var signinForm = el('signinForm');
  var passwordForm = el('passwordForm');
  var signinSubmit = el('signinSubmit');
  var passwordSubmit = el('passwordSubmit');

  function showPhase(phase) {
    var signin = phase !== 'password';
    signinForm.hidden = !signin;
    passwordForm.hidden = signin;

    el('authTitle').textContent = signin
      ? 'Sign in to Aria Operations'
      : 'Choose your own password';
    el('authSub').textContent = signin
      ? 'Private, admin only'
      : 'This account is still using the password it was set up with.';
    document.title = (signin ? 'Sign in' : 'Choose a password') + ' | Aria Operations';

    var first = signin ? el('email') : el('currentPassword');
    if (first) first.focus();

    /* Keep the address bar honest, so reloading mid-flow comes back to the
       step the operator was actually on. */
    var q = new URLSearchParams(global.location.search);
    if (signin) q.delete('phase'); else q.set('phase', 'password');
    var qs = q.toString();
    global.history.replaceState(null, '', global.location.pathname + (qs ? '?' + qs : ''));
  }

  signinForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearAlert();
    clearFieldErrors(['email', 'password']);

    var email = el('email').value.trim();
    var password = el('password').value;

    if (!email) { setFieldError('email', 'Enter your email address.'); el('email').focus(); return; }
    if (!password) { setFieldError('password', 'Enter your password.'); el('password').focus(); return; }

    busy(signinSubmit, true, 'Signing in', 'Sign in');

    session.signIn(email, password, remembered()).then(function (data) {
      if (data.admin && data.admin.mustChangePassword) {
        busy(signinSubmit, false, '', 'Sign in');
        clearAlert();
        setAlert('Signed in. Choose your own password before the dashboard will open.', 'is-warn', false);
        showPhase('password');
        return;
      }
      global.location.replace(safeNext());
    }, function (err) {
      busy(signinSubmit, false, '', 'Sign in');
      el('password').value = '';

      if (!(err instanceof api.OpsApiError)) {
        setAlert('Something went wrong signing in. Try again.', '', true);
        return;
      }
      if (err.code === 'ops_login_rate_limited') {
        rateLimited(signinSubmit, 'Sign in', err.retryAfter);
        return;
      }
      if (err.code === 'ops_login_invalid') {
        setAlert(err.message, '', true);
        return;
      }
      if (err.code === 'ops_unreachable') {
        setAlert(err.message, '', true);
        return;
      }
      /* ops_login_failed is deliberately the same answer for an unknown
         address, a wrong password, and a disabled account. Repeating the
         server's wording keeps the client from implying more than it knows. */
      setAlert(err.message, '', true);
      el('password').focus();
    });
  });

  /* ------------------------------------------------------------ phase two */

  passwordForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearAlert();
    clearFieldErrors(['currentPassword', 'newPassword', 'confirmPassword']);

    var current = el('currentPassword').value;
    var next = el('newPassword').value;
    var confirm = el('confirmPassword').value;

    if (!current) {
      setFieldError('currentPassword', 'Enter the password you were given.');
      el('currentPassword').focus(); return;
    }
    if (next.length < 12) {
      setFieldError('newPassword', 'Choose a password of at least 12 characters.');
      el('newPassword').focus(); return;
    }
    if (next === current) {
      setFieldError('newPassword', 'Choose a password you have not used here before.');
      el('newPassword').focus(); return;
    }
    if (next !== confirm) {
      setFieldError('confirmPassword', 'The two passwords do not match.');
      el('confirmPassword').focus(); return;
    }

    busy(passwordSubmit, true, 'Saving', 'Save password and continue');

    session.changePassword(current, next).then(function (data) {
      var others = data && data.otherSessionsRevoked;
      setAlert(
        others
          ? 'Password saved. ' + others + ' other session' + (others === 1 ? '' : 's') + ' signed out.'
          : 'Password saved.',
        'is-ok', false
      );
      global.setTimeout(function () { global.location.replace(safeNext()); }, 600);
    }, function (err) {
      busy(passwordSubmit, false, '', 'Save password and continue');

      if (!(err instanceof api.OpsApiError)) {
        setAlert('Something went wrong saving the password. Try again.', '', true);
        return;
      }
      if (err.code === 'ops_password_rejected') {
        setFieldError('currentPassword', err.message);
        el('currentPassword').value = '';
        el('currentPassword').focus();
        return;
      }
      if (err.code === 'ops_password_too_short' || err.code === 'ops_password_unchanged') {
        setFieldError('newPassword', err.message);
        el('newPassword').focus();
        return;
      }
      setAlert(err.message, '', true);
    });
  });

  /* ---------------------------------------------------------------- start */

  wireThemeToggle();
  wirePasswordToggles();
  wireRemember();

  var wanted = query.get('phase') === 'password' ? 'password' : 'signin';

  if (wanted === 'password' && !session.readRefreshToken()) {
    /* Landed on the password step with nothing to authenticate it. Sign in
       first; the server would refuse the change anyway. */
    wanted = 'signin';
  }

  showPhase(wanted);

  if (wanted === 'password') {
    setAlert('Choose your own password before the dashboard will open.', 'is-warn', false);
  } else {
    var reason = REASONS[query.get('reason')];
    if (reason) setAlert(reason.text, reason.tone, false);
    /* A stale credential in storage is worse than none: it produces a sign-in
       screen that silently fails on the next call. Landing here always means
       the session is over, so drop it. */
    if (query.get('reason')) session.clearTokens();
  }
})(window);
