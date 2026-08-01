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
    pane-data.js        shared pane plumbing: source, formatting, states, charts
    pane-analytics.js   People and usage
    pane-spend.js       Cloud costs
```

A pane page is the same six lines of HTML with a `data-page` attribute, plus a script tag for
its own renderer where one exists. Everything a pane *is* lives in the `PANES` registry in
`shell.js`, so the rail cannot drift from the pages.

A renderer registers itself under its pane id in `window.OpsPanes` and the shell hands it the
content area. Registration rather than a flag in the registry, because the thing that knows
whether a pane is built is the pane's own script being on the page; a boolean in the registry
could claim "built" on a page that loads nothing to build it. The shell boots on
`DOMContentLoaded` rather than the moment it parses, so a renderer loaded after it is always
registered before the shell decides what to draw.

## What this release does and does not do

The shell, the sign in, and the design system shipped first. Every pane routes to a real page:
either the pane itself, or a state that says plainly that it is not built yet and which
delivery wave builds it. **People and usage** and **Cloud costs** are built. Overview,
Happening now, What happened and Problems are W2; App releases and Look up a user are W4;
Settings is W5. Aria quality is deferred to its own project.

The shared filter bar round trips through the querystring, so a pane reads a selection rather
than inventing one. A pane listens on `window` for two events, both dispatched once the session
is confirmed and the shell is in the document, so a listener added while `shell.js` is still
booting cannot miss them:

- `ops:ready`, carrying `{ pane, filters }`, which is the signal that `#content` exists.
- `ops:filters`, carrying the selection, fired for the starting selection as well as for every
  change to it. `OpsShell.filters()` returns the same thing on demand.

Per-pane filters arrive with the pane that needs them.

The scope control follows the rule the mocks encode: All, Mobile and Coaches Web appear only
where a per-app split is real. Cloud costs says so inline, because cloud spend is billed per
piece of infrastructure rather than per app and splitting a shared bill by client would be an
invented number.

Role differences surface in navigation affordances only at this stage. Settings is owner only,
so a non-owner sees it marked in the rail and lands on a state that names the role it needs
rather than a destination that silently vanishes. The server enforces this independently; the
client renders a fact, it does not decide one.

## The two understand panes

### Where their figures come from, and what happens while nothing serves them

Neither pane's read API is published yet. The pane's data source therefore carries a **null**
endpoint rather than a guessed path, and a null endpoint means no request is made and the pane
says so. That is a deliberate choice with a visible consequence: today both panes render an
honest "not reporting yet" state on the live site, and the day the endpoint exists it is one
line here and nothing else on the pane changes.

Guessing a path instead would have been worse in a specific way. A pane that calls a route
nobody has written gets a 404, and a 404 renders as a fault. The dashboard would then be
reporting that the platform is broken when the truth is that a piece of it has not been built,
and those are the two things every state on this dashboard exists to keep apart.

The panes hold no figures of their own. Every label that names a service, a version, a group,
or a resource arrives in the response; nothing operational is a literal in these files. What is
static is the layout, the state copy, and the glossary, because a definition is not a
measurement.

### The response the panes read

Both read the transport's envelope, so the pane sees `payload.data`.

**Cloud costs** expects `asOf`, `publishLagHours`, `staleness`, `currency`, `period`, `total`,
`forecast`, `budget`, a `views` object holding any of `category`, `resourceGroup` and `service`
as `{ label, hint, rows }`, `daily`, `unitCosts`, `reconciliation`, and `anomalies`.
`availability.state` is `ready`, `not_published`, or anything else, which reads as "no source
is configured".

**People and usage** expects `asOf`, `coverage`, `apps`, `cohorts`, `funnel`, and `features`.
`availability.state` is `ready` or `insufficient`.

Two conventions run through both, and both exist so a figure means the same thing on the pane
that it meant in the data:

- **Money is integer micro-units of the billing currency.** The pane divides once, at the
  moment of display. This is what lets Cloud costs *add up* its rows and compare the sum with
  the billed total exactly; a float sum over a few hundred daily rows does not reproduce an
  invoice, and a near miss is indistinguishable from a real gap.
- **A rate is basis points, and it arrives with the denominator it was computed over.** No
  ratio is precomputed as a percentage, because a stored percentage is only correct for the
  exact window it was computed for.
- **A colour is a token name (`s1` to `s6`, or `muted` for a comparison line), never a colour
  value.** A raw colour from the response is the one way a figure can end up unreadable on a
  theme it was not picked against: brand cyan at full brightness measures about 1.3:1 on the
  light theme's white card. Anything outside that closed set falls back to the default series
  token, so the answer for both themes stays in the stylesheet, where it was measured.
- **A link is a relative path on this origin.** An `href` in the response is refused if it
  carries a scheme, if it is protocol-relative, if it holds a control character or whitespace
  anywhere, or if resolving it against the current page lands on another origin. The last two
  are what make the first two hold: the URL parser strips tabs and newlines before it reads a
  scheme, so `java<TAB>script:` reaches the browser as `javascript:`, and it treats a backslash
  as a path separator, so `/\evil.example/x` resolves cross-origin while looking relative. A
  refused link renders its label as plain text, so the sentence it belonged to is intact and
  only the navigation is withheld. The pages' content policy would already stop a `javascript:`
  URL from running; this keeps the guarantee next to the code that builds the link rather than
  in a meta tag somebody may loosen later.
- **A money figure is an object carrying integer `micros`, and nothing else counts as one.**
  A scalar `total: 0`, an array, or a string is read as no figure rather than as zero. On a
  pane about money a zero is a claim, and it is the one claim a missing field must not be
  turned into.
- **A timestamp is a string, and anything else is absent.** `null`, `0` and unreadable strings
  all render the "the time of this reading was not reported" sentence rather than a stamp,
  because `new Date(null)` is the epoch rather than an invalid date and would otherwise print
  1 Jan 1970 with an age of half a million hours computed from a field nobody sent.

### Two rules the panes enforce rather than assume

**A rate whose denominator is under 50 is not drawn.** The floor is applied on the surface, to
every rate the panes draw *over a group of people*, whether it arrives as a numerator and a
denominator or already computed, and whether the payload labels it a rate or a decimal: what
makes a figure subject to it is the denominator travelling with it, not the label. A rate that
arrives with no denominator at all is not drawn either, because a base nobody reported cannot
be known to clear the floor. With a group smaller than 50, one person moves the figure by
several points and the reader has no way to tell that from a change. Every suppressed figure
says the size of the group it was refused for, or says plainly that the size is unknown, and
offers the raw counts, which are always safe to show.

Two figures are deliberately outside the floor, because neither is a rate over people: coverage,
which is the share of an app version's own sessions that report an event, and unit cost, which
is money. Both are labelled for what they are, and coverage that was never measured says so
rather than drawing a percentage.

**Every cost figure carries the moment it was true.** Cost data is never live; billing publishes
on a cycle. The "as of" stamp is on every state that shows a figure, including the ones that
show no total, and a reading that is behind is labelled as behind, with the reason, rather than
quietly replaced by nothing. Losing the number is worse than knowing it is a few hours old.

Two details that are easy to get wrong and are therefore fixed in code. A timestamp with no
timezone designator is read as the UTC the pipeline meant, not as the operator's local time,
because parsing it locally and then formatting it back out as UTC produces a stamp that is
wrong by the reader's own offset. And a reading stamped *ahead* of now is reported as two
clocks disagreeing rather than clamped to fresh, since a future reading is the one kind of
staleness nobody thinks to look for.

**People who have not turned on usage analytics appear in no figure here.** That is not a filter
this client applies. Their activity is never recorded in the first place, so there is nothing on
this side to leave out, and nothing to get wrong.

### Looking at the states before the data exists

Because neither read API is published, the ready, insufficient, and stale renderings would
otherwise be unreviewable until it is, which is the wrong way round: the rendering is what is
being reviewed now. So a pane can be pointed at a same-origin JSON document holding one response
envelope, by setting `ops-pane-fixture-analytics` or `ops-pane-fixture-spend` in `localStorage`
to its path. Honoured only when the page itself is served from a loopback address, exactly like
the API base-url override, so a deployment on the real origin can never read one, and only when
the stored value is a relative path, so same-origin is enforced by the code that reads it rather
than only by the page's `connect-src`.

The pane that has no data yet says so, and says it without a promise it cannot keep: the state
tells you the reporting behind it is unbuilt and that the release which builds it points the
pane at it. It does not claim figures will appear "without another release", because both
`endpoint` values are `null` in these files and a backend publishing a route would change
nothing on its own.

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
9. **The per-page `<style>` blocks the mock gave these two panes became classes**, because the
   pages allow no inline style. Two consequences worth naming:
   - Lengths that come from data (a bar's width, a cell's tint, a swatch's colour) are set
     through the CSSOM, never as a style attribute. That is not a workaround, it is the only
     path the policy leaves open: `style-src 'self'` refuses `setAttribute('style', ...)` and
     always has, while a CSSOM property assignment is not an inline style declaration at all.
     Anything passed through the shell's `h()` helper as a `style` key would be silently
     dropped, which is worth knowing before writing the next pane.
   - The mock's `.seg` view switchers became real tablists. A control that swaps the panel
     beneath it is a tab pattern rather than a toggle, so it is driven by `aria-selected` and
     inherits the shell's arrow, Home and End keys.
10. **A `[hidden] { display: none !important }` rule.** The user-agent rule for `hidden` is a
    bare attribute selector, so any class carrying `display` outranks it and the hidden thing
    stays on screen. Every collapsible block and every tab panel on these panes is switched
    with the attribute, so the rule is load bearing rather than defensive.
11. **Callout fills are mixed into `--surface-1` rather than into transparency.** This closes
    two of the contrast debts recorded below; see the note under that table.
12. **A card head wraps below 860px**, dropping its view switcher onto its own line instead of
    squeezing the title into a column a word wide.

### Known contrast debt, inherited

Measured across both themes against composited backgrounds. **Every pairing rendered by the
panes built so far passes in both themes**, text at 4.5:1 or better and control boundaries at
3:1 or better. That was verified again for the two understand panes across all four of their
states, 68 pairings in total, worst case 4.67:1 in light and 5.99:1 in dark.

**Two rows are now closed.** The warning and critical callout inks measured 4.41:1 and 4.26:1
in the light theme *only when the callout sat directly on the page background*, which is darker
than a card; on a card they passed. A translucent tint takes its final colour from whatever is
behind it, so the same component had two different ratios depending on where it was put. The
fix mixes the tint into `--surface-1` instead of into transparency, which makes the fill, and
therefore the ratio, independent of the surface underneath. They now measure 4.94:1 and 4.74:1.
No approved hue changed, and dark is unaffected.

The debt below remains and is drawn by nothing built so far. In the light theme these pairings
sit between 3.79:1 and 4.49:1 against the 4.5:1 they need; the same pairings pass in dark. Every
one is byte-identical to the approved mock. They are recorded so that the first pane to draw one
does not ship it unnoticed:

| Pair | Light ratio |
|---|---|
| `.badge-crit`, `.nav-count.is-crit`, `.btn-danger` on their tint over a card | 4.49 |
| `.btn-danger:hover` | 3.79 |
| `.tag-backend` on its tint | 4.46 |
| `.badge-crit` / `.badge-ok` / `.badge-warn` over the page background rather than a card | 4.04 / 4.21 / 4.17 |

Closing these means darkening the light theme's status hues, which is a design decision about
approved tokens rather than a pane concern, so it is left to whoever owns the palette. The
badge row has a cheaper avoidance in the meantime and the understand panes take it: a status
badge goes inside a card, never loose on the page background, where it measures 4.67:1 or
better.

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

The same stub is what makes the pane fixtures usable: it has to serve the fixture document too,
because a cross-origin fetch for it would be refused by `connect-src` for the same reason a
cross-origin API call would be.
