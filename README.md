# Review screenshots: Overview pane wired to /api/ops/summary

Evidence for the PR "Operations dashboard: wire the Overview figures to
/api/ops/summary". This is an orphan branch that carries images only, so the
pull request can show them inline without putting review artefacts on `main`.
Nothing here is served by the site and nothing here is merged. Delete the
branch once the review is over.

Each image is the Overview pane rendered against a stubbed
`GET /api/ops/summary` response shaped from the route source at
`Stadiora/Aria` commit `043ae369422750789a547ff733658966f91f88ba`.

| Branch of the contract | Dark, 1440 | Light, 1440 | 375px |
|---|---|---|---|
| Healthy | `healthy-dark.png` | `healthy-light.png` | `healthy-375.png` |
| `not_reporting` (people and activity) | `not-reporting-dark.png` | `not-reporting-light.png` | `not-reporting-375.png` |
| `insufficient` | `insufficient-dark.png` | `insufficient-light.png` | `insufficient-375.png` |
| Comparison absent, no reading before | `no-comparison-dark.png` | `no-comparison-light.png` | `no-comparison-375.png` |
| Comparison absent, past the retention horizon | `retention-dark.png` | `retention-light.png` | `retention-375.png` |
| Series with a `null` gap | `gap-dark.png` | `gap-light.png` | `gap-375.png` |
| Both omissions over figures that also have none | `omissions-dark.png` | `omissions-light.png` | `omissions-375.png` |
| Previous window under the reporting floor | `below-floor-dark.png` | `below-floor-light.png` | `below-floor-375.png` |
| Summary read failed, problems unaffected | `read-failed-dark.png` | `read-failed-light.png` | `read-failed-375.png` |
