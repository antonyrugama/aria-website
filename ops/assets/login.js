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
    if (/(^|\/)login\.html([?#]|$)/.test(next)) return 'index.html';
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
    var counter = el('authCountdown');
    if (counter) counter.textContent = '';
    /* Dropping the class rather than the element. A live region that leaves
       the tree via display:none is one that misses its next announcement. */
    alertBox.className = '';
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
      var what = btn.getAttribute('data-pw-label') || 'password';
      btn.addEventListener('click', function () {
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        /* The visible word stays short so it fits beside the field. The
           accessible name says which field it acts on and still contains the
           visible word, so the two do not disagree. */
        btn.textContent = showing ? 'Show' : 'Hide';
        btn.setAttribute('aria-label', (showing ? 'Show ' : 'Hide ') + what);
        input.focus();
      });
    });
  }

  var rememberBtn = el('remember');

  function remembered() {
    return rememberBtn.checked;
  }

  function wireRemember() {
    /* Somebody who already chose to be remembered on this browser almost
       certainly means to again. */
    if (session.rememberedOnDevice()) rememberBtn.checked = true;
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
    var counter = el('authCountdown');

    /* The alert fires once. Rewriting a role="alert" every second would
       interrupt a screen reader sixty times in a row, each announcement
       cutting off the last, leaving the operator unable to hear anything else
       until the cooldown ended. The ticking number lives in a silent element
       beside it, for the eyes only. */
    setAlert('Too many attempts. Try again in ' + left + ' second' +
      (left === 1 ? '' : 's') + '.', 'is-warn', true);

    function tick() {
      if (left <= 0) {
        global.clearInterval(countdownTimer);
        countdownTimer = null;
        if (counter) counter.textContent = '';
        button.disabled = false;
        setAlert('You can try again now.', 'is-warn', false);
        return;
      }
      if (counter) {
        counter.textContent = left + ' second' + (left === 1 ? '' : 's') + ' left.';
      }
      left -= 1;
    }

    button.disabled = true;
    button.textContent = idleText;
    if (countdownTimer) global.clearInterval(countdownTimer);
    tick();
    countdownTimer = global.setInterval(tick, 1000);
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
    /* hasOwnProperty, not a bare index: ?reason=constructor would otherwise
       return Object, which is truthy, and paint "undefined" into the alert. */
    var key = query.get('reason');
    var known = key && Object.prototype.hasOwnProperty.call(REASONS, key);
    /* Display only. This page never clears credentials on the strength of a
       querystring: ?reason is a public, guessable value, so a cross-site link
       to login.html?reason=required would otherwise sign the operator out.
       Every path that genuinely ends a session already calls clearTokens()
       before it navigates here. */
    if (known) setAlert(REASONS[key].text, REASONS[key].tone, false);
  }
})(window);
