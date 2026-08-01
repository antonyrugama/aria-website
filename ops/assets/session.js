/* Session policy for the operations dashboard.

   Everything about who is signed in, how a call recovers when the token has
   aged out, and when a failure means "sign in again" rather than "try again"
   lives here. api.js is the transport underneath it and knows none of this.

   WHAT THIS FILE PROMISES, stated exactly:

     Ordinary races converge. A copy of a credential that has been superseded
     signs that tab out locally. The server adjudicates; the client does not
     pretend to.

   That is deliberately weaker than the absolute "at most once, ever" an
   earlier draft claimed, and the weaker promise is the honest one.

   The exchange it is written against: the refresh token rotates on every use,
   and the immediately-previous generation presented within a few seconds of
   its rotation is answered with a fresh access token, refreshTokenRotated:
   false, and no refresh token, rather than being treated as theft. Two tabs
   refreshing at the same moment therefore converge. The same generation
   presented long after its rotation is theft as far as the server is
   concerned and ends the session everywhere; anything older than that is
   simply refused. This file does not try to make either of those calls
   itself.

   Given that, the client does not have to be the thing that makes races safe,
   and the machinery here is sized accordingly:

     1. The access token is cached per tab, so ordinary navigation performs no
        refresh at all. This is the one that still earns its keep: it turns
        rotation from once per page view into roughly once per fifteen minutes
        per tab, which is the difference between constant races and rare ones.
     2. Web Locks serialise the exchange across same-origin contexts where the
        API exists. This is now an efficiency measure, not a correctness one,
        so its absence is fine and the fallback is a per-document queue.
     3. A ledger of already-presented token hashes, the moment each was
        presented and which context presented it, consulted before an exchange.
        This is a local courtesy, not a guarantee, and it is worth being exact
        about which. It targets the one case the grace window cannot cover: a
        refresh whose response was lost, presented again long after the window
        has passed. When it hits, the operator gets a clean sign-in on this
        device instead of a refusal that ends the session everywhere. When it
        misses, and it will, the request goes to the server and the server
        decides, which is the correct outcome reached by a worse route.

        The timestamp is the whole point of the entry, not bookkeeping around
        it. A hash on its own cannot tell a replay from the other tab in an
        ordinary race, and refusing the race locally is how a client talks
        itself out of the very grace window that exists to absorb it. So an
        entry younger than the window is presented anyway and the server
        answers it; only an older one is refused here.

        It misses whenever storage is full, SubtleCrypto is absent, or the
        entry has been evicted, and eviction is the honest limit: the list is
        capped, so the further into the past a lost response was, the less
        likely its hash is still here. Sizing it to cover every case would
        mean unbounded storage for a UX nicety. Nothing here is load bearing,
        which is exactly why every path fails open.

   Storage:
     - The refresh token is opaque, lasts up to 30 days, and must survive a
       reload for a durable session to mean anything. It goes to localStorage
       when the operator asked to be remembered on the device, and to
       sessionStorage otherwise, which is what makes "remember this device" a
       real control rather than a decorative one. It is stored with the
       administrator it belongs to and read back with the store it came from,
       so a tab can tell both when the credential under it has become somebody
       else's and whether what it is holding is private to this tab or shared
       with every tab on the browser. Nothing here ever writes over or deletes
       a stored credential belonging to another administrator.
     - The access token is a 15 minute JWT cached in sessionStorage. Memory
       only forces a refresh on every page load of a multi-page shell, which
       is what made rotation as frequent as navigation. sessionStorage keeps
       the property that matters, that a browser restart cannot resume a
       session without the refresh exchange.
     - The ledger stores SHA-256 hashes, never tokens, so it reveals nothing
       to anything that reads it. */
(function (global) {
  'use strict';

  var api = global.OpsApi;

  var REFRESH_KEY = 'ops-refresh';
  var ACCESS_KEY = 'ops-access';
  var SUPERSEDED_KEY = 'ops-superseded';
  var SPENT_KEY = 'ops-spent';
  var LOCK_NAME = 'ops-refresh';
  /* Raised when the credential under this tab has become a different
     administrator's. Carried as an error code so no call site can adopt a
     credential without dealing with it. */
  var IDENTITY_CHANGED = 'ops_identity_changed';
  /* Raised when the browser refused to store the credential. Never silent: a
     refresh token that was not written is a session that ends without warning
     when the access token does, which is the one failure an operator must not
     discover halfway through an incident. */
  var STORAGE_UNAVAILABLE = 'ops_storage_unavailable';
  /* A plain capped list, oldest evicted first. Roughly ten days of one-tab use
     at one exchange per fifteen minutes, proportionally less with more tabs
     open, which is a deliberate compromise rather than a size chosen to cover
     the whole 30 day session ceiling: covering that would mean unbounded
     storage to buy a nicer sign-out message.

     Be clear about which way the cost runs. An eviction is this guard missing,
     and a miss is the expensive direction: the stale token reaches the server
     and the server ends the session rather than this device signing itself out
     quietly. That is the correct security outcome by a worse route, and
     accepting it is why the list is capped by count rather than sized to the
     whole session ceiling. */
  var SPENT_KEEP = 1000;
  /* How recently a token can have been presented and still be worth
     presenting again. Deliberately well inside the window the server absorbs,
     so that clock skew and a slow request cannot carry a presentation this
     side judged safe past the point where the other side stops being gentle
     about it. Under it, the race goes to the server, which is the only thing
     that can actually resolve one. Over it, this device signs itself out
     instead. */
  var SPENT_GRACE_MS = 5000;
  /* Tells this document's ledger entries apart from every other same-origin
     context's. Per document rather than per tab, which is the right grain: a
     mark is only ever taken back by the exchange that wrote it, and that
     exchange cannot outlive the page it is running on. Uniqueness is all that
     is asked of the value, so a refused or absent crypto API is not a failure
     here. */
  var CONTEXT_ID = (function () {
    var c = global.crypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch (e) {}
    }
    return String(Date.now()) + '-' + String(Math.random()).slice(2);
  })();
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
    /* Locally raised: this tab's copy of the credential has been superseded by
       a rotation it cannot see. Terminal for this tab, and only for this tab,
       which is why call() gives it its own ending. */
    ops_refresh_spent: 'continued'
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

  function storeNamed(name) {
    return name === 'local' ? global.localStorage : global.sessionStorage;
  }

  /* The refresh credential is stored with the administrator it belongs to, and
     read back with the store it came from. Both halves are load bearing.

     The subject, because one administrator has one refresh slot, so a second
     sign-in replaces it, and without the subject beside it a tab already
     rendered for one administrator has no way to notice the credential
     underneath it is now someone else's.

     The store, because localStorage is shared by every tab on the browser and
     sessionStorage is private to one. Two administrators can be signed in at
     once, one remembered and one not, and a tab that cannot tell which store
     its own credential came from will happily write over the other one. */
  function readRecordFrom(name) {
    var raw = safeGet(storeNamed(name), REFRESH_KEY);
    if (!raw) return null;
    var v;
    try { v = JSON.parse(raw); } catch (e) { return null; }
    if (!v || typeof v.t !== 'string' || !v.t) return null;
    return { token: v.t, subject: typeof v.s === 'string' ? v.s : null, store: name };
  }

  /* sessionStorage first. A tab with its own private credential is using that
     one, and somebody else's remembered credential can be sitting in
     localStorage beside it. */
  function readRefreshRecord() {
    return readRecordFrom('session') || readRecordFrom('local');
  }

  function readRefreshToken() {
    var rec = readRefreshRecord();
    return rec ? rec.token : null;
  }

  function storedSubject() {
    var rec = readRefreshRecord();
    return rec ? rec.subject : null;
  }

  /* Removes the refresh records this tab is entitled to remove: its own
     private one, and the shared one only when that names the same
     administrator, or nobody. A shared record naming somebody else is their
     live credential, and a tab reaching the end of its own session has no
     business ending theirs. */
  function forgetRefreshRecords(subject) {
    safeRemove(global.sessionStorage, REFRESH_KEY);
    var shared = readRecordFrom('local');
    if (shared && (shared.subject === null || shared.subject === subject)) {
      safeRemove(global.localStorage, REFRESH_KEY);
    }
  }

  /* remember=true survives a browser restart; remember=false lives only as
     long as the tab.

     Returns false when the browser refused the write, and the caller must not
     treat that as a stored session. On failure the record this administrator
     still has is removed rather than left behind, because the token in it has
     just been superseded server side and replaying it later is the one outcome
     worse than holding no token at all. */
  function writeRefreshToken(token, remember, subject) {
    var payload = JSON.stringify({ t: token, s: subject || null });
    var target = remember ? 'local' : 'session';
    var other = remember ? 'session' : 'local';

    if (!safeSet(storeNamed(target), REFRESH_KEY, payload)) {
      forgetRefreshRecords(subject);
      return false;
    }

    /* The other store is cleared only when what it holds belongs to this
       administrator, or to nobody. Clearing it unconditionally is how a tab
       signing in without "remember this device" deletes the remembered
       credential of whoever else is signed in on this browser. */
    var stale = readRecordFrom(other);
    if (stale && (stale.subject === null || stale.subject === subject)) {
      safeRemove(storeNamed(other), REFRESH_KEY);
    }
    return true;
  }

  /* Whether this browser holds a remembered credential at all. A hint for the
     sign-in form's "remember this device" box and nothing more: it says
     somebody chose to be remembered here, not that it was this tab, and it is
     deliberately not what decides where a rotated token is written. */
  function rememberedOnDevice() {
    return readRecordFrom('local') !== null;
  }

  /* Whether the credential this tab is using is the remembered one. This, not
     rememberedOnDevice(), is what decides where a rotated token is written. */
  function storedRemember() {
    var rec = readRefreshRecord();
    return !!rec && rec.store === 'local';
  }

  /* The access token is cached for this tab only. A tab opened from a link
     inherits a copy of sessionStorage, which is exactly what we want here: the
     new tab starts with a usable access token and therefore does not refresh,
     which is the collision the copy would otherwise cause.

     The cache carries its subject too. If another tab has since signed in as a
     different administrator, this tab's cached bearer belongs to the previous
     one, and handing it back as though it were current is how a tab silently
     starts acting as somebody else. */
  /* Parses and validates the cache entry, expiry included. Everything that
     reads the cache goes through here, because an entry that has expired is
     not merely an unusable token: it is also not evidence of who this tab is.
     Treating a stale entry as an identity is how an idle tab talks itself into
     believing a switch has happened. */
  function readAccessEntry() {
    var raw = safeGet(global.sessionStorage, ACCESS_KEY);
    if (!raw) return null;
    var v;
    try { v = JSON.parse(raw); } catch (e) { return null; }
    if (!v || typeof v.token !== 'string' || typeof v.expiresAt !== 'number') return null;
    if (Date.now() >= v.expiresAt) return null;
    return v;
  }

  function readAccessCache() {
    var v = readAccessEntry();
    if (!v) return null;
    var current = storedSubject();
    if (v.s && current && v.s !== current) return null;
    return v;
  }

  function cachedSubject() {
    var v = readAccessEntry();
    return v && typeof v.s === 'string' ? v.s : null;
  }

  /* Best effort, and unlike the refresh record that is the whole of it: the
     token is held in memory as well, so a refused write costs this document
     nothing. What it costs is the next page load in this tab, which has to
     exchange the refresh token rather than read the cache. More exchanges mean
     more races, which is a slower dashboard rather than a broken session, so
     the return value is deliberately not acted on. */
  function writeAccessCache(token, expiresAt, subject) {
    return safeSet(global.sessionStorage, ACCESS_KEY,
      JSON.stringify({ token: token, expiresAt: expiresAt, s: subject || null }));
  }

  /* Set when the server has told this tab, in so many words, that the token it
     presented is the previous generation and the successor was written where
     this tab cannot read it. It is the difference between "your session has
     ended" and "your session carried on in another tab", and only this tab
     knows which of those happened.

     In sessionStorage rather than a module variable, because this is a
     multi-page shell and a module variable is forgotten by the next pane the
     operator opens. The tab that retired its copy keeps a working access token
     for up to fifteen minutes, so the flag has to survive every navigation
     inside that window or the ending it explains arrives wearing the wrong
     sentence: "your session expired", on a session that is still live in the
     tab that won the rotation. It sits beside the record it describes, in the
     store the retirement already wrote to, and is private to this tab for the
     same reason that record is. */
  function markSuperseded(on) {
    if (on) safeSet(global.sessionStorage, SUPERSEDED_KEY, '1');
    else safeRemove(global.sessionStorage, SUPERSEDED_KEY);
  }

  function credentialSuperseded() {
    return safeGet(global.sessionStorage, SUPERSEDED_KEY) === '1';
  }

  /* Throws away the access token everywhere it is held, memory and cache
     together. Clearing only the memory copy leaves the cache to hand the same
     rejected token straight back on the next read, which turns the
     refresh-and-retry path into a silent no-op. */
  function discardAccess() {
    accessToken = null;
    accessExpiresAt = 0;
    safeRemove(global.sessionStorage, ACCESS_KEY);
  }

  /* Hashes of refresh tokens this browser has already presented, each with the
     moment it was presented and the context that presented it. localStorage
     rather than sessionStorage on purpose: it is shared by every tab including
     ones that inherited a copied sessionStorage, which is the only way a tab
     holding a duplicated token can find out the token has been presented at
     all. That sharing is also why an entry has to say whose presentation it
     records: two tabs can present the same token, and only one of them may
     take its own mark back.

     Every operation here is best effort and every failure path returns the
     answer that lets the exchange proceed. The server, not this list, decides
     whether a token is acceptable. */
  function readSpent() {
    var raw = safeGet(global.localStorage, SPENT_KEY);
    if (!raw) return [];
    var v;
    try { v = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(v)) return [];
    return v.filter(function (e) {
      return e && typeof e.h === 'string' && typeof e.at === 'number';
    });
  }

  function writeSpent(list) {
    return safeSet(global.localStorage, SPENT_KEY,
      JSON.stringify(list.slice(-SPENT_KEEP)));
  }

  /* Records that this context has presented the token, and returns the entry
     it wrote so that a later release can take back that one and nothing else.
     Null when the write was refused: the next presentation of this token
     cannot be recognised here and goes to the server instead, which is the
     documented way this list fails.

     Another context's entry for the same token is left where it is. Only this
     context's own earlier mark for this same token is replaced, so a retry
     does not accumulate entries. */
  function markSpent(hash) {
    var list = readSpent().filter(function (e) {
      return e.h !== hash || e.o !== CONTEXT_ID;
    });
    var entry = { h: hash, at: Date.now(), o: CONTEXT_ID };
    list.push(entry);
    return writeSpent(list) ? entry : null;
  }

  /* Takes one entry back out, for the one case where the token demonstrably
     was not consumed by THIS presentation: the request never reached a server
     that could rotate it. Only the exact entry this context wrote is removed.

     Whose entry it is, is the whole of this. Two tabs holding the same
     Remember-off copy legitimately present the same token, and a release that
     matched on the hash alone would erase the entry recording the sibling's
     successful presentation. The token would then be invisible to the ledger,
     and this tab's next attempt would present an already rotated token long
     after its rotation, which the server reads as theft and answers by ending
     the session everywhere. */
  function releaseSpent(mark) {
    var list = readSpent();
    var kept = list.filter(function (e) {
      return !(e.h === mark.h && e.o === mark.o && e.at === mark.at);
    });
    if (kept.length !== list.length) writeSpent(kept);
  }

  /* When this browser presented the token, or 0 if it never did. A clock that
     has moved backwards yields a negative age, which reads as recent and sends
     the exchange to the server: the fail-open direction, as everywhere else
     here. */
  function spentAt(hash) {
    var list = readSpent();
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].h === hash) return list[i].at;
    }
    return 0;
  }

  /* Resolves to a hex digest, or null where SubtleCrypto is unavailable (an
     insecure origin). Null skips the guard rather than blocking sign in, which
     is the correct trade now that the guard is a courtesy rather than a
     correctness requirement. Production is https, so it does not arise there. */
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

  /* Ends the session this tab is holding: memory, cache, and the stored
     credential it is entitled to remove.

     "Entitled to" is the whole of the difference from an earlier draft. Who
     this tab is, is what it has rendered, or failing that whoever the record
     it is actually using belongs to. Anything else in shared storage names a
     different administrator and stays exactly where it is. */
  function clearTokens() {
    var mine = readRefreshRecord();
    var subject = committedSubject() || (mine && mine.subject) || null;
    refreshInFlight = null;
    markSuperseded(false);
    discardAccess();
    forgetRefreshRecords(subject);
    /* The spent ledger deliberately survives. Its whole job is to remember
       tokens across sign-outs and page loads, and it holds only hashes. */
    state.admin = null;
    state.session = null;
    state.authTime = 0;
    state.freshAuth = false;
  }

  /* -------------------------------------------------------- token intake */

  /* The identity this tab has already committed to, if any: what it rendered,
     or failing that what its cached bearer belongs to. Null means the tab has
     not shown anybody anything yet, and adopting whichever credential is on
     the device is simply correct rather than a switch. */
  function committedSubject() {
    return (state.admin && state.admin.id) || cachedSubject() || null;
  }

  /* Throws, rather than returning a flag, when the credential belongs to a
     different administrator than the one this tab is already showing. A
     boolean can be ignored by omission, and two of the three call sites cannot
     currently reach the mismatch, so a returned flag would have been safety
     resting on incidental ordering. Throwing makes every present and future
     caller deal with it. Navigation to the sign-in screen is already under way
     by the time this throws. */
  function adoptCredential(data, remember, presented) {
    var incoming = (data.admin && data.admin.id) || null;
    var committed = committedSubject();
    if (incoming && committed && incoming !== committed) {
      identityChanged();
      throw new api.OpsApiError(401, IDENTITY_CHANGED,
        'A different administrator signed in on this browser.');
    }
    var subject = incoming || committed;

    accessToken = data.accessToken;
    /* Renew thirty seconds early so a call never starts with a token that
       will have expired by the time it arrives. */
    accessExpiresAt = Date.now() + Math.max(0, (data.expiresIn || 900) - 30) * 1000;
    writeAccessCache(accessToken, accessExpiresAt, subject);

    /* A grace response says refreshTokenRotated: false and carries no refresh
       token. An explicit flag rather than the absence of a field, so that a
       future response shape cannot quietly turn this into an overwrite. */
    if (data.refreshTokenRotated === false) {
      retireSupersededToken(presented);
    } else if (data.refreshToken) {
      markSuperseded(false);
      if (!writeRefreshToken(data.refreshToken, remember, subject)) {
        /* The bearer assigned a few lines up goes with it. A refresh token
           that was not stored is a session that cannot outlive this access
           token, and leaving the access token behind is what turns the failure
           card's Try again into a reload that opens the dashboard on a
           fifteen minute fuse: boot() proceeds on the cache alone. What the
           card says at that moment, that nothing has been signed out and the
           session is still live on the server, stays true either way. This is
           the same cleanup signIn() already does with this code, and it
           removes only what is private to this tab: the stored records were
           dealt with, by administrator, inside writeRefreshToken(). */
        discardAccess();
        throw new api.OpsApiError(0, STORAGE_UNAVAILABLE,
          'This browser would not let the dashboard store your session. Free some ' +
          'space or allow storage for this site, then sign in again.');
      }
    }

    if (data.admin) state.admin = data.admin;
    if (data.session) state.session = data.session;
    if (typeof data.authTime === 'number') state.authTime = data.authTime;
    if (typeof data.reauthWindowSeconds === 'number') {
      state.reauthWindowSeconds = data.reauthWindowSeconds;
    }
    return data;
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
      'Your session carried on in another tab. Sign in again in this one.');
  }

  /* Called on a grace response, which is the server saying plainly that the
     token this tab presented is the previous generation. Whoever won the
     rotation wrote the successor into their own store.

     If that store is one this tab can read, it already holds the successor and
     the next exchange picks it up with nothing to do here: that is the
     "remember this device" case, where both tabs share one localStorage slot.

     If the slot still holds exactly what we presented, this tab's copy is
     private, the successor is in another tab's sessionStorage, and the token
     in hand is provably dead. It goes, because the alternative is presenting
     it again later, when the server no longer has a reason to be gentle about
     it. Nothing belonging to anybody else is touched: the only record removed
     is the one whose token this tab just proved to be superseded. */
  function retireSupersededToken(presented) {
    var rec = readRefreshRecord();
    if (presented && rec && rec.token === presented) {
      safeRemove(storeNamed(rec.store), REFRESH_KEY);
      markSuperseded(true);
      return;
    }
    markSuperseded(false);
  }

  /* Raised when the credential under this tab has become a different
     administrator's. Never adopted silently: the tab is signed out locally and
     sent to the sign-in screen with an explanation. */
  function identityChanged() {
    clearLocalIdentity();
    toLogin('switched');
  }

  /* Drops what this tab believes about itself and nothing else.

     Deliberately NOT clearTokens(). The credential that triggered the mismatch
     is the shared one, and it belongs to the administrator who is currently
     signed in on this browser, not to the stale tab that just noticed. Wiping
     it would let an idle tab sign the current administrator out of every other
     tab on the machine, which is a worse outcome than the silent switch this
     guard exists to prevent. The tab forgets who it was; the session on the
     device is left alone. */
  function clearLocalIdentity() {
    refreshInFlight = null;
    discardAccess();
    state.admin = null;
    state.session = null;
    state.authTime = 0;
    state.freshAuth = false;
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

    var rec = readRefreshRecord();
    if (!rec) {
      /* Two different endings share this branch and must not share a sentence.
         A tab whose superseded copy was retired knows the session carried on
         without it; a tab with nothing stored knows only that there is nothing
         to exchange. */
      return Promise.reject(credentialSuperseded() ? spentError()
        : new api.OpsApiError(401, 'ops_refresh_rejected',
            'Your session has ended. Sign in again.'));
    }

    /* Refused before it is presented, not after it has been adopted. The
       record names the administrator it belongs to, so a tab displaying one
       administrator can tell that the credential underneath it is now somebody
       else's without spending it. Checking after the exchange is far too late:
       by then this tab has rotated a credential it has no business rotating,
       and its owner is left holding a token the server has already retired. */
    var committed = committedSubject();
    if (rec.subject && committed && rec.subject !== committed) {
      identityChanged();
      return Promise.reject(new api.OpsApiError(401, IDENTITY_CHANGED,
        'A different administrator signed in on this browser.'));
    }

    var token = rec.token;
    /* Where the rotated token goes is decided by where this one came from, not
       by whether the browser happens to hold a remembered credential for
       somebody. Reading the device instead of the record is how a tab that
       chose not to be remembered moves its own token into localStorage and
       deletes another administrator's on the way. */
    var remember = rec.store === 'local';

    return hashToken(token).then(function (hash) {
      var presentedAt = hash ? spentAt(hash) : 0;
      /* Only an old presentation is refused here. A recent one is the other
         tab in an ordinary race, and the server absorbs those; refusing it
         locally would sign an operator out without a single request leaving
         the browser, on the strength of a guess this side is not equipped to
         make. */
      if (presentedAt && Date.now() - presentedAt > SPENT_GRACE_MS) throw spentError();

      /* Marked before the request, not after. If this document is destroyed
         mid-flight, or the response is lost, the server may still have rotated
         the token and this client cannot tell. Recording it first means a much
         later replay is caught here and costs one sign-in, instead of reaching
         the server long after its rotation. */
      var mark = hash ? markSpent(hash) : null;

      return api.request('/api/ops/auth/refresh', {
        method: 'POST',
        body: { refreshToken: token }
      }).catch(function (err) {
        /* A fault below HTTP, or a 5xx from in front of the application, is
           overwhelmingly a request that never reached the thing that rotates.
           Keeping the token marked would turn a gateway blip or a dropped
           connection into a forced sign-in on the next attempt, and the retry
           button this dashboard offers would be the thing that signed the
           operator out, without a single request leaving the browser. So this
           context's own mark comes off and the credential survives the fault.
           Its own, and no other: a sibling tab holding the same copy may have
           presented the same token and been answered, and erasing the record
           of that is how a fault in one tab ends the session in all of them.

           What that gives up, stated rather than glossed: this context's own
           response, lost after the server had already rotated, looks identical
           from here, and releasing the mark lets that token be presented once
           more. The server reads it as the previous generation returning long
           after its rotation and ends the session everywhere, which is the
           outcome the ledger was only ever a politer route to. Losing a
           session to a passing outage is the more common failure and the less
           defensible one. */
        if (mark && err instanceof api.OpsApiError &&
            (err.status === 0 || err.status >= 500)) {
          releaseSpent(mark);
        }
        throw err;
      });
    }).then(function (payload) {
      adoptCredential(payload.data, remember, token);
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

  /* The ending for a tab whose copy of the credential has been superseded by a
     rotation it could not see. Only this tab signs out, and only what is
     private to this tab is removed: the shared slot may well hold the live
     successor, and a tab that has fallen behind must never be able to sign the
     current administrator out of every other tab on the machine. A dead token
     left in shared storage can do nothing worse than earn a 401. */
  function endSupersededCopy() {
    clearLocalIdentity();
    safeRemove(global.sessionStorage, REFRESH_KEY);
    toLogin('continued');
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

        if (err.code === IDENTITY_CHANGED) {
          /* identityChanged() has already cleared state and is navigating.
             Never settle, so nothing downstream renders with the wrong
             administrator's data in hand. */
          return new Promise(function () {});
        }
        if (TERMINAL[err.code]) {
          /* Terminal for this tab is not the same as terminal for the session.
             Everything the server calls finished ends the session; a
             superseded copy ends only the tab holding it. */
          if (err.code === 'ops_refresh_spent') endSupersededCopy();
          else endSession(TERMINAL[err.code]);
          throw err;
        }
        if (RETRYABLE[err.code] && !attempted.refreshed) {
          attempted.refreshed = true;
          /* Both copies, or accessTokenReady() rehydrates the very token the
             server just rejected and the refresh never happens. */
          discardAccess();
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
      /* Signing in as somebody else is a deliberate switch, not a silent one,
         so the slate is wiped first and nothing is committed to compare
         against. This is the one place a stored credential is replaced on
         purpose: everywhere else, a record belonging to another administrator
         is left where it is. */
      clearTokens();
      try {
        adoptCredential(payload.data, !!remember);
      } catch (e) {
        /* A session the browser would not store is not a session. Leave
           nothing half adopted behind, and let the sign-in screen say so
           rather than navigating into a dashboard that is about to end. */
        if (e && e.code === STORAGE_UNAVAILABLE) clearTokens();
        throw e;
      }
      return payload.data;
    });
  }

  /* Always attempts the server-side revocation, and swallows whatever comes
     back. Deciding from the presence of a refresh token was wrong: a tab can
     legitimately hold a live access token with no refresh token beside it,
     once another tab or a storage failure has removed the shared one. In that
     state the old check skipped the call, cleared local storage, and left the
     session alive on the server for every other copy of it. Whether a call can
     be made is the question, not whether one particular credential is present.

     If the call fails the local credential is dropped anyway: leaving a token
     on the device because the server could not be reached is the wrong way to
     fail. */
  function signOut() {
    var haveSomething = accessToken || readAccessCache() || readRefreshToken();
    var done = haveSomething
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
      /* Re-authentication mints an access token and nothing else, so there is
         no refresh token to place. The flag is read from the record this tab
         is actually using anyway, so that a future response shape carrying one
         cannot land it in the wrong store. */
      adoptCredential(payload.data, storedRemember());
      state.freshAuth = true;
      return payload.data;
    });
  }

  function loadSession() {
    return call('/api/ops/auth/session').then(function (payload) {
      var incoming = payload.data.admin && payload.data.admin.id;
      var committed = committedSubject();
      if (incoming && committed && incoming !== committed) {
        identityChanged();
        throw new api.OpsApiError(401, IDENTITY_CHANGED,
          'A different administrator signed in on this browser.');
      }
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
      if (err instanceof api.OpsApiError && err.code === IDENTITY_CHANGED) {
        return new Promise(function () {});
      }
      throw err;
    });
  }

  /* ------------------------------------------------------- reauth prompt */

  /* An element whose whole job is to announce. shell.js appends both of these
     to the body, so any overlay that inerts the body's children will find
     them. The same test lives there, because neither file may depend on the
     other having loaded. */
  function isLiveRegion(el) {
    return el.hasAttribute('aria-live') || el.classList.contains('toast-host');
  }

  var reauthOpen = null;
  /* Every dialog gets a number. A network call started by one dialog can only
     finish after the operator has cancelled it and opened another, so its
     handlers have to be able to tell whether they are still the current
     dialog before they touch any shared state. */
  var reauthGeneration = 0;

  /* A modal that asks for the password again, used when the API answers
     403 ops_reauth_required. Traps focus, closes on Escape, and returns focus
     to whatever the operator was on. Resolves true when the re-authentication
     succeeded and the original call should be retried. */
  function promptReauth(maxAgeSeconds) {
    if (reauthOpen) return reauthOpen;

    var generation = ++reauthGeneration;

    reauthOpen = new Promise(function (resolve) {
      var previous = document.activeElement;
      var closed = false;

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
         background is neither clickable nor reachable by a virtual cursor.

         Live regions are the exception, and the exception matters: a live
         region carrying aria-hidden announces nothing, so inerting one would
         silence exactly the messages a dialog is most likely to produce. They
         hold no focusable content, so leaving them out of the backdrop costs
         the modality nothing. */
      var backdrop = Array.prototype.filter.call(document.body.children, function (el) {
        return el !== modal && el !== scrim && !isLiveRegion(el);
      });
      backdrop.forEach(function (el) {
        if ('inert' in el) el.inert = true;
        el.setAttribute('aria-hidden', 'true');
      });

      /* Idempotent, and it never touches anything it does not still own. A
         late-arriving success from a dialog the operator already cancelled
         would otherwise strip inert off a newer dialog's backdrop, leaving
         that dialog on screen over a fully interactive shell. */
      function close(result) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('focusin', onFocusIn, true);
        backdrop.forEach(function (el) {
          if ('inert' in el) el.inert = false;
          el.removeAttribute('aria-hidden');
        });
        modal.remove();
        scrim.remove();
        /* Only the current dialog may release the shared slot. */
        if (generation === reauthGeneration) reauthOpen = null;
        if (previous && previous.focus) previous.focus();
        resolve(result);
      }

      function isCurrent() {
        return !closed && generation === reauthGeneration;
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
          /* The re-authentication itself still counted, so the caller's token
             is fresh either way. What must not happen is this dialog tidying
             up after a different one. */
          if (!isCurrent()) return;
          close(true);
        }, function (err) {
          if (!isCurrent()) return;
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
    /* clearTokens is deliberately not exported. It drops the credential
       without telling the server, which is a sign-out that leaves the session
       alive everywhere else; signOut() is the one a page should reach for. */
    readRefreshToken: readRefreshToken,
    rememberedOnDevice: rememberedOnDevice,
    daysLeft: daysLeft,
    role: role,
    hasRole: hasRole,
    toLogin: toLogin
  };
})(window);
