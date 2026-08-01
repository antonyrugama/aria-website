# Aria Operations dashboard

The private operations dashboard, served from this repository at `/ops/`. Plain static HTML,
CSS, and vanilla JavaScript, matching the rest of the site: no build step, no package manager,
no CDN, nothing fetched from a third party at runtime.

This directory is self-contained. Nothing outside `ops/` is read, written, or referenced by
anything in here, and nothing in here is referenced by any other page on the site.

> This file is served publicly along with everything else in this directory, so it stays at the
> level of what a reader could work out from the JavaScript beside it. The contributor-facing
> detail, delivery tracking, and the reasoning behind the identity boundary live in the backend
> repository and in the pull request that added this directory.

## What is public and what is not

Every byte in this directory is world readable, by design rather than by oversight:

- **The dashboard holds no credential of its own.** No API key, no service token, no connection
  string, no list of who is allowed to sign in. Anyone can read this JavaScript and learn the
  shape of the API, which is expected: the API is built to be safe against a knowledgeable
  stranger.
- **Everything shown comes from an authenticated API.** These pages contain no operational data,
  so there is nothing here to leak; they are scaffolding that stays hidden until the API
  confirms a session.
- **An unauthenticated visitor gets the sign-in screen.**

Administrator accounts are separate principals from athlete and coach accounts, with no join
between them, so signing in to the mobile app grants exactly zero dashboard access.

## Sessions

The session transport is a bearer token in the `Authorization` header, never a cookie, because
this origin also serves the marketing site and a parent-domain cookie would be an ambient
credential for every page that origin will ever serve. Every request sends
`credentials: 'omit'` and no CSRF token, the latter because the API route family never reads a
cookie in the first place.

### The one invariant

**A refresh token is presented to the server at most once, ever, from a given browser profile.**

The backend rotates the refresh token on every use and keeps one generation of history, so
re-presenting a token it has already rotated is read as theft: it revokes the session on every
device and writes a compromise event into an append-only audit log. An operator who
middle-clicked a nav link must never be able to cause that. Three mechanisms hold the invariant,
each closing a case the others cannot:

1. **The access token is cached per tab**, in `sessionStorage`, so ordinary navigation around
   this multi-page shell performs no refresh at all. This is what makes the other two rarely
   needed: rotation happens roughly once per fifteen minutes per tab rather than once per page
   view.
2. **Web Locks** (`navigator.locks`) serialise the whole read/POST/write across every
   same-origin context, and the token is re-read *after* the lock is held rather than captured
   before waiting for it, so two tabs cannot both present the same value. Where Web Locks is
   unavailable this degrades to a per-document queue.
3. **A ledger of already-presented tokens**, stored as SHA-256 hashes in `localStorage` and
   consulted before every exchange. A token this profile has already spent is never sent again:
   the client signs itself out locally instead. That costs one sign-in and produces no false
   compromise event. The hash is written *before* the request, not after, because a page
   destroyed mid-flight cannot know whether the server rotated the token, and a client that
   cannot know must assume it did. Entries are pruned by age rather than by count, because a
   hash stops mattering only when the session that owned it can no longer exist, and the
   server's ceiling on that is 30 days. Evicting on a small count instead would let a tab
   dormant across enough rotations wake holding a token whose hash had scrolled off the end,
   which is the one way this ledger could fail open.

Residual risk, stated plainly: if a tab is duplicated with "Remember this device" off, so the
copy inherits a private `sessionStorage`, and the original is closed before the copy's access
token expires, the copy still holds a token the original spent. The ledger catches it and signs
that tab out locally rather than replaying it, so reuse detection is still never reached, but
the operator does have to sign in again. Fully removing even that would need a short server-side
idempotency window on the refresh endpoint, which is not a change this repository can make.

### Storage, and the one departure from the identity contract

| Token | Lifetime | Where |
|---|---|---|
| Access token | 15 minutes | `sessionStorage` |
| Refresh token | up to 30 days | `localStorage` when "Remember this device" is on, `sessionStorage` when off |
| Spent-token ledger | 30 days | `localStorage`, SHA-256 hashes only, never tokens |

The identity design record specifies the access token as **memory only**. Caching it in
`sessionStorage` is a deliberate departure, and it is recorded here because it needs to be
agreed rather than discovered. Memory-only forces a refresh on every page load of a multi-page
shell, which makes rotation as frequent as navigation and is the direct cause of the replay
hazard above. `sessionStorage` preserves the property the contract was protecting, that a
browser restart cannot resume a session without the refresh exchange, and a 15-minute token is
a strictly smaller prize than the 30-day refresh token already sitting in the same origin's
storage under the contract's own accepted trade.

### A security control that lives outside this directory

`localStorage` is scoped to the **origin**, not the path. The Content-Security-Policy below
protects `/ops/*` and does nothing for the other pages this origin serves, which carry no CSP.
Any third-party script added to any page on this origin, an analytics pixel, a chat widget, a
support snippet, can read the refresh token and walk away with an administrator session, and
nothing inside `ops/` would have changed. **"No third-party script on this origin" is therefore
a load-bearing security control**, and it is not enforced by anything in this directory. It
belongs in the architecture record, and moving the dashboard to its own origin, so that storage
partitioning does the work instead of a convention, is the durable fix.

## Content-Security-Policy

GitHub Pages cannot send response headers, so the policy is a `<meta>` tag on every page:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self' https://api.runwitharia.com;
base-uri 'none'; form-action 'none'
```

What follows from wanting it this strict:

- **No inline script.** The theme must be applied before first paint or navigating between panes
  flashes the wrong colours, so `assets/theme.js` is a blocking classic script in `<head>`
  rather than an inline snippet. No hash to keep in sync across eleven files.
- **No inline style attributes.** Everything is a class.
- **No `innerHTML` anywhere.** The shell is built as DOM with `textContent`, so nothing from the
  API, the querystring, or storage can become markup.
- `connect-src 'self'` is present because this origin serves static files only; it allows no
  capability the pages do not already have.
- `form-action 'none'` matters more than it looks. Both sign-in forms are submitted by script
  with `preventDefault`. If that script ever failed to load, a browser would otherwise navigate
  the form and put a password in the address bar.

`frame-ancestors` is deliberately absent: it is ignored in a `<meta>` tag.

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

The ten pane pages are byte-identical apart from `data-page` and `<title>`. Everything a pane is
lives in the `PANES` registry in `shell.js`, so the rail cannot drift from the pages.

## What this release does and does not do

This release builds the shell, the sign in, and the design system. Every pane routes to a real
page that says plainly that it is not built yet and which delivery wave builds it: W2 for
Overview, Happening now, What happened and Problems; W3 for People and usage and Cloud costs;
W4 for App releases and Look up a user; W5 for Settings. Aria quality is deferred to its own
project.

The shared filter bar ships now and round trips through the querystring, so later waves read a
selection rather than inventing one. Panes listen for the `ops:filters` event on `window`.
Per-pane filters arrive with the pane that needs them.

The scope control follows the rule the mocks encode: All, Mobile and Coaches Web appear only
where a per-app split is real. Cloud costs says so inline, because cloud spend is billed per
piece of infrastructure rather than per app and splitting a shared bill by client would be an
invented number.

Role differences surface in navigation affordances only at this stage. Settings is owner only,
so a non-owner sees it marked in the rail and lands on a state that names the role it needs
rather than a destination that silently vanishes. The server enforces this independently; the
client renders a fact, it does not decide one.

## Departures from the approved mocks

`assets/ops.css` is the mock stylesheet with these changes:

1. **No Google Fonts `@import`.** The font stacks are unchanged, so anyone with Fira Sans or
   JetBrains Mono installed sees the intended faces and everyone else falls back cleanly.
   Nothing is fetched from a third party.
2. **Mock-only rules removed**: design commentary, the preview-state switcher, the notes toggle,
   and the `--note-bg` token that only they used.
3. **`--mono` gains `Consolas`** before the generic `monospace`, so Windows has a real fallback.
4. **Dark `--text-3` moved from `#667484` to `#8593A2`.** The original measured 3.35:1 on
   `--surface-3`, its worst rendered pairing, where `.badge`, `.tag`, `.masked`, `.toast` and
   `.nav-count` all place it, and 3.93:1 on a card. It needs 4.5:1, because it carries metadata,
   table headers, filter labels and placeholder text, all of which are text. The new value
   clears 4.76:1 on every surface the stylesheet actually pairs it with.
5. **A new `--cta-end` token** ends the primary-button gradient. White on the light theme's
   `#0092AE` measured 3.67:1; `#007A93` holds 4.99:1. Splitting it from `--brand` darkens the
   button without darkening every tint derived from the brand. Dark mode is unchanged, because
   dark `--cta-end` is identical to dark `--brand`.
6. **A new `--control-border` token** outlines interactive controls. WCAG 1.4.11 asks 3:1 of the
   visual information required to identify a user interface component, which is a text field's
   outline. The mock's `--border` gives 1.22:1 against the field it outlines, so the login
   form's inputs and buttons had no discernible boundary in either theme. `--border` itself is
   left exactly as the mock drew it, because a rule between two paragraphs is not a component.
7. **The switch grew from 34x19 to 40x24** to clear the 24x24 minimum in WCAG 2.2 SC 2.5.8, and
   became a real `<input type="checkbox" role="switch">` so that its `<label>` is clickable.
8. **Real semantics** where the mock used inert markup: headings are `h1` to `h4` in order and
   take their size from a class, tabs are a `role="tablist"` with arrow-key support, and both
   overlays trap focus, close on Escape, restore focus, and make the background inert.

### Known contrast debt, inherited and not yet fixed

Measured across both themes against composited backgrounds. **Dark passes everywhere.** In the
light theme, the following pairings sit between 3.79:1 and 4.49:1 against the 4.5:1 they need.
None of them renders in this release, because no badge, tag, or status callout is on screen yet,
and every one is byte-identical to the approved mock. They are recorded here so that the first
pane to draw one does not ship them unnoticed:

| Pair | Light ratio |
|---|---|
| `.badge-crit`, `.nav-count.is-crit`, `.btn-danger` on their tint over a card | 4.49 |
| `.btn-danger:hover` | 3.79 |
| `.tag-backend` on its tint | 4.46 |
| `.badge-crit` / `.badge-ok` / `.badge-warn` over the page background rather than a card | 4.04 / 4.21 / 4.17 |
| `callout-warn` / `callout-crit` ink over the page background | 4.41 / 4.26 |

Closing these means darkening the light theme's status hues, which is a design decision about
approved tokens rather than a shell concern, so it is left to whoever owns the palette.

## Working on it locally

Serve the repository root and open `http://127.0.0.1:8000/ops/login.html`:

```bash
python3 -m http.server 8000
```

`assets/api.js` points at the production API and can only be redirected when the page itself is
served from a loopback address, by setting `localStorage['ops-api-base']`. A deployment on the
real origin always talks to production. Note that production CORS does not allow `localhost`, so
a browser on a loopback origin cannot call the real API directly; put a proxy in front of it
that sets the `Origin` header, or point the override at a local stub.
