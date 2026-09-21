# Fidelity audit: the built ops dashboard against the approved mocks

Measured 21 Sep 2026. Built side: `aria-website@483cccc`. Approved side:
`docs/mocks/ops-dashboard-v2/` at `Stadiora/Aria@main`, whose `review.html` is
the ten-pane contact sheet the user signed off.

This is a fidelity audit, not a pixel diff. The mocks are static HTML with
invented figures and the panes render real shapes, so an exact comparison would
be meaningless. What is compared is what is load-bearing: information hierarchy
and section order, what disappeared or arrived, the type scale, the colour
roles, and whether the four preview states still cohere.

**Nothing in this pass is a fix.** Every finding is reported for the owner to
decide on.

## How it was measured, and what the measurement cannot see

**The approved side is `docs/mocks/ops-dashboard-v2/` at `Stadiora/Aria@main`**,
not the tree as it stood when the user signed it off. That distinction is not
cosmetic: the mock set has itself been changed since approval, and an earlier
revision of this audit measured the older tree and published a colour finding
that is false of the mocks as they stand. See correction 9.

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
   themselves** — the first argument of every band call in each pane file —
   compared against the titles named inside the cannot-answer lists, which are a
   separate and opposite set. Note the call is not spelled the same everywhere,
   and a naive sweep is wrong in two different ways. `pane-users.js` uses
   `shell.band(`, so a grep for `S.band(` returns **nothing** for it.
   `pane-evaluations.js` also uses `shell.band(`, but only twice — at
   `:368` and `:375`, inside the `workingBand()` / `previewBand()` wrappers —
   and the first argument at both sites is the parameter `title`, not a literal.
   A sweep that reads first arguments therefore returns **two parameter names**
   for that pane, which is worse than nothing because it looks like an answer.
   Its real band titles are at the wrapper call sites (`:543`, `:550`, `:998`,
   `:1102`, `:1160`, `:1223`) and were read from there.
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
| Colour roles | **No drift.** Every shared role matches exactly, both themes. The mock's palette was itself fixed for AA, by `Stadiora/Aria#10042`. |
| Pane questions | **Nine of ten verbatim.** One changed. |
| Section hierarchy | **Divergence on 8 of 10 panes**; four of the eight acknowledge it on screen, four have no machinery to. |
| Preview states | **Coherent**, with one pane that ignores the control for a defensible reason. |
| Type identity | **Inert.** Both sheets ask for Geist; the built dashboard has never rendered in it. |

**On colour, the two sets have converged rather than drifted.** Every heading
role the audit samples resolves to an identical `rgb()` on both sides, in both
themes: band, hero and card titles at `rgb(232,238,246)` dark / `rgb(11,18,32)`
light, KPI labels at `rgb(126,141,163)` / `rgb(85,99,122)`, and the rose accent
at `rgb(251,113,133)` / `rgb(159,18,57)`.

That agreement is not an accident and it is worth stating, because the obvious
reading of the history is the opposite one. The approved set as signed off in
`Stadiora/Aria#9941` (18 Sep) carried a light palette that failed WCAG AA — its
secondary ink measured 3.05:1 to 3.43:1 across the four light surfaces. It was
fixed the next day, **in the mock set itself**, by `Stadiora/Aria#10042`,
*"make the v2 palette meet WCAG AA, with a rendered-pixel guard"*. The built
dashboard carries the same values. So the palette moved once, correctively, on
both sides, and there is nothing here to file.

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
arrived in three steps, not one. The first version of this document credited all
of it to PR #36; independent review showed that is wrong on both halves, and
`git log -S` gives the real trace:

| PR | what it did to the question |
|---|---|
| **#36** `a94025f` | added the **quarantine** tool, and set the question to *"Can this approved evidence enter private quarantine safely?"* — already off the approved one, but not today's wording |
| **#40** `9e90d42` | added the **dataset-declaration** tool and set the question **shipping today** |
| **#50** `1154673` | added the **qualified approval handoff** tool |

So no single PR moved the question to its current wording while adding three
tools. #36 displaced the approved question; #40 replaced #36's.

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
`find . -name "*.woff*"` both return nothing at `483cccc` — and its CSP sets
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
| Look up a user | One account / Recent activity / Subscription, support and consent / Danger zone | *not comparable* | all four present as `shell.band(...)` calls, one **renamed** to "Subscription and devices"; two **added** — "Matches" and "Access record" |
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

Of the eight diverging panes, **four say so on screen** — Overview, Happening
now, What happened, Aria quality — and **four carry none of the machinery at
all**: Problems (`pane-alerts.js`), People and usage (`pane-analytics.js`),
Cloud costs (`pane-spend.js`) and App releases (`pane-releases.js`). Settings is
the fifth file with machinery, and it does not diverge.

Problems is in the second group but files nothing here: its divergence is an
**addition** ("Closed, and how the watching is doing"), not a loss, so there is
nothing for it to acknowledge.

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

**1. The mock collapses at 375px; the built pane does not.** This is the clearest
single image in the audit, and the one place where the measurement is starker than
the screenshot. In the approved Overview at 375, the hero's resolved grid is:

| | approved mock | built pane |
|---|---|---|
| `getComputedStyle(.hero).gridTemplateColumns` | `279px 0px` | `46px 233px` |
| `.hero-title` box width | **0px** | 233px |
| `.hero-title` content width | 78px | 233px |
| `scrollWidth > clientWidth` | **true** | false |

The chips take 279px of the hero's 343px and **the title column resolves to
zero**. The title is not merely narrow, it has no box: 78px of text in a 0px
container. The built pane gives the orb its 46px and the title the remaining
233px, unclipped.

This is issue `Stadiora/Aria#10397`, and the approved mock is where it came from.
Measured with `hero375.mjs`, which reads the resolved track list rather than
`documentElement.scrollWidth` — the scroll width is blind here, because `.hero`
clips, so the document stays 375 either way.

**2. The mock cannot ship under the dashboard's CSP.** The eleven mock pages carry
677 inline `style=` attributes between them (676 across the ten panes, one in the
`review.html` contact sheet). The served dashboard sets a CSP with
no `'unsafe-inline'`, so a faithful port was never possible; every one of those
declarations had to become a class. The structural divergence in finding 4 is
partly the residue of that translation.

**3. The mock is off its own type scale in one place.** `evaluations.html` sets
`style="font-size:18px"` on a `.hero-title`, the only hero on either side not at
19px. The built pane is on-scale.

**4. Panes label what they cannot answer.** Nothing in the approved set does
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

A second review round then caught three more, two of which are worth recording
because they are failures of the *correction*, not of the original audit:

6. **One of the five fixes above was announced but never applied.** The edit was
   a silent no-op — the search text did not match the file's line wrapping — so
   the document asserted the wrong PR trace in finding 2 and retracted it in
   this list at the same time, and #10805's correction comment pointed at a
   document that still said the wrong thing. *A fix reported without being
   verified by content is indistinguishable from no fix.*
7. **The corrected count was itself miscounted.** Eight diverging panes minus
   four that acknowledge leaves four, not the three first written; Problems
   (`pane-alerts.js`) carries no machinery either. Its divergence is an addition
   rather than a loss, so it files nothing, but it belongs in the count.
8. The PR description still published five claims this document had retracted.

A third round then found the largest error of all, and it was in the audit's
**baseline** rather than in any single claim:

9. **The whole audit was run against the wrong copy of the approved mocks.** It
   served the review snapshot of `Stadiora/Aria#9941` — the set as the user saw
   it during approval — rather than `docs/mocks/ops-dashboard-v2/` at `main`.
   Every file in the mock set differs between the two. The consequence was a
   headline finding that was **false of the mocks as they stand**: the audit
   reported, in the present tense, that the approved light palette fails WCAG AA
   and that the built dashboard is better for having fixed it. In fact
   `Stadiora/Aria#10042` fixed the mock set itself on 19 Sep, two days before
   this audit ran, and the built dashboard and the approved mocks now carry
   **identical** inks.

   All 320 extractions were re-run against `main`. The correction is precisely
   bounded, and the bound was measured rather than assumed: the band-spine
   comparison is **byte-identical** between the two baselines, and no type size
   changed, so findings 1, 2, 4 and 5 and issues #10804, #10805 and #10807 are
   untouched. Exactly three colour readings and one mock hero string differ.
   The colour finding has been replaced by the convergence note in the summary.

   *A baseline is an input, and this audit never stated which one it used. It
   states it now, in the second paragraph, because every number below is a
   claim about a comparison and a comparison is only as identified as its two
   sides.*
