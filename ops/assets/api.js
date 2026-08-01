/* Transport for the operations API.

   Deliberately dumb. This file knows how to reach app-backend, how to attach a
   bearer token it is handed, and how to turn every possible response into one
   predictable shape. It knows nothing about sessions, refreshing, roles, or
   what to do when a call fails. That policy lives in session.js, which is the
   only caller. Keeping the seam here means the retry and sign-out rules are
   readable in one place instead of tangled through fetch options.

   Two things about the boundary are load bearing and are settled by the
   backend's identity design record rather than by preference here:

     - The session is a bearer token in the Authorization header, never a
       cookie. Every request therefore sends credentials: 'omit' so that no
       ambient credential from anywhere else on runwitharia.com is attached.
     - There is no CSRF token on /api/ops/*. The route family is exempt from
       the backend's double-submit guard precisely because it never reads a
       cookie, so sending X-CSRF-Token here would be cargo cult.
*/
(function (global) {
  'use strict';

  var PROD_BASE = 'https://api.runwitharia.com';

  /* Local verification escape hatch. Only honoured when the page itself is
     being served from a loopback address, so nothing about a real deployment
     on runwitharia.com can be pointed at another host. */
  function baseUrl() {
    var host = global.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      try {
        var override = localStorage.getItem('ops-api-base');
        if (override) return override.replace(/\/+$/, '');
      } catch (e) { /* storage unavailable, fall through to production */ }
    }
    return PROD_BASE;
  }

  /* Every failure the dashboard can see, normalised.

     code is the backend's machine-readable error code where there was one,
     and a locally minted code where the failure happened below HTTP (no
     network, unreadable body). Callers branch on code, never on message. */
  function OpsApiError(status, code, message, extra) {
    this.name = 'OpsApiError';
    this.status = status;
    this.code = code;
    this.message = message;
    this.retryAfter = extra && extra.retryAfter;
    this.requiredRoles = extra && extra.requiredRoles;
    this.maxAgeSeconds = extra && extra.maxAgeSeconds;
  }
  OpsApiError.prototype = Object.create(Error.prototype);
  OpsApiError.prototype.constructor = OpsApiError;

  var GENERIC = 'Something went wrong talking to the operations API.';

  /* The backend answers with two different error envelopes and a client that
     assumes one of them will throw on the other. Routed errors are
     { error: { code, message } }; anything that matched no route at all comes
     back from the app-level 404 handler as { error: "Not found" }, a string. */
  function toError(status, payload) {
    if (payload && typeof payload.error === 'object' && payload.error) {
      var e = payload.error;
      return new OpsApiError(status, e.code || 'ops_unknown', e.message || GENERIC, {
        retryAfter: typeof e.retryAfter === 'number' ? e.retryAfter : undefined,
        requiredRoles: Array.isArray(e.requiredRoles) ? e.requiredRoles : undefined,
        maxAgeSeconds: typeof e.maxAgeSeconds === 'number' ? e.maxAgeSeconds : undefined
      });
    }
    if (payload && typeof payload.error === 'string') {
      return new OpsApiError(status, 'ops_route_missing', payload.error);
    }
    return new OpsApiError(status, 'ops_unknown', GENERIC);
  }

  /* opts:
       method   HTTP verb, default GET
       body     plain object, JSON encoded
       token    bearer access token, omitted when absent
       query    plain object of querystring values
       signal   AbortSignal
     Resolves with the parsed `data` field. Rejects with OpsApiError. */
  function request(path, opts) {
    opts = opts || {};

    var url = baseUrl() + path;
    if (opts.query) {
      var qs = new URLSearchParams();
      Object.keys(opts.query).forEach(function (k) {
        var v = opts.query[k];
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      });
      var s = qs.toString();
      if (s) url += '?' + s;
    }

    var headers = { Accept: 'application/json' };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    var init = {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
      redirect: 'error'
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    if (opts.signal) init.signal = opts.signal;

    return global.fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        if (text) {
          try { payload = JSON.parse(text); } catch (e) { payload = null; }
        }

        if (!res.ok) throw toError(res.status, payload);

        if (payload === null) {
          throw new OpsApiError(res.status, 'ops_bad_response',
            'The operations API answered with something this page could not read.');
        }
        return payload;
      });
    }, function (err) {
      if (err && err.name === 'AbortError') throw err;
      /* fetch only rejects below HTTP: no network, DNS failure, TLS failure,
         or a CORS preflight the browser refused. All of them mean the same
         thing to a person looking at the screen. */
      throw new OpsApiError(0, 'ops_unreachable',
        'Could not reach the operations API. Check your connection and try again.');
    });
  }

  global.OpsApi = {
    request: request,
    baseUrl: baseUrl,
    OpsApiError: OpsApiError
  };
})(window);
