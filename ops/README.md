# Aria Operations dashboard

The private operations dashboard for Run With Aria, served from this repository at
`https://runwitharia.com/ops/`. Plain static HTML, CSS, and vanilla JavaScript, matching the
rest of the site: no build step, no package manager, no CDN, nothing fetched from a third
party at runtime.

This directory is self-contained. Nothing outside `ops/` is read, written, or referenced by
anything in here, and nothing in here is referenced by any other page on the site.

## What is public and what is not

Every byte in this directory is world readable, and that is by design rather than by
oversight. The architecture is written down in `docs/adr/0023-operations-dashboard-repository-boundary.md`
in the `Stadiora/Aria` monorepo. The short version:

- **The dashboard holds no credential of its own.** No API key, no service token, no
  connection string, no list of who is allowed to sign in. Anyone can read this JavaScript and
  learn the shape of the API, which is expected: the API is built to be safe against a
  knowledgeable stranger.
- **Everything shown comes from an authenticated API.** `https://api.runwitharia.com/api/ops/*`,
  served by app-backend, which owns the data, the access control, and the audit trail.
- **An unauthenticated visitor gets the sign-in screen.** These pages contain no operational
  data at all, so there is nothing here to leak; they are scaffolding that stays hidden until
  the API confirms a session.

## Signing in

Administrator accounts are separate principals from athlete and coach accounts. There is no
join between them: signing in to the mobile app as an athlete grants exactly zero dashboard
access. Accounts are provisioned by an owner with `app-backend/scripts/seed-ops-admin.ts`
against production; there is no self-registration and no invitation flow yet.

The session transport is a bearer token, never a cookie, because `runwitharia.com` is also the
marketing site's origin and a parent-domain cookie would be an ambient credential for every
page that origin will ever serve. The reasoning is in
`docs/ops-dashboard-admin-identity.md` in the monorepo. Consequences that show up in this code:

- The short-lived access token (15 minutes) lives in a closure variable and is never written to
  storage.
- The refresh token (up to 30 days) has to survive a reload, so it goes to `localStorage` when
  "Remember this device" is on and `sessionStorage` when it is off. That is the real cost of
  the bearer decision, and it is why every page carries a strict Content-Security-Policy.
- Refresh is single flight. The backend treats a replayed refresh token as a compromise signal
  and revokes the whole session, so two refreshes racing each other would sign the operator out
  of their own session.
- Every request sends `credentials: 'omit'` and no CSRF token. `/api/ops/*` is exempt from the
  backend's double-submit guard precisely because it never reads a cookie.

## Content-Security-Policy

GitHub Pages cannot send response headers, so the policy is a `<meta>` tag on every page:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self' https://api.runwitharia.com;
base-uri 'none'; form-action 'none'
```

Three things follow from wanting that policy to be this strict:

- **No inline script.** The theme has to be applied before first paint or navigating between
  panes flashes the wrong colours, so `assets/theme.js` is a blocking classic script in
  `<head>` rather than the inline snippet the design mocks used. No hash to keep in sync across
  eleven files.
- **No inline style attributes.** Everything is a class.
- **No `innerHTML` anywhere.** The shell is built as DOM with `textContent`, so nothing that
  arrives from the API, the querystring, or storage can become markup.
- `connect-src 'self'` is present because the origin serves static files only; it allows no
  capability the pages do not already have.
- `form-action 'none'` matters more than it looks. Both sign-in forms are submitted by script
  with `preventDefault`. If that script ever failed to load, a browser would otherwise navigate
  the form and put a password in the address bar. The policy makes that impossible.

`frame-ancestors` is deliberately absent: it is ignored in a `<meta>` tag and would only log a
console warning.

## Layout

```
ops/
  login.html            sign in, and the choose-your-own-password step
  index.html            Overview
  jobs-live.html        Happening now
  run-history.html      What happened
  alerts.html           Problems
  analytics.html        People and usage
  spend.html            Cloud costs
  evaluations.html      Aria quality (deferred, coming-soon banner)
  releases.html         App releases
  users.html            Look up a user
  settings.html         Settings (owner only)
  assets/
    ops.css             design system, ported from the approved mocks
    theme.js            pre-paint theme, loaded first on every page
    icons.js            inline SVG icon set
    api.js              transport: one request function, one error shape
    session.js          session policy: tokens, refresh, recovery, re-auth
    shell.js            pane registry, rail, top bar, filter bar, boot gate
    login.js            the sign-in page controller
```

The ten pane pages are byte-identical apart from `data-page` and `<title>`. Everything a pane
is, including its plain-language name, the question it owns, which filters are real for it, and
which delivery wave builds it, lives in the `PANES` registry in `shell.js`. Adding a pane means
one registry entry and one copy of the template, and the rail cannot drift from the pages
because neither is written twice.

## What this release does and does not do

This is **W1**: the shell, the sign in, and the design system. Every pane routes to a real page
that says plainly that it is not built yet and which wave builds it:

| Wave | Panes | Tracking |
|---|---|---|
| W2, operate panes | Overview, Happening now, What happened, Problems | `Stadiora/Aria` #5408 |
| W3, understand panes | People and usage, Cloud costs | #5407 |
| W4, ship and support panes | App releases, Look up a user | #5441 |
| W5, settings pane | Settings | #5442 |
| deferred | Aria quality | its own project, not part of the first release |

The shared filter bar ships now and round trips through the querystring, so W2 onward can read
a selection rather than inventing one. Panes listen for the `ops:filters` event on `window`.
Per-pane filters, such as severity on Problems or cohort on People and usage, arrive with the
pane that needs them.

The scope control follows the rule the mocks encode: All, Mobile, and Coaches Web appear only
where a per-app split is real. Cloud costs says so inline, because Azure bills infrastructure
rather than apps and splitting a shared Postgres bill by client would be an invented number.
The other panes without it simply omit the control.

Role differences surface in navigation affordances only at this stage. Settings is owner only,
so a non-owner sees it in the rail marked "owner" and gets a state that names the role it
needs, rather than a destination that silently vanishes. The server enforces this
independently; the client is rendering a fact, not deciding one.

## Departures from the approved mocks

The design system in `assets/ops.css` is the mock stylesheet, with these changes and no others:

1. **No Google Fonts `@import`.** The font stacks are unchanged, so anyone with Fira Sans or
   JetBrains Mono installed sees the intended faces and everyone else falls back cleanly.
   Nothing is fetched from a third party.
2. **Mock-only rules removed**: design commentary, the preview-state switcher, the notes
   toggle. None of it was ever going to ship.
3. **Two colour tokens changed, both to meet the contrast criteria on the issue.**
   - Dark `--text-3` moved from `#667484` to `#8593A2`. The original measured 3.13:1 on
     `--surface-hover` and 3.93:1 on a card, under the 4.5:1 it needs: the token carries
     metadata, table headers, and filter labels, all of which are text.
   - A new `--cta-end` token ends the primary-button gradient. White on the light theme's
     `#0092AE` measured 3.67:1; `#007A93` holds 4.99:1. Splitting it from `--brand` means the
     button darkens without darkening every tint derived from the brand.

   Fifty foreground and background pairings were then measured against the composited
   background in both themes. Dark passes at 5.66:1 or better, light at 4.50:1 or better.
4. **Real semantics** where the mock used inert markup: headings are `h1` to `h4` in order and
   take their size from a class, the switch is a `button` with `role="switch"`, tabs are a
   `role="tablist"` with arrow-key support, and the rail overlay traps focus, closes on Escape,
   and restores focus to the control that opened it.

## Working on it locally

Serve the repository root and open `http://127.0.0.1:8000/ops/login.html`:

```bash
python3 -m http.server 8000
```

`assets/api.js` points at `https://api.runwitharia.com` and can only be redirected when the
page itself is served from a loopback address, by setting `localStorage['ops-api-base']`. A
deployment on `runwitharia.com` always talks to production. Note that production CORS allows
`runwitharia.com` and not `localhost`, so a browser on a loopback origin cannot call the real
API directly; put a proxy in front of it that sets the `Origin` header, or point the override
at a local stub.
