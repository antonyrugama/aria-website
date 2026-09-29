<!-- A verbatim excerpt, not a summary.

source repository: Stadiora/Aria
source path: docs/ops/operations-dashboard-metric-definitions.md
source commit: 0545338a65255abbc30d902d556281996ea3357d
source sha256: 78b14b4202309958f0ccbe04684d6596e3b49234c3d93e077314ed8fb40145af

Each heading below is a heading in the source, and the lines under it are
copied from under that heading unchanged: the first paragraph of each glossary
term, and for Stored metrics the table header and the one row the tour quotes.
Only what ops/assets/tour.js quotes is copied, so the rest of that document
(storage, retention sweeps, configuration) is not published from this
repository. scripts/ops-tour-coverage.test.mjs holds every quote in DEFINITIONS
against this file and the commit above against DEFINITION_SOURCE. To move the pin,
re-copy these paragraphs from the source at the new commit, update the
four source lines, and let that test say which quotes no longer match. -->

### Active user

One authenticated account with at least one telemetry event from a client app in the window,
counted once per source app no matter how many devices it used.

### Session

Foreground activity from one account in one client app, with gaps under 30 minutes. A gap of
more than 30 minutes starts a new session. Session length is the time from the session's first
event to its last.

### Coming back

Of the accounts that signed up in one week, how many were active again in a later week.

### Feature use

The share of that app's active users who opened the feature at least once in the window.

### Coverage

The share of sessions on an app version that emit the event a metric needs.

## Stored metrics

| Metric key | Dimension | App version | Meaning |
|---|---|---|---|
| `ai_runs` | AI outcome type | none | Completed AI runs |
