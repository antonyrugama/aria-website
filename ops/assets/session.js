/* Session policy for the operations dashboard.

   Everything about who is signed in, how a call recovers when the token has
   aged out, and when a failure means "sign in again" rather than "try again"
   lives here. api.js is the transport underneath it and knows none of this.

   THE INVARIANT THIS FILE EXISTS TO HOLD:

     A refresh token is presented to the server at most once, ever, from this
     browser profile.

   That is not a nicety. The backend rotates the refresh token on every use and
   keeps one generation of history, so re-presenting a token it has already
   rotated is read as theft: it revokes the entire session on every device and
   writes an admin.refresh_reuse_detected event into an append-only audit log
   with no delete path. An operator who middle-clicked a nav link would be
   told a security incident had occurred. Three mechanisms hold the invariant,
   and each closes a case the others cannot:

     1. The access token is cached per tab, so ordinary navigation performs no
        refresh at all. This is what makes the other two rarely needed.
     2. Web Locks serialise the read/POST/write across every same-origin
        context, and the token is re-read after the lock is held rather than
        before waiting for it, so two tabs cannot both present the same value.
     3. A ledger of already-presented tokens, keyed by hash, is consulted
        before every POST. A token this profile has already spent is never
        sent again: the client signs itself out locally instead, which costs
        one sign-in and produces no false compromise event.

   Storage, and why it is split:
     - The refresh token is opaque, lasts up to 30 days, and must survive a
       reload for a durable session to mean anything. It goes to localStorage
       when the operator asked to be remembered on the device, and to
       sessionStorage otherwise, which is what makes "remember this device" a
       real control rather than a decorative one.
     - The access token is a 15 minute JWT cached in sessionStorage. The
       identity design record describes it as memory only, and this is a
       deliberate, documented departure from that line, because memory only
       forces a refresh on every page load of a multi-page shell and therefore
       makes rotation as frequent as navigation. sessionStorage keeps the
       property the contract was protecting, that a browser restart cannot
       resume a session without the refresh exchange, and a 15 minute token is
       a strictly smaller prize than the 30 day refresh token already sitting
       in the same origin's storage by the contract's own accepted trade. The
       backend's identity design record should be updated to match.
     - The spent-token ledger stores SHA-256 hashes, never tokens, so it
       reveals nothing to anything that reads it. */
(function (global) {
  'use strict';

  var api = global.OpsApi;

  var REFRESH_KEY = 'ops-refresh';
  var ACCESS_KEY = 'ops-access';
  var SPENT_KEY = 'ops-spent';
  var LOCK_NAME = 'ops-refresh';
  /* 30 days is the server's hard ceiling on a session, so a hash older than
     that cannot protect anything. 500 entries is roughly five days of
     continuous use at one rotation per fifteen minutes per tab. */
  var SPENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  var SPENT_KEEP = 500;
  var ROOT = 'login.html';

  /* Failures that mean the session itself is finished. Refreshing will not
     help and the only honest response is the sign-in screen. */
  var TERMINAL = {
    ops_session_revoked: 'revoked',
    ops_session_expired: 'expired',
    ops_session_unknown: 'ended',
    ops_account_inactive: 'inactive',
    ops_refresh_rejected: 'expired',
    /* The server could not parse the stored refresh token at all. Retrying
       replays the same unparseable value forever, so this is a finished
       session by any reasonable reading. */
    ops_refresh_invalid: 'ended',
    /* Locally raised: this profile has already presented this token once. */
    ops_refresh_spent: 'ended'
  };

  /* Failures that mean the access token aged out but the session may be fine.
     Worth exactly one refresh-and-retry. */
  var RETRYABLE = { ops_auth_invalid: true, ops_auth_required: true };

  var accessToken = null;
  var accessExpiresAt = 0;
  var refreshInFlight = null;

  var state = {
    admin: null,
    session: null,
    authTime: 0,
    freshAuth: false,
    reauthWindowSeconds: 300
  };

  /* ------------------------------------------------------------- storage */

  function safeGet(store, key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }
  function safeSet(store, key, value) {
    try { store.setItem(key, value); return true; } catch (e) { return false; }
  }
  function safeRemove(store, key) {
    try { store.removeItem(key); } catch (e) {}
  }

  function readRefreshToken() {
    return safeGet(global.sessionStorage, REFRESH_KEY) ||
           safeGet(global.localStorage, REFRESH_KEY);
  }

  /* remember=true survives a browser restart; remember=false lives only as
     long as the tab. Writing one always clears the other so the two stores
     can never disagree about which token is current. */
  function writeRefreshToken(token, remember) {
    if (remember) {
      safeRemove(global.sessionStorage, REFRESH_KEY);
      safeSet(global.localStorage, REFRESH_KEY, token);
    } else {
      safeRemove(global.localStorage, REFRESH_KEY);
      safeSet(global.sessionStorage, REFRESH_KEY, token);
    }
  }

  function rememberedOnDevice() {
    return safeGet(global.localStorage, REFRESH_KEY) !== null;
  }

  /* The access token is cached for this tab only. A tab opened from a link
     inherits a copy of sessionStorage, which is exactly what we want here: the
     new tab starts with a usable access token and therefore does not refresh,
     which is the collision the copy would otherwise cause. */
  function readAccessCache() {
    var raw = safeGet(global.sessionStorage, ACCESS_KEY);
    if (!raw) return null;
    var v;
    try { v = JSON.parse(raw); } catch (e) { return null; }
    if (!v || typeof v.token !== 'string' || typeof v.expiresAt !== 'number') return null;
    if (Date.now() >= v.expiresAt) return null;
    return v;
  }

  function writeAccessCache(token, expiresAt) {
    safeSet(global.sessionStorage, ACCESS_KEY,
      JSON.stringify({ token: token, expiresAt: expiresAt }));
  }

  /* Hashes of refresh tokens this profile has already presented. localStorage
     rather than sessionStorage on purpose: it is shared by every tab including
     ones that inherited a copied sessionStorage, which is the only way a tab
     holding a duplicated token can find out the token is spent.

     Entries are pruned by age, not by count. A hash stops mattering when the
     session that owned it can no longer exist, and the server's ceiling on
     that is 30 days. Evicting on a small count instead would let a tab that
     had been dormant across enough rotations wake up holding a token whose
     hash had scrolled off the end, which is the one way this ledger could
     have failed open. The count cap is only a backstop against unbounded
     growth, and is far above any realistic rotation rate. */
  function readSpent() {
    var raw = safeGet(global.localStorage, SPENT_KEY);
    if (!raw) return [];
    var v;
    try { v = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(v)) return [];
    var floor = Date.now() - SPENT_MAX_AGE_MS;
    return v.filter(function (e) {
      return e && typeof e.h === 'string' && typeof e.t === 'number' && e.t > floor;
    });
  }

  function markSpent(hash) {
    var list = readSpent();
    if (!list.some(function (e) { return e.h === hash; })) {
      list.push({ h: hash, t: Date.now() });
    }
    safeSet(global.localStorage, SPENT_KEY, JSON.stringify(list.slice(-SPENT_KEEP)));
  }

  function isSpent(hash) {
    return readSpent().some(function (e) { return e.h === hash; });
  }

  /* Resolves to a hex digest, or null where SubtleCrypto is unavailable (an
     insecure origin). Null degrades to the pre-ledger behaviour rather than
     blocking sign in, and production is https so it does not arise there. */
  function hashToken(token) {
    var subtle = global.crypto && global.crypto.subtle;
    if (!subtle || !global.TextEncoder) return Promise.resolve(null);
    return subtle.digest('SHA-256', new TextEncoder().encode(token)).then(function (buf) {
      var out = '';
      new Uint8Array(buf).forEach(function (b) {
        out += b.toString(16).padStart(2, '0');
      });
      return out;
    }, function () { return null; });
  }

  function clearTokens() {
    accessToken = null;
    accessExpiresAt = 0;
    refreshInFlight = null;
    safeRemove(global.sessionStorage, REFRESH_KEY);
    safeRemove(global.localStorage, REFRESH_KEY);
    safeRemove(global.sessionStorage, ACCESS_KEY);
    /* The spent ledger deliberately survives. Its whole job is to remember
       tokens across sign-outs and page loads, and it holds only hashes. */
    state.admin = null;
    state.session = null;
    state.authTime = 0;
    state.freshAuth = false;
  }

  /* -------------------------------------------------------- token intake */

  function adoptCredential(data, remember) {
    accessToken = data.accessToken;
    /* Renew thirty seconds early so a call never starts with a token that
       will have expired by the time it arrives. */
    accessExpiresAt = Date.now() + Math.max(0, (data.expiresIn || 900) - 30) * 1000;
    writeAccessCache(accessToken, accessExpiresAt);
    if (data.refreshToken) writeRefreshToken(data.refreshToken, remember);
    if (data.admin) state.admin = data.admin;
    if (data.session) state.session = data.session;
    if (typeof data.authTime === 'number') state.authTime = data.authTime;
    if (typeof data.reauthWindowSeconds === 'number') {
      state.reauthWindowSeconds = data.reauthWindowSeconds;
    }
  }

  /* ------------------------------------------------------------- refresh */

  /* Serialises the whole read/POST/write across every same-origin context.
     Web Locks is the only primitive that reaches other tabs; where it is
     missing we fall back to a per-document queue, which is what this file did
     before and is no worse than it was. */
  var localQueue = Promise.resolve();
  function withRefreshLock(fn) {
    var locks = global.navigator && global.navigator.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request(LOCK_NAME, fn);
    }
    var run = localQueue.then(fn, fn);
    localQueue = run.then(function () {}, function () {});
    return run;
  }

  function spentError() {
    return new api.OpsApiError(401, 'ops_refresh_spent',
      'Your session was continued somewhere else. Sign in again on this device.');
  }

  /* Runs with the lock held. Everything it reads must be read here, not
     captured before the wait, because another context may have rotated the
     token while this one was queued. */
  function exchangeRefreshToken() {
    /* A sibling context in this same tab may have finished a refresh while we
       waited, in which case there is nothing left to do. */
    var cached = readAccessCache();
    if (cached) {
      accessToken = cached.token;
      accessExpiresAt = cached.expiresAt;
      return Promise.resolve({ reused: true });
    }

    var token = readRefreshToken();
    if (!token) {
      return Promise.reject(new api.OpsApiError(401, 'ops_refresh_rejected',
        'Your session has ended. Sign in again.'));
    }
    var remember = rememberedOnDevice();

    return hashToken(token).then(function (hash) {
      if (hash && isSpent(hash)) throw spentError();

      /* Marked before the request, not after. If this document is destroyed
         mid-flight, or the response is lost, the server may still have rotated
         the token, and a client that cannot tell must assume it did. The cost
         is one extra sign-in; the alternative is a replay that revokes the
         session everywhere and files a false compromise event. */
      if (hash) markSpent(hash);

      return api.request('/api/ops/auth/refresh', {
        method: 'POST',
        body: { refreshToken: token }
      });
    }).then(function (payload) {
      adoptCredential(payload.data, remember);
      return payload.data;
    });
  }

  function refresh() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = withRefreshLock(exchangeRefreshToken).then(function (r) {
      refreshInFlight = null;
      return r;
    }, function (err) {
      refreshInFlight = null;
      throw err;
    });

    return refreshInFlight;
  }

  function accessTokenReady() {
    if (accessToken && Date.now() < accessExpiresAt) return Promise.resolve(accessToken);
    /* The cache is what stops ordinary navigation from refreshing. Without it
       every page load of this multi-page shell would rotate the token. */
    var cached = readAccessCache();
    if (cached) {
      accessToken = cached.token;
      accessExpiresAt = cached.expiresAt;
      return Promise.resolve(accessToken);
    }
    return refresh().then(function () { return accessToken; });
  }

  /* -------------------------------------------------------- redirection */

  /* Where to send someone back to after they sign in. Only a path inside this
     dashboard is ever accepted, so a crafted ?next= cannot bounce an operator
     to another site with a fresh session in hand. */
  function currentPath() {
    return global.location.pathname + global.location.search;
  }

  function toLogin(reason) {
    var params = new URLSearchParams();
    var here = currentPath();
    if (!/\/login\.html$/.test(global.location.pathname)) params.set('next', here);
    if (reason) params.set('reason', reason);
    var qs = params.toString();
    global.location.replace(ROOT + (qs ? '?' + qs : ''));
  }

  function endSession(reason) {
    clearTokens();
    toLogin(reason || 'ended');
  }

  /* The password step is a detour, not a destination. Carry where the operator
     was actually heading so they land there once they have chosen one. */
  function toPasswordChange() {
    var params = new URLSearchParams();
    params.set('phase', 'password');
    if (!/\/login\.html$/.test(global.location.pathname)) params.set('next', currentPath());
    global.location.replace(ROOT + '?' + params.toString());
  }

  /* ------------------------------------------------- authenticated calls */

  /* An authenticated request with the full recovery policy applied.

     Order matters. An expired access token is common and cheap to fix, so it
     is refreshed and retried once. A revoked or expired session is terminal
     and gets the sign-in screen immediately. A database wobble behind the auth
     guard answers 503 and must NOT sign anybody out, because the session is
     probably fine and signing out on a transient fault would be its own
     outage. */
  function call(path, opts) {
    opts = opts || {};
    var attempted = { refreshed: false, reauthed: false };

    function attempt() {
      return accessTokenReady().then(function (token) {
        var o = {};
        Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
        o.token = token;
        return api.request(path, o);
      }).catch(function (err) {
        if (!(err instanceof api.OpsApiError)) throw err;

        if (TERMINAL[err.code]) {
          endSession(TERMINAL[err.code]);
          throw err;
        }
        if (RETRYABLE[err.code] && !attempted.refreshed) {
          attempted.refreshed = true;
          accessToken = null;
          accessExpiresAt = 0;
          return attempt();
        }
        if (err.code === 'ops_password_change_required') {
          toPasswordChange();
          throw err;
        }
        if (err.code === 'ops_reauth_required' && !attempted.reauthed && !opts.noReauthPrompt) {
          attempted.reauthed = true;
          return promptReauth(err.maxAgeSeconds).then(function (confirmed) {
            if (!confirmed) throw err;
            return attempt();
          });
        }
        throw err;
      });
    }

    return attempt();
  }

  /* ------------------------------------------------------ sign in / out */

  function signIn(email, password, remember) {
    return api.request('/api/ops/auth/login', {
      method: 'POST',
      body: { email: email, password: password }
    }).then(function (payload) {
      clearTokens();
      adoptCredential(payload.data, !!remember);
      return payload.data;
    });
  }

  /* Best effort. If the network call fails the local credential is dropped
     anyway: leaving a token on the device because the server could not be
     reached is the wrong way to fail. */
  function signOut() {
    var had = readRefreshToken();
    var done = had
      ? call('/api/ops/auth/logout', { method: 'POST', body: {} }).catch(function () {})
      : Promise.resolve();
    return done.then(function () {
      clearTokens();
      global.location.replace(ROOT + '?reason=signedout');
    });
  }

  function changePassword(currentPassword, newPassword) {
    return call('/api/ops/auth/password', {
      method: 'POST',
      body: { currentPassword: currentPassword, newPassword: newPassword }
    }).then(function (payload) {
      if (state.admin) state.admin.mustChangePassword = false;
      return payload.data;
    });
  }

  function reauth(password) {
    return call('/api/ops/auth/reauth', {
      method: 'POST',
      body: { password: password },
      noReauthPrompt: true
    }).then(function (payload) {
      adoptCredential(payload.data, rememberedOnDevice());
      state.freshAuth = true;
      return payload.data;
    });
  }

  function loadSession() {
    return call('/api/ops/auth/session').then(function (payload) {
      state.admin = payload.data.admin;
      state.session = payload.data.session;
      state.authTime = payload.data.authTime;
      state.freshAuth = !!payload.data.freshAuth;
      if (typeof payload.data.reauthWindowSeconds === 'number') {
        state.reauthWindowSeconds = payload.data.reauthWindowSeconds;
      }
      return state;
    });
  }

  /* ---------------------------------------------------------- boot guard */

  /* Resolves only when there is a confirmed, usable session. Every other
     outcome either redirects to the sign-in screen or rejects, and a pane must
     not render anything until this resolves.

     The rejection carries a reason so the page can tell "we are signing you
     out, the redirect is already happening" apart from "the API is down, here
     is a retry button", which are the two cases that otherwise look identical
     and produce the classic half-built shell. */
  function boot() {
    if (!readRefreshToken() && !readAccessCache()) {
      toLogin('required');
      return new Promise(function () {});  /* navigation is in flight */
    }
    return loadSession().then(function (s) {
      if (s.admin && s.admin.mustChangePassword) {
        toPasswordChange();
        return new Promise(function () {});
      }
      return s;
    }, function (err) {
      if (err instanceof api.OpsApiError && TERMINAL[err.code]) {
        return new Promise(function () {});  /* endSession already redirected */
      }
      if (err instanceof api.OpsApiError && err.code === 'ops_password_change_required') {
        return new Promise(function () {});
      }
      throw err;
    });
  }

  /* ------------------------------------------------------- reauth prompt */

  var reauthOpen = null;

  /* A modal that asks for the password again, used when the API answers
     403 ops_reauth_required. Traps focus, closes on Escape, and returns focus
     to whatever the operator was on. Resolves true when the re-authentication
     succeeded and the original call should be retried. */
  function promptReauth(maxAgeSeconds) {
    if (reauthOpen) return reauthOpen;

    reauthOpen = new Promise(function (resolve) {
      var previous = document.activeElement;

      var scrim = document.createElement('div');
      scrim.className = 'scrim is-open';

      var modal = document.createElement('div');
      modal.className = 'modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'reauthTitle');

      var card = document.createElement('form');
      card.className = 'modal-card';

      var h = document.createElement('h2');
      h.id = 'reauthTitle';
      h.className = 'sec-title';
      h.textContent = 'Confirm your password';
      card.appendChild(h);

      var p = document.createElement('p');
      p.className = 'field-hint';
      var mins = Math.max(1, Math.round((maxAgeSeconds || state.reauthWindowSeconds || 300) / 60));
      p.textContent = 'This action needs a recent sign in. Enter your password to continue. ' +
        'It stays confirmed for ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.';
      card.appendChild(p);

      var alert = document.createElement('div');
      alert.className = 'form-alert mt';
      alert.setAttribute('role', 'alert');
      card.appendChild(alert);

      var label = document.createElement('label');
      label.className = 'field-label mt';
      label.setAttribute('for', 'reauthPassword');
      label.textContent = 'Password';
      card.appendChild(label);

      var input = document.createElement('input');
      input.className = 'field-input';
      input.id = 'reauthPassword';
      input.type = 'password';
      input.autocomplete = 'current-password';
      input.required = true;
      card.appendChild(input);

      var row = document.createElement('div');
      row.className = 'row mt';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn';
      cancel.textContent = 'Cancel';
      var submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'btn btn-primary';
      submit.textContent = 'Confirm';
      row.appendChild(cancel);
      var sp = document.createElement('span');
      sp.className = 'spacer';
      row.appendChild(sp);
      row.appendChild(submit);
      card.appendChild(row);

      modal.appendChild(card);
      document.body.appendChild(scrim);
      document.body.appendChild(modal);

      /* Everything that is not the dialog goes inert while it is open, so the
         background is neither clickable nor reachable by a virtual cursor. */
      var backdrop = Array.prototype.filter.call(document.body.children, function (el) {
        return el !== modal && el !== scrim;
      });
      backdrop.forEach(function (el) {
        if ('inert' in el) el.inert = true;
        el.setAttribute('aria-hidden', 'true');
      });

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('focusin', onFocusIn, true);
        backdrop.forEach(function (el) {
          if ('inert' in el) el.inert = false;
          el.removeAttribute('aria-hidden');
        });
        modal.remove();
        scrim.remove();
        reauthOpen = null;
        if (previous && previous.focus) previous.focus();
        resolve(result);
      }

      /* The Tab wrap below only fires when focus is on the first or last
         control. Focus reset to <body>, or returning from browser chrome,
         matches neither branch and would walk straight out of the dialog. */
      function onFocusIn(e) {
        if (!modal.contains(e.target)) {
          var items = focusables();
          if (items.length) items[0].focus();
        }
      }

      function focusables() {
        return Array.prototype.filter.call(
          modal.querySelectorAll('button, input'),
          function (el) { return !el.disabled; }
        );
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
        if (e.key !== 'Tab') return;
        var items = focusables();
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }

      document.addEventListener('keydown', onKey, true);
      document.addEventListener('focusin', onFocusIn, true);
      cancel.addEventListener('click', function () { close(false); });
      scrim.addEventListener('click', function () { close(false); });

      card.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!input.value) { input.focus(); return; }
        submit.disabled = true;
        submit.textContent = 'Checking';
        alert.textContent = '';
        reauth(input.value).then(function () {
          close(true);
        }, function (err) {
          submit.disabled = false;
          submit.textContent = 'Confirm';
          input.value = '';
          alert.textContent = (err && err.message) || 'That password did not match.';
          input.focus();
        });
      });

      input.focus();
    });

    return reauthOpen;
  }

  /* ------------------------------------------------------------ helpers */

  function daysLeft() {
    if (!state.session || !state.session.expiresAt) return null;
    var ms = new Date(state.session.expiresAt).getTime() - Date.now();
    if (!isFinite(ms)) return null;
    return Math.max(0, Math.floor(ms / 86400000));
  }

  function role() {
    return (state.admin && state.admin.role) || null;
  }

  function hasRole(required) {
    var r = role();
    if (!r) return false;
    if (!required || !required.length) return true;
    return required.indexOf(r) !== -1;
  }

  global.OpsSession = {
    state: state,
    boot: boot,
    call: call,
    signIn: signIn,
    signOut: signOut,
    refresh: refresh,
    loadSession: loadSession,
    changePassword: changePassword,
    reauth: reauth,
    promptReauth: promptReauth,
    clearTokens: clearTokens,
    readRefreshToken: readRefreshToken,
    rememberedOnDevice: rememberedOnDevice,
    daysLeft: daysLeft,
    role: role,
    hasRole: hasRole,
    toLogin: toLogin
  };
})(window);
