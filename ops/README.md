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
    operate.css         pane styling for the operate panes
    operate.js          shared pane furniture: charts, drawer, confirm, states
    alerts-model.js     the problems API in plain words, shared by two panes
    pane-overview.js    Overview
    pane-alerts.js      Problems
    pane-awaiting-data.js  Happening now and What happened
    pane-data.js        shared plumbing for the understand panes: source,
                        formatting, states, charts
    pane-analytics.js   People and usage
    pane-spend.js       Cloud costs
    pane-releases.js    App releases
    pane-users.js       Look up a user
    settings.css        pane styling for Settings
    settings.js         Settings
```

A pane page carries the shell, and where the pane has been built, its own module. Everything a
pane *is* lives in the `PANES` registry in `shell.js`, so the rail cannot drift from the pages;
everything a pane *shows* is registered by that module through `OpsShell.definePane`, and a pane
with no module renders the not-built state. The shell waits for the document to finish parsing
before it asks for a pane's contents, so which script finishes first cannot change what renders.

Registration rather than a flag in the registry, because the thing that knows whether a pane is
built is the pane's own module being on the page; a boolean in the registry could claim "built"
on a page that loads nothing to build it.

## What this release does and does not do

The shell, the sign in, and the design system are built. Of the panes, **Problems** is complete:
it reads the live problems and alert rules, takes a problem on, closes it with a reason, tunes a
rule where the role allows it, and states whether the alerting is armed and where what it finds
is sent. **Overview** is built for the part that has a source, which is the urgency question:
the status ribbon and the needs-attention queue are real, and every entry opens the pane that
owns the work.

The rest of Overview, and the whole of **Happening now** and **What happened**, are not drawn.
Their figures are being collected but nothing serves them to a page yet, so those pages say so in
words instead of showing a zero. A tile reading zero and a tile with no pipeline behind it look
identical, and that is the one thing an operations screen must never be.

A read answers with at most 100 problems, worst first and then oldest, and there is no second
page. A full page therefore keeps the oldest problem in each severity and drops the most recent,
which is the opposite of what a window ending today needs. When a page comes back full, both
Overview and Problems say so, every count reads as "at least", and the two figures that cannot
be salvaged, the 30 day false-alarm rate and the 30 day volume chart, say they cannot be worked
out instead of showing a number that is quietly short.

**People and usage** and **Cloud costs** are drawn in full: every state, every card, and the
whole of the copy. Neither has a read API published yet, so on the live site both land on an
honest "not reporting yet" state for the same reason Happening now and What happened do, and the
section below says exactly what changes on the day their endpoints exist.

**Settings** is built, and is the one pane that can change something rather than only report it.
The section on it below is worth reading before the page is used. Aria quality is deferred to its
own project.

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
than inventing one. A pane listens on `window` for two events, both dispatched once the session
is confirmed and the shell is in the document, so a listener added while `shell.js` is still
booting cannot miss them:

- `ops:ready`, carrying `{ pane, filters }`, which is the signal that `#content` exists.
- `ops:filters`, carrying the selection, fired for the starting selection as well as for every
  change to it. `OpsShell.filters()` returns the same thing on demand.

Per-pane filters arrive with the pane that needs them. App releases adds a Platform switch beside
the shared controls rather than growing a second bar underneath the first: its module appends to
the rendered `.filterbar`, deferring to `ops:ready` when the bar is not in the document yet,
which is the same small move `OpsOperate.paneFilters` makes for the operate panes. It is written
out locally rather than reached for across `operate.js`, because App releases loads none of the
rest of that file and a whole shared module pulled in for six lines is a dependency the pages do
not need.

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

People and usage and Cloud costs keep the controls the registry gives them, and that is the same
rule rather than an exception to it. With no read API published they draw no figure at all, so
there is no figure a selection can sit over and be silently wrong about; what a control does
today is repaint the same "not reporting yet" state, which is honest in every position. The
selection is what the query will carry on the day an endpoint lands, and if one ships able to
answer only some of them, the ones it cannot carry become a `filterNote` in the same commit that
turns the endpoint on.

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
pane at it. It does not claim figures will appear "without another release", because both
`endpoint` values are `null` in these files and a backend publishing a route would change
nothing on its own.

## The Settings pane

Settings is owner only and is the one pane that can change something, so it is worth being exact
about what it does and does not do.

**What is real.** The administrator list, each account's role, status, last sign in and current
session expiry, the ability to revoke another administrator's access, and the access record all
come from the API. Revoking asks first, requires a written reason, sends that reason, and reports
what the server answered rather than what was asked for. The record of the change is reloaded
beside the change, so the audit entry is on screen next to the thing it describes.

**What is not, and says so.** Retention windows, the cost category mapping, integration
connection state, and the session and elevated-access windows are settings in the approved mock
that no API can yet read or write. Each of those renders a state saying which of "not built" and
"not reported" applies, rather than a select or a switch that would silently write nothing. A
control that appears to work and does not is worse than no control, and on this pane it would be
worse than the whole pane being missing.

**The role table is written from the server, not from the design.** Every enforced row traces
to server code: a `requireOpsRole` call or an ownership branch in the operations routers, or,
for pane visibility, the shell's registry backed by this pane's owner-only endpoints. A row
whose endpoint does not exist yet says so on the row, so the table never implies that something
refuses a capability nothing can yet be asked for. Settings is the only
pane carrying a role, so "view every pane" is stated with that exception rather than without it:
a matrix that misreports the permission governing the page it is printed on is worse than no
matrix, because the person least able to check it is the one reading it.

**Nothing here is a permission check.** The pane draws what the role in hand can do, and the
server re-reads the account row on every request and refuses independently. A control drawn for
somebody who may not use it is a cosmetic bug; the server's answer is the one that counts, and it
is the one shown.

**The export covers what is loaded**, which is what the button says. There is no server-side
export, and a button labelled "export the record" that quietly sent one page of it would be a lie
about the record people are meant to be able to check. Cells that begin with a character a
spreadsheet reads as a formula are prefixed so that opening the file cannot run anything: two
columns of that export carry text somebody else wrote, including the address submitted on a
failed sign in.

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
14. **The two ship and support panes darken the light-theme status ink**, scoped to those two
    pages. Same debt as item 11's neighbours and the same shape of fix as `operate.css`; see the
    second half of the note below.
15. **`.table-wrap` is positioned.** `overflow-x` clips only a descendant whose containing block
    is the wrapper, and an absolutely positioned one resolves that to the nearest positioned
    ancestor. Left static, an `.sr-only` span inside a table wider than a phone resolves to the
    page, escapes the wrapper's clip, and extends the document's scroll width: the table scrolls
    inside its card and the whole page scrolls sideways with it. `position: relative` puts the
    containing block back where the clip is.

    Stated exactly, because the rule is on every page: **no pane ships a span that triggers this
    today**, so it is a guard rather than a repair, and it was measured as one. Put a
    screen-reader-only span in the last cell of each wrapper at 375px and delete the declaration
    at run time, and the document's scroll width goes from 375 to 1118 on Settings and to 434 on
    App releases, with the span's offset parent moving from the wrapper to `body`; with the
    declaration it stays 375 on both. Settings reaches the same end by a second route, using
    `aria-label` on the revoke buttons rather than a hidden span, and App releases and People and
    usage already carry hidden spans inside a wrapper that happen to sit inside the visible width.
    Both are one layout change away from not doing so.

    It changes nothing else. Every element on all seven pane pages was measured at 1440px and
    375px with the declaration and without it: the only difference anywhere is the wrapper's own
    computed `position`. No geometry, paint order, or sticky behaviour moves, because a sticky
    header is itself positioned and was already painting in the positioned layer, and `z-index`
    stays `auto` so no stacking context is created.

### Known contrast debt, inherited

Measured across both themes against composited backgrounds. **Every pairing rendered by the
panes built so far passes in both themes**, text at 4.5:1 or better and control boundaries at
3:1 or better. That was verified again for the two understand panes across all four of their
states, 68 pairings in total, worst case 4.67:1 in light and 5.99:1 in dark.

Settings was measured the same way and **needs no fix of its own**, which is why it carries
neither of the two page-scoped blocks below. Every text pairing it draws was read off the
rendered page rather than computed from tokens, by walking each element's ancestor background
chain and compositing what the engine actually paints: 36 distinct pairings in light and 36 in
dark, across the ready, empty, per-card failure, access-record failure and denied states, at
1440px and 375px, plus the revoke confirmation. Nothing fails. The lowest in light is 4.665,
`.badge-warn` on a card, and the next is `.badge-ok` at 4.695; the lowest in dark is 5.988. Both
figures land on the "Ink was, on a card" column of the badge table below to three decimals, which
is the point: those inks are untouched here, and what keeps them passing is where the badge is
put. Settings draws its status badges **only** inside a card, and it draws no `.badge-crit`, no
`.badge-info`, no `.btn-danger` and no platform tag anywhere. The whole set of tinted classes on the pane is
`.badge`, `.badge-ok`, `.badge-warn`, `.badge-brand`, `.tag`, `.callout` and `.callout-warn`.

Two of those figures are worth keeping in view rather than filing away. 4.665 is a pass with
0.165 to spare, so a Settings badge moved onto the page background, or onto any surface darker
than a card, fails on the day it is moved; and the light-theme `.badge-warn` ink there is the
same `#9A5B06` the two blocks below darken elsewhere, so the eventual token change closes this
margin too.

Part of that debt has now come due, and three separate fixes have landed against it. Which pages
get which follows from where each one lives, so it is worth being explicit: `ops.css` is on every
page, `operate.css` is on the four operate pages only, and the third fix is in `ops.css` but
scoped by a selector to the two ship and support pages.

**The callout fix is in `ops.css`, so it reaches every page.** The warning and critical callout
inks measured 4.41:1 and 4.26:1 in the light theme *only when the callout sat directly on the
page background*, which is darker than a card; on a card they passed. A translucent tint takes
its final colour from whatever is behind it, so the same component had two different ratios
depending on where it was put. The fix mixes the tint into `--surface-1` instead of into
transparency, which makes the fill, and therefore the ratio, independent of the surface
underneath. They now measure 4.94:1 and 4.74:1. No approved hue changed, and dark is unaffected.

**The badge fix is in `operate.css`, so it reaches the operate panes only.** They are the first
to draw a status badge loose on the page background, and `operate.css` darkens the three
light-theme inks, scoped to `[data-theme="light"]` and to the badge's ink alone.

The ratios are computed rather than eyeballed, and are reproducible from the shipped tokens. The
badge tint is semi-transparent, so the background that decides is the tint composited over
whatever the badge sits on: `composited = 0.11 x status token + 0.89 x parent surface` in sRGB,
because `--tint` is 11% in the light theme, then the WCAG 2 relative-luminance ratio. These panes
put a badge on `--surface-1` `#FFFFFF` (a card, the alert list, the drawer), on `--surface-2`
`#F6F8FB` (an alert row on hover, the runbook card) and on `--bg` `#EEF2F7` (the filter bar). The
page is the darkest of the three, so it is the one that has to clear 4.5:1.

| Badge | Ink was | Ink now | On a card | On a hovered row | On the page |
|---|---|---|---|---|---|
| `.badge-crit` | `#C8322B` | `#AE2C25` | 4.505 to 5.580 | 4.247 to 5.260 | 4.030 to 4.991 |
| `.badge-warn` | `#9A5B06` | `#885005` | 4.665 to 5.652 | 4.399 to 5.331 | 4.176 to 5.060 |
| `.badge-ok` | `#047857` | `#046B4D` | 4.695 to 5.591 | 4.429 to 5.275 | 4.205 to 5.008 |

All three now clear 4.5:1 on every surface W2 draws them on. Before, only the card cleared it and
only just. The two variants these panes draw but the fix does not touch already pass: `.badge-info`
is 5.649 on a card and 5.058 on the page, and the plain `.badge` is 6.82 on a card.

An earlier version of this section recorded 4.15 / 4.22 / 4.27 before and 4.55 or better after.
Neither figure reproduces from the tokens, and the before figures also disagreed with W1's own
record of 4.04 / 4.21 / 4.17 for crit / ok / warn over the page background, which does match the
table above. The palette owner acts on these numbers, so they need to be recomputable.

That is a patch and not the fix. The base status tokens are also the dots, the chart series, the
meters and the callout borders, all of which pass where they are used and all of which are shared
with the panes other waves are building; darkening the tokens themselves is a decision about the
approved palette and belongs to whoever owns it. When it happens, the three rules at the end of
`operate.css` become redundant and should be deleted.

**The third fix is the same shape, for App releases and Look up a user.** Those two pages load no
stylesheet of their own, so it sits at the end of `ops.css` and is scoped by the page rather than
by the file: `[data-theme="light"] body:is([data-page="releases"], [data-page="users"])`. Nothing
outside those two pages is restyled by it. The three badge inks are byte-identical to the three
in `operate.css` on purpose; a second set of values would mean a critical badge was one red on
Problems and a different red on Look up a user, which is worse than the debt.

These two panes never put a tinted status loose on the page background, so the surface that
decides is a different one: the selected match row, which is `--brand-dim` over a card and
composites to `#E3F3F6`. They also draw one pairing that composites twice, a state badge inside a
`.build` chip already tinted with the same hue, and that is the worst pairing on either pane.
Same formula as above, with `--tint-soft` 9% for a platform tag and no tint at all where the ink
goes straight onto a card.

| Pair | Ink was | Ink now | On a card | On a hovered row | On a selected row |
|---|---|---|---|---|---|
| `.badge-crit`, `.flagchip.is-crit` | `#C8322B` | `#AE2C25` | 4.494 to 5.566 | 4.241 to 5.253 | 3.976 to 4.925 |
| `.badge-warn`, `.flagchip.is-warn` | `#9A5B06` | `#885005` | 4.668 to 5.656 | 4.408 to 5.341 | 4.111 to 4.982 |
| `.badge-ok` | `#047857` | `#046B4D` | 4.688 to 5.583 | 4.428 to 5.274 | 4.139 to 4.930 |
| `.tag-mobile` | `#0E7490` | `#0D6880` | 4.716 to 5.586 | 4.457 to 5.280 | 4.196 to 4.971 |
| `.tag-coaches` | `#7C3AED` | `#7434DF` | 4.978 to 5.560 | 4.706 to 5.257 | 4.390 to 4.903 |

And the double-tinted pairing, on a card: `.badge-crit` inside `.build.is-blocked` 3.852 to
4.771, `.badge-ok` inside `.build.is-live` 4.059 to 4.834. 4.771 is the worst figure either pane
produces after the fix, and 3.852 was the worst before it. Of the 36 pairings the two panes draw
with a status token as text, 17 were below 4.5:1 and none is now.

Every figure above is the arithmetic, so it recomputes from the tokens. The same pairings were
also measured against what the browser actually composites, by walking each element's ancestor
background chain: those agree to within 0.03 (the engine mixes at a precision the hex round trip
here does not keep), and the worst rendered pairing on either pane is 4.778. Deleting the five
rules at run time and re-measuring brings back exactly five failures, worst 3.970, which is what
makes them load bearing rather than decorative. The lowest rendered figure on App releases is not
in the table at all: it is `--text-3` on the tinted `.build` chip at 4.586, which passes untouched
and is recorded so the next person to darken a chip knows how little room is left.

Three of those rows already passed and are moved anyway: `.verdict-worse` 5.321 to 6.590,
`.verdict-slightly-worse` and `.reveal-note` 5.422 to 6.570, `.verdict-better` 5.484 to 6.531.
`.verdict-worse` and `.badge-crit` are drawn in adjacent cells of the same release-health row, and
two reds a shade apart in one row read as a mistake rather than as a palette.

Deliberately untouched on these two pages, with the worst figure each reaches on them:
`.badge-info` and `.flagchip.is-info` 4.837 inside a `.build` chip and 4.998 on a selected row,
`.badge-brand` 4.825, the plain `.badge` 6.821 on its own opaque fill, `.masked` 4.706,
`--text-3` on a selected row 4.771, and `.field-error` 5.321. `.field-error` has a second reason:
the sign-in page draws it too, and darkening it under a page scope would give one component two
inks across pages for no contrast gain.

What is left. The first three rows are drawn by nothing built so far, and are recorded so that
the first pane to draw one does not ship it unnoticed. The fourth is a boundary rather than an
untouched debt:

| Pair | Light ratio |
|---|---|
| `.nav-count.is-crit`, `.btn-danger` on their tint over a card | 4.49 |
| `.btn-danger:hover` | 3.79 |
| `.tag-backend` on its tint | 4.46 |
| `.badge-crit` / `.badge-ok` / `.badge-warn` over the page background, on a page carrying neither scoped fix | 4.04 / 4.21 / 4.17 |

The last row is the badge fix's own boundary and is recorded rather than dropped, because the
darkened inks live in `operate.css` and in a rule scoped to two pages, so People and usage, Cloud
costs and Settings carry neither. Those panes avoid the row rather than inherit it: a status badge
on them goes inside a card, never loose on the page background, where it measures 4.67:1 or
better. The row closes for everyone on the day the tokens themselves are darkened, which is the
same day the three rules at the end of `operate.css` and the block at the end of `ops.css` are
deleted together.

Dark mode passes throughout and is untouched. Both badge overrides are scoped to
`[data-theme="light"]`, so the dark inks are the ones W1 shipped: over the same three surfaces
and the same 14% tint, the lowest of the four badges is `.badge-crit` on `--surface-2` at 5.200,
and `.badge-info` is the next at 5.457. Every other pairing is 5.657 or better.

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
