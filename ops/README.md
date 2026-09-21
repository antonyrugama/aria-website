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

GitHub Pages cannot send response headers, so the policy is a `<meta>` tag on every page, and
every page carries the same one. The directives are read out of the tag rather than printed from
memory, because a policy that quietly grows an `'unsafe-inline'` and a README that still shows
the strict one is the worst version of this file:

```claims id=csp-policy
default-src = 'none'
script-src = 'self'
style-src = 'self'
img-src = 'self' data:
font-src = 'self'
connect-src = 'self' https://api.runwitharia.com
base-uri = 'none'
form-action = 'none'
pages carrying this exact policy = 13
```

What follows from wanting it this strict:

- **No inline script.** The theme must be applied before first paint or navigating between panes
  flashes the wrong colours, so `assets/theme.js` is a blocking classic script in `<head>`
  rather than an inline snippet, and there is no hash to keep in sync across every page in the
  dashboard. How many that is, and whether the two things the policy forbids are actually absent
  from the markup, is counted rather than remembered:

  ```claims id=csp-pages
  pages in ops/ = 13
  pages declaring the policy in a <meta> = 13
  pages loading assets/theme.js = 13
  pages with an inline <script> = 0
  pages with a style attribute in markup = 0
  ```

- **No inline `style` attributes.** Everything that can be a class is a class. The handful of
  lengths and colours that are genuinely data-driven, a bar segment's width, a skeleton block's
  height, a legend swatch, App releases' rollout meter and its adoption bar, are set through
  CSSOM on the element's `style` property by the pane's own script. That is a declaration made
  from script rather than a `style` attribute in markup, so `style-src 'self'` allows it without
  `'unsafe-inline'`, and every value set that way is a number this code computed or a fixed
  internal token, never a string from the API. It is worth stating precisely so nobody
  "simplifies" it into a break: the write does serialize into a `style` attribute in the DOM, and
  `setAttribute('style', ...)` for the same value would be blocked.
- **No `innerHTML` anywhere.** The shell is built as DOM with `textContent`, so nothing from the
  API, the querystring, or storage can become markup.
- `connect-src 'self'` is present because this origin serves static files only; it allows no
  capability the pages do not already have.
- `form-action 'none'` matters more than it looks. Every form on these pages is submitted by
  script with `preventDefault`. If that script ever failed to load, a browser would otherwise
  navigate the form and put a password in the address bar.

`frame-ancestors` is deliberately absent: it is ignored in a `<meta>` tag.

`setup.html` carries one thing the other pages do not: `<meta name="referrer" content="no-referrer">`,
declared above every subresource in the file. That page is opened from a link whose query string
holds a one-time credential, and a referrer policy only governs the requests made after the
browser has parsed it, so anything loaded before that declaration would put the whole URL in a
`Referer` header before a line of script had run.

## First-time setup

An administrator account can exist with no password at all, and the only way to claim one is to
prove control of the address it is named after. Two pages carry that:

- The sign-in page offers **First time here?**, which asks the API for a setup link. That
  endpoint answers one fixed sentence for every address it is ever given, and the panel repeats
  that sentence unchanged. Anything the client added to it would turn an endpoint designed to
  reveal nothing into a way of asking whether an address is an administrator.
- `setup.html` is where the emailed link lands. It reads the token out of the query string into
  a variable, strips it from the address bar with `replaceState` before anything else happens,
  and never writes it into the DOM, a link, a form action, or a log. Opened without a link the
  page has no form on it at all, so there is nothing there to submit.

Setting the password does not sign anybody in, because the API deliberately issues no session
here: the owner signs in immediately afterwards with what they just chose, which proves the
credential works while they are still in front of the form that made it. `setup.js` loads the
transport and nothing else, so this page has no function on it capable of adopting a session
even if one were handed to it.

Whether a link is still good is not a question this page answers. The API returns one generic
rejection for a link that is unknown, expired, already used, or replaced by a newer one, so the
page names those possibilities rather than choosing between them, and offers a way to ask for a
new link. The token's shape is not checked here either: a second opinion on validity can only
ever disagree with the first one.

## Layout

```
ops/
  login.html            sign in, the choose-your-own-password step, and the setup-link request
  setup.html            first-time setup: spend the emailed link, choose the first password
  index.html            Overview
  jobs-live.html        Happening now
  run-history.html      What happened
  alerts.html           Problems
  analytics.html        People and usage
  spend.html            Cloud costs
  evaluations.html      Aria quality: dataset declarations, quarantine and approval handoffs
  releases.html         App releases
  users.html            Look up a user
  settings.html         Settings (owner only)
  assets/
    ops.css             design system, ported from the approved mocks
    theme.js            pre-paint theme, loaded first on every page
    icons.js            inline SVG icon set
    api.js              transport: one request function, one error shape
    session.js          session policy: tokens, refresh, recovery, re-auth
    pane-registry.js    what every pane is called, asks, filters on and allows —
                        the one table both shells read
    shell.js            v1 rail, top bar, filter bar, boot gate — no page loads
                        it; the tests that do are in assets-only-in-tests
    login.js            the sign-in page controller
    setup.js            the first-time setup page controller
    operate.js          v1 pane furniture: charts, drawer, confirm, states — no
                        page loads it; likewise
    alerts-model.js     the problems API in plain words; which pages load it is
                        assets-by-page, and no count is kept here
    pane-overview.js    Overview
    pane-alerts.js      Problems
    pane-data.js        v1 plumbing for the understand panes and for Overview's
                        figures: source, formatting, states, charts — no page
                        loads it; likewise
    pane-analytics.js   People and usage
    pane-spend.js       Cloud costs
    pane-evaluations.js dataset validation, private quarantine import and approval handoffs
    pane-releases.js    App releases
    pane-users.js       Look up a user
    settings.js         Settings
  shell-v2.html         the v2 design system, rendered — reference page, not a pane
  assets/
    aria.css            v2 design system: tokens, rail, top bar, components
    aria.js             v2 runtime: rail, icons, charts, preview states
    shell-v2.js         the controller for shell-v2.html
    shell-pane-v2.js    the v2 pane bootstrap: session gate, rail, top bar,
                        filter bar, roles, definePane, the four states
    shell-pane-v2.css   what a v2 pane page needs and aria.css does not carry:
                        the three gates, the phone drawer, the toast
    pane-overview-v2.css  Overview's own shapes
    pane-releases-v2.css  App releases' own shapes
    pane-alerts-v2.css    Problems' own shapes
    pane-settings-v2.css  Settings' own shapes
    pane-users-v2.css     Look up a user's own shapes
    pane-run-history-v2.js   What happened
    pane-run-history-v2.css  What happened's own shapes
    pane-jobs-live-v2.js     Happening now
    pane-jobs-live-v2.css    Happening now's own shapes
    pane-evaluations-v2.css  Aria quality's own shapes
    pane-analytics-v2.css  People and usage's own shapes
    pane-spend-v2.css     Cloud costs' own shapes
```

The tree above says what each file is **for**. What each file is **loaded by** is not written
here in prose, because prose is what went wrong: seven issues were filed against this README in
one day, every one of them a sentence describing the code more broadly or more narrowly than the
code behaves. The block below is read out of the `<link>` and `<script>` tags in `ops/*.html` by
`scripts/ops-readme-claims.test.mjs` and compared line for line, so a page that stops loading
something, or a file that is deleted, is a red test rather than a stale sentence.

```claims id=assets-by-page
alerts-model.js = alerts.html, index.html, jobs-live.html, run-history.html
api.js = alerts.html, analytics.html, evaluations.html, index.html, jobs-live.html, login.html, releases.html, run-history.html, settings.html, setup.html, spend.html, users.html
aria.css = alerts.html, analytics.html, evaluations.html, index.html, jobs-live.html, releases.html, run-history.html, settings.html, shell-v2.html, spend.html, users.html
aria.js = alerts.html, analytics.html, evaluations.html, index.html, jobs-live.html, releases.html, run-history.html, settings.html, shell-v2.html, spend.html, users.html
icons.js = login.html, setup.html
login.js = login.html
operate.js = (no page)
ops.css = login.html, setup.html
pane-alerts-v2.css = alerts.html
pane-alerts.js = alerts.html
pane-analytics-v2.css = analytics.html
pane-analytics.js = analytics.html
pane-data.js = (no page)
pane-evaluations-v2.css = evaluations.html
pane-evaluations.js = evaluations.html
pane-jobs-live-v2.css = jobs-live.html
pane-jobs-live-v2.js = jobs-live.html
pane-overview-v2.css = index.html
pane-overview.js = index.html
pane-registry.js = alerts.html, analytics.html, evaluations.html, index.html, jobs-live.html, releases.html, run-history.html, settings.html, spend.html, users.html
pane-releases-v2.css = releases.html
pane-releases.js = releases.html
pane-run-history-v2.css = run-history.html
pane-run-history-v2.js = run-history.html
pane-settings-v2.css = settings.html
pane-spend-v2.css = spend.html
pane-spend.js = spend.html
pane-users-v2.css = users.html
pane-users.js = users.html
session.js = alerts.html, analytics.html, evaluations.html, index.html, jobs-live.html, login.html, releases.html, run-history.html, settings.html, spend.html, users.html
settings.js = settings.html
setup.js = setup.html
shell-pane-v2.css = alerts.html, analytics.html, evaluations.html, index.html, jobs-live.html, releases.html, run-history.html, settings.html, spend.html, users.html
shell-pane-v2.js = alerts.html, analytics.html, evaluations.html, index.html, jobs-live.html, releases.html, run-history.html, settings.html, spend.html, users.html
shell-v2.js = shell-v2.html
shell.js = (no page)
theme.js = alerts.html, analytics.html, evaluations.html, index.html, jobs-live.html, login.html, releases.html, run-history.html, settings.html, setup.html, shell-v2.html, spend.html, users.html
```

A file no page loads is not automatically dead: some are kept alive by the tests, which load
them from disk on purpose. The block below is the list of those, with the test files that read
each one, derived the same way.

```claims id=assets-only-in-tests
operate.js = ops-alerts-v2.test.mjs, ops-shell-pane-v2.test.mjs
pane-data.js = ops-overview-v2.test.mjs, ops-shell-pane-v2.test.mjs
shell.js = ops-alerts-v2.test.mjs, ops-shell-pane-v2.test.mjs
```

Those three are the answer to "what dies when the last pane moves across": **not yet**, and not
because of the pages. Test files execute `shell.js` and `operate.js` on purpose — the reason is
recorded in `ops/assets/shell-pane-v2.js` — and read `pane-data.js`, so deleting any of them
takes those tests with it. Which tests, and how many, is the block above rather than this
sentence. `ops.css` and `icons.js` are not page-less at all:
`login.html` and `setup.html` still load both, and those two pages have no v2 remodel.

And the files this README still talks about which are no longer in the tree. The guard checks
each one is **absent**, so a file that comes back leaves the prose around it red rather than
quietly wrong again, and it re-derives who still mentions the name. All 257 lines of
`operate.css` went in [aria-website#74](https://github.com/antonyrugama/aria-website/pull/74),
merged as `eae7de31041ffc5e4c773ff662b6821ad09ac5ec`, along with the light-theme badge block that
closed `ops.css`; the scripts still naming it are asserting a v2 page does **not** link it, which
is a live assertion about a file that is gone and stays true because it is gone.

```claims id=deleted-assets
ops/assets/operate.css = gone; loaded by no page; named in ops-alerts-v2.test.mjs, ops-analytics-v2.test.mjs, ops-dead-css.test.mjs, ops-jobs-live-v2.test.mjs, ops-shell-pane-v2.test.mjs, ops-spend-v2.test.mjs, ops-users-v2.test.mjs
ops/assets/settings.css = gone; loaded by no page; named by no script
```

### The v2 layer

`aria.css` and `aria.js` are the design system from `docs/mocks/ops-dashboard-v2/` in the Aria
monorepo, ported here so the panes can be remodelled one at a time. They sit **beside** `ops.css`
and `shell.js` rather than replacing them: the two sheets declare a great many of the same class
names from different token sets, so **a page loads one or the other, never both.** How many, and
which of them carry the most selectors in `ops.css` — the widest eight, ties broken on the first
letter, so the list is a sample of that width and not all of it — is counted out of the sheets. A
list typed here once said `ops.css` declares `.pill` and `.tbl`, and it declares neither, and
never did.

```claims id=v1-v2-collision
class names declared in both ops.css and aria.css = 47
.btn = 7 selectors in ops.css, 4 in aria.css
.budget = 4 selectors in ops.css, 3 in aria.css
.card-foot = 3 selectors in ops.css, 2 in aria.css
.card-head = 3 selectors in ops.css, 1 in aria.css
.content = 3 selectors in ops.css, 2 in aria.css
.legend = 4 selectors in ops.css, 3 in aria.css
.nav-item = 9 selectors in ops.css, 6 in aria.css
.seg = 5 selectors in ops.css, 4 in aria.css
```
 **Which layer a pane is on is stated by its own page**, in the stylesheets
and scripts its `<head>` loads, and nowhere else: a list written here by hand would have to be
corrected by every change that moves a pane, and the first one that moved while another was in
review left it saying something untrue. The list below is therefore read out of the pages. All
panes read the endpoints they always read — moving a pane across changes its surface, never its
reads.

Every pane has now moved, and the v1 layer did **not** all die with the last one. Which files
actually died is the `deleted-assets` block under Layout above rather than a list here — it
carries `operate.css` and `settings.css` today, and a third deletion joins it without this
sentence being touched; what survives, and why, is the two blocks beside it. `ops.css`
and `icons.js` are still loaded by `login.html` and `setup.html`, which are not panes and have no
v2 remodel; `shell.js`, `operate.js` and `pane-data.js` are loaded by no page and executed by the
tests, so they are fixtures rather than dead code. A sentence here predicting which files go on
which day is exactly the claim that rotted, so there is no longer one.

`shell-v2.html` exists so the system can be seen and checked. It makes no API call and holds no
operational data — every number on it is a literal in the page — so unlike a pane it has nothing
to gate and no session to wait for. It is the surface `scripts/check-ops-shell-v2.mjs` measures.

Three things about `aria.js` are worth knowing before using it:

- `Aria.icon(name)` returns an **SVGElement**, not a string. Nothing in this repository builds
  markup from a string, so the mock's `innerHTML` form could not come across.
- The rail's badges and the account footer are **passed in** through `boot({ badges, account })`
  and render nothing when absent. The mock hard-codes both; they are operational facts, and a
  dashboard that invents a count is worse than one that shows nothing.
- `boot`, `icon`, `redraw` and `applyState` are the whole surface. There is no `Aria.icons()`.

Theme is **not** decided in `aria.js`. `theme.js` is a blocking script in every `<head>` and owns
the pre-paint decision; `aria.js` reads what it wrote. The stylesheet's `:root` default has to
agree with `theme.js`'s own fallback, because that is what paints when scripting is off — two
places that each decide a default eventually disagree, and then the page paints one theme and
visibly switches to the other.

Preview states are keyed on an attribute: `data-state` lists the states an element belongs to,
`Aria.applyState()` puts `data-shown` on the matching ones, and `aria.css` hides the rest with
`[data-state]:not([data-shown])`. Hiding rather than showing is the point — a shown element keeps
its own display type, so `data-state` works on a `<tr>`, a `.pill` and a `.card` alike. Setting
`display: block` on the shown case instead would flatten all three.

A pane page carries the shell, and where the pane has been built, its own module. Everything a
pane *is* lives in the `PANES` registry in `pane-registry.js`, so the rail cannot drift from the
pages; everything a pane *shows* is registered by that module through `definePane`, and a pane
with no module renders the not-built state. The shell waits for the document to finish parsing
before it asks for a pane's contents, so which script finishes first cannot change what renders.

Registration rather than a flag in the registry, because the thing that knows whether a pane is
built is the pane's own module being on the page; a boolean in the registry could claim "built"
on a page that loads nothing to build it.

That is why the list below is **read out of the pages** rather than written here: the page each
pane names in the registry, the shell that page loads, and the pane's own stylesheet if it has
one. A pane that moves across layers changes this block in the same change that moves it, or the
suite is red.

```claims id=panes
overview = index.html, shell-pane-v2.js, pane-overview-v2.css
jobs = jobs-live.html, shell-pane-v2.js, pane-jobs-live-v2.css
history = run-history.html, shell-pane-v2.js, pane-run-history-v2.css
alerts = alerts.html, shell-pane-v2.js, pane-alerts-v2.css
analytics = analytics.html, shell-pane-v2.js, pane-analytics-v2.css
spend = spend.html, shell-pane-v2.js, pane-spend-v2.css
evals = evaluations.html, shell-pane-v2.js, pane-evaluations-v2.css
releases = releases.html, shell-pane-v2.js, pane-releases-v2.css
users = users.html, shell-pane-v2.js, pane-users-v2.css
settings = settings.html, shell-pane-v2.js, pane-settings-v2.css
```

### One registry, two shells

`assets/pane-registry.js` holds `PANES`, `GROUPS`, `WAVES`, `RANGES`, `SCOPES` and `ENVS` — what
each pane is called, the question it owns, which filters its own reads can honour, which roles
may open it, and the id it answers to in the v2 rail. It used to live inside `shell.js`. It was
lifted out unchanged so that a v1 page and a v2 page cannot disagree about what a pane is: the
rail on every page is drawn from this table, and a second copy of it would drift the first time
somebody renamed a pane.

It is loaded **before** whichever shell a page uses. A page that loads a shell without it throws
at boot rather than rendering a rail with no panes in it, which would look exactly like a pane
nobody has built yet. `scripts/ops-shell-pane-v2.test.mjs` checks the pairing on every page in
`ops/`, so a missing tag fails here rather than in production.

### Building a v2 pane page

A v2 pane page loads, in this order:

```html
<script src="assets/theme.js"></script>          <!-- in <head>, blocking, pre-paint -->
...
<link rel="stylesheet" href="assets/aria.css">
<link rel="stylesheet" href="assets/shell-pane-v2.css">
<link rel="stylesheet" href="assets/pane-<name>-v2.css">
...
<body data-pane="<registry key>" class="is-booting">
<script src="assets/pane-registry.js"></script>
<script src="assets/api.js"></script>
<script src="assets/session.js"></script>
<script src="assets/aria.js"></script>
<script src="assets/shell-pane-v2.js"></script>
<script src="assets/pane-<name>.js"></script>
```

and none of `ops.css`, `shell.js` or `icons.js`. `data-pane` rather than v1's
`data-page`, so the two shells can never both claim one document.

`window.OpsPaneShell` is the whole surface, and a test holds this table to it in both directions:

| | |
|---|---|
| `definePane(id, render)` | register what a pane draws. `render(content, pane)` gets the pane's `<main>` and its registry entry, after parsing and after the session is confirmed |
| `init()` | boot this page. Automatic on a page whose `<body data-pane>` names a registered pane |
| `filters()` / `resetRange()` | the current selection; put the range back to the pane's default |
| `paneFilters(nodes)` | the pane's own controls, in the shared filter bar, replacing any it put there before |
| `paneHref(paneId)` | a link to another pane, carrying only the filters that pane has |
| `setBadge(railId, badge)` | a count beside a rail item, or `null` to remove it |
| `region(content)` | the four preview states, as a region the pane owns |
| `read(source)` | the pane's own read, through the local fixture hook |
| `h` / `icon` / `card` / `cardHead` / `band` / `bandHead` / `stateBlock` / `link` | DOM builders, never `innerHTML` |
| `announce` / `toast` / `fmt` / `safeHref` / `isLoopback` / `failureMessage` / `panes` | the rest |

Two events fire on `window` once the shell is in the document: `ops:ready` and then `ops:filters`,
which fires again on every change. Both carry the starting selection, so a pane never reads the
querystring itself.

Rail badges and the account footer are passed through `Aria.boot({ badges, account })` and render
nothing when absent. Wire them from a real read or pass nothing: a dashboard that invents a count
is worse than one that shows nothing. Overview's Problems badge is the count from
`/api/ops/alerts/problems`, and it is removed when that read comes back empty.

## What this release does and does not do

The shell, the sign in, and the design system are built. Of the panes, **Problems** is complete:
it reads the live problems and alert rules, takes a problem on, closes it with a reason, tunes a
rule where the role allows it, and states whether the alerting is armed and where what it finds
is sent. **Overview** answers both of its questions from live reads. The status ribbon and the
needs-attention queue come from the problems API, and every entry opens the pane that owns the
work; the four headline figures, the day-grain activity line, and the list of what is
deliberately not drawn come from `GET /api/ops/summary`, which composes them server side.

Three things about that pane are rules rather than styling, and each one is a rule about not
drawing something. Every figure is labelled with the window the answer says it covers, read from
`window.days`: the approved design asks for active people over 24 hours, nothing behind it is
aggregated more finely than a day, and a tile labelled 24 hours that means seven days is worse
than one labelled seven days. Every block carries an `availability` state and its figures are
absent from the payload unless that state is `ready`, so a tile that is not ready renders words
and never a numeral. And the two apps are never added together: the activity line is one series
per app, and the headline people figure is the platform's own distinct count rather than the sum
of the two, because somebody who used both is one person.

The cost tile draws no budget bar. Nothing in the platform records a cloud budget, so the route
marks the figure `basis: 'spend'` and names the gap in `omissions`, and the pane prints the
omission with its reason instead of drawing a track against a target that does not exist. The
same list is what replaced the old "Not on this page yet" block, and it is rendered from the
answer rather than from a list in the client, so a figure that gains a source leaves it without
an edit here.

**Happening now** draws what a rule reported in the last few minutes, because no route lists
jobs. It does not have a job table, a lane, an age per job or a retry count, and it says so in a
band of its own rather than drawing an empty one. Its one real question is whether a queue that
is over the line is **moving, behind** or **not clearing**, which are different problems with
different fixes and look identical in a count: it compares the age of the job at the front of the
queue against how long the queue has been over the line. A front younger than the breach proves
the queue emptied past everything it held when it crossed the line; a front older than the breach
proves only that nothing queued since has reached the front, and the pane claims no more than
that — a burst that all arrived before the breach can drain steadily and still show an old front.
Neither reading is a rate. One sample of one age counts nothing and times nothing, so **moving,
behind** says the queue turned over and that everything in it now arrived after the line was
crossed, and never that work is arriving faster than it leaves: a queue that shrank from five
jobs to one and then stalled reads the same way.
Where the unit of the observation, the observation itself, the breach start or the elapsed time is
missing, the verdict is **cannot tell**, drawn in words — the two verdicts are never guessed at,
and an unknown is never rounded up to the alarming one. A fourth verdict comes before all three:
the alerting engine does not close a problem when its condition stops, it records a recovery and
waits for a person, so a problem can arrive here with its figures frozen at the last observation
that was over the line. `conditionClearedAt` is read first, and such a problem reads **stopped**,
past tense, with its figures labelled as of when it stopped, excluded from the longest-wait tile
and sorted below everything still going. A count of running
or queued jobs is not drawn at all: a tile reading zero and a tile with no pipeline behind it
look identical, and that is the one thing an operations screen must never be.

**What happened** draws the one record that does exist. There is still no per-run history — no
route lists runs, their stages or their durations — so the pane answers from the alerting
record, which is every failure anybody was watching for, and names the rest as missing in a band
of its own. It applies the operator's window to the problems that came back, groups the failures
by rule and request type so a reason shows how often it happened rather than once per row, and
states how much of the window was actually being watched, because an empty window is good news
only if something was in a position to notice. Its figures are floors when a page comes back
full, for the reason in the paragraph below. What was asked and what Aria answered are not on
the page at any role, the owner included: the privacy band names the three fields, says where a
reveal is recorded, and offers no control here.

A read answers with at most 100 problems, worst first and then oldest, and there is no second
page. A full page therefore keeps the oldest problem in each severity and drops the most recent,
which is the opposite of what a window ending today needs. When a page comes back full, both
Overview and Problems say so and every count reads as "at least"; on Problems the whole of the
"how the watching is doing" card — the fortnight's opened and closed counts, the median time to
take one on, and the false-alarm figure — says it cannot be worked out rather than showing a
number that is quietly short.

**People and usage** and **Cloud costs** are drawn in full: every state, every card, and the
whole of the copy. Both read their live endpoints, `GET /api/ops/usage` and `GET /api/ops/costs`,
and land on an honest state rather than a zero wherever an answer carries no figure.

**Settings** is built, and changes configuration rather than only reporting it — it is not the
only pane that writes, which this file used to claim; see the derived block in the Settings
section below. The section on it below is worth reading before the page is used. **Aria quality** lets
viewers, operators and owners validate synthetic dataset declarations. Paste an input object
containing `datasets` and `fixtureDigests`; the page supplies the operation envelope. The server
returns manifest digests or field paths and reason codes. Editing the input clears the old
result. Validation stores no dataset, inspects no referenced bytes, verifies no qualification
and grants no evidence access or release approval.

Owners and operators can also submit a local synthetic
or exactly authorised production-derived file to the shared Ciel operation. The page sends no
credential or endpoint in request data, renders no raw evidence or storage location, and never
describes quarantine or approval as admission, evaluation consent, training consent, access,
export permission, or proof of de-identification.

The same pane provides metadata-only approval request, lookup, and decision handoffs. Approval
controls bind exact artifact, source, retained, request, purpose, policy, revision, and expiry
values. Qualification is resolved server-side from an external verified record; the dashboard
cannot provision or assert it.
Starting another lookup clears the previous result. If it fails, only the lookup error is shown;
a later successful lookup displays its current result.

The retention field shows the browser's local timezone and submits UTC. Its default starts
30 elapsed days ahead and uses the offset at that future instant, including DST changes,
rather than writing UTC clock text into a local-time input. The control has minute precision:
seconds and milliseconds are omitted. A repeated fall-back hour cannot encode which occurrence
was intended; native JavaScript parsing selects the earlier occurrence, so this is not an exact
instant round-trip for the later occurrence. Manual edits still use the displayed local time,
and the future-date and 90-day retention bounds are unchanged.
The scoring portion remains an explicitly labelled drawing with invented figures. The section
below describes that preview separately from the working declaration, quarantine and approval tools.

**App releases** and **Look up a user** are built. Everything either of them shows comes from the
operations API; neither holds any data of its own, and where the API answers with nothing the
pane says which kind of nothing it is.

App releases draws each platform's tracks as a ladder in promotion order. Two rules from the
approved design are worth knowing before reading the page:

- **Store truth and field truth are never merged.** The store reports what a track is set to,
  usage data reports what people actually have, and both appear as their own figure.
- **A stale source keeps its rows and shows its last successful poll time.** Hiding figures
  because a poll failed would turn a source outage into a data outage.
- **A track outside the ladder is named, not dropped.** The ladder is a fixed set of rungs per
  platform, because its whole point is that promotion runs in one order, so a store reporting a
  track outside that set has nowhere to draw it. Those arrive separately as
  `platforms[].unknownTracks` and are listed under the ladder they are not on, and they count as
  builds in flight: a store whose only build sits on one of them must not render the empty state
  whose sentence is that both stores answered and both are empty.

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
  **Who looked**. A response that does not confirm a record says so on screen rather than
  looking identical to one that does, because a promise nobody can falsify is not a promise.
- **Masked by default, and a missing flag is masked.** Masking happens in the operations API,
  not here, and this directory never derives a mask from a real value. Only an explicit
  `masked: false` renders a field in the clear; absent, null, or a field carrying both a real
  value and a mask is read as masked.
- **A reveal is one field, with its own written reason, and it un-reveals itself** when the
  server's window expires, when the record closes, and when a new search starts. A response
  that carries no expiry does not buy an indefinite reveal: the client applies its own short
  ceiling and says on screen that it did.
- **Health data carries no reveal control at all**, not a disabled one and not a role-gated one.
  The API is expected to send those fields as never-revealable, and the client keeps its own
  list of health field keys as a floor under that, so a server that got it wrong could not make
  this page the place it went wrong.
- **Destructive account actions are absent, not permission-gated.** There is no control for
  deleting an account or wiping its data anywhere on the page. That runs through the account
  deletion workflow, which needs the athlete's own confirmation.

The shared filter bar round trips through the querystring, so a pane reads a selection rather
than inventing one. A pane listens on `window` for two events, both dispatched by
`shell-pane-v2.js` once the session is confirmed and the shell is in the document, so a listener
added while the shell is still booting cannot miss them:

- `ops:ready`, carrying `{ pane, filters }`, which is the signal that `#content` exists.
- `ops:filters`, carrying the selection, fired for the starting selection as well as for every
  change to it. `OpsShell.filters()` returns the same thing on demand.

Per-pane filters are declared, not appended. The bar a pane gets is the one `pane-registry.js`
declares for it and `shell-pane-v2.js` draws, and no pane module on the v2 layer touches
`.filterbar` at all — the only code that does is in `shell.js` and `operate.js`, which no page
loads. App releases is the pane this paragraph used to describe as adding its own Platform
switch; its registry entry now declares `scope`, `range` and `env` all false and carries a
`filterNote` saying why, so the shell prints the note where controls would have been.

The scope control follows the rule the mocks encode: All, Mobile and Coaches Web appear only
where a per-app split is real. Cloud costs says so inline, because cloud spend is billed per
piece of infrastructure rather than per app and splitting a shared bill by client would be an
invented number.

That rule now binds a built pane to what its own reads can carry, through the registry's
`filterNote`. Overview declares no scope, range or environment control, because everything it
draws is the state of things right now, across every app, in production; Problems keeps its
window, which is applied to the problems that were read and disclosed in the count line under
the list, and drops the environment control, because a problem carries no environment to filter
on. A control that moves and changes nothing is worse than no control: it leaves Staging showing
in the bar over production figures. Both say so where the control would have been, and both get
their controls back when something can carry them.

People and usage and Cloud costs keep the controls the registry gives them, and now every one of
those controls is carried into the read: People and usage sends `scope`, `range` and `env`, and
Cloud costs sends `range`. That is not automatic. Both read APIs answer a request with no
querystring rather than refusing it, so a pane that pointed at an endpoint and forgot the query
would draw confident figures for every app over thirty days on production, with the operator's
own selection sitting in the bar above them.

Two controls came off in the same commit that turned the endpoints on, for the same reason the
rule exists:

- **Cloud costs no longer offers Custom.** This bar carries a range name and no bounds, so a
  custom window reaches the cost API with no start and no end and is refused
  (`ops_cost_range_unsupported`). Left in the list it would be a selectable option whose only
  outcome is a failure card with a retry that cannot succeed. It comes back when the bar grows
  date controls to fill it.
- **App releases no longer offers a range.** `ops_release_snapshots` is upserted per track, so it
  holds current state and no history; the route accepts a range and echoes it, and not one field
  in the response varies by it. The control is removed rather than labelled, and a `filterNote`
  says so where it was.

Two more came off later, for the same reason and after a spell of doing the other thing.
Happening now and What happened each declared an app control and an environment control, and
each then explained, in prose underneath the bar the registry had made the shell draw, that the
app control narrowed nothing and that Staging would be refused rather than answered. What
happened also offered a custom window whose one outcome was a refusal card. The alerting record
is kept per request type rather than per app, there is no staging alerting record, and no bar on
this dashboard can supply a start and an end. All of it is now declared `false` — or, for the
custom window, simply not listed — and one `filterNote` on each pane says why, which is what
Overview has done since it was built.

That rule now has a guard rather than a reader.
`scripts/ops-registry-filters.test.mjs` boots every pane on the v2 bootstrap that declares a
filter, at every value
the shell will offer for it, and requires the value either to reach that pane's own read in a
field of the same name or to narrow what the page draws. It reads the call the pane recorded and
the DOM it wrote, never the pane's source text: a check that greps source pins the spelling
rather than the behaviour, and stays green the day somebody reinstates the defect in a different
one. It locks its own coverage as well, so a pane that gains a filter is red there until somebody
writes down how that filter is acted on. The converse — that a filter a pane does not declare
cannot be reached through the URL — is deliberately not asserted there: the shell pins every
undeclared filter before a pane sees one, so no mutation of a pane can turn that claim red. The
narrower shell-level claim that can fail — that a pane is offered exactly the filters it
declared and never one more — is held in `scripts/ops-shell-pane-v2.test.mjs`, and what the two
pane suites hold instead is what their own bar draws. Cloud costs is the single exclusion: that file does not boot it, so
nothing there proves its windows. The lock pins the exact claim it is excused for by name **and
by value**, so a filter or a window added to it is red as well. The pane itself is on the v2
bootstrap like every other — the `panes` block above is what says so — and the exclusion is now
about what that file boots rather than about which shell the pane is on.

Role differences surface in navigation affordances only at this stage. Settings is owner only,
so a non-owner sees it marked in the rail and lands on a state that names the role it needs
rather than a destination that silently vanishes. The server enforces this independently; the
client renders a fact, it does not decide one.

## The two understand panes

### Where their figures come from

Both panes read a live endpoint: Cloud costs reads `GET /api/ops/costs?range=`, and People and
usage reads `GET /api/ops/usage?scope=&range=&env=`. Each builds its query from the shell's
filter state at the moment of the call, so the request and the bar cannot disagree.

The query is as load bearing as the path, and easier to leave off. Neither route refuses a
request that arrives without one: costs falls back to this month and usage to every app over
thirty days on production. A pane that set the endpoint and forgot the query would therefore
render a complete, confident answer to a question nobody asked.

A pane may still be pointed at a same-origin JSON fixture from a loopback page, which is how the
branches a live API will not produce on demand get looked at: a window billed in two currencies,
a reading stamped ahead of this clock, a covered span with holes in the middle.

The panes hold no figures of their own. Every label that names a service, a version, a group,
or a resource arrives in the response; nothing operational is a literal in these files. What is
static is the layout, the state copy, and the glossary, because a definition is not a
measurement.

### The response the panes read

Both read the transport's envelope, so the pane sees `payload.data`.

**Cloud costs** expects `range`, `asOf`, `publishLagHours`, `staleness`, `scopeNote` and
`availability` on every answer, and — only when `availability.state` is `ready` — `currency`,
`period`, `total`, a `views` object holding `category`, `resourceGroup` and `service` as
`{ label, hint, rows }`, and `daily`. `comparison` and `forecast` are each present or absent on
their own terms: a comparison only when a previous window was collected in the same currency,
and a forecast only when the period is still open, something has been billed, and the total is
above zero — so the only range that can carry one is `month`. `availability.state` is `ready`,
`unconfigured`, `disabled`, `not_published` or `mixed_currency`.

This paragraph used to name `budget`, `unitCosts`, `reconciliation` and `anomalies`, and to list
three availability states. The route sends none of those four fields and sends five states. The
v1 pane read all four and drew a budget meter, an anomaly card and a unit-cost strip from
whatever `undefined` produced, which is why they are gone from the remodel rather than
reimplemented: there was never an answer behind them. A figure this pane cannot source is an
issue to file, not a slot to fill.

`mixed_currency` has its own card rather than falling into either neighbour, because neither is
true of it. The route withholds the total when a period was billed in more than one currency, and
that is not a timing question ("normal in the first hours of a period") nor a configuration one
("cost reporting is not set up"): the spending was collected in full, in two currencies, and
cannot be added. The route names the currencies in its own `detail`, which the card renders,
because the response carries no `currency` when there is more than one.

The headline label follows the range in the answer rather than saying "Month to date" whatever
the window is. That was invisible while the pane had no endpoint and would have put those words
over a twelve month bill the day it got one.

**People and usage** expects `asOf`, `window`, `coverage`, `apps`, `cohorts` and `features`.
`availability.state` is `ready`, `insufficient`, or `not_reporting`. There is no `funnel`:
`OpsUsagePayload` has never carried one, and departure 9 below says why the pane stopped
drawing one.

The age on the band head is read from `window.rollupsComputedAt` and never from `asOf`. They
look interchangeable and are not: the route sets `asOf` to the window's exclusive end, which is
the last UTC midnight and is recomputed on every request, so an answer whose rollups last ran a
week ago still arrives with an `asOf` from this morning. `rollupsComputedAt` is the freshest
recompute behind the summed figures, and `null` when nothing has been computed at all — a
different statement from a timestamp that cannot be read, and the pane says each of them
differently.

`window` carries three separate facts about how much of the chosen span has figures behind it,
and the pane renders all three as statements about the *window*, never about a column, because
each is a union across the selected apps:

- `daysCovered` with `reportingStart` is the span that has ever been aggregated. A 90 day window
  opened today reaches back past the pipeline's own lifetime, and those earlier days are outside
  it rather than missing from it. Where the covered span is shorter than the window, the head of
  the first band says how much of the window that span reaches and from which day — `20 of 90
  days covered, from 31 Aug 2026` — beside the figures that are summed over it, because the range
  name alone says 90 days either way. **Covered**, never *stored*: the span is the distance from
  `reportingStart` to the end of the window, and the days inside it that carry figures are that
  distance minus `daysMissingRollups`, so on the answer above the pill says 20, the chart's name
  says `18 of 90 days with a reading` and the trend foot names the two gap days. It does not say *why* the span is short: that the rollups began on a
  particular day is a fact about the pipeline rather than about this answer, and a sentence
  explaining it is an argument, which the editorial rule keeps off the pane. Not a warning
  either — the route is explicit that partial coverage annotates the figures rather than
  replacing them.
- `daysMissingRollups` is the real gap: days at or after `reportingStart` that carry no stored
  figures. Those shorten the session and coverage figures and leave the live people figures
  alone, and the callout says so.
- `reportingStart: null` with `daysCovered: 0` arrives as `ready`, because the people figures are
  read live from accounts and can clear the reporting floor while not one day has been
  aggregated. The pane draws the live figures, and shows the figures counted from stored days as
  **not reported** rather than as zero. A zero there would say the apps ran and nobody did
  anything, which is the one reading the payload has ruled out.

Two conventions run through both, and both exist so a figure means the same thing on the pane
that it meant in the data:

- **Money is integer micro-units of the billing currency.** The pane divides once, at the
  moment of display. This is what lets Cloud costs *add up* its rows and compare the sum with
  the billed total exactly; a float sum over a few hundred daily rows does not reproduce an
  invoice, and a near miss is indistinguishable from a real gap. The comparison is therefore
  finer than the display: a gap smaller than one whole unit of the last decimal place shown is
  named in words rather than printed, because printing it would put three figures on screen that
  do not visibly differ by the amount the sentence beside them claims. The wording names no
  currency unit, since the billing currency is whatever the response says it is.
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
  turned into. Grouping rows read through the same rule, so a row whose `micros` is a string,
  `null`, `NaN` or `Infinity` makes the reconciliation *unavailable*: the pane says the rows
  cannot be checked against the bill rather than claiming they add up exactly with the
  unreadable row silently counted as zero, and rather than reporting a gap that is really a
  parse failure.
- **A timestamp is an ISO string in one of three shapes, and anything else is absent.**
  `YYYY-MM-DD`, `YYYY-MM-DD[T ]HH:MM[:SS[.digits]]` (read as the UTC the pipeline meant, with
  fractional seconds of any length), and the date-time shape carrying `Z` or a `+/-HH:MM` or
  `+/-HHMM` offset; the designator belongs to the date-time shape only. A `Date` instance is
  accepted too.
  Two normalisations run before the shape is matched, and both are narrow on purpose. A single
  space between the date and the time stands in for `T`; any later space leaves a shape none of
  the three match. And a lowercase `t` in that separator position, or a lowercase trailing `z`,
  is folded to uppercase, because the shapes the engine is required to read as UTC are the
  uppercase ones, so matching a lowercase designator and then passing it through unchanged would
  hand exactly the strings this guard exists for back to engine-decided parsing. The fold is
  anchored to those two positions only: it does not touch a lowercase letter anywhere else, so
  `2026-07-31Tz06:00` and the like still fail the shape and are absent.
  Everything else, including `null`, `0` and strings the language would happily parse such as
  `Jul 31 2026 06:00` or `12/25/2026`, renders the "the time of this reading was not reported"
  sentence. The shape is checked before `new Date` sees the string, not after: `new Date(null)`
  is the epoch rather than an invalid date and would print 1 Jan 1970 with an age of half a
  million hours, and a non-ISO string is parsed as *local* time, which formatted back out with
  `getUTC*` and labelled UTC gives every operator a different stamp for the same payload and,
  either side of the date line, a different day.

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
pane at it. It does not claim figures will appear "without another release", and the reason is
not that the routes are unnamed. Every `pane-*.js` in the tree has a line here, and the line is
every `/api/…` string literal that file spells:

```claims id=pane-read-endpoints
pane-alerts.js = /api/ops/alerts/problems, /api/ops/alerts/problems/, /api/ops/alerts/rules, /api/ops/alerts/rules/
pane-analytics.js = /api/ops/usage
pane-data.js = (no route literal)
pane-evaluations.js = /api/ops/ciel/operations
pane-jobs-live-v2.js = /api/ops/alerts/problems, /api/ops/alerts/rules
pane-overview.js = /api/ops/alerts/problems, /api/ops/alerts/rules, /api/ops/summary
pane-registry.js = (no route literal)
pane-releases.js = /api/ops/releases
pane-run-history-v2.js = /api/ops/alerts/problems, /api/ops/alerts/rules
pane-spend.js = /api/ops/costs, /api/ops/summary
pane-users.js = /api/ops/users/, /api/ops/users/lookup
```

A backend publishing `/api/ops/usage` or `/api/ops/costs` changes nothing on its own, because a
fixture is read only from `localStorage` on a loopback origin and a pane pointed at one is not
pointed at the route. The README said the two fixture-capable panes' `endpoint` values were both
`null`, which was false against both files at the head that said it.

The block is a **literal scan**, not a call graph. A pane that builds a URL by concatenation
shows the prefix it spells — `/api/ops/users/` and `/api/ops/alerts/problems/` are that, not
routes of their own — and a route named only in a comment would appear here too. What the block
does guarantee is that no pane leaves the list: a file with nothing matched says
`(no route literal)` rather than dropping out, which is how the first spelling of this block hid
three panes that do name routes. Whether a named route is ever *called*, and by what, is not
decided here.

## The Settings pane

Settings is owner only. It used to say here, and in the tour above, that it is "the one pane that
can change something". That was false when it was written: Problems acknowledges and closes
problems, People reveals a masked field, and Aria quality posts an evaluation. Derived rather
than asserted, from the HTTP method each file spells:

```claims id=write-capable-assets
ops assets naming a write method = login.js, pane-alerts.js, pane-evaluations.js, pane-users.js, session.js, settings.js, setup.js
of those, pane scripts = pane-alerts.js, pane-evaluations.js, pane-users.js
```

`settings.js` is the v1 script and `session.js` is the transport every one of them calls through;
`login.js` and `setup.js` are the two pages outside the shell. The line is per file and not per
call site — it reads the HTTP method a call site spells, so a file keeps its place until its last
write method goes, and says nothing about whether any of those calls is reachable or authorised. What is true of Settings is
narrower and worth being exact about: It runs on the v2 shell: `settings.html` loads `aria.css`,
`shell-pane-v2.css` and `pane-settings-v2.css`, and registers through `definePane`. The v1
`settings.css` is gone with it.

**Six areas, and only three of them are read from anywhere.** Administrators, active sessions and
the access record come from the API. Retention windows, the cost-category mapping and integration
state have no endpoint to read or write. Both halves are on the same pane, so the pane has to say
which is which, and it says so three times over, never once in colour alone:

1. **The word.** Every card head carries a source chip reading either `Live` or `No API yet`.
   Both chips are the same neutral ghost pill, so the distinction survives a reader who cannot
   tell two tints apart.
2. **The surface.** A card with nothing behind it is flat, dashed and hatched, with none of the
   lit top edge that makes a live panel read as a raised object.
3. **The figures.** A card with nothing behind it prints **no numeral at all** — not a count, not
   a window length, not a date. It says which of "not built" and "not reported" applies, and what
   stays true regardless. A number nobody can check is indistinguishable from one that came from
   somewhere, so there are none.

A live card also carries `data-endpoint` naming the path it was filled from, and
`scripts/ops-settings-v2.test.mjs` holds the partition in both directions: every card marked
`data-source="live"` names an endpoint the pane actually requested on that boot, every card marked
`data-source="static"` names none and contains no digit, and **neither set is empty**. Moving one
card across the boundary fails the suite.

`Stadiora/Aria#5442` is the issue that gives the three static cards an API. Until it lands, the
line stays where it is: this pane restyles all six areas and moves none of them across it.

**What the live half does.** Each account's role, status, last sign in and current session expiry;
every live session with who holds it, when it started, when it was last used and when it ends; and
the access record, newest first, with paging and an export. Revoking asks first, requires a
written reason, sends that reason, and reports what the server answered rather than what was asked
for. The record is reloaded beside the change, so the entry describing it is on screen next to the
thing it describes.

**Four facts the restyle is not allowed to lose**, because each one is the difference between a
settings change and an incident:

- The access record is **append only**. Nothing on the pane can edit or delete an entry, including
  an owner. Export is the only write path and it writes a copy.
- Sessions end at a **hard ceiling, not an idle timeout**. Revoking signs that browser out on its
  next request. The ceiling is **measured** from the widest live session rather than printed from
  a constant, so a pane that has nothing to measure says nothing instead of repeating a number the
  server may have changed.
- Retention windows split into **configurable** and **fixed by policy**, and the fixed ones say
  why they are locked: they record who looked at an athlete. **Shortening a configurable window
  deletes rows on the next nightly pass** — it is not a filter on what is read back.
- **Three fixed roles**, and there is no custom permission set.

**Nothing here is a permission check.** The pane draws what the role in hand can do, and the
server re-reads the account row on every request and refuses independently. A control drawn for
somebody who may not use it is a cosmetic bug; the server's answer is the one that counts, and it
is the one shown. The pane is `roles: ['owner']` in the registry, so every other role gets the
shell's named refusal rather than a blank pane, and the pane module is never asked for a pane at
all — nothing here reads anything until `definePane`'s callback runs. The test asserts both
directions, because a gate that refuses everybody passes a test that only checks refusals.

**The export covers what is loaded**, which is what the button says. There is no server-side
export, and a button labelled "export the record" that quietly sent one page of it would be a lie
about the record people are meant to be able to check. Cells that begin with a character a
spreadsheet reads as a formula are prefixed so that opening the file cannot run anything: two
columns of that export carry text somebody else wrote, including the address submitted on a
refused sign in.

**Where the pane departs from `docs/mocks/ops-dashboard-v2/settings.html`:**

- The mock's band is called *Audit log*; here it is the **Access record**, which is what
  `pane-users.js` and the rest of this README already call the same thing. One name for one
  record.
- The mock's audit band note reads `kept 7 years`. Nothing reports that window, so it is not
  printed. The retention card says so instead.
- The mock's twelve-row role matrix is not built. It is an unverifiable claim about server
  behaviour rendered as a table that looks like data, which is the failure the source chips exist
  to prevent; the three roles it described are stated once, under the table whose Role column they
  explain.
- The mock's disabled **Invite** button is not built. There is no invitation endpoint, and a
  control that changes nothing is worse than no control. The card foot says where accounts come
  from instead.
- Sessions show **no IP address and no user agent**. The mock shows a coarse region, which nothing
  here can derive; printing the raw address instead would widen what a world-readable pane's
  screenshots can leak for no operational gain. Both fields stay in the CSV export, where the
  audience is an owner who asked for them.
- There is **no filter bar**. The registry gives Settings no scope, range or environment, and the
  shell draws a bar only for the filters a pane's own reads can honour.

## The Aria quality pane

`evaluations.html` runs on the v2 shell and loads `aria.css`, `shell-pane-v2.css` and
`pane-evaluations-v2.css`. It is the one pane where **most of what is on screen is a drawing**,
and everything about how it is built follows from that.

**The operation tools work. The scoring half does not exist.** Dataset declaration validation,
evidence quarantine and approval handoffs call the shared Ciel operation using supplied inputs. Below them
is a design for a scoring harness that has no code, no endpoint and no stored score. The numbers
in it were invented to draw the layout.

**How a reader tells one from the other**, three ways over, never once in colour alone:

1. **A stamp in every band's status slot**, carrying a word and a glyph: `Works now` on the operation
   tools, `Invented figures` on all three drawn bands. Same chip, same slot, so they read against
   each other, and a screenshot of any one band still carries its own stamp.
2. **A banner above the drawn half**, headed *The scoring harness is not built yet*, which states
   in one sentence that every figure below it was made up.
3. **The surface.** The drawn half sits on a flat, dashed, hatched panel with none of the lit top
   edge that makes a working card read as a raised object — the same treatment Settings uses for
   a card with no API behind it, so the two panes teach one vocabulary rather than two.

`scripts/ops-pane-evaluations.test.mjs` holds that partition in both directions: every band
inside the drawn panel is stamped `Invented figures` and none is stamped `Works now`, every band
outside it is the reverse, **neither set is empty**, and **neither a two-decimal figure nor any
string in the file's hand-written invented inventory appears outside the panel in the two render
states it sweeps**. Moving one band across the boundary turns seven tests in that file red.
Nothing real on this pane is written as a two-decimal figure, which is what makes that sweep a
usable rule rather than a coincidence: the working half prints digests, byte counts and timestamps.

The sweep reads one string taken from `<body>` with the panel's subtree removed, so it covers the
shell's live region — `announce()` is how a screen-reader operator hears every success here, and
the stamps are visual chips — and it finds a phrase split across sibling elements, which bolding a
number inside a sentence produces and which a per-element sweep walked past. It also reads text
carried on attributes, listed once as `SPOKEN_ATTRS` in that file and nowhere else, because an
enumeration repeated in prose goes stale the round after the list is widened — **and separately
the live `value` a control is holding**, which is a property rather than an attribute: this pane
assigns `expiry.value` and `mediaType.value` in JS, where `getAttribute('value')` returns nothing
and the box on screen is full. Two shapes qualify: text painted on screen, like a field's value or
a placeholder shown until the operator types, and text a screen reader substitutes for the
element's own, like an `aria-label` — a figure in the second is worse than one in the live region,
because it suppresses the real words underneath it as well. The two states are the booted page and
the page after the dataset and quarantine forms have been submitted and answered. This sweep
does not cover post-submission approval states.

Three gaps, each measured rather than guessed, with a row of the PR's battery behind it. **The
inventory is hand-written and nothing proves it is complete**: a bare count, or a round number in
a new sentence, is invisible to it. **The error branches are a third render state nothing reads**:
a score in a validation failure message leaves the suite green, while the same string on a
boot-state hint turns three tests red. **A figure split mid-token** across two elements joins with
a space here and without one in a browser. Adding invented data to this pane means adding it to
the inventory by hand, and the test file says so where a reader will meet it.

**What the working tools do.** Validation takes an input object containing `datasets` and
`fixtureDigests`; the page supplies the operation envelope. The server returns manifest digests
or field paths and reason codes. Editing the input clears the old result. Validation stores no
dataset, inspects no referenced bytes, verifies no qualification and grants no evidence access or
release approval.

Owners and operators can also submit a local synthetic or exactly authorised production-derived
file to the shared Ciel operation. The page sends no credential or endpoint in request data,
renders no raw evidence or storage location, and never describes quarantine as admission,
evaluation consent, training consent, export permission, or proof of de-identification. A viewer
is told in a named block that the import needs operator access, rather than being shown a gap
where a form was.

Approval lookup remains available to viewers. Operators and owners also see request and decision
forms. The backend checks record access, fresh authentication, independence and verified qualification;
the page cannot grant qualification or admit evidence. An unconfigured authority remains unavailable.

The retention field shows the browser's local timezone and submits UTC. Its default starts
30 elapsed days ahead and uses the offset at that future instant, including DST changes,
rather than writing UTC clock text into a local-time input. The control has minute precision:
seconds and milliseconds are omitted. A repeated fall-back hour cannot encode which occurrence
was intended; native JavaScript parsing selects the earlier occurrence, so this is not an exact
instant round-trip for the later occurrence. Manual edits still use the displayed local time,
and the future-date and 90-day retention bounds are unchanged.

**Where the pane departs from `docs/mocks/ops-dashboard-v2/evaluations.html`:**

- **The working tools come first, then the banner, then the drawing.** The mock opens with the
  banner, because the mock is a drawing of a pane where nothing is built. Here operation tools are, so
  a page that opens by saying it is not built would be false. The banner sits directly above the
  half it describes and its claim is scoped to that half.
- **The drawn half is not faded.** The mock sets `opacity: .55` over it, which multiplies every
  ink in the panel and takes text the v2 palette places at 4.5:1 down below 3:1. The dashed
  hairline, the flat fill and the hatch carry the same "this is not a thing yet" reading without
  moving a single colour.
- **The drawn half is not `aria-hidden`.** The mock hides it from assistive technology, which
  hides the warning too. Every drawn band carries a real, announced stamp instead: the mock's own
  stated reason for per-band stamps was that a screenshot of one card still carries the warning,
  and a screen reader user has the same problem.
- **The drawn half holds no control.** The mock keeps `Open run` buttons in it under
  `pointer-events: none`, which leaves them in the tab order inside a hidden subtree. A control
  that changes nothing is worse than no control; they are gone. The test asserts the panel holds
  no control at all and exactly one focus stop — the table that scrolls sideways on a phone,
  which is named and reachable because a scroll region a keyboard cannot get to fails WCAG
  2.1.1 — while every working band contains at least one control.
- **No sparkline over the version list.** Both draw the same seven figures; that is one fact
  captioned twice.
- **No `including the 0.82 on Overview`.** Overview prints no quality figure, so the sentence
  describes something that is not there.
- **No `.why` annotation blocks.** They are the mock's design commentary, gated behind its own
  notes toggle, and are not part of the pane.
- **No filter bar controls.** The registry gives this pane no scope, range or environment and
  carries a note saying why; the shell prints the note where the controls would have been.

## Departures from the approved mocks

`assets/ops.css` is the mock stylesheet with these changes. Read the list as the record of the
v1 stylesheet: `ops.css` is now loaded by `login.html` and `setup.html` only (the block under
Layout is where that is read off the pages), so an item below saying "every page" or naming a
pane page is describing what that rule reached while the panes were on it. The v2 sheets carry
those panes now.

1. **No Google Fonts `@import`.** The font stacks are unchanged, so anyone with Fira Sans or
   JetBrains Mono installed sees the intended faces and everyone else falls back cleanly.
   Nothing is fetched from a third party.
2. **Mock-only rules removed**: design commentary, the preview-state switcher, the notes toggle,
   and the `--note-bg` token that only they used.
3. **`--mono` gains `Consolas`** before the generic `monospace`, so Windows has a real fallback.
4. **Dark `--text-3` moved from `#667484` to `#8593A2`.** The original measured 3.35:1 on
   `--surface-3`, its worst rendered pairing at the time, and 3.93:1 on a card. It
   needs 4.5:1, because it carries metadata, table headers, filter labels and placeholder text,
   all of which are text. What the new value clears is not typed here — it is measured from the
   shipped token against the **surfaces** of that same block, named below rather than counted, so
   a surface renamed or added is a red run and not a number that still reads 5. Every other
   opaque token in the block is named on the last line for the same reason: a new one belongs to
   one list or the other, and until somebody says which, this is red. The figure that used to sit
   in this sentence disagreed with the comment on the token itself by 0.05:

   ```claims id=dark-text-3
   --text-3 in ops.css's dark :root = #8593A2
   surfaces it is measured against = --bg, --surface-1, --surface-2, --surface-3, --surface-hover
   worst pairing = --surface-hover #1E2833 at 4.76:1
   clears 4.5:1 on every one of them = true
   every other opaque token in that block = --ai, --border, --border-strong, --brand, --brand-bright, --control-border, --control-border-hover, --crit, --cta-end, --info, --ok, --s1, --s2, --s3, --s4, --s5, --s6, --text, --text-2, --text-3, --text-inverse, --warn
   tokens in that block this cannot read as a flat colour = --glow, --ink-mix, --scrim, --shadow-1, --shadow-2, --shadow-3, --tint, --tint-line, --tint-soft, --topbar-bg
   later :root rules redeclaring any of them = (none)
   ```

   Every custom property that block declares is on exactly one of those three lines, under
   whatever name CSS allows — `--panel_bg` and `--PanelBg` are legal custom properties and used
   to fall through a `[a-z0-9-]` name class into none of the lists. A colour is resolved from its
   **value** rather than matched by its spelling: `#abc`, `#AABBCC` and `rgb(170, 187, 204)` are
   one colour here, where the block once read only the six-digit hex and a surface written any
   other way was measured against nothing. A property declared twice in that rule resolves to the
   **last** declaration, as it does in a browser. The surfaces are the tokens named `--bg` and
   `--surface-*`, spelled exactly that way; anything else opaque is named on the second line, so a
   surface introduced under some other name is a red run rather than a silent omission. The fourth
   line exists because `ops.css` declares `:root` more than once and a later one wins: a token
   redeclared below this block would not be the colour measured above.

   What it does **not** answer is where the ink lands: `--topbar-bg` and `--scrim` are `rgba()`
   and composite over whatever is behind them, so no arithmetic over this block can judge the
   pairing a translucent bar produces — which is why they are named on the third line rather than
   quietly dropped. `check-ops-contrast.mjs` measures the rendered pair in a browser, and that is
   the oracle for it.
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
   overlays trap focus, close on Escape, restore focus, and make the background inert. Overlays
   stack, and the stack has two rules that matter to a keyboard user. Only the top overlay acts
   on a key, so one Escape closes the confirmation and leaves the drawer under it. And an overlay
   asked to close while something is open above it comes down when it is the top again, rather
   than restoring the background from underneath an open dialog. A confirmation whose action is
   in flight refuses Escape and the scrim for that window, the same window in which its buttons
   are disabled, and re-arms all three together if the action fails.
9. **The per-page `<style>` blocks the mock gave the understand panes became classes**, because the
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
13. **`.btn-primary:hover` restates its own background.** Without it `.btn:hover` wins on
    specificity and repaints a primary button with the plain hover fill while `.btn-primary`
    keeps the inverse text colour: white on pale grey, 1.2:1, so the label vanished under the
    pointer that was about to click it. This is not a pane-scoped fix and it is not a token
    change; the sign-in button is the one it was found on.
14. **Gone: the two ship and support panes darkened the light-theme status ink**, scoped to
    those two pages. That block was deleted from the end of `ops.css` in `aria-website#74` when
    App releases and Look up a user moved to the v2 layer and stopped loading this stylesheet;
    the arithmetic it was computed from is kept in the historical record below.
15. **A sideways-scrolling wrapper needs to be positioned, and some of the v2 ones are not.**
    `overflow-x` clips only a descendant whose containing block is the wrapper, and an absolutely
    positioned one resolves that to the nearest **positioned** ancestor. Left static, an
    `.sr-only` span inside a table wider than a phone resolves past the wrapper, escapes its
    clip, and extends the document's scroll width: the table scrolls inside its card and the
    whole page scrolls sideways with it. `position: relative` puts the containing block back
    where the clip is.

    This item used to say the declaration was "on every page". It was not, and on the v2 layer it
    is not now. Where it actually is, derived from the sheets by finding each box through its own
    `overflow-x` rather than by class name:

    ```claims id=scroll-wrapper-position
    ops.css .table-wrap = position: relative
    pane-alerts-v2.css .scrollx = position: static (the sheet sets none)
    pane-analytics-v2.css .u-scroll = position: relative
    pane-evaluations-v2.css .tbl-wrap = position: relative
    pane-releases-v2.css .tbl-scroll = position: relative
    pane-run-history-v2.css .tbl-wrap = position: static (the sheet sets none)
    pane-settings-v2.css .tbl-wrap = position: relative
    pane-spend-v2.css .sp-scroll = position: static (the sheet sets none)
    pane-users-v2.css .tbl-wrap = position: relative
    ```

    `.table-wrap` is the **v1** wrapper, declared in `ops.css`, which since the remodel only
    `login.html` and `setup.html` load and neither of them draws a table. Evaluations'
    `.tbl-wrap`, Releases' `.tbl-scroll`, Settings' `.tbl-wrap` and People's `.tbl-wrap` were
    repaired under Stadiora/Aria#10706 and join `.u-scroll` in carrying it; the escape route
    above is open on every wrapper still marked static. The block
    is derived from the sheets on every run, so read the count off it rather than off this
    sentence.

    This item used to add "no pane ships such a span today". That was false, and it was false in
    the most expensive way — a reassuring sentence nobody re-derived. Panes ship them:

    ```claims id=sr-span-classes
    absolutely positioned screen-reader classes = aria.css .sr, ops.css .sr-only
    ops assets drawing one = aria.js, operate.js, pane-alerts.js, pane-analytics.js, pane-data.js, pane-releases.js, pane-users.js, settings.js, shell-pane-v2.js, shell.js
    ```

    `pane-alerts.js` puts a `caption.sr` inside `table.tbl` inside `div.scrollx`; `pane-users.js`
    and `pane-releases.js` do the same inside `div.tbl-wrap` and `div.tbl-scroll`. Of those three
    wrappers, Releases' and People's are now positioned and Alerts' `.scrollx` is still static in
    the block above, so for that one the containing block of the caption is not the wrapper. Nothing is broken on screen anyway, for a reason this item had never stated: a
    1px-wide clipped caption's static position is the table's left edge, so resolving past the
    wrapper adds no scroll width to the right of anything. That is a claim about layout, not
    about text, and it is **not derived here** — `scripts/check-ops-narrow-overflow.mjs` is the
    oracle that would catch it if it stopped being true. The gap stays open because a span whose
    static position is *not* at the left edge would escape, and nothing in this tree stops one
    being added. Tracked as `Stadiora/Aria#10706`.

    **Not covered here.** The original item carried measured figures — a document scroll width
    going from 375px to 1118px on Settings and to 434px on App releases with the declaration
    deleted at run time. Those were taken against the v1 `.table-wrap` before the panes were
    remodelled, and nothing in this tree reproduces them: the sheets those panes load today
    declare no `position` to delete. They are gone rather than restated, because an unreproducible
    number in a departures record is the defect this file was just corrected for.

16. **A filter-bar note wraps.** `.badge` is `nowrap`, which is right for a chip and wrong for
    the sentence a `scopeNote` or `filterNote` puts in the bar. A flex item will not shrink
    below unbreakable content, so on a phone the note was wider than the bar and pushed the
    document sideways with it: `/ops/alerts.html` measured 385px against a 375px viewport on
    the "Problems are production only" note. `.filterbar .badge { white-space: normal; }`
    lets it take a second line. Same repair as item 12 and the same reasoning as item 15 — a
    row wraps or scrolls inside its own container, and the page never scrolls sideways.

    Worth knowing for anything measured this way: **font metrics differ per platform**. That
    375px overflow reproduces on Linux and not on Windows, where the same sentence renders
    narrow enough to fit. It was found by the check in `scripts/check-ops-narrow-overflow.mjs`
    running in CI, after a local run of the same commit had passed.

### Overview on v2: where the pane departs from the mock

`docs/mocks/ops-dashboard-v2/index.html` in the Aria monorepo is the approved design. The pane
follows its structure, its drill-down paths and the rules its README calls normative.

The list below is **not a complete diff against the mock** and does not claim to be. It names
the departures that carry a decision: a thing the mock draws that nothing behind the pane can
answer, and a second caption for a fact already on screen. Wording, ordering within a card and
exact copy differ in more places than are listed here, because the mock is a static page with
hand-written sample text and the pane writes its words from the answer. Anyone checking this
pane against the mock should read the list as "these are on purpose and here is why", not as
"everything else is identical".

1. **No App, Range or Environment control.** The registry gives Overview none, and the filter bar
   states the absence where they would have been. `/api/ops/summary` takes no parameter and
   reports the environment it answered for; a control that changes nothing is worse than no
   control, because the selection sits in the bar looking applied.
2. **No budget bar on the cost tile.** Nothing in the platform records a cloud budget. The route
   marks the figure `basis: 'spend'` and names the gap in `omissions`, and the pane prints the
   omission with its reason. An empty track reads as a budget with nothing spent against it and
   a full one as a budget already gone.
3. **No month-end forecast**, for the same reason: only billed usage to date is stored.
4. **No sparkline in the tiles.** The daily series exists for active people only. A sparkline on
   three tiles out of four, with one of them drawn from a different shape, invites a comparison
   between lines that are not comparable.
5. **No severity stack bar in the ribbon.** The chips beside it already carry each count with its
   own glyph and word; the bar is the same fact a second time, in colour.
6. **The mock's explanatory captions are not reproduced.** "Not the sum of the two apps", the
   omissions footer, and the cost tile's sentence about `basis` each restate something the figure,
   the pill or the omissions card already says. The mocks encode one fact per slot, and that rule
   is what took the approved set from 7,240 words to 4,842.

7. **Five more things the mock draws are absent, all for reason (2) above — no source.** They
   are listed separately because they are structural, not wording, and a reader diffing the pane
   against the mock hits them first:
   - the hero service-health chips (`Main backend 99.98%`, `Aria AI 99.94%`, `Plan builder`,
     `Database 3ms`). No uptime or latency series is stored per component; `/api/ops/summary`
     answers for the platform, not for four named services.
   - the AI-runs quality figures (`98.6% finished cleanly`, `Slowest 5% took 8.4s`). The route
     returns a run count and its previous-window count, and no outcome or duration distribution.
   - the version tile's `Adoption 73%` and `Crash free 99.7%` meters. Neither is recorded; a
     meter drawn against a denominator nothing stores is the budget-bar problem again.
   - `Auto refresh · 60s`. Nothing here polls, and a label claiming a refresh that does not
     happen is worse than a page you know is a snapshot.
   - the **hourly** grain on the activity chart. Nothing behind it aggregates finer than a day,
     which is rule 1 of this pane: a figure labelled for a window it does not cover is worse
     than one labelled for the window it does.

Everything the omissions card shows comes **from the answer**, never from a list in the client,
so a figure that gains a source drops off the card without a code change here.

### App releases on v2: where the pane departs from the mock

`docs/mocks/ops-dashboard-v2/releases.html` in the Aria monorepo is the approved design. The
pane follows its structure — the four-rung pipeline, the version-share band, the store card with
its age attached, the health comparison — and the rules its README calls normative.

As with Overview above, this is **not a complete diff** and does not claim to be. It names the
departures that carry a decision.

The pane's one claim comes first, because most of the list follows from it. A version sitting at
20% of the field **because the Play rollout is staged at 20%** is a different fact from a version
stalled at 20% **because nobody is updating**, and the two are answered by two different figures
that are never merged: `track.rolloutBasisPoints` is what the store is releasing to, per
platform; `adoption.buckets` is what the field actually ran, across all platforms. Anything that
would blend them is not drawn.

1. **No Range, App or Environment control.** The release snapshot is upserted per track, so the
   table holds what is on that track now and no history to window. The registry gives this pane
   no control and the filter bar states the absence where one would have been.
2. **Version share is one bar, not one per platform.** The mock splits it iOS/Android. The
   reading behind it is dimensioned by app version only — `adoption.buckets` is a share of all
   sessions that reported a version — so two bars would be one number drawn twice under two
   labels it does not have. The per-platform fact the split was carrying is the store's ceiling,
   and that is on the pipeline row and in the one sentence under the bar.
3. **No adoption curve.** The mock draws "adoption since release" as an area chart over nine
   points. Nothing stores a series: the snapshot holds the current share and overwrites it. A
   curve drawn from one point is a straight line pretending to be a history.
4. **The fourth rung is "Rolled out", not "Adopted".** The pipeline is the store's ladder, and
   its last rung is the store finishing — which is exactly the fact a staged rollout has not
   reached. Calling it "Adopted" would put the field's answer on the store's ladder and merge
   the two figures rule 0 keeps apart.
5. **The health table is one comparison, not a release history.** The mock draws six rows of
   version × platform with sessions, crash free, median start and AI failure rate. `health`
   carries one platform, a current build, a previous build and a list of named signals, and
   nothing stores a per-release history to widen it to. The table drawn is the comparison the
   contract describes.
6. **No "What is in 1.1.2" band.** Release notes, build metadata, languages, minimum OS,
   download sizes, the rollback build and the support-ticket reference are none of them stored
   anywhere in this platform. The whole band is eight fields with no source.
7. **No Export or Failed runs actions on the health band.** Nothing generates that export, and a
   button that does nothing is the filter problem in another costume.
8. **The mock's three `why` blocks are not reproduced.** "Merging these into one score would
   hide exactly the case this pane is looking at" is an argument for the design, not a fact
   about the release, and the mocks' own rule is one fact per slot. The facts those blocks
   carried are on screen: the store ceiling is named beside the share, and the age of a store
   reading is attached to the row it fed.
9. **A chip inside a version-share segment reads `57%`, not `1.1.1 · 57%`.** The mock's wide
   chip carries the version name as well as the share. A chip is sized by its segment and a
   store version name has no length limit, so the mock's shape clips whatever it puts last —
   and last is the percentage, the one number the chip exists to state. Measured, the mock's
   order loses it entirely between 561px and 650px. Putting the share first is not a fix
   either: it only moves the clip onto the version. The version is on the key beside the bar,
   so the chip states the share alone and nothing unbounded goes in it.
   See the comments in `assets/pane-releases.js` and `assets/pane-releases-v2.css` that the
   `source-anchors` block pins.

Two additions the mock does not have, both of which exist because the pane reads a live answer
where the mock reads its own sample text:

- **A failing poller ages the row it fed.** The mock's store card carries freshness; a real
  answer can carry a poller that has been refused for two days, and "6 days unchanged" read two
  days ago is a claim about last Thursday. The row says how old its figures are, once, where
  they are read. The store card then says why and exactly when.
- **The empty state is derived from the source statuses, not from the ladder.** An empty ladder
  means "there are no builds" only when both stores were asked and both answered. A store that
  was never connected, or polled and refused, makes the same empty ladder mean nothing at all,
  and the headline says which of the three it is.

`assets/pane-releases-v2.css` carries this pane's own shapes. Two rules in it are scoped
overrides of shared stylesheets that this change is not allowed to edit; both name
`Stadiora/Aria#10397`, which is filed to move them.

### Look up a user on v2: where the pane departs from the mock

`docs/mocks/ops-dashboard-v2/users.html` in the Aria monorepo is the approved design. The pane
follows its structure — the lookup panel, the match list, the account card, the reveal card, the
activity table, subscription and devices, the access record, the danger zone.

As above, this is **not a complete diff**. It names the departures that carry a decision.

Six promises are made to the athlete on this pane, and each is a sentence on screen rather than
a property of the code. They are the constraint every departure below is measured against:
personal fields are hidden for every role including the owner until a reveal is recorded; a
reveal is owner only and needs a written reason; it is recorded by field name, never by value;
the athlete can see that it happened and who did it; the record outlives the reveal and a reveal
cannot erase one; and request and reply content is not shown here at any role.
`assets/pane-users.js` names where each one is drawn, and `scripts/ops-users-v2.test.mjs`
asserts the sentence and the mechanism behind it separately, because a sentence that outlives
the thing it describes is the worse of the two failures.

1. **The drawer is gone.** The mock holds the fuller field list, the devices, the billing record
   and the access record behind a "Full record" button with four tabs. They are bands on the page
   now. The access record is the one thing on this pane that makes the rest of it defensible, and
   a promise the athlete is given should not be one click further away than the reveal it covers.
2. **The danger zone is stated and not drawn as controls.** The mock carries account actions
   behind re-authentication with live buttons. `GET`/`POST /api/ops/users/*` is unchanged by this
   remodel and answers no action route, so the pane names each action the response reports, keeps
   "Re-authentication required" on the head, and draws no button. A control that cannot succeed
   is the filter problem in another costume; hiding the band would only make people ask whether
   the actions exist.
3. **The privilege strip is in the pane body, not the filter bar.** The mock puts "Owner",
   "Personal fields hidden until revealed" and "Every reveal is visible to the athlete" among the
   filters. `assets/pane-registry.js` is the one table both shells read and is not this change's
   to edit; it gives this pane a scope control and no room for three pills. Two of the six
   promises are carried there, so they went into the pane rather than nowhere.
4. **No support-context card.** The mock shows an open ticket with its subject, its state, its
   age and the run behind it. `supportActions.available[]` is what the contract carries and it is
   a list of action names; nothing in the response holds a ticket. Drawing the card would also
   put a request's subject line on a pane whose sixth promise is that request content is not
   shown here.
5. **No consent card.** Four consent rows with their grant dates are the clearest thing in the
   mock and there is no field behind any of them: the detail response carries state, tier,
   memberSince, summary, record, activity, devices, billing, access and supportActions, and
   nothing about consent. A consent grid invented on the page is worse than none, because it
   would be read as the record.
6. **The mock's "Not granted means not collected" is dropped, and nothing on this pane replaces
   it.** It belongs to the card in 5 that has no source, and the fact it carries has no home
   here: it is a statement about **consent** — nothing was collected, so there is nothing behind
   the mask to unlock — and on this pane a mask is the opposite, a value the owner *can* unlock
   with a recorded reason. The account card's foot says that
   plainly, "Hidden for every role, including this one, until a reveal is recorded", and reading
   it as the mock's sentence in a new place would get it backwards. Nothing replaces the mock's
   sentence, because the pane has no consent input to state it from: the API tells this pane
   whether a field can be *shown*, never whether it was collected. Both notes it prints are
   about showability — `neverShownNote` for a field that is never shown here at all
   (health readings and any field the API marks `reveal: 'never'`)
   and `unavailableNote` for one that cannot be revealed right now. Neither claims a
   value does or does not exist behind the mask, and the pane does not author that claim.
7. **The mock's `why` blocks are not reproduced.** They argue for the design rather than state a
   fact about the account, and the mocks' own rule is one fact per slot. What they carried that
   is a fact is on screen: the reveal card says what is recorded, the access band says how long
   it is kept, the activity card says what is not shown.
8. **No "Recently looked up" row.** This one is a privacy decision and not an editorial one. The
   mock keeps the coded references this browser has opened and offers them back as shortcuts;
   the pane keeps none, in any store, for any length of time. A list of the accounts an
   administrator has recently opened is a small standing record of who was looked at, sitting on
   the device rather than in the access record where the athlete can see it — and the access
   record is the thing that makes the rest of this pane defensible. Typing the reference again
   costs a few seconds and leaves the only copy in the place that is auditable.

Two additions the mock does not have, both because the pane reads a live answer where the mock
reads its own sample text:

- **A lookup that wrote no access record says so.** "Every lookup is recorded" is a promise, and
  a response whose `recorded` is missing has not kept it. The pane runs degraded and names it
  rather than drawing a clean page over it.
- **A `matchCount` larger than `matches[]` is reported.** A capped list beside an uncapped count
  would have the header naming accounts the operator cannot see, which is bulk listing with the
  listing removed. The pane says the two disagree rather than believing one of them.

`assets/pane-users-v2.css` carries this pane's own shapes.

One inherited leftover used to be named here rather than fixed: a light-theme badge block at the
end of `ops.css`, scoped `[data-theme="light"] body:is([data-page="releases"],
[data-page="users"])`, matching nothing once releases lost its `data-page` in #55 and this change
took the last one. **That block is gone** — deleted from `ops.css` in `aria-website` #74 — and
this paragraph described it as still filed here for as long as it took somebody to look. What is
true now is derived rather than described:

```claims id=data-page-scoping
ops.css rules scoped to a data-page attribute = (none)
pages carrying a data-page attribute = login.html, setup.html
```

The two pages still carrying the attribute are the pair that never moved to the v2 shell, and no
rule anywhere in `ops.css` selects on it, so the attribute currently styles nothing. If either
half of that changes, the block above is a red run rather than a stale sentence.

### What happened on v2: where the pane departs from the mock

`docs/mocks/ops-dashboard-v2/run-history.html` in the Aria monorepo is the approved design. The
pane follows the shape its README calls normative — the summary strip, the failure table read
worst-first, the privacy band that locks content rather than offering to unlock it — and departs
where nothing behind the page can answer what the mock draws. As with the sections above, this
is not a complete diff: it names the departures that carry a decision.

1. **Every figure about a *run* is absent, and named.** The mock draws runs, their durations, a
   slowest-5% figure, a per-run view and a stage breakdown. No route lists runs at all, so there
   is nothing to render them from. The pane names each missing thing in a band rather than
   drawing an empty chart, because an empty chart and a quiet month look the same.
2. **The record drawn is the alerting record.** The mock's "what happened" is every run; this
   pane's is every failure something was watching for. The difference is printed on the page, in
   the band and in the watching line, rather than left for the reader to infer.
3. **No trend chart.** A chart needs a series, and the problems route answers one page ordered
   worst-first — a shape that cannot be turned into a line over time without inventing the
   missing part of it.
4. **The app control, the environment control and the custom window are not drawn at all.** The
   alerting record is kept per request type rather than per app; there is no staging alerting
   record; and nothing on this page can supply a start and an end for a custom window. Each of
   the three was offered for a while and then explained away underneath itself, which is the
   same defect as a disabled button by the reasoning under Happening now rule 5 — a control that
   cannot succeed says the thing is within reach. The registry now declares only the window this
   pane really applies, and a single `filterNote` says why the other two are absent.
   `scripts/ops-registry-filters.test.mjs` holds the registry to it, keyed off the call each
   pane recorded rather than off anything a file says about itself.

`assets/pane-run-history-v2.css` carries this pane's own shapes.

### Happening now on v2: where the pane departs from the mock

`docs/mocks/ops-dashboard-v2/jobs-live.html` in the Aria monorepo is the approved design. The
pane keeps what that design is for — the one-line verdict at the top, the counters beneath it,
the queue read worst-first, the callout that separates a queue which is not clearing from a busy
one — and departs where nothing behind the page can answer what the mock draws. As with the
sections above, this is not a complete diff: it names the departures that carry a decision.

1. **There is no job table, because there are no jobs to list.** The mock draws every open job
   with its lane, its age and its retry count. No route serves a job, a lane or a retry, so the
   table, the three lanes and the per-job age are absent and named in a band instead.
2. **Running and queued are not counted.** The mock draws both as tiles. Nothing serves either
   count, and a tile reading zero is indistinguishable from a tile with nothing behind it, so
   neither is drawn as a numeral.
3. **Moving, not clearing and cannot tell are three answers, not two.** The mock's callout says
   a queue is stuck. Two numbers cannot prove that, so the pane says less: it compares the age of
   the job at the front of the queue against how long the queue has been over the line, and calls
   the older front **not clearing** — work that was already waiting when it crossed the line is
   still waiting — rather than stuck, which would claim the front has not moved. The younger
   front is **moving, behind**, which says the queue turned over and stops there: two numbers
   carry no rate, so nothing on the pane says work is arriving faster than it leaves. It prints
   **cannot tell** when the unit, the observation, the breach start or the elapsed time is
   missing. The unit lives only on the rules read, so a failure of that read costs the verdict
   rather than producing a guessed one. The pane's question in `pane-registry.js` still reads
   "is anything stuck?" and is deliberately left alone: that is the operator's question, and
   answering it with the strongest thing the record supports is the point.
4. **Stopped is a fourth answer, and it is the ordinary one.** The mock has no state for an
   incident that ended and is still open, because in the mock a problem that stops disappears. It
   does not: `record_recovery` sets `conditionClearedAt` and leaves the problem open until a
   person closes it, and `observedValue` and `lastObservedAt` stop being written, because
   `refreshProblem` runs only on a breaching observation. `status=open` means open-or-acknowledged
   and never consults `conditionClearedAt`. Drawn live, the frozen figures say a queue that
   recovered forty minutes ago is not clearing. So the pane reads the field ahead of the
   arithmetic and draws the past tense, matching the Problems pane, which has said
   "Stopped <ago>" against the same field since before this pane existed.
5. **Cancel, retry and export are absent.** The mock offers all three. There is no route behind
   any of them; a control that cannot succeed says the thing is within reach, so the pane names
   the three rather than drawing them disabled.
6. **The app control and the environment control are not drawn at all.** The alerting record is
   kept per request type rather than per app, exactly as on What happened, and there is no
   staging alerting record, so production figures under a staging label would be worse than a
   refusal. Both were drawn for a while and then explained away underneath themselves, which
   rule 5 above already settles: a control that cannot succeed says the thing is within reach,
   and a filter that narrows nothing is that same control in a different widget. The registry
   declares neither, and a `filterNote` says why they are missing.
   `scripts/ops-registry-filters.test.mjs` holds the registry to it, keyed off the call each
   pane recorded rather than off anything a file says about itself.
7. **The page does not refresh itself.** The mock reads as a feed. What is drawn is one reading
   taken when the page loaded, and the page says so rather than implying a live one.

`assets/pane-jobs-live-v2.css` carries this pane's own shapes.
### Problems on v2: where the pane departs from the mock

`docs/mocks/ops-dashboard-v2/alerts.html` in the Aria monorepo is the approved design. The pane
follows its structure, its drill-down paths and the rules its README calls normative.

As with Overview, the list below is **not a complete diff against the mock**. It names the
departures that carry a decision. Wording and ordering differ in more places than are listed,
because the mock is a static page with hand-written sample text and the pane writes its words
from the answer.

1. **No drawer and no modal.** The mock opens a problem in a side drawer and closes one in a
   dialog. The detail expands in place under the card instead, with `aria-expanded` and
   `aria-controls`, and Close is an inline form. At 375px a modal is a focus trap over a page
   the operator still needs to read, and a second thing that can overflow sideways; the v1
   drawer also lived in `operate.css`, which a v2 page could not load and which has since been
   deleted outright.
2. **No meter on a problem card.** The answer carries an observed value and a threshold and no
   scale to put them on. A bar between two numbers with no axis is the budget-bar problem from
   Overview in another shape.
3. **No "right now" column in the rules table.** `GET /api/ops/alerts/rules` sends each rule's
   threshold and the verdict of its last evaluation, and no current reading. The table's foot
   says that rather than leaving a reader to wonder where the column went.
4. **No volume chart.** The mock draws problems per day over 30 days. The problems read is capped
   at 100 with no second page, so a chart drawn from it would be short by exactly the recent days
   it is about. The card in that slot states what the sample can and cannot answer.
5. **Six facts the mock shows are absent, for the same reason — no source.** People affected by a
   problem; snooze and mute; how many times a reminder has been sent; an "Add a rule" control;
   the share of problems found by a rule rather than by a person; and a note attached to taking a
   problem on. None is in any of the three answers, and the API is unchanged by this work.
6. **The routing card is v1's, not the mock's.** Delivery is a real operational fact — the rules
   answer carries each channel's last delivery status, its last failure reason and its
   consecutive-failure count — and a page that claims alerting is armed without saying whether
   anything can be delivered is claiming the wrong thing.
7. **The rule switch is a checkbox.** The mock draws a `<button>` with a styled child. A real
   `<input type="checkbox" role="switch">` is what a screen reader and a keyboard already know,
   so the knob is a `::after` on the input.

The close note is the one piece of the mock's sample text that is **content rather than filler**.
It is printed from the problem's own record — the `closed` event's `detail.note` in
`GET /api/ops/alerts/problems/:id` — and the closed list says where to find it rather than
dropping it.

The rules table **scrolls inside a named region with its own tab stop**. Six columns hold a
760px minimum, so on a phone the table scrolls inside its card rather than taking the document
sideways with it, and a scroll region a keyboard cannot get to fails WCAG 2.1.1. For anyone
below owner every switch in that table is disabled, so the box then contains nothing focusable
at all: Chrome grants a scrollable box a tab stop of its own, but leaves it unnamed and
roleless, and Safari grants none. So the box carries `tabindex="0"`, `role="region"` and the
table's own screen-reader `<caption>` as its accessible name, and the focus ring is pulled
inside its edge, because `aria.css` draws that ring 2px outside the element and the box is
flush with the card: with `aria.css`'s `+2px` left alone, `aria-website#72` measured 21,234
device pixels of ring painted entirely beyond the box and none of its four edges showing ring
inside it, all of that outside the card it belongs to.

Same three attributes as App releases' `.tbl-scroll` and Settings' `tableWrap()`
(`Stadiora/Aria#10459`) — but **not the same one CSS line**, and there never was one. Some of the
sideways-scrolling boxes on the v2 panes pull the ring inside with an `outline-offset` of their
own, one of those adds a `border-radius` beside it, and the rest declare nothing and take
`aria.css`'s ring wherever that sheet puts it. Which box does which is the block below, read out
of the sheets and out of `aria.css`, and deliberately **not** counted or listed in this sentence:
a sentence enumerating them is what was wrong here before, and a second one would rot the same
way.

Which boxes carry a ring of their own is read out of the v2 pane sheets — every box that
declares `overflow-x: auto`, found by that declaration and not by its class name, with whatever
its own `:focus-visible` rule sets. A box that loses its rule, or gains one, is red here.

```claims id=table-focus-rings
pane-alerts-v2.css .scrollx = outline-offset: -2px
pane-analytics-v2.css .u-scroll = (no rule of its own; aria.css's ring, outline-offset: 2px; outline: 2px solid var(--cyan-ink))
pane-evaluations-v2.css .tbl-wrap = outline-offset: -2px
pane-releases-v2.css .tbl-scroll = border-radius: 0; outline-offset: -2px
pane-run-history-v2.css .tbl-wrap = (no rule of its own; aria.css's ring, outline-offset: 2px; outline: 2px solid var(--cyan-ink))
pane-settings-v2.css .tbl-wrap = outline-offset: -2px
pane-spend-v2.css .sp-scroll = (no rule of its own; aria.css's ring, outline-offset: 2px; outline: 2px solid var(--cyan-ink))
pane-users-v2.css .tbl-wrap = (no rule of its own; aria.css's ring, outline-offset: 2px; outline: 2px solid var(--cyan-ink))
```

### People and usage on v2: where the pane departs from the mock

`docs/mocks/ops-dashboard-v2/analytics.html` in the Aria monorepo is the approved design.
`ops/analytics.html` follows its structure and the rules its README calls normative, and reads
`GET /api/ops/usage` unchanged: this is a surface remodel, and no field moved to make it.

The list below is **not a complete diff against the mock**. It names the departures that carry a
decision — something the mock draws that nothing behind the pane can answer, and a second caption
for a fact already on screen. Wording and ordering differ in more places than are listed, because
the mock is a static page with hand-written sample text and the pane writes its words from the
answer.

1. **No week-over-week pill on a tile.** The response carries one window and no previous one,
   so a delta drawn from the window the pane already has would be a number nobody measured.
   **No "New signups this month" tile** for a different reason: not absence but repetition —
   the response does carry per-app active-people counts, and a signup total on a tile would be
   the same population the band beneath it already breaks down.
2. **No "Returning after 7 days" headline.** Retention arrives as a grid of signup groups, each
   with its own denominator. Collapsing them into one figure means choosing a group and an
   offset, and the pane would then be publishing a rate the answer never sent.
3. **No "Where people are" region table.** No region or country field is in the response.
4. **No per-row ribbon, no `Times` column and no `Week over week` column in the feature table.**
   The response sends a share of people and the group it was measured over, not an event count
   and not a daily series per feature.
5. **The chart's scale is HTML beside the drawing rather than `<text>` inside it.** `role="img"`
   carries `children-presentational`, so text inside the picture is announced to nobody, and the
   drawing is stretched to the width of its card, which would render that text at about four
   pixels on a phone. The picture keeps an accessible name that states what the lines are of and
   the window they cover, then, for each line, how many of the window's days have a reading, its
   low and high — or that it is flat — and its last reading. A line with no reading at all says
   that instead. (`chartName` and `seriesSentence` in `ops/assets/pane-analytics.js`; the
   sentences are pinned in `scripts/ops-analytics-v2.test.mjs`.)
6. **No Custom range**, which is the registry's decision, recorded in the comment above the
   entry in `assets/pane-registry.js`: the bar carries a range name and no bounds, so a custom
   window reaches the usage API with no start and no end, and that route answers over the widest
   window retention allows rather than refusing it. The figures would be confident and for a
   window nobody chose. Nothing states this **on screen** — `shell-pane-v2.js` renders
   `pane.filterNote` where a missing control would have been, and the `analytics` entry sets
   none, unlike `spend`, which sets `scopeNote`. The absence is a decision about the bar, and the
   bar belongs to a file this pane may not edit; adding the note is `Stadiora/Aria#10449`.
7. **The retention grid has no legend.** Every cell prints its own percentage, so a key mapping
   tint to range is the same fact again; the one symbol that is not a number, `·` for a week a
   group has not reached yet, is named once in the band note and carries its own text for a
   screen reader.
8. **The mock's explanatory captions are not reproduced, and neither are four of the route's
   own sentences nor four of its counts**, under the same rule: the mocks encode one fact per
   slot, which is what took the approved set from 7,240 words to 4,842. What was dropped, and
   why, since these are fields the answer carries. The list names **the members whose absence
   carries a decision**, and nothing here claims it is every member the pane does not read: it
   once did, and that claim was false, because `asOf` and `apps[].app` are non-optional members
   the pane does not read and neither was on it (`Stadiora/Aria#10474`). Completeness is in the
   NOT COVERED list under "What checks this" and stays there: `OpsUsagePayload` is declared in
   the Aria monorepo, at `app-backend/server/services/opsUsage/opsUsageView.ts`, so no check in
   this repository can enumerate its members to subtract the read ones from.
   - `coverage.shortfall.detail` was the versions card's footer. It is the complement of the
     coverage pill — 30.7% did not report *is* 69.3% did — and the `Reporting` column beside it
     names which versions, which is the part an operator acts on. What makes *already on screen*
     true is departure 16: the pill is drawn on every answer that carries a figure, not only on
     the ones with two columns.
   - `features.coverageNote` was the feature card's footer, twenty words carrying that same
     coverage figure a third time. The method survives as nine: *Only seen on app versions that
     report feature use.* The number does not. This one is **read**, unlike the rest of the
     list: `assets/pane-analytics.js` tests the field and draws its own nine words when the route
     sent it, so what is dropped is the route's wording and its figure, not the field.
   - `features.note` and `features.hint` both say the shares are of each app's own active people.
     The card head prints `hint`, seven words; `note` is two sentences of the same thing.
   - `consent.detail` is four sentences saying the gate is at ingest. The pane prints the route's
     shorter form of the same statement, the last sentence of `cohorts[].note`, beside the groups
     it is about. Where no group is drawn the head of the first band carries
     **Consenting accounts only** instead, so the page never prints headcounts without it.
   - `metrics[].numerator`, `cohorts[].rows[].cells[].returned` and `features.rows[].users` are
     each the count a printed rate was computed over — `679 of 1,061`, drawn by the v1 pane
     beside every rate. One fact per slot: the rate is the fact, and the base it was taken over
     is not withheld, because `denominator` is read for the reporting floor and a rate is
     withheld outright when its base is under it. The counts come back in the day a cell grows a
     hover or a detail view, which is where a second figure belongs.
   - `apps[].subtitle` is `Athlete app` / `Coach workspace`. The split card already heads each
     column with the app's own name, and there are two apps; a gloss on which is which is a
     sentence restating a label.
   - `apps[].tone` drives the v1 pane's `tag-` class and has no v2 equivalent — the series token
     the pane needs is `trend.color`, which it reads. `window.grain` and `window.timezone` are
     literal constants (`'day'`, `'UTC'`); `window.range`, `window.start`, `window.endExclusive`
     and `filters` belong to the shell's bar, not to the pane.
9. **No activation funnel card.** `OpsUsagePayload` carries no `funnel` member and the route's
   own docblock says why: a funnel's second step is read against its first, so it is a rate over
   people whether or not it says so, and the only counts available for one are not consent
   gated. The v1 pane drew one anyway, from a field the server never sends — visible only when
   a local fixture supplied it, and drawn without the reporting floor this pane otherwise
   applies to every rate. The remodel drops the card rather than carrying dead code that
   contradicts the pane's own contract; the mock does not draw one either.

10. **No median-session tile.** The mock draws one, and the metric union the route can send is
    `count`, `rate` or `decimal` — there is no duration in it, and the four figures it names per
    app are active people, sessions, sessions per person and the share who opened a feature. A
    tile for a figure the endpoint cannot produce is a tile that would always read "Not
    reported", so the fourth slot carries the share who opened a feature instead.
11. **Week columns are headed `Week 1`, from offsets that arrive as `W1`.** The mock's wording,
    the route's value: `W3` set in a row of percentages reads as a figure rather than as a
    heading. The cohort card is headed with the question it answers and noted with the route's
    own definition of a group — `cohorts[].note`, which names its app inside it — never with
    `app`, which is the value the filter sends and reaches an operator as `mobile`. That note is
    the one place the pane says what the figures are *of*: `size` counts the accounts created
    that week which also opened the app that week, not the week's sign-ups, and the population is
    only people who have usage analytics on. Neither is inferable from a grid of percentages.

12. **The retention grid scrolls sideways inside its card, at every width.** `offsets` is as long
    as the widest group has aged weeks, so the 90-day range — one of the four the bar offers, and
    where the insufficient state's own button sends you — sends eleven week columns, which do not
    fit a half-width desktop card either. The alternative, a fixed table layout, does not overflow
    when it runs out of room: it *overlaps*, printing each percentage over its neighbour while a
    page-level measurement reads clean.

13. **A `Which versions report` card, which the mock does not draw.** `coverage.versions` is the
    only place an operator can see that a figure on this page is missing a slice of the estate,
    and which build to chase; the split card's coverage pill says how much is missing but not
    from where. The share column is of each app's own sessions — the route's own denominator — so
    the card head carries that sentence once rather than repeating it on every row.
14. **A second pill in the first band's head, which the mock does not draw: how much of the
    window the stored span reaches.** The mock's bar carries a range name and nothing behind it, and its
    sample answer is a window covered in full. A real one need not be: the nightly job began
    writing rollups on a particular day, so a 90 day window reaches back past the pipeline's own
    lifetime and its session total is a sum over the covered span while the range name still says
    90. The pill states that span and not the days that carry figures — those are the span minus
    `daysMissingRollups`, and the chart's name and the trend foot already say both. Drawn only
    when the covered span is shorter than the window and not empty —
    `daysCovered: 0` is a different statement, and every stored-day figure already reads
    **not reported** with its reason attached.
15. **A third pill in that head wherever no group is drawn: Consenting accounts only.** The
    consent statement is the route's, and its home is the last sentence of `cohorts[].note`,
    beside the groups it is about. `buildCohorts` skips an app whose widest admissible signup
    week has aged into nothing (`opsUsageView.ts:932`), which happens on **7d** always — the
    only admissible start is the window's own and `floor(7d / 7d) - 1` is zero aged weeks — and
    on **14d** on every weekday but the one the window ends on, because there the admissible
    interval is eight days wide and holds two signup weeks only when it ends on one. That is
    **13 of the 28 range-and-weekday combinations**, not one range: the band does not render and
    the statement leaves the page while the headcounts stay. Drawn where no group is drawn —
    gated on `cohorts.length`, which is the fact that decides it, and never on the range, which
    is not — and read from `consent.enforcedAt` rather than written here. Four words rather than
    `consent.detail`'s four sentences: the pane does not restate a paragraph it has a shorter
    true form of, and the gate itself stays at ingest.
16. **The coverage pill survives the split card refusing to draw.** `scope=mobile` and
    `scope=coaches` are two of the three values the bar offers and both send one app, so
    `appColumn` never runs and the card says *No split to draw* instead. The headline tiles carry
    no coverage figure, so before this the figure was printed **zero** times on those two
    selections — while the versions and feature cards both drop the route's sentence about it on
    the ground that it is already on screen, and the feature card still prints *Only seen on app
    versions that report feature use*, telling the operator the shares are undercounted without
    the magnitude. `coveragePill` now draws in the one-app state block as well as in a column,
    which is one printing on every answer that carries a figure. Round 8 finding.

Two invariants on this pane are held by its own `node:test` file and by measurement in review,
not by a repo guard. Since [Stadiora/Aria#10492](https://github.com/Stadiora/Aria/issues/10492)
`scripts/check-ops-narrow-overflow.mjs` does render `ops/analytics.html`, at 375px and 360px in
both themes — but with an empty `/api/ops/usage` envelope, so what it lays out is this pane's
no-data card and not a populated pane. Since
[Stadiora/Aria#10462](https://github.com/Stadiora/Aria/issues/10462)
`scripts/check-ops-theme-redraw.mjs` does render this pane's own page too, in both theme
directions — but its fixture, `scripts/ops-api-stub.mjs`, answers `/api/ops/usage` with an empty
envelope as well, and says so in its own docblock, so that sweep also toggles the no-data card
rather than a populated pane. What it holds there is that the toggled page equals a fresh load
of itself, which is not one of this pane's two invariants either.

### Where this pane departs from the shared page furniture

`assets/pane-analytics-v2.css` carries this pane's own shapes. One rule in it resets a shared
one rather than adding to it: `.u-vers th[scope="row"]` drops the whole `.tbl th` treatment,
because a row heading here carries a value rather than a column name and `aria.css`'s 9.5px
uppercase letter-spaced `--ink-3` turns `Coaches Web version not reported` into shouted small
print. It also sets `overflow-wrap: anywhere`, which is about `app_version` being a 32 character
free-text column: `Mobile 1.4.2+0a1b2c3d4e5f6a7b8c9d0e1f` holds one break opportunity, and the
version token alone otherwise sets the column's minimum width and takes the page sideways.

### Cloud costs on v2: where the pane departs from the mock

`docs/mocks/ops-dashboard-v2/spend.html` in the Aria monorepo is the approved design.
`ops/spend.html` follows its structure and the rules its README calls normative, and reads
`GET /api/ops/costs` unchanged: this is a surface remodel, and no field moved to make it.

The list below is **not a complete diff against the mock**. It names the departures that carry a
decision.

1. **No budget hero and no budget meter.** The mock's largest object is spend against a budget,
   with a forecast marker on the same bar. No budget is configured anywhere behind this route
   and none is in the response, so the bar would have been drawn against a number this codebase
   invented. What survives is the half that is real: the period total, and the forecast to
   period end when the period is open.
2. **No anomalies card and no unit costs strip.** Same reason, and the same reason the v1 pane
   was wrong to draw them: `anomalies` and `unitCosts` are not fields the route sends.
3. **No per-service category column, so the second card is the table and not a switch state.**
   The service view's rows carry no category key, so the mock's `Top services` column would
   have had to be reconstructed by matching a service name against the category view — a join
   this pane is not the right place to perform and would silently get wrong for any service the
   two views name differently. Without that column the top-N table and the service grouping are
   the same rows, so the switch offers the two **allocation** cuts only (category, resource
   group) and the per-service rows are drawn once, by the table. Offering all three drew two
   cards with the same title, the same rows and the same reconciliation line.

   Each reconciliation line names what it added up — `5 categories`, `3 resource groups`,
   `5 services` — rather than `N rows`, so two cards on one page never end in the same
   sentence.
4. **No Export button.** Nothing behind the pane produces a file.
5. **`ungrouped` is real, and drawn.** The mock states there is no uncategorised bucket. The
   route has six category keys and one of them is `ungrouped`, so the pane draws it and marks
   the row in its own words — `Unmapped: no category covers these services yet`. Drawing zero
   rows would have been the mock's claim; hiding a non-zero one would have broken the only
   arithmetic this pane exists to show, because the unmapped row is inside the sum.
6. **The reconciliation line is a row under the grouping, not a card.** The pane's main claim is
   that the categories add up to the invoice exactly. It is one line — a glyph, the row count,
   and the two figures — and it states both directions: it says the rows reconcile when they do,
   and names the gap when they do not. It also has a third form, for when the sum cannot be
   checked at all, which is not the same statement as a gap of zero.
7. **The chart's scale is HTML beside the drawing rather than `<text>` inside it**, for the
   reason People and usage gives: `role="img"` is `children-presentational`, so a `<text>`
   element inside the figure is announced to nobody. The figure's accessible name carries the
   series, their billed-day counts, and each one's low, high and closing figure.
8. **One caption per card.** The mock captions the grouping card above the rows and again
   beneath them. The lower caption is gone wherever it restated the upper one; what stayed is
   the route's own `daily.note`, which says either that there is no comparison line and why, or
   that the two stretches are different lengths — both facts that appear nowhere else and that
   change how the picture should be read.
9. **`7d` is absent from the range control** because `pane-registry.js` does not offer it, and
   **Custom is absent** because the route refuses an unbounded range with
   `ops_cost_range_unsupported`: offering it would put a control on screen whose only outcome is
   a failure card with a retry that cannot succeed. Neither is this pane's decision to revisit.

This pane's invariants are held by `scripts/ops-spend-v2.test.mjs` and by measurement in review.
Browser guards **do** render `ops/spend.html` — `check-ops-shell-v2.mjs` names every page in
`ops/`, and the registry-driven sweeps reach every pane the registry declares, which includes
this one; the `browser-guards` block below derives that reach rather than asserting it here. What
none of them renders is a *populated* Cloud costs pane: `scripts/ops-api-stub.mjs` answers
`/api/ops/costs` with an empty envelope, exactly as People and usage describes for
`/api/ops/usage`, so those sweeps lay out this pane's no-data card. That gap is tracked as
[Stadiora/Aria#10462](https://github.com/Stadiora/Aria/issues/10462); the sentence this replaces
said no guard rendered the page at all, two sections above a derived block saying one renders
every page in `ops/`.

### Where Cloud costs departs from the shared page furniture

`assets/pane-spend-v2.css` carries this pane's own shapes. Three rules in it reach past this
pane's own classes, each because a shared rule assumes content this pane does not have:

- `.band-end .pill { white-space: normal; }`. A `.pill` is `nowrap` and the poller-failure pill
  carries a whole sentence, so `.band-end` grows to hold it on one line and takes the page
  sideways. Re-measured in the poller-failure state with the declaration deleted through CSSOM
  and nothing else, naming each node: `.band-end` `offsetWidth` is 288 / 343 / 736 with the rule
  at 320 / 375 / 768 and 926 at all three without it, and `document.scrollWidth` is 320 / 375 /
  768 with and 942 without. It is not inside a media query because the pill is as long as the
  failure text, so no viewport is wide enough by construction.
- `.card-head { flex-wrap: wrap }` and `.card-end { width: 100% }` under 720px, so the view
  switch gets its own row rather than squeezing the card title beside it. Re-measured on the
  grouping card: at 375px the rule holds the title block at 127.02px against 125.13px without it
  and keeps its note on one line rather than two, and at 320px it holds 127.02px against 102.27px.
  At 700px the two buttons still fit beside the title, so there the rule only moves the switch
  down a row.
- `.grid > .card { min-width: 0 }`, so a grid track may be narrower than the table inside it and
  the table scrolls in its own card rather than widening the page.

### Known contrast debt, inherited — a historical record

**This section is a record of the v1 status palette, not a reading of what pages paint today**
— what it measured, the arithmetic the figures come from, and the two page-scoped fixes that
were shipped against it. Which of these classes anything still draws is the block below, and
that block is derived: a row naming a page and reading `painted where drawn` is a live pairing
rather than history. `.field-error` is one today, on the four pages that draw it, because
`login.html` and `setup.html` still load `ops.css` — its 5.321 below is the ratio those two
pages still paint. Both of those fixes have since been deleted,
and every pane is now on the v2 layer, with its own `pane-*-v2.css` and its own inks. It is kept
because the arithmetic recomputes from the shipped tokens and the palette owner acts on these
numbers, and because the first pane to draw one of these classes again inherits the debt with it.

What changed, and when:

- Every pane in the rail moved to v2. App releases and Look up a user — the two pages the second
  table below is about — moved with the rest; the epic closed when Cloud costs merged as
  `c791c8dac68f08be684902139d601be9107e27c8`. This section used to describe both as pre-remodel
  pages that load no stylesheet of their own (`Stadiora/Aria#10457`).
- `operate.css` was deleted, all 257 lines of it, in `aria-website#74`
  (`eae7de31041ffc5e4c773ff662b6821ad09ac5ec`), and the light-theme badge block at the end of
  `ops.css` went in the same change. Those were the two fixes this section describes as live
  (`Stadiora/Aria#10639`).
- `ops.css` itself is now loaded by `login.html` and `setup.html` only, so a rule in it reaches
  the sign-in and setup pages and nothing else. The block under Layout above is where that is
  read off the pages.

Which of these classes any page can still draw is therefore derived rather than remembered. A
`(no page)` means no file the scan can read assembles that token; `no sheet declares it on
<page>` means the page writes the token and loads no stylesheet that carries a rule for it.

```claims id=v1-status-classes
.badge = declared in ops.css; drawn by (no page)
.badge-ai = declared in ops.css; drawn by (no page)
.badge-brand = declared in ops.css; drawn by (no page)
.badge-crit = declared in ops.css; drawn by (no page)
.badge-info = declared in ops.css; drawn by (no page)
.badge-ok = declared in ops.css; drawn by (no page)
.badge-warn = declared in ops.css; drawn by (no page)
.tag = declared in ops.css; drawn by (no page)
.tag-backend = declared in ops.css; drawn by (no page)
.tag-coaches = declared in ops.css; drawn by (no page)
.tag-mobile = declared in ops.css; drawn by (no page)
.tag-watch = declared in ops.css; drawn by (no page)
.callout = declared in ops.css, pane-evaluations-v2.css, pane-releases-v2.css; drawn by evaluations.html, releases.html; painted where drawn
.callout-ai = declared in ops.css; drawn by (no page)
.callout-crit = declared in ops.css; drawn by (no page)
.callout-info = declared in ops.css; drawn by (no page)
.callout-warn = declared in ops.css, pane-evaluations-v2.css; drawn by evaluations.html; painted where drawn
.verdict-better = declared in ops.css; drawn by (no page)
.verdict-slightly-worse = declared in ops.css; drawn by (no page)
.verdict-worse = declared in ops.css; drawn by (no page)
.flagchip = declared in ops.css; drawn by (no page)
.build = declared in ops.css; drawn by (no page)
.masked = declared in ops.css, pane-users-v2.css; drawn by users.html; painted where drawn
.reveal-note = declared in ops.css, pane-users-v2.css; drawn by users.html; painted where drawn
.nav-count = declared in ops.css; drawn by (no page)
.btn-danger = declared in ops.css, pane-settings-v2.css; drawn by settings.html; painted where drawn
.field-error = declared in ops.css, pane-evaluations-v2.css, pane-users-v2.css; drawn by evaluations.html, login.html, setup.html, users.html; painted where drawn
```

Three lines in that block are worth reading twice:

- **`.btn-danger` is drawn, and painted.** Settings writes it on the revoke controls and on the
  confirmation's submit, and `pane-settings-v2.css` declares it. This section used to file it
  under "drawn by nothing built so far", and said in as many words that Settings draws none. The
  4.49 and 3.79 figures below are `ops.css`'s inks over `ops.css`'s tint, which is not what
  paints it now. No figure in this file describes what does. `check-ops-contrast.mjs` is **not**
  that oracle either: it fixes its page to `/ops/shell-v2.html` (`scripts/check-ops-contrast.mjs:92`,
  loaded at `:3277`) and never opens `settings.html`, so the live pairing is unmeasured by
  anything in the tree. That is a gap, stated as one rather than closed with a pointer at a guard
  that does not look.
- **Two classes were written with nothing behind them, and are not any more.** `.masked` and
  `.callout-warn` were both tokens whose rule stayed in `ops.css` when their pane moved to v2,
  so the page that wrote them loaded no sheet declaring them. `aria-website#83` gave
  `pane-users-v2.css` a `.locked.masked` rule and `aria-website#84` gave `pane-evaluations-v2.css`
  a `.callout-warn` rule, and both lines now read `painted where drawn`. **Nothing in this
  section was edited to say so either time** — the block is derived, so each sibling merge moved
  its own line, and this PR found out both times by running red on a rebase.
- **`.field-error` is drawn on four pages and painted on all four.** It is the one pairing in
  this record that is still live rather than historical, which is why the 5.321 figure below is
  a measurement of the sign-in and setup pages as they stand and not of a page that is gone.

The badge, flagchip, platform-tag and verdict vocabularies are assembled by nothing the scan can
see — every one of their rows reads `(no page)` — but that too is the block's answer rather than
this sentence's, and a class that starts being drawn again moves its own line.

What the figures were. The ratios are computed rather than eyeballed, and are reproducible from
the shipped tokens. The badge tint is semi-transparent, so the background that decides is the
tint composited over whatever the badge sits on: `composited = 0.11 x status token + 0.89 x
parent surface` in sRGB, because `--tint` was 11% in the light theme, then the WCAG 2
relative-luminance ratio. The operate panes put a badge on `--surface-1` `#FFFFFF` (a card, the
alert list, the drawer), on `--surface-2` `#F6F8FB` (an alert row on hover, the runbook card) and
on `--bg` `#EEF2F7` (the filter bar). The page was the darkest of the three, so it was the one
that had to clear 4.5:1.

| Badge | Ink was | Ink now | On a card | On a hovered row | On the page |
|---|---|---|---|---|---|
| `.badge-crit` | `#C8322B` | `#AE2C25` | 4.505 to 5.580 | 4.247 to 5.260 | 4.030 to 4.991 |
| `.badge-warn` | `#9A5B06` | `#885005` | 4.665 to 5.652 | 4.399 to 5.331 | 4.176 to 5.060 |
| `.badge-ok` | `#047857` | `#046B4D` | 4.695 to 5.591 | 4.429 to 5.275 | 4.205 to 5.008 |

All three cleared 4.5:1 on every surface those panes drew them on. Before the fix, only the card
cleared it and only just. The two variants those panes drew but the fix did not touch already
passed: `.badge-info` was 5.649 on a card and 5.058 on the page, and the plain `.badge` 6.82 on
its own opaque fill. That fix lived in the three rules at the end of `operate.css`, and went with
the file.

An earlier version of this section recorded 4.15 / 4.22 / 4.27 before and 4.55 or better after.
Neither figure reproduces from the tokens, and the before figures also disagreed with W1's own
record of 4.04 / 4.21 / 4.17 for crit / ok / warn over the page background, which does match the
table above. The palette owner acts on these numbers, so they need to be recomputable.

The callout fix is the one piece of this that is still in a file a page loads. Warning and
critical callout inks measured 4.41:1 and 4.26:1 in the light theme *only when the callout sat
directly on the page background*, which is darker than a card; on a card they passed. A
translucent tint takes its final colour from whatever is behind it, so the same component had two
different ratios depending on where it was put. The fix mixes the tint into `--surface-1` instead
of into transparency, which makes the fill, and therefore the ratio, independent of the surface
underneath. They measured 4.94:1 and 4.74:1 after it. No approved hue changed, and dark was
unaffected. It is in `ops.css`, so what it reaches now is `login.html` and `setup.html`.

The second fix was the same shape, for App releases and Look up a user, and sat at the end of
`ops.css` scoped by the page rather than by the file:
`[data-theme="light"] body:is([data-page="releases"], [data-page="users"])`. Both panes have
since moved to v2 and that block has been deleted, so the table below is a record of what the v1
pages measured, not of what those pages paint. The surface that decided was the selected match
row, `--brand-dim` over a card, compositing to `#E3F3F6`; the worst pairing on either pane
composited twice, a state badge inside a `.build` chip already tinted with the same hue. Same
formula as above, with `--tint-soft` 9% for a platform tag and no tint at all where the ink went
straight onto a card.

| Pair | Ink was | Ink now | On a card | On a hovered row | On a selected row |
|---|---|---|---|---|---|
| `.badge-crit`, `.flagchip.is-crit` | `#C8322B` | `#AE2C25` | 4.494 to 5.566 | 4.241 to 5.253 | 3.976 to 4.925 |
| `.badge-warn`, `.flagchip.is-warn` | `#9A5B06` | `#885005` | 4.668 to 5.656 | 4.408 to 5.341 | 4.111 to 4.982 |
| `.badge-ok` | `#047857` | `#046B4D` | 4.688 to 5.583 | 4.428 to 5.274 | 4.139 to 4.930 |
| `.tag-mobile` | `#0E7490` | `#0D6880` | 4.716 to 5.586 | 4.457 to 5.280 | 4.196 to 4.971 |
| `.tag-coaches` | `#7C3AED` | `#7434DF` | 4.978 to 5.560 | 4.706 to 5.257 | 4.390 to 4.903 |

And the double-tinted pairing, on a card: `.badge-crit` inside `.build.is-blocked` 3.852 to
4.771, `.badge-ok` inside `.build.is-live` 4.059 to 4.834. 4.771 was the worst figure either pane
produced after the fix, and 3.852 the worst before it. Of the 36 pairings the two panes drew with
a status token as text, 17 were below 4.5:1 and none was after.

Every figure above is the arithmetic, so it recomputes from the tokens. The same pairings were
also measured against what the browser composited at the time, by walking each element's ancestor
background chain: those agreed to within 0.03 (the engine mixes at a precision the hex round trip
here does not keep), and the worst rendered pairing on either pane was 4.778. Deleting the five
rules at run time and re-measuring brought back exactly five failures, worst 3.970, which is what
made them load bearing rather than decorative. The lowest rendered figure on the v1 App releases
pane was not in the table at all: `--text-3` on the tinted `.build` chip at 4.586, recorded so
the next person to darken a chip knows how little room was left.

Three of those rows already passed and were moved anyway: `.verdict-worse` 5.321 to 6.590,
`.verdict-slightly-worse` and `.reveal-note` 5.422 to 6.570, `.verdict-better` 5.484 to 6.531.
`.verdict-worse` and `.badge-crit` were drawn in adjacent cells of the same release-health row,
and two reds a shade apart in one row read as a mistake rather than as a palette.

Deliberately untouched on those two pages, with the worst figure each reached on them:
`.badge-info` and `.flagchip.is-info` 4.837 inside a `.build` chip and 4.998 on a selected row,
`.badge-brand` 4.825, the plain `.badge` 6.821 on its own opaque fill, `.masked` 4.706 — the
figure is of `ops.css`'s rule, which is no longer what the users pane loads — `--text-3` on a
selected row 4.771, and `.field-error` 5.321. `.field-error` had a second reason: the sign-in
page draws it too, and darkening it under a page scope would have given one component two inks
across pages for no contrast gain. That is still true, and the block above is where the
pages it is drawn on are counted.

What was left unfixed. These were recorded so that the first pane to draw one did not ship it
unnoticed, and that is still what they are for; the block above is what now decides whether
anything draws them:

| Pair | Light ratio |
|---|---|
| `.nav-count.is-crit`, `.btn-danger` on their `ops.css` tint over a card | 4.49 |
| `.btn-danger:hover`, same | 3.79 |
| `.tag-backend` on its tint | 4.46 |
| `.badge-crit` / `.badge-ok` / `.badge-warn` over the page background, with neither scoped fix | 4.04 / 4.21 / 4.17 |

The `.btn-danger` rows are `ops.css`'s ink over `ops.css`'s tint. Settings draws that class from
its own sheet now, so those two figures no longer describe the only place the class is drawn —
and nothing measures what does, because `check-ops-contrast.mjs` only ever loads
`/ops/shell-v2.html`. The last row was
the badge fix's own boundary: it closes for good on the day the status tokens themselves are
darkened, which is a decision about the approved palette and belongs to whoever owns it — the
base tokens are also the dots, the chart series, the meters and the callout borders.

Dark mode passed throughout and was untouched. Both badge overrides were scoped to
`[data-theme="light"]`, so the dark inks were the ones W1 shipped: over the same three surfaces
and the same 14% tint, the lowest of the four badges was `.badge-crit` on `--surface-2` at 5.200,
and `.badge-info` the next at 5.457. Every other pairing was 5.657 or better.

What measures contrast now is `scripts/check-ops-contrast.mjs`, on the rendered page rather than
from the tokens; the section after next is about what it can and cannot see.

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

The same stub is what makes the pane fixtures usable: it has to serve the fixture document too,
because a cross-origin fetch for it would be refused by `connect-src` for the same reason a
cross-origin API call would be.

`scripts/check-ops-narrow-overflow.mjs` is one such stub, written for a narrow-viewport
regression and reusable as a starting point. It serves this repository, answers the auth calls
and the reads behind every pane except two — `/api/ops/usage` gets an empty envelope and
`/api/ops/costs` a period that has not published, so People and usage and Cloud costs are laid
out with no figures in them — lays **every
pane the registry declares** out in headless Chrome at **375px and 360px** in both themes, and
fails if `documentElement.scrollWidth` exceeds the viewport. Two widths because an overflow that
reproduced on CI's fonts at 375px reproduced on macOS only at 360px, and a guard a reviewer
cannot make fail locally is a guard that gets argued with instead of read. Before it measures a
pane it requires that pane to have drawn a string only its loaded state draws, because the panes
that read something answer an empty read with a failure card of their own, and a failure card
fits any viewport. Run it with `node scripts/check-ops-narrow-overflow.mjs`; it also runs in CI
on any change under `ops/`.

`shell-v2.html` needs none of that. It calls no API, so `python3 -m http.server 8000` and
`http://127.0.0.1:8000/ops/shell-v2.html` is the whole setup.

Overview reads `ops-pane-fixture-overview` on the same terms as the two understand panes: a
relative path to a same-origin JSON document holding one `{ "data": ... }` envelope, honoured only
on loopback. It is the only practical way to see the states the live API will not produce on
demand — a window nothing reported, a comparison the retention horizon refused, a day with no
stored reading — which on this pane is most of them.

### What checks this

| Check | What it can see that nothing else can |
|---|---|
| `node --test scripts/*.test.mjs` | The accessible name every chart derives, that preview state is applied in **both** directions, and that the theme button re-resolves each chart's colours. Runs `scripts/ops-aria-shell.test.mjs` alongside the pane tests. |
| `scripts/ops-shell-pane-v2.test.mjs` | That the rail cannot drift from the registry, that a pane is offered exactly the filters it declared and never one more, that a role without access gets a named refusal rather than a blank pane, that the three gates stay mutually exclusive, and that the v2 formatters still agree with the v1 ones they were ported from. |
| `scripts/ops-overview-v2.test.mjs` | That every figure's window label comes from the answer, that a block which is not `ready` prints words and never a numeral, that the two apps are never added together, that a day with no stored reading breaks the line instead of joining across it, that the omissions card is drawn from the answer, that a change pill's chevron follows the figure's own sign rather than its tone, that each app keys the same colour in the tile as in the chart legend, and that every doorway points at the pane the registry says owns it. |
| `scripts/ops-registry-filters.test.mjs` | That every filter the registry declares is one the pane behind it can act on — for every pane on the v2 bootstrap, Cloud costs excepted, where only the declaration is held: the value the operator picked either reaches that pane's own read in a field of the same name, or narrows what the page draws, proved from the call the pane recorded and the DOM it wrote rather than from anything a file says about itself. It locks its own coverage as well, so a pane that gains a filter is red here until somebody writes down how that filter is acted on. |
| `scripts/ops-run-history-v2.test.mjs` | That the operator's window reaches the answer rather than the request, that a problem still open from before the window stays inside it, that a full page reads as a floor and says why, that the same rule in two request types is two reasons and in one is a count, that the bar draws a window control and nothing else and says why the other two are gone, that a custom window asked for in the URL is clamped back to the window the pane starts on, that run content is locked at every role including owner with a field name and no value node at all, that the six guarantees are on screen as sentences, and that the read carries its querystring as well as its path. |
| `scripts/ops-jobs-live-v2.test.mjs` | That a queue whose front is older than the breach reads not clearing and one whose front arrived after it reads moving, that both can be on screen at once and stay different, that a missing unit, a missing or negative observation, a missing breach start or a span of zero produces cannot tell rather than the alarming one, that a problem whose `conditionClearedAt` is set reads stopped in the past tense rather than as a live breach, is excluded from the longest-wait tile and sorts below everything still going, that work which is flowing and failing is a third fact rather than a queue, that a figure nothing records renders words and never a numeral, that the bar draws no app and no environment control at all and says why instead, that an empty page says whether anything was watching, that no `button` or `input` is drawn without a route behind it, and that the read carries its querystring as well as its path. |
| `scripts/ops-alerts-v2.test.mjs` | That taking a problem on and closing it stay two different calls and that a close carries the note it was written with; that an unacknowledged problem says nobody has it; that a read which came back full reads as a floor and names the recent problems it is missing; that severity is filtered by the API and category on what came back, and a scoped figure says so; that the same problem in two answers is one problem; that an empty page proves which kind of empty it is, including over a failed **rules** read, where the pane has not got the fact that tells the two kinds apart and states neither; that a capped closed read is disclosed, never reported as a zero, and on a window hedges the queue's own count as well as the closed list, while leaving the count it cannot shorten alone; that one failed read degrades rather than blanks the pane; that no reading is printed without the unit its rule gives it; that the rail count comes from the read and goes when the read cannot see it; that a rule switch is the owner's and everybody else sees the true state; and that every severity is a word, not only a colour; that picking a severity leaves the operator standing on the same button rather than replacing it; that every control which is destroyed or disabled by being used hands focus back — the five re-reads and all four of the re-reads a write starts to the content region, the three refused writes to the control itself, the record retry to the Details button that owns its region, and the first read, which destroys nothing, to nowhere — measured from focus parked on `<body>`, which is where a browser puts it when a control is disabled or removed, and in the other direction from focus parked on a control that survives, which must not be moved; and that a refused close and an unreadable record are announced rather than written where nobody is told to look; and that a problem already closed is offered neither of the two controls the server would refuse. |
| `scripts/ops-analytics-v2.test.mjs` | That a rate over a group under the reporting floor is withheld with its reason and that a ratio delivered as a decimal goes through the same floor, that a window with no stored days prints its stored-day figures as not reported rather than as zero, that the two apps are never added, that a day with no reading breaks the line rather than being joined across, that the age of the answer comes from the rollup recompute rather than from the window's end — the field that makes the stale path reachable at all — and says how far behind it is once a nightly run has been missed, and that every picture of data is either named with its data or hidden. |
| `scripts/ops-spend-v2.test.mjs` | That each of the three cuts of the bill — the two the switch offers and the per-service table — adds up to the billed total exactly and that the line says so in both directions — reconciled, and the gap named when they do not — and that a sum which cannot be checked says that instead of reporting a gap of zero; that the `ungrouped` row is drawn and marked rather than hidden and is inside the sum; that a row with no figure prints words and is not added up as a zero; that the change pill's chevron follows the figure's own sign and that a rise and a fall are not the same glyph; that the per-service rows are drawn once and no state of the switch draws them again; that activating the switch hands focus back to the button that was activated, and only when focus was there to begin with; that a forecast is drawn only when the route sent one; that the age of the answer is printed beside the total once the poller is behind — the stale path — and against the answer's own publish lag rather than a constant in the pane; that the day line breaks on a day past the end of a stretch instead of joining across it; that each of the five availability states gets its own words and an unknown sixth still gets some; that the chart is named with its data and draws no `<text>` inside the figure; that the day chart carries the dates the route labelled under it and names both of its lines, so the dashed one is not just a texture; that a period billed only part way through says how far and to which day, and one billed to its own end does not repeat what the range name says; that the way out of an empty period travels to the closed month rather than back to the period it escapes — read from the link's `href`, not from its words; that no view button is offered for a grouping the answer did not carry; that the box holding the per-service table is reachable from a keyboard and names itself from the answer's own label, because at 320px the whole Change column is past its visible edge; that the sheet states no colour of its own, checked twice over — an allowlist over declaration values, which sees a named colour, an `oklch()` and a `color-mix()` carrying a raw one, beside the spelling match it once replaced, which sees a hex or an `rgb()` family wherever it stands including an all-numeric `#333`, a `var()` fallback, a `@keyframes` body and a property no list names; and that nothing in the module writes markup. **Not covered**: that money is divided once at display and never summed as a float — every figure in the fixture is a whole number of dollars, so rounding each row to cents before summing changes no output and no mutation can make it red; it becomes testable when a fixture row carries a fraction of a cent. In a property whose name carries none of the colour-bearing words the value scan gates on — `text-decoration`, `text-emphasis` and `mask-image` are the three shapes — **anything the spelling clause cannot read** is seen by neither clause: a named colour, an `oklch()`, a `lab()`, a `color-mix()`. Not only the named colour `text-decoration: underline crimson` names (`Stadiora/Aria#10663`). The gate is what decides it: the same named colour in `border-bottom` is caught, and a hex or an `RGB()` in `text-decoration` is caught. Both clauses are case-blind, so no spelling here is covered in one case and uncovered in the other. Which properties are gated and which spellings are read is the `spend-colour-gate` block below, produced by running the guard's own two matchers rather than by reading them. Which exotic ways to write markup or a style attribute walk through the module guard, and whether the module writes any of them, is the `spend-write-gate` block below — run against the guard's own two patterns rather than counted in a sentence here, which is how this row came to say "none of the four" about a list of three. |
| `node scripts/check-ops-result-view.mjs` | Whether a state the JavaScript can enter is one a loaded stylesheet can **paint**. It drives every pane the registry declares past its landing state to a result view, proves it arrived by a string only that view draws, and then asks two things in real Chrome with no pointer over the page: that every class the pane wrote is reached by at least one rule from a sheet that page loads, and that every positive `aria-current`/`-selected`/`-pressed`/`-checked`/`-expanded` is painted differently from the same shape without it. `Stadiora/Aria#10456` is the shape: `pane-users.js` wrote `is-selected` on the picked match, no sheet `users.html` loads had a rule for it, and every other guard stayed green for the life of the defect. Known failures are enumerated in `KNOWN_UNPAINTED`, and each entry must still reproduce. **Not covered**, from its own docblock: one width (1280px); contrast, since two states that differ imperceptibly both pass; the accessibility tree, since the state is read off the markup rather than out of Chrome; any result view nobody drives — one per pane; a class judged per page rather than per site; the reach of a `~` or `+` clause; and paint that is not a class at all. |
| `node scripts/check-ops-shell-v2.mjs` | Whether the custom properties resolve at all; whether all 33 of them, plus `color-scheme`, hold the exact value the design writes, per theme; whether any chart shape **or any icon on `/ops/shell-v2.html`** reaches that page with no paint; whether a shown `<tr>` is still `table-row`; and — with `aria.js` and then all scripting blocked — what paints **before** any of this runs. All of that is measured on that one page, which is the only page in the repository that draws `aria.js`'s charts and its icon gallery. It does load every other page in `ops/` afterwards, in both themes, but only to catch a console error or a page that rendered nothing: a pane shipping an unpainted icon is **not** seen here. |
| `node scripts/check-ops-contrast.mjs` | Whether the colours a rule actually **asks for** can be read where they land: the resolved ink over the topmost paint at each run of text, as a WCAG ratio, at every rendered text site in both themes and all four states. Token pinning cannot see this — a rule asking for the wrong token leaves every token defined and correct. |
| `node scripts/check-ops-narrow-overflow.mjs` | Every pane `assets/pane-registry.js` declares, at 375px **and 360px** in both themes: that nothing is past the right edge of the document on any of them, and that each page measured was the pane the registry pointed at, had reached its ready gate, had drawn more than a handful of elements, and had drawn **a string only that pane's loaded state draws** — Overview, App releases and Settings each answer an empty read with a failure card that passes every other gate and clears the element floor, so without that last one the sweep would shrink from ten laid-out panes to seven while still reporting ten. The swept count is compared against the registry's own, so a pane that silently stops being measured is a failure rather than a shorter run. On the Problems pane it additionally requires the longest sentence the pane can put in a rule row to have been laid out. Its failure message skips cells inside a horizontal scroller when it names the widest offender; that affects **diagnosis only** — the pass/fail decision is `scrollWidth > viewport` on the document and no filter touches it. |
| `node scripts/check-ops-theme-redraw.mjs` | Whether pressing the theme button repaints the page. A colour resolved at **draw time** is only correct for the theme it was drawn in; this loads every pane `assets/pane-registry.js` declares plus `/ops/shell-v2.html`, clicks the real button, and requires **every node's** resolved paint to equal the paint that node carries on a **fresh load** of the same page in the theme the button switched to — sixteen paint properties per node, with a `url(#id)` gradient resolved to its stops, because the ids are minted per draw. Two assertions stand either side of that one: that the two fresh loads differ at all, so the comparison is not vacuous on a page the theme never reached, and, on the pages that draw `aria.js`'s charts, that every shape painted from a token holds the palette's pinned value — the only one of the three that would notice `aria.css` drifting away from the palette, since a page compared against itself agrees with itself. Both directions, every page. **Not covered**, from its own docblock: pseudo-elements, any property outside those sixteen, a gradient that changed in a way its stops do not record, a page whose DOM differs between the two loads (reported as not comparable rather than passed), the populated states of People and usage and Cloud costs — the shared stub answers both with an empty envelope — and any theme beyond dark and light. |
| `node scripts/check-ops-dialog-hit.mjs` | Whether a confirmation dialog that is entirely correct in the DOM is **reachable by a mouse**. `Stadiora/Aria#10688` is the shape: the Settings pane's revoke dialog sat at `z-index` 60 under its own scrim at 90, so `elementFromPoint` over the confirm button returned the scrim and a real click never landed, while every unit test — element present, role correct, focus trapped, submits from the keyboard — passed. Two assertions per dialog, because each alone has a hole: every interactive control is hit-tested at its centre **and four inset corners** and must return itself or a descendant; and the dialog is screenshotted with the scrim in the DOM and again with it removed, and the two PNGs must be byte-identical — a scrim carrying `pointer-events: none` passes the hit test while still painting a dim and a blur over the dialog. Neither assertion compares `z-index` numbers: stacking is resolved from the whole ancestor chain, so the browser's answer is the only one worth having. It fails rather than skips when it opens no dialog. |

The `33` in that first row is not typed either. It is the size of the guard's own two pinned
tables — the per-theme palette and the tokens it holds invariant across themes — counted out of
the file:

```claims id=shell-v2-pins
palette tokens pinned for dark = 26
palette tokens pinned for light = 26
tokens pinned the same in every theme = 7
tokens pinned in total for dark = 33
tokens pinned in total for light = 33
color-scheme pinned per theme = 2
```

Which browser guard runs where is read out of the guards and the workflows, so a guard added
next week is a red run here rather than a paragraph that quietly describes all of them but the newest: the
workflow whose job line carries `node scripts/<guard>`, and the pages the guard's own source
names — `every pane the registry declares` where it boots from `OpsPaneRegistry` rather than
from a literal list. This says what each guard **loads**, which is the half that goes stale; what
it then asserts on each page is the table above.

```claims id=browser-guards
check-ops-contrast.mjs = ops-contrast.yml; /ops/shell-v2.html
check-ops-dialog-hit.mjs = ops-dialog-hit.yml; /ops/settings.html
check-ops-narrow-overflow.mjs = ops-narrow-overflow.yml; every pane the registry declares
check-ops-result-view.mjs = ops-result-view.yml; every pane the registry declares + /ops/run-history.html
check-ops-shell-v2.mjs = ops-shell-v2.yml; every page in ops/
check-ops-theme-redraw.mjs = ops-theme-redraw.yml; every pane the registry declares + /ops/shell-v2.html
```

The Cloud costs colour guard's own reach is not described here either. The block below is
produced by **running** that guard's two matchers — `COLOUR_SLOT` and `rawColourSpellings`,
lifted out of `scripts/ops-spend-v2.test.mjs` — over a fixed set of probes, so each line is the
guard's answer rather than a reading of it. A `does not look here` or a `cannot read it` is a
hole; they are the NOT COVERED row above, stated as values.

```claims id=spend-colour-gate
property --sp-ink = value scan looks here
property color = value scan looks here
property background-image = value scan looks here
property border-color = value scan looks here
property outline-color = value scan looks here
property fill = value scan looks here
property stroke = value scan looks here
property box-shadow = value scan looks here
property filter = value scan looks here
property text-decoration = value scan does not look here
property text-emphasis = value scan does not look here
property mask-image = value scan does not look here
property accent-color = value scan looks here
value #2b7fff = spelling clause reads it
value #333 = spelling clause reads it
value rgb(255, 0, 0) = spelling clause reads it
value hsl(0 100% 50%) = spelling clause reads it
value crimson = spelling clause cannot read it
value oklch(0.7 0.2 250) = spelling clause cannot read it
value lab(50% 40 59) = spelling clause cannot read it
value color-mix(in srgb, crimson 50%, transparent) = spelling clause cannot read it
```

The same row's other count is the three spellings the module guard is documented as **not**
matching. Whether each still walks through it, and whether the module writes it, is run against
the guard's own patterns:

```claims id=spend-write-gate
setAttributeNS(null, 'style', …) = walks through the guard; and the module does not write it
a capitalised Style: key on h() = walks through the guard; and the module does not write it
createContextualFragment() = walks through the guard; and the module does not write it
```

Charts and icons are swept for paint **separately**, with their own counts and their own
messages, and each sweep marks what it swept so that every `<svg>` on the page has to be claimed
by exactly one of them. The icon sweep exists because the chart sweep excluded icons, on the
grounds that an icon takes its colour from `currentColor` rather than from a token and so cannot
fail the way an unresolved tone fails. That was true about one cause and said nothing about
coverage: deleting `stroke` from `icon()` left sixty icons a blank box with the unit suite at
60/60 and this guard exiting 0.

What the icon sweep does **not** answer is whether an ink that resolves to a real colour can be
seen against what is painted behind it. That needs the effective background — layered gradients
and `color-mix` alpha here, not any one ancestor's `background-color` — and it belongs to a
contrast oracle rather than to a paint-presence check; `check-ops-contrast.mjs` is that oracle,
and it measures text, not icons. The icon sweep reads one geometry property, `stroke-width` on
the stroke channel, because that is the channel icons paint through; an icon hidden by
`opacity`, `visibility`, `display`, a zero size or a broken `viewBox` still passes.

### Where this README points at code

The block below points at comments and lines rather than at files; how many is its own business
rather than this sentence's. The anchor each one quotes is the subject; **the line number is
derived**, so a pointer whose code moved is a red run naming
the new line, and a pointer whose code is gone is a red run saying so. Three of the seven line
citations this file used to carry had already drifted — `pane-registry.js:103-110` was the
alerting note, not the Custom-range comment, and both `pane-users.js` citations were about 250
lines short — which is why none of them are typed any more.

```claims id=source-anchors
ops/assets/pane-analytics.js "`features.coverageNote` carries two facts" = line 1058
ops/assets/pane-registry.js "Custom is deliberately not offered, for the same reason as Cloud costs" = line 136
ops/assets/pane-releases.js "The chip carries the share and nothing else" = line 178
ops/assets/pane-releases-v2.css "The chip holds the share and nothing else" = line 191
ops/assets/pane-users.js "Hidden for every role, including this one, until a reveal is recorded." = line 1014
ops/assets/shell-pane-v2.js "Ported from the v1 panes rather than reached for" = line 112
```

### What holds this README to the code

Seven issues were filed against this file in one day (`Stadiora/Aria#10457`, `#10474`, `#10510`,
`#10639`, `#10641`, `#10655`, `#10663`), all of them the same defect: a sentence describing the
code more broadly, or more narrowly, than the code behaves. A README that describes a guard more
broadly than it behaves is worse than no README, because the next reader stops looking.

So the numbers and lists this file is read **for** are not typed here. They are in fenced blocks
whose info string is `claims id=<id>`, and `scripts/ops-readme-claims.test.mjs` rebuilds each one
from the repository — the pages' own `<link>` and `<script>` tags, `pane-registry.js` executed in
a vm, the stylesheets parsed into rules, the guard scripts and workflows, and
`ops-spend-v2.test.mjs`'s own regexes run against probe values — then `deepStrictEqual`s the
block against it. No value is read out of the README, so breaking the code turns
the run red with this file untouched. Every id it derives must appear exactly once here and every
block here must be one it derives — and a `claims` fence it cannot parse is a failure rather than
a block quietly skipped — so a block cannot be added, renamed or dropped silently, and the run
prints what it judged, per block, in CI.

Five blocks cannot derive **which** rows they carry, only what each row says: `source-anchors`
and `deleted-assets` read their subjects out of this file, and `v1-status-classes`,
`spend-colour-gate` and `spend-write-gate` read theirs from hand-written arrays in the guard,
because no sheet says which of its classes carry status and no tree lists the files it has lost.
All five still derive every **value**. What that shape cannot catch by itself is a subject
deleted, so all five are pinned **row by row** in the guard — by name, not by count, because a
count is absorbed the moment the block grows — and a row can only go by deleting it there too.

Which blocks those are is itself derived, out of the guard rather than out of a sentence here:
the enumeration that used to sit in this paragraph said nine and fell three behind, missing two
blocks added in review and one added by the commit that fixed it. Two row sets are held by a
test instead of a block, and are the last two lines: the sweep requires every repository file
path this README spells in a code span to be in the tree or declared in `deleted-assets`, which
is what makes a file deleted elsewhere red here rather than quietly stale — a span carrying a
directory counts whatever its extension, and a bare `name.ext` counts when the tree uses that
extension, which is what keeps `payload.data` out of it; and the checks table
above must carry a row for every `check-ops-*.mjs` in `scripts/`, which is how the sixth browser
guard got a row the day it landed instead of the day somebody noticed. Neither judges the
**words** in the row — only that the row is there.

```claims id=claims-blocks
claims id=assets-by-page
claims id=assets-only-in-tests
claims id=browser-guards
claims id=claims-blocks
claims id=csp-pages
claims id=csp-policy
claims id=dark-text-3
claims id=data-page-scoping
claims id=deleted-assets
claims id=pane-read-endpoints
claims id=panes
claims id=scroll-wrapper-position
claims id=shell-v2-pins
claims id=source-anchors
claims id=spend-colour-gate
claims id=spend-write-gate
claims id=sr-span-classes
claims id=table-focus-rings
claims id=v1-status-classes
claims id=v1-v2-collision
claims id=write-capable-assets
and a test, every repository file ops/README.md names is in the tree or declared deleted
and a test, every browser guard in the tree has a row in the checks table
```

**NOT COVERED**, so a green run is not read as more than it is. Prose is not judged: a sentence
restating a block in English, or claiming something no block carries, is nobody's red. Only
statically spelled `assets/…` tags are seen, so a runtime-injected asset is invisible; a tag
inside an HTML comment is cut before the count, because a page that only remembers a stylesheet
does not load it, and neither is a tag inside a `<template>`, which the browser keeps inert.
Every attribute this file reads out of a page goes through one pair of matchers: a name is never
the tail of a longer one, so `data-src` is not `src`; the `=` may be spaced; a quoted value may
hold spaces and an unquoted one may not. Markup a script writes into the page at runtime is not
read at all. A workflow **runs** a guard when one of its `run:` steps starts a shell segment with
that command, so a name in a comment or inside an `echo` is not read as running it; a step turned
off by an `if:`, or a job nothing triggers, is beyond this file. The
fixture map recognises this repository's `read('assets/NAME')` idiom and nothing else. Draw sites
are the class tokens written in a page and the scripts it loads — `class=` in either quote,
`class:`, `className`, `classList` and `setAttribute('class', …)`, each with a literal and each
held to the same name guard as the page attributes above, so `data-class` is not `class` — and that error runs
**both ways**, so neither value is the safe one to trust: a name in a comment counts as a draw, and
a class assembled at run time or spelled through some other helper is invisible, so a `(no page)`
can be an under-report exactly as a named page can be an over-report. `painted where drawn` asks
only whether some rule in a stylesheet that page loads names the class, not whether it applies,
wins or paints anything. CSS is read as text with a browser's case rules — `POSITION:` is `position:`,
`Auto` is `auto`, and a custom property name keeps its case because CSS says that one is
case-sensitive — and an empty value (`--x: ;`, which is legal) stays a declaration rather than
disappearing. Route blocks list the `/api/…` literals a pane source spells, not the calls it
makes. Whether one element is drawn *inside* another is never decided here; that is what
`check-ops-narrow-overflow.mjs` measures. A guard's page
set is read from `OpsPaneRegistry` and the `/ops/*.html` literals in its source. `OpsUsagePayload`
is declared in the Aria monorepo, so nothing here can decide whether departure 8's list is a
complete sweep of it, which is why that departure no longer claims to be one. A declaration is
read the way a browser reads one — whitespace around the colon, `!important`, and a property
declared twice in a rule resolving to the last of them — but CSS is otherwise parsed by text, so
a value behind `var()`, a `calc()`, an `hsl()` or anything else this cannot resolve to a flat
colour is **named** as unresolvable rather than measured or dropped. `@media` and `@supports`
blocks are flattened — under any spelling, because an at-rule name is case-insensitive too — so a
`:root` inside one counts as a later `:root` whether or not its condition holds: that direction
over-reports rather than hides. A value declared twice in one rule resolves last-wins, with an
important declaration beating a later normal one, which is the one piece of cascade this does
model. Route blocks are a **literal scan**: every `/api/…` string a pane source spells, closed by
the quote that opened it, with a line for every `pane-*.js` so none can drop out. There is no
resolver and no unresolved branch — a URL assembled at run time is simply not there, a prefix
like `/api/ops/users/` is listed as the literal it is, and a route named in a comment counts.
Contrast ratios are
pixels, not arithmetic over the tree: `check-ops-contrast.mjs` is that oracle. And the
`deleted-assets` list is checked for absence only — the pull request each line names is not
verifiable from a shallow checkout.

The guard's own docblock carries that NOT COVERED list too, beside the code it is about; the
list of blocks is the `claims-blocks` block above, derived from the guard's own derivations.

### Measuring contrast where the colour lands

Pinning token values catches a palette that was derived instead of ported, and a token that
quietly changed value. It cannot catch a **usage-site swap**: a rule that asks for the *wrong*
token, where both tokens exist and both hold the value the design says. Swap `.pill.acc`'s
`color: var(--cyan-ink)` for `color: var(--cyan)` and every token still resolves, every pinned
value still matches, both suites stay green, and the pill measures 3.03:1 in light.

So `check-ops-contrast.mjs` measures pixels instead of parsing CSS. Backdrops on this page are
layered gradients under `color-mix` surfaces, and no ancestor's `background-color` is the colour
a reader sees, so the check hides every glyph with a constructable stylesheet — `<style>` is
blocked by the page's `style-src 'self'`, CSSOM is not — screenshots the full page, and samples
the **topmost paint at each run of text** with the glyphs lifted. Runs, not element boxes: a row
that contains a chip is 12% chip, and the row's own words sit on none of it. That paint is the
surface *behind* the glyphs only while nothing paints *above* them — lifting the text cannot tell
the two apart, and the error runs the flattering way, so over-paint is in NOT COVERED below.

Four things decide the answer, and each is chosen for the **role** the colour plays — an ink,
not a fill. Three of the four end in a refusal rather than a number, because a refusal fails
the run and a wrong number does not:

- **The ink decides against its worst surface**, with no minimum share. The hatch behind
  `.budget .fore` is 22% amber every 6px, so a letter crossing a stripe is read at the stripe's
  4.49:1 and not at the 6.01:1 of the gap. Put a 5% floor on surfaces and a real 1.63:1 site
  sinks below it unseen. Judge the widest surface instead and the site the page carries today
  stops failing altogether — what catches *that* is the freeze list below, which requires every
  frozen site to still reproduce and reports 0 matches where it needs 1. On a page with nothing
  frozen, judging the widest surface would be silent; the freeze entry is load-bearing here.
- **An ink it cannot resolve is refused, never assumed.** Assuming opaque is the flattering
  direction for an ink: a faded ink read as solid clears AA. `color(srgb …)` — how Chromium
  serialises `color-mix()` — is read as the 0..1 floats CSS Color 4 says it is, because the
  parser this one was ported from understood only `rgb()` and silently dropped 40 sites with 10
  real failures among them (monorepo #10255). It is read **only within gamut, to half a byte of
  slack**, because that serialisation is not clamped at either end and both ends bite:
  `color-mix(in srgb, oklch(1 0 0) 50%, white)` is plain white and computes to
  `color(srgb 0.999935 1.00003 1.00004)`, so a gate at exactly 0..1 refuses white, while
  `color-mix(in srgb, color(display-p3 1 0 0) 90%, white)` computes to
  `color(srgb 1.08372 -0.104021 -0.0350659)`, which scaled by 255 is a colour that does not
  exist and a ratio to match. The first is read, the second is refused, and both are pinned by
  Chromium's own serialisation in **self-test part F2** rather than by this paragraph.
  Anything it cannot read fails the run. **No ink on the shell reaches this branch, as measured
  on this commit.** The parser sees inks only — backdrops come from screenshot pixels and never
  enter it — so instrumenting the branch and running a full sweep counts every string that
  arrives: **ten**, of which nine are the fixture spans in parts F and F2 and the tenth is the
  literal F2 parses directly to pin the clamp's lower half. None is a page ink. The
  `color-mix()` values the shell does carry are backgrounds, borders and shadows. So the gate
  costs no coverage here, and it is not costing none because the page's mixes happen to be in
  gamut — it is not reached. It is there for the first mix written into a `color`.

  **That is an observation, not an invariant, and nothing here enforces it.** A `color-mix()`
  written into a `color` tomorrow starts arriving at the branch with no warning, which is the
  intended outcome — the gate is what handles it — but the count above is a fact about this
  commit that a stylesheet change can move, and no assertion pins it.
- **The fade does not have to be on the text.** `opacity` does not inherit, so a faded ancestor
  leaves the text element reading `opacity: 1` while its glyphs composite at the ancestor's
  alpha. The ink's alpha is the product of every `opacity` in the chain, plus `fill-opacity` on
  SVG. That product is the true glyph alpha only while nothing **inside** a fade paints a
  surface under the text — group opacity composites a subtree as a unit, so the glyphs blend
  with that surface first and the pair is faded together. Where something does, the site is
  **refused by name** rather than guessed at; the painter does not have to be the faded element
  and does not have to be faded itself.
- **The ink is `color` — or `-webkit-text-fill-color`, which beats it for the glyph interior —
  times that alpha. Four named properties that defeat that reading are refused.** `filter`,
  `mix-blend-mode`, `-webkit-text-stroke` and, on SVG text, `stroke` each decide the pixel a
  glyph paints while the computed colour still reads exactly as the stylesheet asked for, which
  is the flattering direction for an ink: `filter: opacity(.06)` and `opacity: .06` paint
  identically and only the second is in the model; `mix-blend-mode: screen` erases black text
  that still computes to `rgb(0, 0, 0)`; SVG paints `fill` then `stroke`, so a 2px stroke in
  the surface colour erases a 10px label whose `fill` is unchanged. Set any of the four and the
  site is **refused by name** and the run fails. Read on the element and its ancestors — and,
  for a `::placeholder` site, on the pseudo-element too, together with its own `opacity`, which
  is the one place an `opacity` sits outside the chain above.

  That list is **what this tool will not stand behind, not what CSS can do to a glyph, and it
  does not close.** `mask-image` and `clip-path` are two more ways to spell the same 6% fade,
  both measured passing at the same anchor where `opacity` and `filter` are both caught; they
  are in NOT COVERED below rather than in the list, because enumerating CSS is the losing half
  of this trade. `backdrop-filter` is a deliberate omission of a different kind — it alters the
  backdrop, which the screenshot samples correctly — and that reasoning is specific to
  `backdrop-filter`, not a general property of the screenshot: `text-shadow` is painted on the
  real page and deleted on the plate, which is its own NOT COVERED entry below. The shell sets none of the four on a
  glyph today, so the refusals cost no coverage — but "the shell has one `filter`" was itself
  an overclaim. The only CSS `filter` a shell page loads is `aria.css:592`'s
  `.btn-primary:hover`, which the sweep never enters; `ops.css:278`/`:281`/`:477` carry three
  more that no v2 page loads; and `aria.js:463`, `:544` and `:623` each set a `filter`
  **presentation attribute** on an SVG chart stroke, which is shipped, rendered, and simply not
  a text node the sweep samples.
  `::first-line` and `::first-letter` are refused on the same terms — see the pseudo-element
  paragraph below — and likewise match nothing on the shell today.

The tool proves itself before it judges anything: `node scripts/check-ops-contrast.mjs
--self-test` runs eight parts against synthetic fixtures — the formula against published WebAIM
values, the decode/plate/sample pipeline against declared swatch colours, plate integrity pixel
by pixel, SVG ink read from `fill` rather than `color`, a paint-server fill refused rather than
read as its fallback, `color(srgb 0.5 0 0.5)` read as rgb(127.5, 0, 127.5), both ends of the
gamut window pinned against Chromium's own serialisation of an in-gamut overshoot and a
wide-gamut mix — with the slack capped at a byte, because guards written in terms of it
bracket it rather than pin it, and the clamp's lower half pinned against a literal, because the
only rendered fixture with negative components is the wide-gamut one and the gate refuses it
before the clamp runs — and the three boundary
censuses counted on a page that carries six spellings of a nested browsing context, an open
author shadow root, a closed one, and seven user-agent roots carrying text of which exactly one
paints words no source reaches — that one named in full, so a census that catches the wrong host
fails too. If any part fails, nothing is measured
and the run exits non-zero.

**Not covered.** This paragraph used to say the tool "measures text only" and put focus rings
outside it. Both halves are stale: the script grew a focus sweep, and `--verbose` reports the
indicators it measures against 1.4.11's 3:1 alongside its text results. What is still outside it
is the rest of non-text contrast — control boundaries, icon strokes, chart geometry against its
card. It is also one page: `SHELL` is `/ops/shell-v2.html` and nothing else is opened, so a class
only a standalone page paints is unmeasured however carefully the tool measures the shell. Text over a picture is likewise outside it: the plate hides `img`,
`canvas` and text-free `<svg>` outright, so a word sitting on an icon or an image would be
sampled against the surface *behind* it rather than against the picture, and `video` is not
hidden at all. The shell has no `img`, `canvas` or `video`, and its text-free SVGs paint nothing
under any text band (measured in round 4 of this PR's independent review: a plate that keeps them
visible differs from the shipped plate by **0 pixels** across the four text bands their boxes
contain), so this bites nowhere today. A skip link parked off-canvas is skipped, so its focused appearance is
unmeasured. Only `shell-v2.html` is walked, at one viewport, in the four states `applyState`
exposes.

**Text painted by `::before`, `::after` or `::marker` is not measured at all.** A
pseudo-element has no text node to range over, so there is nothing to sample the surface behind.
Rather than measure the originating element's box and call that an answer, the run **fails** if
any of the three paints text — for `::before`/`::after` a quoted string, `counter()`,
`counters()`, `attr()` or a quote keyword; for `::marker`, `display: list-item` with a
`list-style-type` other than `none`, because a marker's `content` computes to `normal` whatever
the page asks for and the words come from the type. `content: ''`, the decorative form this page
uses everywhere, is not text and is not flagged. What is claimed is that **these three cannot
pass unmeasured** — nothing more.

**Three other pseudo-elements are handled by two other mechanisms, and the list is still open.**
`::placeholder` is collected and **read** from its own computed style, because it carries its own
colour — and a `::placeholder` whose own style carries `opacity`, `filter`, `mix-blend-mode` or
`-webkit-text-stroke` is **refused by name**, because all four apply to the pseudo-element while
leaving the originating element reporting the defaults, so neither the alpha chain nor the
element-level refusal can see them. (`PLATE_CSS` also lifts it explicitly. That rule is **proven
on the self-test fixture only**: deleting it leaves the real page's plate band byte-identical,
not because the shell sets no placeholder colour — it sets one at `.field input::placeholder` —
but because the `*` rule's inherited transparent `-webkit-text-fill-color` beats that colour and
already lifts those glyphs. A page spelling its placeholder ink as `-webkit-text-fill-color` on
the pseudo-element would **not** be lifted by that rule; that case is not covered. `PLATE_HOLDS`
cannot speak for it either, because a placeholder has no text node to iterate.) `::first-line` and `::first-letter` repaint the element's **own** text — no new text node,
no new box, no change to the site count, and the plate lifts them correctly — so nothing in the
census or the plate check can see them; they are **refused by name** instead, detected by
comparing the pseudo-element's resolved ink against the element's own on the element and on every
ancestor, since first-line styles propagate into inline descendants. (`-webkit-text-fill-color`
does not apply through either one in Chromium, measured rather than assumed, so `color` is the
whole channel.) That is six pseudo-elements by three mechanisms — and **`::selection`,
`::target-text` and the highlight pseudos repaint text too and are neither censused, read nor
refused.** Six handled is not "all of them"; round 5 of this PR's review found `::first-line` by
reading past exactly this kind of sentence.

**Text painted through `filter`, `mix-blend-mode`, `-webkit-text-stroke` or an SVG `stroke` is
not measured** — it is refused, which fails the run, so it can neither pass unmeasured nor be
reported as a number the tool cannot stand behind. The same goes for a surface painted inside a
fade. These are refusals, not coverage.

**`text-shadow` is deleted on the plate, so the surface immediately around a glyph is not the
surface measured.** A shadow paints from the glyph outline even when the text itself is
transparent, so leaving it in would put glyph geometry into the very sample the plate exists to
keep clean — clearing it is right for the plate and wrong for the reader, who sees the halo. A
five-deep `text-shadow` on `.tbl th` changes 259 of 4608 pixels in the sampled band on the real
page and **0** on the plate, and the run stays green. No claim is made about which direction that
error runs: WCAG 2.x does not model a halo and this tool does not invent one.

**Paint that lands ON TOP of the glyphs is sampled as though it were behind them, and the error
runs in the flattering direction.** The plate is the whole page screenshotted with the glyphs
made transparent; lifting the text cannot distinguish paint under it from paint over it, so a
positioned sibling, child or pseudo-element covering a text run is read as that run's backdrop.
`unmodelled()` walks the element and its ancestors, and an over-painting box is neither, so there
is no property to refuse by name. A `::after` with `position: absolute; inset: -2px;
background: rgba(255,255,255,.94)` over `span.card-note` exits **0** with the site count
unmoved, and — forcing the AA threshold to 99 so every judged site prints its ratio — the number
this tool reports goes **UP**, from `5.85:1 … #55637A on #F8FBFD` to `6.08:1 … #55637A on
#FFFFFF`: it has sampled the overlay and called it the backdrop. The round-6 reviewer's
independent pixel probe puts the best contrast available anywhere in that band, on the real
page, at **1.08:1**. The same pixels spelled `opacity: .06` on the element are caught at 1.08:1.
A second shape with no pseudo-element and no `content` — an absolutely positioned child `i` over
`.legend span` — behaves identically: exit 0, with the reviewer measuring the real page at
6.95:1 to 1.09:1 while the tool moves 6.94:1 to 6.95:1.
Closing it would mean a geometric overlap analysis over positioned boxes rather than a named
refusal, so it is named here instead. The shell does not do this today: neutralising every
shipped positioned overlay that paints in the content layer changes **0 of 113,083** sampled band
pixels in dark/degraded and **0 of 114,670** in light/live.

**A paint-affecting property outside those four is neither modelled nor refused**, and text
under one is measured as though it were painted in full. `mask-image` and `clip-path` are the
demonstrated cases: a 6% `mask-image` on `.legend span` and a `clip-path: inset(100%)` that
paints no glyph at all both measure clean, at the same anchors where `opacity: .06` and
`filter: opacity(.06)` are caught. This is the honest shape of a refusal list — it holds what
has been named and nothing more — and it is why the pixel-level checks below exist alongside
it. A fifth spelling found later is a new entry, not a surprise.

**The backdrop-alpha refusal is written and unexercised.** Chromium returns this page's
screenshot as PNG colour type 2, which has no alpha channel, so the "a backdrop I cannot read
as one opaque colour is refused" half of the per-role rule is structurally unreachable on this
decode path and no mutation drives it. It is a fail-closed guard against that path changing,
claimed as nothing.

**Text on an element with no box of its own is refused, and only `display: contents` is
named.** The collector drops anything whose box is smaller than a glyph, which is how this page
spells "not shown" — `.sr` clips its text to 1×1 and paints nothing. `display: contents` gives
the same zero rect and means the opposite: no box, while the text paints in full. That case is
**refused by name**, which fails the run. Other ways to have no box while text paints — a
zero-sized block with `overflow: visible`, for one — are **still dropped in silence**, and the
gate cannot tell them apart without letting `.sr` into the sweep at its full text width. Naming
one member of a class is not covering the class.

**The WCAG 1.4.3 inactive-component exemption is bounded to form controls, and it no longer
outranks a refusal.** Round 7 of this PR's independent review broke both halves of this in one
payload: `closest(':disabled')` reaches through `<fieldset disabled>`, which is simultaneously an
element HTML lets be disabled and a container, so one attribute on `ops/shell-v2.html` took **56
status badges** out of the sweep — including the issue's own headline `.pill.acc` defect at
3.03:1 — and the run reported `1576 … 56 exempt as inactive controls` and exited 0. The same
wrapper also turned 56 *refusals* into 56 exemptions, because the exemption was tested first.
Both are closed: the nearest `:disabled` ancestor-or-self must now also be a `button`, `input`,
`select`, `textarea`, `option` or `optgroup` — `fieldset` and `form` are deliberately not on that
list — and the refusal check runs **before** the exemption, so "refusals fail the run" now has no
exception. The exempt count is printed on every run and is `0` today, and the shell carries no
`:disabled` element and no `<fieldset>` at all.

**Text over a picture is not covered.** The plate hides `img`, `canvas` and text-free `<svg>`
outright — the last is every `Aria.icon()` on the page — so text over one would be measured
against whatever is underneath rather than against the picture, and `video` is not hidden at
all. `shell-v2.html` carries no `img`, `canvas` or `video` element, so nothing here exercises
that path for those three and no mutation proves it either way — read it as not covered, not as
handled.

**WCAG's large-text allowance is not implemented: every text site needs 4.5:1.** The allowance
drops the requirement to 3.0:1 at 24px, or at 18.66px bold, and both numbers can only come from
`getComputedStyle().fontSize` — the size the stylesheet *asked for*, not the size the glyphs land
at. Round 7 of this PR's review bought the weaker threshold with `font-size: 24px;
transform: scale(.48)` on `.pill.acc`, which renders glyphs **narrower** than the untouched
11.5px pill and passed the issue's own 3.03:1 headline defect at exit 0. That was answered by
refusing `transform` and `zoom` by name, and round 8 reproduced the identical output twice more
without touching either: `scale: .48` is an independent transform property Chromium keeps out of
computed `transform`, and `font-size-adjust: .2` is not a transform at all. Refusing by name cost
one round per spelling and closed nothing, because the spelling was never the cause — with the
allowance in place, plain `font-size: 24px` and no scaling of any kind was already enough to pass
the 3.03:1 defect.

So the allowance is **deleted** rather than defended, and nothing in the tool reads the rendered
size. The cost is real and runs the safe way for an ink: text WCAG AA would genuinely permit at
3.0:1 fails this check. It costs **0** sites today — the sweep still passes at 1632 with 4.5:1
required everywhere, and the lowest ratio measured on any unfrozen site is 5.20:1 — and a site
that ever earns the allowance goes in `KNOWN_BELOW_AA` with an issue, where it is reconciled in
both directions instead of granted silently. Rotation and skew are **not** refused and never
were: `rotate: 20deg` passes, and what a rotated site gets is a sample taken from its
axis-aligned bounding box, which is wider than the glyphs. Under the worst-surface rule a wider
box can only add surfaces and so can only lower the ratio, which is the conservative direction.

**Text inside a shadow root is refused, because nothing here enters one.** `COLLECT`,
`GENERATED_TEXT` and `PLATE_HOLDS` are all `document.querySelectorAll('*')` walks, and none of
them crosses a shadow boundary. Round 8 of this PR's review put a declarative shadow root on the
pill row with no JavaScript at all: eight sites left the sweep with no site row, no refusal and
no census entry — the headline 3.03:1 defect among them — and the run still reported every
rendered text site meeting AA, eight short. Author shadow roots, open **and** closed, now fail
the run. The census is taken over CDP with `DOM.getDocument({ pierce: true })` rather than in the
page, because `el.shadowRoot` is `null` for a closed root: measured here, a closed declarative
root is invisible to the in-page read and reports `shadowRootType: "closed"` to CDP, so an
in-page census would have covered half the class while reading as though it covered all of it.
It refuses rather than measures — piercing the sweep into shadow trees means ranges, plate rules
and the `*` selector all crossing the boundary — and it costs **0** sites: the shell carries no
author shadow root in any of the eight passes. That last fact is also why the census is asserted
in **self-test part G** rather than only on the shell: on a page with no shadow root, a census
that always returns nothing looks exactly like a working one. Part G's fixture carries an open
author root, a closed one and a user-agent one, and requires exactly the first two.

**A user-agent shadow root is refused when it paints words `COLLECT` has no source for, and
measured when it does not.** `COLLECT` reads a control's words from its own text nodes, from
`.selectedOptions`, from `.value` and from `.placeholder`. All four of the shipped page's
user-agent roots — one `<select>`, its two `<option>`s and one `<input>` — fall inside those
four sources and are measured, proven by mutation: colouring `#sampleRange` `#E9EDF2` fails the
run at `1.08:1` in four passes, colouring the placeholder `#EDEFF2` fails it at `1.11:1`, and the
failing select run samples a clean `#F2F6FA` backdrop with no glyph pixels in it, which is what
says the plate lifts a user-agent-painted value too. Round 8 of this PR's review wrote that the
`<select>`'s value was out of reach and filed it as an issue; round 9 disproved that from the
code and from those mutations, so
[Stadiora/Aria#10422](https://github.com/Stadiora/Aria/issues/10422) is closed as not a defect.

Round 10 then showed that round 9 had stopped one step short. A user-agent root that paints words
in **none** of those four sources used to leave the sweep with no site, no refusal and no census
entry. Four of them are reachable from this shell with no change to the tool — `<input
type="file">` ("Choose File / No file chosen"), `<input type="date">` with no value
("mm/dd/yyyy"), `<input type="submit">` with no value ("Submit"), and `<img alt>` on a broken
`src` — and each exited **0** while painting real text at about `1.13:1` in light. The control is
what makes it a defect rather than a limit: the same element at the same anchor with the same
ink, `<input type="date" value="2026-09-20">`, routes its identical glyphs through `.value`.

Those are now refused by name. The test is behavioural, not a tag list: `DOM.getDocument` with
`pierce: true` returns the user-agent root's own text nodes, so "this root paints words" is
answered by the browser. A host is refused unless `COLLECT`'s own rule, run on that host,
produces **the same string the root paints** — a match is the only thing that shows the glyphs in
the root are the glyphs the sweep judged — and unless the host is visible with a box of at least
2×2. That is why the shipped page refuses **0**: `.selectedOptions` gives the `<select>` exactly
the `Last 7 days` its root paints, `.placeholder` gives the search input exactly its own
placeholder, and each `<option>` has its own text node. Round 11 replaced an *existence* test
here, which `placeholder=" "` and `placeholder="never painted"` both walked straight through.
A working `<img>`, `<input type="range">`, `<input type="color">`, `<progress>` and `<meter>` all
report an empty root and are never censused. Two consequences worth stating because they are
costs, not wins: `<video controls>` and `<audio controls>` are refused **whatever they contain**,
since their root paints a running time and their fallback content — which Chromium never renders
— does not match it; and `<input type="date" value="…">` is refused too, because its root paints
`09/20/2026` where `.value` reads `2026-09-20`. Part G's fixture carries seven user-agent roots
with text — a sourced `<select>`, its `<option>`, a sourced `::placeholder`, the file input's own
inner UA button sourced through `.value`, a `display: none` reset and a zero-box submit — plus
one visible `<input type="file">`, and requires **exactly that one, named in full**, to be
refused: four exonerations of a source, two of a gate, one catch. A census that refused
everything, nothing, or the wrong host fails there.

What a user-agent root still keeps out of reach is the `<option>` **list** of an open `<select>`,
which the browser paints in a platform popup outside the page — there are no such glyphs in the
screenshot, and nothing in the page's own styling decides its contrast.

**Text inside a nested browsing context is refused, for the same reason and a worse one.** A
frame is a separate document: the shell's `*` walks do not reach it, the plate stylesheet is not
installed in it, and no `Range` can be taken over its text — while it paints into the same
screenshot at full size. Round 9 of this PR's review replaced the pill span with an
`<iframe srcdoc>` rendering the same pill from the same stylesheet, with the headline token swap
applied: the sweep went from `1632` sites to `1624`, **exited 0**, and still printed that every
text site it reaches meets AA, while the pill inside the frame painted at `2.89:1` — worse than
the `3.03:1` this guard exists for. CSP does not prevent it: `shell-v2.html` is
`default-src 'none'` with no `frame-src`, and `about:srcdoc` is exempt from CSP by spec. The
census is `Page.getFrameTree` over CDP, not a tag-name list, so a different spelling does not
walk through it — and that is asserted in **self-test part G**, whose fixture carries
`<iframe srcdoc>`, `<iframe src>`, `<object type=text/html>`, `<embed type=text/html>`,
`<object type=image/svg+xml>` and `<embed type=image/svg+xml>` and requires all six to be
reported. An in-page census would miss two of those outright: `embed.contentDocument` reads
`null` to script in the page even for HTML the `<embed>` is hosting. It refuses rather than
measures, and it costs **0** sites: the shell carries no nested browsing context in any of the
eight passes.

On the shipped page, CSP narrows which spellings can even create a context: `default-src 'none'`
with no `frame-src` and no `object-src` blocks `<object>` and `<embed>` entirely — they create no
context and paint nothing — and blocks `<iframe src>`, which still appears in the frame tree as a
`chrome-error://` child and is still refused. `about:srcdoc` is exempt from CSP by spec, which is
why it is the spelling that reached the sweep.

And the check answers "is the ink readable against the paint at its own run", which is "can this
be read" only while nothing paints over the glyphs — not "is this the designed colour". The token
pins in `check-ops-shell-v2.mjs` answer the second, and the three are complementary.

Sites that are below AA on the page today are frozen one at a time in `KNOWN_BELOW_AA`, keyed
per site — theme, state, selector and the words — with the issue that tracks each. The freeze is
asserted in both directions: an entry that stops reproducing, matches more than one site, or
moves by more than 0.15 fails the run, so an exemption cannot outlive what it exempts. There is
one entry today, [Stadiora/Aria#10366](https://github.com/Stadiora/Aria/issues/10366).

The pre-paint half of the shell check is the part worth keeping. A theme default written in two
places that disagree produces a page that paints one theme and switches to the other a moment
later, and *any* assertion that runs after boot sees the corrected page and passes. The only way
to see it is to stop the script that does the correcting.
