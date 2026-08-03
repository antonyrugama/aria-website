/* First-time setup: spend the emailed link, choose the first password.

   This page is where the link in the setup email lands. It is unauthenticated,
   like the sign-in page, and deliberately loads no session code at all: api.js
   is the transport and nothing else is here, so there is no function on this
   page capable of adopting a credential. That is structural rather than
   careful. The setup endpoint issues no session by design, and a page that
   could not sign anybody in even if it were handed one cannot drift away from
   that decision later.

   The token:

     It arrives in the query string, which means it is in the address bar, in
     the tab title's tooltip, in anything the operator copies out of the bar,
     and in any screenshot of the window. It is read once, into a closure
     variable, and stripped from the URL before anything else happens. It is
     never written into the DOM, never put in a link or a form action, never
     logged, and never given to anything but the request body. The document
     also carries a no-referrer policy, because a subresource fetched before
     this script ran would otherwise have carried the whole URL in a header.

   What this page does not decide:

     Whether a link is valid. It submits what it was given and repeats what the
     server says. The API answers one generic rejection for unknown, expired,
     consumed, superseded, and already-claimed alike, so guessing between those
     here would either be wrong or would leak the distinction the API refuses
     to draw. The client does not even check the token's shape: a shape check
     is a second, divergent authority on validity that can only ever disagree
     with the first one. */
(function (global) {
  'use strict';

  var api = global.OpsApi;
  var icons = global.OpsIcons;

  var MIN_PASSWORD_LENGTH = 12;
  /* Same sentence the API answers with, so a length the client catches and a
     length the server catches read identically. */
  var TOO_SHORT = 'Choose a password of at least ' + MIN_PASSWORD_LENGTH + ' characters.';

  var el = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------- the credential */

  var query = new URLSearchParams(global.location.search);
  var token = query.get('token') || null;

  /* Out of the address bar immediately, before a single request is made and
     before the operator has a chance to copy or screenshot it. replaceState
     leaves no history entry behind, so Back cannot restore it either.

     If the browser refuses, setup carries on: the link is already in the bar
     and refusing to spend it would leave the account unclaimable without
     buying back any of the exposure. Nothing is logged, because the only
     interesting thing to log here would be the value we are trying to hide. */
  var tokenStillInBar = false;
  if (token !== null) {
    query.delete('token');
    var rest = query.toString();
    try {
      global.history.replaceState(null, '',
        global.location.pathname + (rest ? '?' + rest : '') + global.location.hash);
    } catch (e) {
      /* Address bar unchanged. Setup still proceeds, but the operator is the
         only one who can act on what is now sitting in their history, so they
         are told rather than left to assume the link was cleaned up. */
      tokenStillInBar = true;
    }
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

  /* The field keeps whatever it was already described by, and gains the error
     rather than being re-pointed at it. Overwriting aria-describedby is how a
     password field stops announcing its own length rule at the exact moment
     somebody has got the length wrong. */
  function setFieldError(fieldId, text) {
    var field = el(fieldId);
    var box = el(fieldId + 'Error');
    if (!box) return;
    var base = field ? (field.getAttribute('data-hint') || '') : '';
    box.textContent = '';
    if (text) {
      box.appendChild(icons.icon('warn'));
      box.appendChild(document.createTextNode(text));
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', (base ? base + ' ' : '') + fieldId + 'Error');
      }
    } else if (field) {
      field.removeAttribute('aria-invalid');
      if (base) field.setAttribute('aria-describedby', base);
      else field.removeAttribute('aria-describedby');
    }
  }

  function clearFieldErrors() {
    setFieldError('newPassword', '');
    setFieldError('confirmPassword', '');
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
        btn.textContent = showing ? 'Show' : 'Hide';
        btn.setAttribute('aria-label', (showing ? 'Show ' : 'Hide ') + what);
        input.focus();
      });
    });
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
       cutting off the last. The ticking number lives in a silent element
       beside it, for the eyes only. */
    setAlert('Too many attempts. Wait and try again in ' + left + ' second' +
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

  /* ----------------------------------------------------------- the states */

  var setupForm = el('setupForm');
  var setupSubmit = el('setupSubmit');
  var recovery = el('setupRecovery');
  var recoveryText = el('setupRecoveryText');

  /* There is no link left worth spending, so the form goes and the way back
     takes its place. Any token still in hand is dropped with it, so nothing
     can resubmit it. */
  function showRecovery(text) {
    token = null;
    /* Cleared rather than merely hidden: a hidden input still holds its value,
       and the value here is a password the operator may be about to type
       somewhere else. The success path already does this. */
    el('newPassword').value = '';
    el('confirmPassword').value = '';
    setupForm.hidden = true;
    recoveryText.textContent = text;
    recovery.hidden = false;
  }

  if (tokenStillInBar) {
    setAlert('This browser would not let the page clear the link from the address bar. ' +
      'Finish setting your password, then close this tab and clear it from your history.',
      '', false);
  }

  /* ------------------------------------------------------------- submit */

  setupForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearAlert();
    clearFieldErrors();

    var next = el('newPassword').value;
    var confirm = el('confirmPassword').value;

    if (next.length < MIN_PASSWORD_LENGTH) {
      setFieldError('newPassword', TOO_SHORT);
      el('newPassword').focus();
      return;
    }
    if (next !== confirm) {
      setFieldError('confirmPassword', 'The two passwords do not match.');
      el('confirmPassword').focus();
      return;
    }
    if (!token) {
      showRecovery('This page no longer has a setup link to use. Open the most recent link ' +
        'from your email, or ask for a new one.');
      setAlert('There is no setup link on this page any more.', '', true);
      return;
    }

    busy(setupSubmit, true, 'Setting password', 'Set password');

    api.request('/api/ops/auth/setup/complete', {
      method: 'POST',
      body: { token: token, password: next }
    }).then(function () {
      /* Spent. Whatever happens next, this value is dead, and holding it would
         only be holding a credential. */
      token = null;
      el('newPassword').value = '';
      el('confirmPassword').value = '';
      setupForm.hidden = true;
      setAlert('Password set. Taking you to the sign-in page.', 'is-ok', false);
      /* Deliberately no session: setup issues none, and this page asks for
         none. The operator signs in with what they just chose, which proves it
         works while they are still in front of the form that made it. */
      global.setTimeout(function () {
        global.location.replace('login.html?reason=setup');
      }, 900);
    }, function (err) {
      busy(setupSubmit, false, '', 'Set password');

      if (!(err instanceof api.OpsApiError)) {
        setAlert('Something went wrong setting your password. Try again.', '', true);
        return;
      }
      if (err.code === 'ops_setup_rate_limited') {
        rateLimited(setupSubmit, 'Set password', err.retryAfter);
        return;
      }
      if (err.code === 'ops_setup_password_too_short') {
        /* The server checks the password before it looks at the link, so this
           answer says nothing about the link and the operator can simply try
           again with a longer one. */
        setFieldError('newPassword', err.message || TOO_SHORT);
        el('newPassword').focus();
        return;
      }
      if (err.code === 'ops_setup_rejected') {
        /* One answer for unknown, expired, already used, and replaced by a
           newer link. Saying which would be inventing a distinction the API
           refuses to draw, so the copy names the possibilities instead and
           sends the operator somewhere that can actually help. */
        showRecovery('That link may have expired, it may have been used already, or a newer ' +
          'link may have replaced it. Links last 60 minutes, and asking for a new one retires ' +
          'the old one, so use the most recent email. If you already set a password with an ' +
          'earlier link, sign in with it instead.');
        setAlert('That setup link did not work.', '', true);
        return;
      }
      if (err.code === 'ops_setup_invalid') {
        showRecovery('Open the setup link from your email and choose a password there.');
        setAlert(err.message, '', true);
        return;
      }
      if (err.status >= 500 || err.code === 'ops_route_missing') {
        /* A fault after the password was written is indistinguishable here
           from one before it. The server sets the password first and only then
           records the change, so a 500 can arrive with the account already
           claimed, and an account that is already claimed is refused a new
           setup link in silence. Telling the operator setup failed and sending
           them back to the email would strand them there with a password that
           works. So this says what is actually true, which is that the outcome
           is unknown, and puts the one check that settles it first. */
        showRecovery('The operations API did not answer clearly, so whether your password ' +
          'was saved is not something this page can tell you. Try signing in with the ' +
          'password you just chose. If it works, setup is done. If it does not, ask for a ' +
          'new setup link.');
        setAlert('That did not complete cleanly. Try signing in before asking for a new link.',
          '', true);
        return;
      }
      /* ops_unreachable and anything else: nothing here knows the link has
         been spent, so the form stays where it is and the operator can retry. */
      setAlert(err.message, '', true);
    });
  });

  /* ---------------------------------------------------------------- start */

  wireThemeToggle();
  wirePasswordToggles();

  if (token) {
    setupForm.hidden = false;
    el('newPassword').focus();
  } else {
    /* Reached without a link. Nothing to submit, nothing to send, and the page
       says so rather than showing a form that could only ever fail. */
    showRecovery('This page works from the setup link that was emailed to you, and there is ' +
      'no link on it. Open the most recent link from that email, or ask for a new one.');
  }
})(window);
