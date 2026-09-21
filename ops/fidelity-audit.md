# Fidelity audit: the built ops dashboard against the approved mocks

Measured 21 Sep 2026 against `54a8c42`, comparing the ten built panes with the
approved mock set (`docs/mocks/ops-dashboard-v2/` in the monorepo, whose
`review.html` is the ten-pane contact sheet the user signed off).

This is a fidelity audit, not a pixel diff. The mocks are static HTML with
invented figures and the panes render real shapes, so an exact comparison would
be meaningless. What is compared is what is load-bearing: information hierarchy
and section order, what disappeared or arrived, the type scale, the colour
roles, and whether the four preview states still cohere.

**Nothing in this pass is a fix.** Every finding is reported for the owner to
decide on.

## How it was measured, and what the measurement cannot see

Both sides were booted over HTTP in headless Chrome at 1280 and 375, in both
themes, and forced into the same preview state before extraction — the mocks
through `localStorage['aria-ops-state']`, the built panes through
`Aria.applyState`. 320 extractions in total (10 panes x 2 themes x 2 widths x 2
sides x 4 states). Section spines were read from the rendered DOM rather than
from source, and type and ink were read from `getComputedStyle` on elements that
actually carry glyphs.

Three limits, stated up front because they change how two of the findings should
be read:

1. **`/api/ops/usage` and `/api/ops/costs` are answered empty by the shipped
   stub, deliberately.** `scripts/ops-api-stub.mjs` says so in prose, and
   `scripts/check-ops-narrow-overflow.mjs` repeats it: People and usage draws its
   no-data card and Cloud costs draws the card for a period that has not
   published. Every in-repo checker therefore measures those two panes empty. To
   get a real rendering this audit supplied its own populated fixtures, held in
   the audit harness and never in the repo. **A section that rendered under that
   fixture is proof it exists. A section that did not render is not proof it is
   gone** — it may only mean the fixture did not carry the field. Every absence
   claimed below was therefore confirmed a second way, against the built pane
   source.

   That second check was originally a plain text search for the approved label,
   and **independent review showed a plain text search is unsound in one
   direction.** `"The runs"` matches `pane-run-history-v2.js:685`, but that line
   is `title: 'The runs themselves'` *inside* the band `What this pane cannot
   answer yet` — the pane naming the thing it cannot draw. A substring cannot
   tell "this band exists" from "this band is listed as one that does not". The
   first version of this document published that false presence.

   The determinations below are therefore taken from **the rendered band calls
   themselves** — the first argument of every `S.band(...)` in each pane file —
   compared against the titles named inside the cannot-answer lists, which are a
   separate and opposite set.
2. **Look up a user could not be rendered at all.** The pane reads
   `/api/ops/users/lookup` and `/api/ops/users/<id>`, neither of which the stub
   serves, and it draws nothing until a search is submitted. Inventing a fixture
   here would have meant reporting the audit's own shape as the product's, so
   the pane is reported as **not comparable under the shipped fixture**. All
   four of its approved bands exist as `band(...)` calls in `pane-users.js`, with
   one renamed: "Subscription, support and consent" ships as **"Subscription and
   devices"**.
3. **Comparisons are of structure, not of figures.** The mock's numbers are
   invented and the panes' numbers are real; no figure is compared to a figure.

## Summary

| | |
|---|---|
| Type scale | **No drift.** Identical on both sides, both themes. |
| Colour roles | **Changed, and the change is corrective.** The mock's own light-theme secondary ink fails WCAG AA. |
| Pane questions | **Nine of ten verbatim.** One changed. |
| Section hierarchy | **Divergence on 8 of 10 panes**; four of the eight acknowledge it on screen, three have no machinery to. |
| Preview states | **Coherent**, with one pane that ignores the control for a defensible reason. |
| Type identity | **Inert.** Both sheets ask for Geist; the built dashboard has never rendered in it. |

The headline is that most of what left the built dashboard left because **no
route serves it**, and on four of the eight diverging panes the pane says so in a
band of its own rather than inventing a figure. That is a materially different situation from design
drift, and it points at backend work rather than at the stylesheets.

## Findings

### 1. Overview lost "What Aria has been doing" with no acknowledgement — the one silent loss

The approved Overview ends with three bands. The built pane has two, and the
band that carries the most information on the dashboard's primary pane is gone:
**"What Aria has been doing"**, a table of every request type over the last 24
hours — Training programs, Chat replies, Nutrition plans, Sprint video analysis,
Coach note summaries — with requests, worked-first-time, slowest 5%, cost, and a
through-the-day sparkline for each. Five rows, six columns, and the only place in
the approved design where cost and reliability appear per request type.

`pane-overview.js` renders exactly two bands — `S.band('What needs a person')`
and `S.band('How things are going')` — and the string "What Aria has been doing"
appears nowhere in it. Two further approved cards on the same pane are also
absent: **"Budget"** and **"Where the money goes"**. (Cloud costs has its own
band named "Where the money goes"; what is gone is Overview's copy of it.)

What makes this the notable one is the contrast with its own neighbours. The
built Overview is one of five pane files carrying acknowledgement machinery: it
has a card headed **"Not drawn here, and why"**. In the audit's fixture that
card named one omission, the budget bar. The request-type table is not named
there, and nothing else on the pane mentions it.

Two qualifications, both of which narrow the claim:

- That card is **driven by gaps the API response declares**, not by a fixed list
  the pane holds. So "it named one omission" is a fact about the fixture, and a
  different response could name others. What is durable is that the mechanism
  exists on this pane, and that no code path adds the request-type table to it.
- Three other approved elements are also absent without acknowledgement — see
  finding 4 and #10807 — but they are on panes (`pane-analytics.js`,
  `pane-spend.js`, `pane-releases.js`) that carry **no** acknowledgement
  machinery at all.

So the precise claim is: **Overview is the only silent loss on a pane that
already had the means to say so and did not use it.**

**Filed as [Stadiora/Aria#10804](https://github.com/Stadiora/Aria/issues/10804).**

### 2. Aria quality no longer answers the question it was approved to answer

The mock set's README opens its product rules with *"each pane owns one
question"*, and each pane prints its question under its title. Nine of the ten
are verbatim identical between mock and built. The tenth is not:

| | |
|---|---|
| Approved | *Is Aria giving better or worse answers than before?* |
| Built | *Can I validate dataset declarations or quarantine evidence?* |

Extracted from the `sub:` argument to `Aria.boot(...)` in each mock page and
from `question:` in `ops/assets/pane-registry.js`, compared verbatim: **9 of 10
identical, evaluations the only difference.**

The label and the sidebar slot are unchanged, so nothing signals the change. It
was traced to PR #36 (`a94025f`, "feat(ops): add Ciel evidence quarantine
pane"), which added three working tool sections to the pane and moved the
question to describe them.

The approved question is still answered — "How good are the answers", "What
regressed" and "Can 1.2.0 ship" all survive, below the new tools — but it is now
the pane's second subject rather than its first.

**Filed as [Stadiora/Aria#10805](https://github.com/Stadiora/Aria/issues/10805).**

### 3. The type identity is declared but never loads

Both stylesheets declare the same stack:

```
'Geist', 'Inter Tight', 'Inter', -apple-system, system-ui, sans-serif
```

The mocks load Geist and Geist Mono from Google Fonts, so the approved design
was reviewed in Geist. The built dashboard ships **no `@font-face` rule, no font
link, and no font file** — `grep -rl "@font-face" ops/` and
`find . -name "*.woff*"` both return nothing at `54a8c42` — and its CSP sets
`font-src 'self'`. Every named family therefore falls through to the system
default.

Measured with `CSS.getPlatformFontsForNode` on the elements that actually carry
glyphs:

| element | approved mock | built today |
|---|---|---|
| `.hero-title` | Geist | .SF NS |
| `.band-title` | Geist | .SF NS |
| `.card-title` | Geist | .SF NS |
| `.mono` | Geist Mono | Menlo |

The sizes, weights and spacing are all faithful — this is purely the typeface.
It is the single largest reason the built dashboard does not *read* as the
approved design even where it is structurally identical, and because the stack
resolves silently it has never produced an error.

**Filed as [Stadiora/Aria#10806](https://github.com/Stadiora/Aria/issues/10806).**

### 4. Eight panes diverge structurally, and four of them say so on screen

Section spines, dark theme at 1280, live state:

| pane | approved | built | verdict |
|---|---|---|---|
| Overview | Today at a glance / What is happening / What Aria has been doing | What needs a person / How things are going | renamed + **one silent loss** (finding 1) |
| Happening now | Right now / The three lanes / Every open job | Right now / Waiting, and whether it is clearing / Flowing, and failing / Open elsewhere / **What this pane cannot answer yet** | acknowledged (two of the five bands need data the audit fixture did not supply) |
| What happened | Why things failed / The runs / Run `run_9f31c2` | What the record shows / Why things failed / What was asked, and what Aria answered / **What this pane cannot answer yet** | acknowledged; "The runs" is **absent**, and named in the cannot-answer band as *"No route lists runs"* |
| Problems | Open problems / What is being watched | + Closed, and how the watching is doing | **addition** |
| People and usage | Who is using Aria / Is that growing / Do people come back / Where people are, and what they do | Who is using Aria / Is that growing / Do people come back / **What people do** | the approved band held two cards; **"What people do" ships as its own band**, the "Where people are" region table is absent and unacknowledged |
| Cloud costs | Where the money goes / The same bill, two other ways / Top services, and anything unusual | What this period cost / Where the money goes / Day by day, and what Azure calls it | reorganised; "Anything unusual" absent |
| Aria quality | How good are the answers / What regressed / Can 1.2.0 ship | + three tool bands above them | **addition** (finding 2) |
| App releases | Where each app is / Who is on which version / Is the newest one healthy / What is in 1.1.2 | first three only | "What is in 1.1.2" absent |
| Look up a user | One account / Recent activity / Subscription, support and consent / Danger zone | *not comparable* | all four present as band calls; one **renamed** to "Subscription and devices" |
| Settings | Administrators / Active sessions / **Audit log** / What we keep / Integrations | …/ **Access record** / … | one rename, order intact |

The pattern worth naming: **Happening now** is missing the most against its mock
— the three lanes, the per-job table, and cancel/retry/export — and it devotes a
band to explaining precisely that, naming each gap and its cause:

> **The jobs themselves.** No route lists jobs, so there is no per-job table, no
> lane, no age per job and no retry count. What is above is what a rule reported,
> which is a narrower thing.
>
> **How many are running or queued.** Nothing serves a count of either. A tile
> reading zero and a tile with nothing behind it look identical, so neither is
> drawn.
>
> **Cancel, retry and export.** The approved design offers all three. Nothing
> serves a route behind any of them, and a control that cannot succeed says the
> thing is within reach.

Settings does the same with a **"No API yet"** pill and a hatched panel on each
section it cannot fill. Aria quality does it twice over, tagging each section
either **"WORKS NOW"** or **"INVENTED FIGURES"** under a banner reading *"The
scoring harness is not built yet."*

So the honest summary of the structural divergence is: **the approved design
asked for more than the API can currently answer, and most panes chose to say so
rather than to invent it.** The gap is a backend gap wearing a design gap's
clothes.

Which panes have the machinery is the dividing line. Searching for any of the
four acknowledgement idioms returns five pane files:

```
$ for s in "What this pane cannot answer yet" "Not drawn here, and why" \
           "No API yet" "Invented figures"; do grep -rlF "$s" ops/assets/*.js; done
ops/assets/pane-jobs-live-v2.js
ops/assets/pane-run-history-v2.js
ops/assets/pane-overview.js
ops/assets/settings.js
ops/assets/pane-evaluations.js
```

`pane-analytics.js`, `pane-spend.js` and `pane-releases.js` carry none of it. Of
the eight diverging panes, **four say so on screen** — Overview, Happening now,
What happened, Aria quality. Settings has the machinery but does not diverge.
The remaining three have neither.

**Filed as [Stadiora/Aria#10807](https://github.com/Stadiora/Aria/issues/10807)**
— the absences with no route and no acknowledgement, on the three panes with no
machinery: the **"Where people are"** region table (People and usage, *not* the
whole approved band — its other card, "What people do", ships as a band of its
own), **"Anything unusual"** (Cloud costs), and **"What is in 1.1.2"** (App
releases).

### 5. The preview states are coherent

Band counts agree between mock and built across all four states: both sides
render bands in `live` and `degraded`, and both collapse to skeletons or empty
cards in `loading` and `empty`. No pane renders a populated band in a state that
should be empty.

One pane ignores the control: **Aria quality** renders the same six bands in all
four states. That is correct rather than broken — its top half is three
interactive tools that read no data, and its bottom half is explicitly labelled
invented. There is no data for a state to vary.

## Where the built dashboard is better than the mock

The brief asked for this explicitly, and it is not a short list.

**1. The mock's light theme fails WCAG AA; the built dashboard passes.** The
secondary ink used for every supporting line and label:

The light theme has four surfaces this ink can sit on, so the ratio is a range,
not a number. Measured against each:

| surface | token | mock `rgb(124,140,161)` | built `rgb(85,99,122)` |
|---|---|---|---|
| `#FFFFFF` | `--surface` | 3.43:1 | 6.08:1 |
| `#F7FAFD` | `--surface-2` | 3.27:1 | 5.81:1 |
| `#F4F7FB` | `--bg` | 3.19:1 | 5.66:1 |
| `#EDF2F8` | `--surface-3` | 3.05:1 | 5.40:1 |

**The mock's secondary ink fails AA on every surface in its own light theme**,
and white is the most favourable of the four — quoting only the white figure
would have flattered it. The built ink passes on all four.

The rose accent moved the same way, `rgb(225,29,72)` to `rgb(159,18,57)`: 4.70:1
to 8.02:1 on white, and 4.17:1 to 7.12:1 on `--surface-3`. Restoring the mock's
palette would reintroduce a measured accessibility defect across all ten panes.

**2. The mock collapses at 375px; the built pane does not.** This is the clearest
single image in the audit. In the approved Overview at 375, the status banner's
title is crushed into a column roughly 30px wide and reads vertically as
"All sys no…", because the chips beside it claim the row's width. The built pane
renders the same hero cleanly at full width. This is issue #10397, and the mock
is where it came from.

**3. The mock cannot ship under the dashboard's CSP.** The ten mock pages carry
672 inline `style=` attributes between them. The served dashboard sets a CSP with
no `'unsafe-inline'`, so a faithful port was never possible; every one of those
declarations had to become a class. The structural divergence in finding 4 is
partly the residue of that translation.

**4. The mock is off its own type scale in one place.** `evaluations.html` sets
`style="font-size:18px"` on a `.hero-title`, the only hero on either side not at
19px. The built pane is on-scale.

**5. Panes label what they cannot answer.** Nothing in the approved set does
this. "No API yet", "What this pane cannot answer yet", "Not drawn here, and
why" and "INVENTED FIGURES" are all inventions of the build, and they are the
reason this audit could tell a missing route from a design regression at all. A
mock that invents figures and a pane that labels them are not the same artifact,
and the second is the one you want in front of somebody during an incident.

## What this audit did not cover

- **Look up a user**, for the reason in limit 2 above.
- **Spacing rhythm** was not measured directly. Type scale and section order
  were, and both agree; a margin-level comparison against invented content would
  not have been meaningful.
- **Absence claims for People and usage and Cloud costs** rest on the pane
  source rather than on rendering, because the shipped fixture cannot populate
  those panes (limit 1). They are taken from the `S.band(...)` calls, not from a
  text search — see the note under limit 1 for why that distinction is the whole
  of it.
- **Two of Happening now's five bands** ("Waiting, and whether it is clearing",
  "Open elsewhere") never rendered under the audit's fixture, so their content
  was not compared. They exist; they are not evidence either way.

## Corrections made after independent review

The first published version of this document carried five claims that did not
survive review, all of one class — a determination not connected to what the
search actually found. They are listed here rather than quietly edited, because
the method failure is more useful than the conclusions:

1. **"The runs" reported present.** It is absent; the only match was the pane
   naming it as unservable. This is what forced the switch from text search to
   reading the band calls.
2. **"Where people are, and what they do" reported wholly absent.** Half of it,
   "What people do", ships as its own band. #10807 was rescoped; as first filed
   it would have sent somebody to rebuild shipping code.
3. **"The only approved element that disappeared without the product saying
   so"** — three others did, on panes with no acknowledgement machinery.
4. **"Six panes diverge, five say so on screen"** — eight and four, and the six
   contradicted this document's own summary table.
5. **The whole Aria quality change credited to PR #36.** It took three PRs
   (#36, #40, #50), and the question shipping today came from #40.
