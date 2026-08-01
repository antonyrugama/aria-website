# Aria Operations dashboard

The private operations dashboard, served from this repository at `/ops/`. Plain static HTML,
CSS, and vanilla JavaScript, matching the rest of the site: no build step, no package manager,
no CDN, nothing fetched from a third party at runtime.

This directory is self-contained. Nothing outside `ops/` is read, written, or referenced by
anything in here, and nothing in here is referenced by any other page on the site.

> This file is served publicly along with everything else in this directory, so it stays at the
> level of what a reader could work out from the JavaScript beside it: what these pages do, and
> why they are built the way they are. Release sequencing, infrastructure, the server's internals,
> and the reasoning behind the identity boundary live in the backend repository and in the pull
> request that added this directory, none of which is served from here.

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

### What the client promises

**Ordinary races converge. A superseded copy of a credential signs that tab out locally. The
server adjudicates.**

That is deliberately weaker than the absolute "at most once, ever" an earlier draft of this
directory claimed, and the weaker promise is the honest one.

The refresh token rotates on every use. When two tabs reach the endpoint at the same moment, one
of them presents a token that was current when it read it and is not current by the time it
arrives; presented within a few seconds of its rotation, that is answered with a **fresh access
token and `refreshTokenRotated: false`**, and no refresh token. The client's side of that
contract is to leave the current credential alone: whichever tab won the rotation has already
written it, and writing anything else would clobber it. Two tabs refreshing at the same moment
therefore converge instead of one of them destroying the session.

The same generation presented long after its rotation is treated as theft and ends the session
everywhere. A generation older than that is refused, quietly and without consequence, because
there is nothing left for it to match. Neither call is one this client makes or second-guesses.

Given that grace, the client does not have to be the thing that makes races safe, and what
remains here is sized to that:

1. **The access token is cached per tab**, in `sessionStorage`, so ordinary navigation around
   this multi-page shell performs no refresh at all. This is the piece that still earns its
   keep: rotation happens roughly once per fifteen minutes per tab rather than once per page
   view, which is the difference between constant races and rare ones.
2. **Web Locks** (`navigator.locks`) serialise the exchange across same-origin contexts, with
   the token re-read *after* the lock is held. This is now an efficiency measure rather than a
   correctness one, so its absence is fine and the fallback is a per-document queue.
3. **A ledger of already-presented token hashes** in `localStorage`, each with the moment it was
   presented and which page presented it, consulted before an exchange. This is a local courtesy,
   not a guarantee, and the difference is worth being exact about. It targets the one case the
   grace cannot cover: a refresh whose response was lost, presented again long afterwards. When it
   hits, the operator gets a clean sign-in on this device instead of a refusal that ends the
   session everywhere.
   **When it misses, and it will,** the request reaches the server and the server decides, which
   is the correct outcome arrived at by a worse route.

   Which page presented it matters for the same reason the timestamp does. A request that never
   reached the server releases its own entry, so that a passing outage does not turn the retry
   button into the thing that signs an operator out. It releases only its own: two tabs sharing
   one credential legitimately present the same token, and a release that went by the hash alone
   would erase the record of the other tab's *successful* presentation, leaving that tab's next
   attempt to replay a token the server has already rotated.

   The timestamp is the point of the entry rather than bookkeeping around it. A hash on its own
   cannot tell a replay from the other tab in an ordinary race, and refusing that race locally is
   how a client talks itself out of the very grace that exists to absorb it, signing an operator
   out without a single request leaving the browser. So a recent entry is presented anyway and
   the server answers it; only an old one is refused here.

   It misses whenever storage is full, SubtleCrypto is absent, or the entry has been evicted.
   Eviction is the honest limit: the list is capped at 1000 entries, roughly ten days of one-tab
   use and proportionally less with more tabs open, so the further into the past a lost response
   was, the less likely it is still here. Sizing it to cover the whole 30-day session ceiling
   would mean unbounded storage to buy a nicer sign-out message. Nothing here is load bearing,
   which is exactly why every path fails open.

With **Remember this device** off the credential lives in `sessionStorage`, which a tab opened
from a link inherits a copy of. Both copies work, and the first rotation makes one of them the
current one. The tab left holding the other is told so by the API, drops it there and then rather
than replaying it later, and asks for a fresh sign-in when its own access token runs out. It says
so plainly when it does, because "your session carried on in another tab" and "your session
ended" are different facts. That is the cost of a credential deliberately confined to one tab,
and it is still the setting worth choosing on a shared computer.

The client never silently changes administrator. Stored credentials carry the subject they belong
to, and a credential belonging to somebody else is refused **before** it is presented rather than
after it has been adopted: presenting it would rotate a credential this tab has no business
rotating and leave its owner holding a token the server has already retired. The tab clears its
own state and returns to the sign-in screen with an explanation.

**It clears only its own state, and it never writes over or deletes anybody else's.** Two
administrators can be signed in on one browser, one remembered and one not, and neither tab's
rotation, sign-out, or terminal error can end the other's session: writes go to the store the
credential in hand came from, and a stored record naming a different administrator is left
exactly where it is. A tab that has been idle long enough to go stale must never be able to sign
the current administrator out of every other tab on the machine. Signing in is the one deliberate
exception, because replacing the session on this browser is precisely what it is for. For the
same reason as the rest of this, an expired cache entry counts as no identity at all rather than
as evidence of a previous one.

### Storage

| Token | Lifetime | Where |
|---|---|---|
| Access token | 15 minutes | `sessionStorage`, with the administrator it belongs to |
| Refresh token | up to 30 days | `localStorage` when "Remember this device" is on, `sessionStorage` when off, with the administrator it belongs to |
| Presented-token ledger | last 1000 exchanges | `localStorage`, SHA-256 hashes, timestamps and the page that presented each, never tokens |

The access token is cached rather than held in memory only. Memory only forces an exchange on
every page load of a multi-page shell, which makes rotation as frequent as navigation and is what
turned an ordinary race into a common one. `sessionStorage` keeps the property that matters, that
a browser restart cannot resume a session without the refresh exchange. The trade is worth
stating rather than glossing: a cached access token is an immediately usable bearer for as long
as it lives.

None of the three writes is assumed to succeed. A browser that refuses to store the refresh token
is a browser that cannot hold a session, so the sign-in fails and says so, rather than opening a
dashboard that ends without warning fifteen minutes later.

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
    pane-releases.js    App releases
    pane-users.js       Look up a user
```

The ten pane pages are byte-identical apart from `data-page`, `<title>`, and the one pane script
a built pane loads. Everything else a pane is lives in the `PANES` registry in `shell.js`, so the
rail cannot drift from the pages.

## What this release does and does not do

The shell, the sign in, and the design system shipped first. A pane that has not been built yet
routes to a real page that says plainly which delivery wave builds it. Aria quality is deferred
to its own project.

**App releases** and **Look up a user** are built. Everything either of them shows comes from the
operations API; neither holds any data of its own, and where the API answers with nothing the
pane says which kind of nothing it is.

App releases draws each platform's tracks as a ladder in promotion order. Two rules from the
approved design are worth knowing before reading the page:

- **Store truth and field truth are never merged.** The store reports what a track is set to,
  usage data reports what people actually have, and both appear as their own figure.
- **A stale source keeps its rows and shows its last successful poll time.** Hiding figures
  because a poll failed would turn a source outage into a data outage.

Its two stores are in different states and the page says so rather than smoothing it over.
Google Play is polled. App Store Connect has no API key yet, so the iOS ladder renders as **not
connected**, which is deliberately not the same state as a poll that ran and was refused.
Starting, pausing, or resuming a rollout is not on this page at all: the operations API holds
read-only access to both stores, so a control that implied otherwise would be a lie.

Look up a user is the only surface that touches a real person's record, and it is built as a
set of constraints:

- **Exact match only.** No browse, no listing, no near-match fallback, so a wrong guess tells
  you nothing about who has an account.
- **Every lookup is recorded**, with the reason the form makes you type, and the record is
  built so it would be safe to show the athlete. It is on the page, per account, under
  **Who looked**.
- **Masked by default.** Masking happens in the operations API, not here. This directory never
  derives a mask from a real value, because that would mean the real value had been sent to the
  browser.
- **A reveal is one field, with its own written reason, and it un-reveals itself** when the
  server's window expires, when the record closes, and when a new search starts.
- **Health data carries no reveal control at all**, not a disabled one and not a role-gated one.
- **Destructive account actions are absent, not permission-gated.** There is no control for
  deleting an account or wiping its data anywhere on the page. That runs through the account
  deletion workflow, which needs the athlete's own confirmation.

The shared filter bar round trips through the querystring, so a pane reads a selection rather
than inventing one. A pane listens on `window` for two events, both dispatched once the session
is confirmed and the shell is in the document:

- `ops:ready`, carrying `{ pane, filters }`, which is the signal that `#content` exists.
- `ops:filters`, carrying the selection, fired for the starting selection as well as for every
  change to it. `OpsShell.filters()` returns the same thing on demand.

**A pane must not assume it heard `ops:ready`.** Both events are dispatched from a promise
callback, and while the parser is waiting for a pane's own script file to arrive it is free to
run that callback, so the event can be over before the listener exists. `OpsShell.ready()`
returns the same `{ pane, filters }` once the shell is up, and a pane starts from whichever of
the two reaches it first. An earlier version of this file claimed the event could not be missed;
it can, and this is how.

A pane that draws its own contents is marked `built` in the registry, which is what stops the
not-built-yet card being drawn under it. `OpsShell.filterBar()` returns the rendered filter bar
so a pane can put its own controls beside the shared ones instead of growing a second bar.

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
   `--surface-3`, its worst rendered pairing, which `.masked` draws, and 3.93:1 on a card. It
   needs 4.5:1, because it carries metadata, table headers, filter labels and placeholder text,
   all of which are text. The new value clears 4.71:1 on every surface the stylesheet actually
   pairs it with.
5. **A new `--cta-end` token** ends the primary-button gradient. White on the light theme's
   `#0092AE` measured 3.67:1; `#007A93` holds 4.99:1. Splitting it from `--brand` darkens the
   button without darkening every tint derived from the brand. Dark mode is unchanged, because
   dark `--cta-end` is identical to dark `--brand`.
6. **New `--control-border` and `--control-border-hover` tokens** outline interactive controls.
   WCAG 1.4.11 asks 3:1 of the visual information required to identify a user interface
   component, which is a text field's outline. The mock's `--border` gives 1.22:1 against the
   field it outlines, and its `--border-strong` hover gives only 1.58:1, so hovering a control
   erased what little boundary it had. Rest measures 3.53:1 dark and 3.40:1 light against the
   control fill; hover measures 5.33:1 and 5.03:1, so hover is now more identifiable than rest
   rather than less. `--border` itself is left exactly as the mock drew it, because a rule
   between two paragraphs is not a component.
7. **The switch grew from 34x19 to 40x24** to clear the 24x24 minimum in WCAG 2.2 SC 2.5.8, and
   became a real `<input type="checkbox" role="switch">` so that its `<label>` is clickable.
8. **Real semantics** where the mock used inert markup: headings are `h1` to `h4` in order and
   take their size from a class, tabs are a `role="tablist"` with arrow-key support, and both
   overlays trap focus, close on Escape, restore focus, and make the background inert.
9. **The light theme's `--ok`, `--warn`, `--crit`, `--s1` and `--s2` are darkened** by between
   4 and 11 percent. Each is drawn as text on a tint mixed from itself, and at the mock's values
   that pairing measured between 3.92:1 and 4.34:1. See the contrast note below. Dark mode is
   untouched, because it already passed.
10. **`.btn-primary:hover` restates its own background.** Without it `.btn:hover` wins on
   specificity and repaints a primary button with the plain hover fill while `.btn-primary`
   keeps the inverse text colour: white on pale grey, 1.2:1, so the label vanished under the
   pointer that was about to click it.

Two things the panes do that the design rules here would otherwise seem to forbid, both
deliberate:

- **A width that is data is set as a CSS custom property through the CSSOM**, and the stylesheet
  turns it into a width. The no-inline-style rule exists because the CSP forbids a `style`
  attribute in markup; a property set through the CSSOM is explicitly outside what `style-src`
  governs, and is the only way to draw a rollout meter at the fraction the store reports.
- **Nothing else moved.** The panes still build every node with `textContent`, so no value from
  the API can become markup.

### Contrast, and the debt that is left

Measured across both themes against composited backgrounds. **Every pairing these pages render
passes in both themes**, text at 4.5:1 or better and control boundaries at 3:1 or better.

W1 recorded a set of inherited failures in the light theme and left them to the first pane that
would draw one. App releases and Look up a user draw most of them, so those are closed here by
darkening the hues themselves. Light-theme, status text on a tint mixed from itself, worst of
the four surfaces the stylesheet composites it over:

| Pair | Was | Now |
|---|---|---|
| `.badge-ok`, `.flagchip.is-ok`, `.verdict-better` | 4.10 | 4.64 |
| `.badge-warn`, `.flagchip.is-warn`, `.reveal-note` | 4.07 | 4.63 |
| `.badge-crit`, `.flagchip.is-crit`, `.nav-count.is-crit` | 3.92 | 4.62 |
| `.tag-mobile` | 4.12 | 4.64 |
| `.tag-coaches` | 4.34 | 4.67 |
| `callout-warn` / `callout-crit` ink over the page background | 4.41 / 4.26 | 4.98 / 5.01 |

What is left, drawn by nothing in this release and so still byte-identical to the mock:

| Pair | Light ratio |
|---|---|
| `.btn-danger` on its tint over a card | 4.62 after the `--crit` change, `:hover` 3.90 |
| `.tag-backend` (`--s3`) on its tint | 3.98 |
| `.tag-watch` (`--s4`) on its tint | 4.32 |

`--s3` to `--s6` are left alone on purpose: the chart series they otherwise carry are graphical
rather than text, so the pane that first draws one of them as text owns the same decision this
one did.

One thing colour still carries alone: the dot on a timeline entry in Look up a user, which
repeats a severity the entry's own words already state. It is decoration over a label, not the
label.

## Working on it locally

Serve the repository root and open `http://127.0.0.1:8000/ops/login.html`:

```bash
python3 -m http.server 8000
```

`assets/api.js` points at the production API and can only be redirected when the page itself is
served from a loopback address, by setting `localStorage['ops-api-base']`. A deployment on the
real origin always talks to production.

Two things constrain what that override can point at. Production CORS does not allow `localhost`,
so a loopback browser cannot call the real API at all. And the pages carry
`connect-src 'self' https://api.runwitharia.com`, where `'self'` is the loopback origin **including
its port**, so an override naming any other port is blocked by the policy before it reaches the
network. A local stub therefore has to be served from the same origin and port as the static
files: one small server that serves `/ops/` and answers `/api/ops/*`, with the override set to
that same origin. `python3 -m http.server` on its own serves the files but answers no API, so the
sign-in form is as far as it goes.

A stub therefore has to answer at least `/api/ops/auth/login`, `/api/ops/auth/session` and
`/api/ops/auth/refresh` before any pane will render, because the shell holds every pane behind a
confirmed session.
