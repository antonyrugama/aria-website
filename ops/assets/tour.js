/* The guided tour: what every pane on this dashboard is for, and what each of
   its figures and controls means.

   Two ways in, both mounted by this file once the shell says the page is up
   (the ops:ready event), so the pane shell itself carries no tour code:

     "What am I looking at?"  a button in the top bar. Opens the steps for the
                              pane on screen, at any time.
     "Take the tour"          a block at the foot of the rail, which is the
                              drawer on a phone. Walks every pane the registry
                              declares, in the order it declares them, and
                              carries on to the next pane's page at the end of
                              each one.

   The steps are one table, TOUR below, keyed by the registry's pane keys. Each
   step names an anchor inside that pane's real markup: a selector the pane
   draws and, where one selector matches several things, the title the element
   carries. When the anchor is on screen the step outlines it, scrolls it into
   view, and reads what it currently says, so the words describe the figure the
   operator is looking at rather than a screenshot of one. When the anchor is
   not on screen the step says why that can happen, in the terms of the state
   the pane is in: still reading, empty, or not read. A missing anchor never
   throws.

   The tour explains and never does. Nothing here clicks a pane control,
   submits a form, or calls the server: the only request a step can make is to
   move to another pane's page, which is navigation and nothing more. Every
   action step says what the control does, who may use it, what gets recorded
   and what cannot be undone, and a step about a control the signed-in role may
   not use says so instead of pointing at something that is not there for them.

   Metric wording that has a definition of record is quoted from it, not
   paraphrased. DEFINITIONS carries each quote with the heading it sits under
   in the metric definitions document in the Aria monorepo and the commit it
   was copied at. The two repositories are separate, so nothing here can read
   that document; scripts/ops-tour-coverage.test.mjs holds every quote against a
   verbatim excerpt of it vendored at the same commit, which is what the pin
   can and cannot promise.

   Progress lives in localStorage under STORE_KEY: which pane and which step,
   whether the dialog was open, and whether the tour was dismissed or
   finished. Nothing else, and nothing read from the page, is stored.

   Public surface, read by the tests: window.OpsTour = { TOUR, DEFINITIONS,
   DEFINITION_SOURCE, STORE_KEY, stepsFor, findAnchor }. */
(function (global) {
  'use strict';

  var registry = global.OpsPaneRegistry;
  if (!registry) throw new Error('ops/assets/pane-registry.js must load before ops/assets/tour.js');
  var S = global.OpsPaneShell;
  if (!S) throw new Error('ops/assets/shell-pane-v2.js must load before ops/assets/tour.js');

  var session = global.OpsSession;
  var PANES = registry.PANES;
  var RANGES = registry.RANGES;
  var h = S.h;

  var STORE_KEY = 'ops-tour-progress';

  /* --------------------------------------------- definitions of record */

  /* Where every quote below was copied from. The excerpt this is held to is
     scripts/fixtures/ops-metric-definitions.excerpt.md. */
  var DEFINITION_SOURCE = {
    repository: 'Stadiora/Aria',
    path: 'docs/ops/operations-dashboard-metric-definitions.md',
    commit: '0545338a65255abbc30d902d556281996ea3357d'
  };

  var DEFINITIONS = {
    activeUser: {
      section: 'Active user',
      quote: 'One authenticated account with at least one telemetry event from a client app in ' +
        'the window, counted once per source app no matter how many devices it used.'
    },
    session: {
      section: 'Session',
      quote: 'Foreground activity from one account in one client app, with gaps under 30 ' +
        'minutes. A gap of more than 30 minutes starts a new session.'
    },
    comingBack: {
      section: 'Coming back',
      quote: 'Of the accounts that signed up in one week, how many were active again in a ' +
        'later week.'
    },
    featureUse: {
      section: 'Feature use',
      quote: "The share of that app's active users who opened the feature at least once in " +
        'the window.'
    },
    coverage: {
      section: 'Coverage',
      quote: 'The share of sessions on an app version that emit the event a metric needs.'
    },
    aiRuns: {
      section: 'Stored metrics',
      quote: 'Completed AI runs'
    }
  };

  /* ------------------------------------------------------------ the steps

     kind      intro | section | metric | action. An intro step is made from
               the registry for every pane and is not written here.
     anchor    { selector, title }. selector is a single compound selector;
               title, when given, is the text of the first heading inside the
               element (or a list of accepted texts), which picks one element
               out of several.
     body      what the step says whether or not the anchor is on screen
     live      (ctx) => a sentence about what the anchor reads right now, or
               '' when there is nothing worth quoting
     metric    { definition | counts, grain, source, healthy, worrying }
     action    { does, who, audited, undo }
     roles     the roles that may use what the step describes. Any other role
               gets the step's explanation plus a sentence saying it is not
               theirs to use, instead of a pointer at a control they do not
               have.
     missing   what to say when the anchor is not on screen, where the state
               of the pane is not the whole reason */

  var BAND_TITLES = '.band-title, .card-title, .kpi-label, .hero-title, .hunt-title, .state-title, .u-soon-title';

  var TOUR = {
    overview: [
      {
        id: 'overview-status', kind: 'section', title: 'The status line',
        anchor: { selector: '.hero' },
        body: 'The top of the page names the worst problem that is open right now and ' +
          'whether anybody has taken it on. The chips count what is open by severity and how ' +
          'many alert rules are able to check. When nothing is open it says that in words.',
        live: function (ctx) {
          var title = ctx.read('.hero-title');
          var sub = ctx.read('.hero-sub');
          return title ? 'Right now it reads: ' + title + (sub ? '. ' + sub : '') : '';
        },
        facts: [
          ['Where it comes from', 'The problems the alert rules have raised, read live.'],
          ['Looks healthy when', 'Nothing is open, or everything open has somebody on it.'],
          ['Worth a closer look when', 'A critical problem has nobody on it, or rules are ' +
            'not able to check.']
        ]
      },
      {
        id: 'overview-attention', kind: 'section', title: 'What needs a person',
        anchor: { selector: 'section', title: 'What needs a person' },
        body: 'Each entry is an open problem, worst first. Its buttons open the pane that ' +
          'owns the work, and taking a problem on happens on Problems, not here.',
        live: function (ctx) {
          var n = ctx.count('.q-item');
          return n ? 'It lists ' + plural(n, 'problem') + ' right now.' : '';
        }
      },
      {
        id: 'overview-active-people', kind: 'metric', title: 'Active people',
        anchor: { selector: '.kpi', title: 'Active people' },
        body: 'The definition below counts a person once per app, which is what the two app ' +
          'figures under the headline show. The headline goes one step further and counts ' +
          'each person once across both apps, so somebody who used both is one person. That ' +
          'is why the two app figures do not add up to it.',
        live: kpiLive,
        metric: {
          definition: 'activeUser',
          grain: 'Whole UTC days over the window the tile names, compared with the same ' +
            'length of window just before it.',
          source: 'Usage events the apps send, counted by the server. People who have not ' +
            'turned usage analytics on are never counted.',
          healthy: 'Steady or rising against the window before, on both apps.',
          worrying: 'A sharp drop, most of all on one app only: that app may have stopped ' +
            'sending anything, which Problems watches for.'
        }
      },
      {
        id: 'overview-ai-runs', kind: 'metric', title: 'Aria AI runs',
        anchor: { selector: '.kpi', title: 'Aria AI runs' },
        live: kpiLive,
        metric: {
          definition: 'aiRuns',
          grain: 'The window the tile names, compared with the window before it.',
          source: 'Every AI run Aria finishes, reported by the AI service when it ends.',
          healthy: 'It moves roughly with active people.',
          worrying: 'It falls while people stay steady, which can mean work is not getting ' +
            'through. What happened shows the runs themselves.'
        }
      },
      {
        id: 'overview-cloud-spend', kind: 'metric', title: 'Cloud spend',
        anchor: { selector: '.kpi', title: 'Cloud spend' },
        live: kpiLive,
        metric: {
          counts: 'What the cloud bill says has been spent so far this month. No budget is ' +
            'recorded anywhere, so there is no bar against one.',
          grain: 'Month to date, compared with the same days of last month. The bill arrives ' +
            'behind the day, and the tile says how far it has been billed.',
          source: "The cloud provider's billing export, collected by the server.",
          healthy: 'A small change against last month, or one that more use explains.',
          worrying: 'A rise with no rise in people or AI runs behind it. Cloud costs breaks ' +
            'the bill down.'
        }
      },
      {
        id: 'overview-app-version', kind: 'metric', title: 'App version in production',
        anchor: { selector: '.kpi', title: 'App version in production' },
        live: function (ctx) {
          var rows = ctx.readAll('.kpi-row');
          var why = ctx.read('.kpi-why');
          return rows.length ? 'It shows ' + rows.join(', ') + '.' + (why ? ' ' + why : '') : '';
        },
        metric: {
          counts: 'The build each store says is live on its production track.',
          grain: 'Current state, not a window. The stores are read on a schedule, and the ' +
            'tile says how long ago that was.',
          source: 'App Store Connect and Google Play.',
          healthy: 'Both stores show the build you expect and were read recently.',
          worrying: 'A store that has not been read for a long time, or a build you did not ' +
            'expect.'
        }
      },
      {
        id: 'overview-activity', kind: 'metric', title: 'People active over time',
        /* The pane titles this card by the grain the server sent: hourly from
           the newer usage window, daily from the older one it still reads. */
        anchor: { selector: '.card', title: ['People active each hour', 'People active each day'] },
        live: function (ctx) {
          var reads = ctx.readAll('.series-read');
          return reads.length ? 'The latest readings: ' + reads.join('; ') + '.' : '';
        },
        metric: {
          definition: 'activeUser',
          grain: 'One reading per completed UTC hour over the last 24 hours, or one per UTC ' +
            'day when the server sends the older daily window; the card title says which. One ' +
            'line per app, and a reading with nothing stored breaks the line rather than ' +
            'joining across it.',
          source: 'Usage events the apps send, counted by the server for each hour or each ' +
            'day the card shows.',
          healthy: 'A steady shape on both lines: a rhythm through the day on the hourly card, ' +
            'a steady level on the daily one.',
          worrying: 'A line that goes flat or stops. An app may have stopped sending data.'
        }
      },
      {
        id: 'overview-omissions', kind: 'section', title: 'Not drawn here, and why',
        anchor: { selector: '.card', title: 'Not drawn here, and why' },
        body: 'Figures the approved design asks for but nothing can supply yet are named here ' +
          'with the reason, rather than drawn as an empty chart or a zero.',
        live: function (ctx) {
          var names = ctx.readAll('.omit-title');
          return names.length ? 'Named right now: ' + names.join(', ') + '.' : '';
        }
      }
    ],

    jobs: [
      {
        id: 'jobs-right-now', kind: 'metric', title: 'Right now',
        anchor: { selector: 'section', title: 'Right now' },
        live: function (ctx) { return ctx.read('.page-sub'); },
        metric: {
          counts: 'Jobs in the queue this moment, by state: waiting, running and stopping.',
          grain: 'The present moment, not a window. The pane reads again every 15 seconds ' +
            'and stops while the tab is hidden.',
          source: 'The record the server keeps of every job Aria works on.',
          healthy: 'Work is running and little is waiting.',
          worrying: 'Waiting keeps growing while running stays flat. A count the server could ' +
            'not produce is shown as missing, never as zero.'
        }
      },
      {
        id: 'jobs-not-clearing', kind: 'metric', title: 'Not clearing',
        anchor: { selector: 'section', title: 'Not clearing' },
        live: function (ctx) {
          var names = ctx.readAll('.omit-title');
          return names.length ? 'It reads: ' + names.join('; ') + '.' : '';
        },
        metric: {
          counts: 'Runs the platform has lost, called given up on because the worker stopped ' +
            'reporting in, and runs taking far longer than usual for their kind, called overdue.',
          grain: 'Judged per kind of work against its own recent usual duration, over the ' +
            'jobs that were read. When not every job was read, the card says so.',
          source: 'The same job record as the counts above.',
          healthy: 'Nothing given up on and nothing overdue.',
          worrying: 'Either list growing. A given-up run is failed automatically at the next ' +
            'clean-up; an overdue run is still working and may need a look.'
        }
      },
      {
        id: 'jobs-lanes', kind: 'section', title: 'Lanes',
        anchor: { selector: 'section', title: 'Lanes' },
        body: 'Work is routed by what it needs, not by who asked for it. Each lane shows how ' +
          'much is waiting, running and stopping in it, and how long the oldest wait is.',
        live: function (ctx) {
          var names = ctx.readAll('.card-title');
          return names.length ? 'Lanes on screen: ' + names.join(', ') + '.' : '';
        }
      },
      {
        id: 'jobs-work', kind: 'section', title: 'The work itself',
        anchor: { selector: 'section', title: 'The work itself' },
        body: 'Every job in flight, oldest first, with how long it has waited, how long it has ' +
          'run, how long its kind usually takes, and a verdict: on time, overdue, or given up on.',
        live: function (ctx) {
          var n = ctx.count('tr') - 1;
          return n > 0 ? 'The table holds ' + plural(n, 'job') + ' right now.' : '';
        }
      },
      {
        id: 'jobs-cancel', kind: 'action', title: 'Cancel or stop a job',
        anchor: { selector: '.job-action-stack' },
        roles: ['owner', 'operator'],
        live: function (ctx) {
          var buttons = ctx.readAll('button');
          var reasons = ctx.readAll('.job-action-reason').map(function (r) {
            return r.replace(/\.$/, '');
          });
          var parts = [];
          if (buttons.length) parts.push('offers ' + buttons.join(' and '));
          if (reasons.length) parts.push('says ' + reasons.join('; '));
          return parts.length ? 'The first row ' + parts.join(', and ') + '.' : '';
        },
        body: 'Where a job can be changed, its row carries the button. Where it cannot, the row ' +
          'says why in words rather than showing a button that would be refused.',
        action: {
          does: 'Cancels a job that is still waiting, or asks a running one to stop at its ' +
            'next checkpoint.',
          who: 'Operators and owners, and only where the server offers it for that job.',
          audited: 'You type the job reference to confirm, and an audit entry is written ' +
            'when the change goes through.',
          undo: 'A cancelled job cannot be resumed. If the work is still needed it has to be ' +
            'asked for again.'
        },
        missing: 'No job on screen right now offers a change, so there is nothing to point at.'
      },
      {
        id: 'jobs-flowed', kind: 'metric', title: 'What has flowed',
        anchor: { selector: 'section', title: 'What has flowed' },
        live: function (ctx) {
          var tiles = ctx.readPairs('.kpi', '.kpi-label', '.kpi-val');
          return tiles.length ? 'On screen: ' + tiles.join('; ') + '.' : '';
        },
        metric: {
          counts: 'Jobs that finished over the window the band states, split by how they ended.',
          grain: 'A stated window, printed on the band, rather than the present moment.',
          source: 'The job record, which keeps every step a job took.',
          healthy: 'Most finished jobs completed.',
          worrying: 'Failures or cancellations climbing. What happened explains why runs failed.'
        }
      },
      {
        id: 'jobs-unanswered', kind: 'section', title: 'What this pane cannot answer yet',
        anchor: { selector: 'section', title: 'What this pane cannot answer yet' },
        body: 'Questions an operator will ask that nothing records yet, named instead of drawn ' +
          'as an empty figure.'
      }
    ],

    history: [
      {
        id: 'history-record', kind: 'metric', title: 'What the record shows',
        anchor: { selector: 'section', title: 'What the record shows' },
        live: function (ctx) {
          var tiles = ctx.readPairs('.kpi', '.kpi-label', '.kpi-val');
          return tiles.length ? 'On screen: ' + tiles.join('; ') + '.' : '';
        },
        metric: {
          counts: 'Runs that finished in the window: how many worked, failed and were ' +
            'cancelled, and how long half of them took and waited.',
          grain: 'The window in the filter bar. A figure nobody could measure says so rather ' +
            'than printing a number.',
          source: 'The record of every step each run took, kept by the server.',
          healthy: 'Failures are a small share of runs, and the time taken is steady.',
          worrying: 'Failures rising, or the time taken growing. The next band says why runs ' +
            'failed.'
        }
      },
      {
        id: 'history-failures', kind: 'metric', title: 'Why things failed',
        anchor: { selector: 'section', title: 'Why things failed' },
        live: function (ctx) {
          var n = ctx.count('tr') - 1;
          return n > 0 ? plural(n, 'reason') + ' in this window.' : '';
        },
        metric: {
          counts: 'Failures grouped by the reason the worker recorded, so a reason shows how ' +
            'often it happened rather than once per row.',
          grain: 'The same window as the figures above.',
          source: 'The failure reason recorded when a run ended.',
          healthy: 'Few reasons, each rare.',
          worrying: 'One reason accounting for most failures, or a new one appearing.'
        }
      },
      {
        id: 'history-runs', kind: 'section', title: 'The runs',
        anchor: { selector: 'section', title: 'The runs' },
        body: 'The newest runs in the window. Open shows the steps a run actually took, which ' +
          'is the one place a retry is visible as a retry.',
        live: function (ctx) {
          var n = ctx.count('tr') - 1;
          return n > 0 ? 'The table holds ' + plural(n, 'run') + ' right now.' : '';
        }
      },
      {
        id: 'history-retry', kind: 'action', title: 'Retry a failed run',
        anchor: { selector: 'section', title: 'The runs' },
        roles: ['owner', 'operator'],
        action: {
          does: 'Creates a new job for the same request, linked to the failed one. The failed ' +
            'run stays in the history.',
          who: 'Operators and owners, and only for failed runs the server says can be retried.',
          audited: 'You type the job reference to confirm, and an audit entry is written ' +
            'when the retry goes through.',
          undo: 'The new job cannot be taken back once it is created. While it waits, it can ' +
            'be cancelled from Happening now.'
        }
      },
      {
        id: 'history-reveal', kind: 'action', title: 'Reveal what was asked and answered',
        anchor: { selector: 'section', title: 'What was asked, and what Aria answered' },
        roles: ['owner'],
        body: 'What a person asked and what Aria answered stay out of the table. An owner can ' +
          'show the stored text for one opened run.',
        action: {
          does: 'Shows the stored request and answer for one opened run, as text on this page ' +
            'only.',
          who: 'Owners only, from an opened run, with a written reason of 10 to 500 characters ' +
            'and a fresh sign-in.',
          audited: 'Every reveal is recorded with who did it and the reason given.',
          undo: 'The record of the reveal stays. Hide content takes the text off the page, but ' +
            'it does not remove the record.'
        }
      },
      {
        id: 'history-unanswered', kind: 'section', title: 'What this pane cannot answer yet',
        anchor: { selector: 'section', title: 'What this pane cannot answer yet' },
        body: 'Questions the run record cannot answer yet, such as which app a run came from, ' +
          'named rather than left out without a word.'
      }
    ],

    alerts: [
      {
        id: 'alerts-status', kind: 'section', title: 'How many problems are open',
        anchor: { selector: '.hero' },
        body: 'The count of open problems and the worst of them. When a read came back full, ' +
          'every count reads as "at least", because the rest could not be fetched.',
        live: function (ctx) {
          var title = ctx.read('.hero-title');
          return title ? 'Right now it reads: ' + title + '.' : '';
        }
      },
      {
        id: 'alerts-open', kind: 'section', title: 'Open problems',
        anchor: { selector: 'section', title: 'Open problems' },
        body: 'Each problem says what tripped, how bad it is in a word as well as a colour, ' +
          'who has it, and where the work is. Details opens its runbook and timeline in place.',
        live: function (ctx) {
          var names = ctx.readAll('.p-title');
          return names.length ? 'Open right now: ' + names.join('; ') + '.' : '';
        }
      },
      {
        id: 'alerts-take-on', kind: 'action', title: 'Take a problem on',
        anchor: { selector: 'section', title: 'Open problems' },
        roles: ['owner', 'operator'],
        action: {
          does: 'Marks the problem as yours, with "I am on it", so everybody can see somebody ' +
            'has it.',
          who: 'Operators and owners.',
          audited: "Kept on the problem's timeline with your name and the time.",
          undo: 'It is not cleared from here. When the work is done, close the problem.'
        }
      },
      {
        id: 'alerts-close', kind: 'action', title: 'Close a problem',
        anchor: { selector: 'section', title: 'Open problems' },
        roles: ['owner', 'operator'],
        action: {
          does: 'Closes the problem with a note saying why.',
          who: 'Operators and owners.',
          audited: "The note and who closed it are kept on the problem's timeline.",
          undo: 'A closed problem is offered no control on this page, so it cannot be reopened ' +
            'here.'
        }
      },
      {
        id: 'alerts-rules', kind: 'action', title: 'What is being watched',
        anchor: { selector: 'section', title: 'What is being watched' },
        roles: ['owner'],
        body: 'Each alert rule, what it watches, the line it has to cross, and whether it could ' +
          'check the last time it ran. The switch turns a rule on or off.',
        live: function (ctx) {
          var n = ctx.count('tr') - 1;
          return n > 0 ? plural(n, 'rule') + ' on screen.' : '';
        },
        action: {
          does: 'Turning a rule off stops it raising problems. It keeps recording.',
          who: 'Owners only. Everybody else sees the true state of every rule.',
          audited: 'The server keeps the new state. This page shows the state, not a record ' +
            'of who changed it.',
          undo: 'A rule turned off can be turned back on. Anything it would have raised while ' +
            'it was off is not raised afterwards.'
        }
      },
      {
        id: 'alerts-closed', kind: 'metric', title: 'Closed, and how the watching is doing',
        anchor: { selector: 'section', title: 'Closed, and how the watching is doing' },
        metric: {
          counts: 'Problems recently closed, how many were opened and closed, how long it took ' +
            'to take one on, how often an alert was a false alarm, and where problems are sent.',
          grain: 'The window in the filter bar for the closed list; the watching figures cover ' +
            'the last fortnight.',
          source: 'The problems and the alert rules, read live.',
          healthy: 'Problems are taken on quickly and few are false alarms.',
          worrying: 'Slow to take on, many false alarms, or a destination that is failing to ' +
            'deliver.'
        }
      }
    ],

    analytics: [
      {
        id: 'analytics-active-people', kind: 'metric', title: 'Active people',
        anchor: { selector: '.kpi', title: 'Active people' },
        live: kpiLive,
        metric: {
          definition: 'activeUser',
          grain: 'Whole UTC days over the range in the filter bar, per app. The two apps are ' +
            'never added together.',
          source: 'Usage events the apps send. People who have not turned usage analytics on ' +
            'are never counted.',
          healthy: 'Steady or growing across the range.',
          worrying: 'A drop on one app only, which can mean that app stopped sending data.'
        }
      },
      {
        id: 'analytics-sessions', kind: 'metric', title: 'Sessions',
        anchor: { selector: '.kpi', title: 'Sessions' },
        live: kpiLive,
        metric: {
          definition: 'session',
          grain: 'Whole UTC days over the range, per app. A session counts on the day it started.',
          source: 'The timing of the usage events themselves.',
          healthy: 'It moves with active people.',
          worrying: 'Sessions falling faster than people, so each person is using the app less.'
        }
      },
      {
        id: 'analytics-sessions-per-person', kind: 'metric', title: 'Sessions per person',
        anchor: { selector: '.kpi', title: 'Sessions per person' },
        body: 'How many sessions each active person had, on average. The definition below ' +
          'is of one session, the thing being averaged.',
        live: kpiLive,
        metric: {
          definition: 'session',
          grain: 'Sessions divided by active people over the same range and app. Withheld when ' +
            'too few people are behind it.',
          source: 'The two counts above.',
          healthy: 'Steady from one range to the next.',
          worrying: 'A fall with no change to the app, which can mean people are giving up sooner.'
        }
      },
      {
        id: 'analytics-feature', kind: 'metric', title: 'Opened a feature',
        anchor: { selector: '.kpi', title: 'Opened a feature' },
        live: kpiLive,
        metric: {
          definition: 'featureUse',
          grain: "The range in the filter bar, measured against that app's own active people. " +
            'Withheld when too few people are behind it.',
          source: 'Feature events from app versions that report them.',
          healthy: 'Most active people open at least one feature.',
          worrying: 'A low share on a version that reports feature use.'
        }
      },
      {
        id: 'analytics-growing', kind: 'metric', title: 'Is that growing',
        anchor: { selector: 'section', title: 'Is that growing' },
        metric: {
          definition: 'activeUser',
          grain: 'One point per UTC day, one line per app. A day with no stored reading breaks ' +
            'the line rather than joining across it.',
          source: 'The same count as the Active people tile.',
          healthy: 'Lines that are level or rising, with a weekly rhythm.',
          worrying: 'A gap, or one line falling while the other holds.'
        }
      },
      {
        id: 'analytics-coming-back', kind: 'metric', title: 'Do people come back',
        anchor: { selector: 'section', title: 'Do people come back' },
        metric: {
          definition: 'comingBack',
          grain: 'Signup weeks down the side, later weeks across. A week a group has not reached ' +
            'yet is left blank rather than shown as zero.',
          source: 'Account creation and later usage events, per app.',
          healthy: 'Each newer group comes back about as well as the ones before it.',
          worrying: 'Newer groups coming back less than older ones did at the same age.'
        }
      },
      {
        id: 'analytics-features', kind: 'metric', title: 'Most used features',
        anchor: { selector: '.card', title: 'Most used features' },
        live: function (ctx) {
          var n = ctx.count('tr') - 1;
          return n > 0 ? 'The list holds ' + plural(n, 'feature') + ' right now.' : '';
        },
        metric: {
          definition: 'featureUse',
          grain: "The range in the filter bar, each feature against its own app's active people.",
          source: 'Feature events from app versions that report them.',
          healthy: 'The features you expect near the top.',
          worrying: 'A feature everybody relies on falling down the list.'
        }
      },
      {
        id: 'analytics-coverage', kind: 'metric', title: 'Which versions report',
        anchor: { selector: '.card', title: 'Which versions report' },
        metric: {
          definition: 'coverage',
          grain: 'Per app version over the range, as a share of that app\'s sessions.',
          source: 'Sessions, and whether each one sent a feature event.',
          healthy: 'Every version people use reports.',
          worrying: 'A version many people use that does not report, which makes feature ' +
            'figures look lower than they are.'
        }
      },
      {
        id: 'analytics-unanswered', kind: 'section', title: 'What this pane cannot answer yet',
        anchor: { selector: 'section', title: 'What this pane cannot answer yet' },
        body: 'Questions about usage that nothing records yet, named instead of drawn as a ' +
          'confident figure.'
      }
    ],

    spend: [
      {
        id: 'spend-total', kind: 'metric', title: 'What this period cost',
        anchor: { selector: 'section', title: 'What this period cost' },
        live: function (ctx) {
          var total = ctx.read('.sp-total');
          var billed = ctx.readAll('.pill');
          return total ? 'The total reads ' + total + (billed.length ? ' (' + billed.join('; ') + ')' : '') + '.' : '';
        },
        metric: {
          counts: 'What the cloud bill says has been spent over the period in the filter bar, ' +
            'and a forecast to the end of the period at the same daily rate.',
          grain: 'The period in the filter bar, compared with the same point of the one before. ' +
            'The bill arrives behind the day, and the band says how far it has been billed.',
          source: "The cloud provider's billing export, collected by the server.",
          healthy: 'A small change against the period before, or one that more use explains.',
          worrying: 'A forecast well above the last period with no growth in use behind it.'
        }
      },
      {
        id: 'spend-target', kind: 'section', title: 'Against the monthly target',
        anchor: { selector: '.card', title: 'Against the monthly target' },
        body: 'No budget is recorded anywhere, so there is nothing to draw against. The card ' +
          'says so rather than drawing a bar against a target that does not exist.'
      },
      {
        id: 'spend-where', kind: 'metric', title: 'Where the money goes',
        anchor: { selector: 'section', title: 'Where the money goes' },
        live: function (ctx) {
          var names = ctx.readAll('.sp-name');
          return names.length ? 'Largest first: ' + names.slice(0, 3).join(', ') + '.' : '';
        },
        metric: {
          counts: 'The same bill cut by what the money is for, or by resource group. Every cut ' +
            'adds up to the billed total, and the card says whether it does.',
          grain: 'The period in the filter bar.',
          source: 'The billing export, sorted into the categories an owner maps in Settings.',
          healthy: 'The cut reconciles to the total and the largest share is the one you expect.',
          worrying: 'A large share marked as not grouped, or a gap between the cut and the total.'
        }
      },
      {
        id: 'spend-daily', kind: 'metric', title: 'Day by day',
        anchor: { selector: 'section', title: 'Day by day, and what Azure calls it' },
        metric: {
          counts: 'Spend for each billed day of this period against the one before, and the ' +
            'bill again by the cloud provider\'s own service names.',
          grain: 'One point per billed day. A day past the end of what was billed breaks the ' +
            'line rather than joining across it.',
          source: 'The billing export.',
          healthy: 'The two lines follow each other.',
          worrying: 'A step up that stays up, or one service growing on its own.'
        }
      },
      {
        id: 'spend-unanswered', kind: 'section', title: 'What this pane cannot answer yet',
        anchor: { selector: 'section', title: 'What this pane cannot answer yet' },
        body: 'Questions about cost that nothing records yet, such as spend per app. A shared ' +
          'bill split by app would be an invented number, so it is named instead.'
      }
    ],

    evals: [
      {
        id: 'evals-browse', kind: 'section', title: 'Browse Ciel scenarios and coverage',
        anchor: { selector: 'section', title: 'Browse Ciel scenarios and coverage' },
        body: 'A read-only view of the Ciel scenario catalogue, its datasets and its coverage. ' +
          'The filters narrow what the server returns. No prompt or production content is ' +
          'shown, and each coverage count carries its own denominator, so a gap stays visible.'
      },
      {
        id: 'evals-validate', kind: 'action', title: 'Check a dataset declaration',
        anchor: { selector: 'section', title: 'Check a dataset declaration' },
        action: {
          does: 'Checks a synthetic dataset declaration you paste and answers with its digests ' +
            'or the fields that are wrong.',
          who: 'Any signed-in role.',
          audited: 'Nothing is stored. The check reads what you pasted and nothing else.',
          undo: 'Nothing to undo: it changes nothing.'
        }
      },
      {
        id: 'evals-quarantine', kind: 'action', title: 'Put evidence into quarantine',
        anchor: { selector: 'section', title: 'Put evidence into quarantine' },
        roles: ['owner', 'operator'],
        action: {
          does: 'Sends one file into private quarantine. Quarantine is not approval, and it ' +
            'does not let anybody use the file.',
          who: 'Operators and owners. The server decides whether quarantine is available at all.',
          audited: 'The server keeps the quarantine record. The page shows its receipt, never ' +
            'the file.',
          undo: 'This page has no control to take a file back out of quarantine.'
        }
      },
      {
        id: 'evals-approval', kind: 'section', title: 'Qualified approval handoff',
        anchor: { selector: 'section', title: 'Qualified approval handoff' },
        body: 'Requesting, looking up and deciding an approval. The page submits exactly what ' +
          'you enter and shows what the server answers. Under the recorded decision, approval ' +
          'stays closed until an outside body can confirm who is qualified, and this page ' +
          'cannot grant that.'
      },
      {
        id: 'evals-admit', kind: 'action', title: 'Admit synthetic evidence',
        anchor: { selector: 'section', title: 'Admit synthetic evidence' },
        roles: ['owner'],
        action: {
          does: 'Admits one approved synthetic file and returns a receipt. It grants no access ' +
            'and no permission to train on or export anything.',
          who: 'Owners only, with a fresh sign-in.',
          audited: 'The server records the admission and returns the receipt.',
          undo: 'This page has no control to reverse an admission.'
        }
      },
      {
        id: 'evals-drawn', kind: 'section', title: 'The scoring harness is not built yet',
        anchor: { selector: '.preview' },
        missing: 'The drawing of the scoring pane is not on screen, so there is nothing to ' +
          'point at.',
        body: 'Everything below the banner is the agreed layout for a scoring tool that does ' +
          'not exist yet. Every figure in it was made up to draw the layout, and each band is ' +
          'stamped to say so. Nothing there is a measurement.'
      }
    ],

    releases: [
      {
        id: 'releases-status', kind: 'section', title: 'The production build',
        anchor: { selector: '.hero' },
        body: 'The build the stores say is live in production, and anything that needs a look ' +
          'before it is.',
        live: function (ctx) {
          var title = ctx.read('.hero-title');
          return title ? 'Right now it reads: ' + title + '.' : '';
        }
      },
      {
        id: 'releases-where', kind: 'metric', title: 'Where each app is',
        anchor: { selector: 'section', title: 'Where each app is' },
        metric: {
          counts: 'For each store, which build is on each track, in the order builds are ' +
            'promoted, and how far a staged rollout has gone.',
          grain: 'Current state, not a window. A store that could not be read keeps its last ' +
            'rows and says when it was last read.',
          source: 'App Store Connect and Google Play, read by the server on a schedule. A ' +
            'store with no connection says so rather than showing an empty ladder.',
          healthy: 'Builds move up the tracks in order, and both stores were read recently.',
          worrying: 'A store that has not been read for a long time, or a rollout that stalls.'
        }
      },
      {
        id: 'releases-versions', kind: 'metric', title: 'Who is on which version',
        anchor: { selector: 'section', title: 'Who is on which version' },
        metric: {
          counts: 'What people actually have, from the apps\' own usage, beside what the stores ' +
            'say is on each track. The two are never merged.',
          grain: 'Recent usage for the versions, current state for the stores.',
          source: 'Usage events for what people have; the stores for what is published.',
          healthy: 'Most people are on the newest build soon after it ships.',
          worrying: 'Many people stuck on an old version.'
        }
      },
      {
        id: 'releases-health', kind: 'metric', title: 'Is the newest one healthy',
        anchor: { selector: 'section', title: 'Is the newest one healthy' },
        metric: {
          counts: 'The newest build compared with the one before it, figure by figure.',
          grain: 'Whatever each row states, per platform.',
          source: 'The store and usage readings above.',
          healthy: 'The newest build is as good as or better than the last.',
          worrying: 'A row where the newest build is clearly worse.'
        }
      },
      {
        id: 'releases-unanswered', kind: 'section', title: 'What this pane cannot answer yet',
        anchor: { selector: 'section', title: 'What this pane cannot answer yet' },
        body: 'This pane is read only. Starting, pausing or resuming a rollout is not here at ' +
          'all, because the dashboard can only read the stores. What it cannot answer yet is ' +
          'named in this band.'
      }
    ],

    users: [
      {
        id: 'users-find', kind: 'action', title: 'Find one account',
        anchor: { selector: '.hunt' },
        action: {
          does: 'Finds one account by an exact identifier. There is no browsing, no list and no ' +
            'near match, so a wrong guess tells you nothing about who has an account.',
          who: 'Anybody who can open this pane. The server can still refuse.',
          audited: 'Every lookup is recorded with the reason you type, in a form that would be ' +
            'safe to show the athlete.',
          undo: 'A lookup cannot be taken off the record.'
        }
      },
      {
        id: 'users-matches', kind: 'section', title: 'Matches',
        anchor: { selector: 'section', title: 'Matches' },
        body: 'The accounts matching exactly what you typed. Personal details are masked.',
        missing: 'Nothing has been looked up yet, so there are no matches to point at. They ' +
          'appear here after a lookup.'
      },
      {
        id: 'users-account', kind: 'section', title: 'One account',
        anchor: { selector: 'section', title: 'One account' },
        body: 'The account you opened. Personal fields are hidden for every role, the owner ' +
          'included, and a missing flag is read as hidden.',
        missing: 'No account is open, so there is nothing to point at yet.'
      },
      {
        id: 'users-reveal', kind: 'action', title: 'Reveal a personal field',
        anchor: { selector: '.card', title: 'Revealing a personal field' },
        roles: ['owner'],
        action: {
          does: 'Shows one hidden field in the clear for a short time, then hides it again. ' +
            'Health data carries no reveal at all, for any role.',
          who: 'Owners only, with a written reason.',
          audited: 'Recorded by field name, never by value, with your reason. The athlete can ' +
            'see that it happened and who did it.',
          undo: 'The field hides itself again, but the record of the reveal stays and a reveal ' +
            'cannot erase it.'
        },
        missing: 'No account is open, so there is no field to point at yet.'
      },
      {
        id: 'users-activity', kind: 'section', title: 'Recent activity',
        anchor: { selector: 'section', title: 'Recent activity' },
        body: 'What the account has done, as a list of events. What anybody wrote or was told ' +
          'is never shown here, at any role.',
        missing: 'No account is open, so there is no activity to point at yet.'
      },
      {
        id: 'users-subscription', kind: 'section', title: 'Subscription and devices',
        anchor: { selector: 'section', title: 'Subscription and devices' },
        body: 'The plan the account is on and the devices it has used.',
        missing: 'No account is open, so there is nothing to point at yet.'
      },
      {
        id: 'users-access', kind: 'section', title: 'Who has looked',
        anchor: { selector: 'section', title: 'Access record' },
        body: 'Every lookup and reveal of this account, with who did it and why. It outlives ' +
          'every reveal and nothing on this page can remove an entry.',
        missing: 'No account is open, so there is no record to point at yet.'
      },
      {
        id: 'users-danger', kind: 'section', title: 'Danger zone',
        anchor: { selector: 'section', title: 'Danger zone' },
        body: 'Actions that cannot be reversed are named here, not performed here. Deleting an ' +
          'account or wiping its data runs through the account deletion process, which needs ' +
          "the athlete's own confirmation.",
        missing: 'No account is open, so there is nothing to point at yet.'
      }
    ],

    settings: [
      {
        id: 'settings-status', kind: 'section', title: 'Who can get in',
        anchor: { selector: '.hero' },
        body: 'How many people can sign in to this dashboard. There are three fixed roles: ' +
          'owner, operator and viewer, and no custom permissions.',
        live: function (ctx) {
          var title = ctx.read('.hero-title');
          return title ? 'Right now it reads: ' + title + '.' : '';
        }
      },
      {
        id: 'settings-revoke-access', kind: 'action', title: 'Revoke an administrator\'s access',
        anchor: { selector: 'section', title: 'Administrators' },
        roles: ['owner'],
        body: 'Every account that can sign in, with its role, when it last signed in, and when ' +
          'its current session ends. Accounts come from outside this pane; there is no invite ' +
          'here.',
        action: {
          does: "Ends every live session for that account. They lose the dashboard on their " +
            'next request and sign in again. Their account and role are left alone.',
          who: 'Owners only.',
          audited: 'You write a reason, and it is recorded against your name. The access ' +
            'record reloads beside the change.',
          undo: 'Ended sessions cannot be brought back. The person signs in again.'
        }
      },
      {
        id: 'settings-revoke-session', kind: 'action', title: 'Revoke a session',
        anchor: { selector: 'section', title: 'Active sessions' },
        roles: ['owner'],
        body: 'Every live session: who holds it, when it started, when it was last used and ' +
          'when it ends. Sessions end at a hard limit, not after a spell of doing nothing.',
        action: {
          does: 'Ends one session. That browser is signed out on its next request.',
          who: 'Owners only.',
          audited: 'You write a reason, and it is recorded against your name.',
          undo: 'An ended session cannot be brought back. Its holder signs in again.'
        }
      },
      {
        id: 'settings-access-record', kind: 'section', title: 'Access record',
        anchor: { selector: 'section', title: 'Access record' },
        body: 'Every privileged action, newest first. The record is append only: nothing on ' +
          'this pane can edit or delete an entry, the owner included. Export writes a copy of ' +
          'what is loaded, which is what the button says.',
        live: function (ctx) {
          var n = ctx.count('tr') - 1;
          return n > 0 ? plural(n, 'entry', 'entries') + ' loaded right now.' : '';
        }
      },
      {
        id: 'settings-sign-in-windows', kind: 'action', title: 'Sign-in windows',
        anchor: { selector: '.card', title: 'Sign-in windows' },
        roles: ['owner'],
        action: {
          does: 'Sets how long a session can last and how recently a password must have been ' +
            'typed before a privileged action.',
          who: 'Owners only.',
          audited: 'The change is recorded, and the access record reloads beside it.',
          undo: 'Shortening the session limit ends sessions older than the new limit on their ' +
            'next request, and asks first. Lengthening it does not extend sessions already live.'
        }
      },
      {
        id: 'settings-retention', kind: 'action', title: 'Data retention',
        anchor: { selector: '.card', title: 'Data retention' },
        roles: ['owner'],
        body: 'How long each kind of record is kept. Some windows are fixed by policy, and they ' +
          'say why: they record who looked at an athlete.',
        action: {
          does: 'Changes how many days a configurable record is kept.',
          who: 'Owners only. Shortening needs the confirmation phrase typed exactly.',
          audited: 'The change is recorded, and the access record reloads beside it.',
          undo: 'Shortening deletes the older rows at the next nightly clean-up. It is not a ' +
            'filter, and deleted rows cannot be brought back.'
        }
      },
      {
        id: 'settings-cost-categories', kind: 'action', title: 'Cost categories',
        anchor: { selector: '.card', title: 'Cost categories' },
        roles: ['owner'],
        action: {
          does: 'Maps a line of the cloud bill to one of the categories Cloud costs uses, for ' +
            'one resource group or everywhere.',
          who: 'Owners only.',
          audited: 'The change is recorded, and the access record reloads beside it. If the ' +
            'mapping changed elsewhere first, the card reloads instead of saving.',
          undo: 'Nothing is lost: a mapping can be changed back, and Use default removes it.'
        }
      },
      {
        id: 'settings-integrations', kind: 'section', title: 'Outside connections',
        anchor: { selector: 'section', title: 'Integrations' },
        body: 'The outside services the dashboard reads from, whether each is connected, and ' +
          'when it last succeeded.'
      }
    ]
  };

  /* --------------------------------------------------------- reading text */

  /* The text a node reads, descendants included. textContent would do in a
     browser; the fake DOM the tests use keeps an element's own text apart from
     its children's, so this walks. */
  function textOf(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';
    var kids = node.childNodes || [];
    if (!kids.length) return node.textContent || '';
    var out = '';
    for (var i = 0; i < kids.length; i++) out += ' ' + textOf(kids[i]);
    return out;
  }

  var QUOTE_LIMIT = 140;

  /* What a step may repeat from the page: whitespace folded, contact details
     masked, and cut short so a long cell cannot take the dialog over. */
  function quote(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    t = registry.maskContactDetails(t) || '';
    return t.length > QUOTE_LIMIT ? t.slice(0, QUOTE_LIMIT - 1) + '…' : t;
  }

  function list(nodes) { return Array.prototype.slice.call(nodes || []); }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  /* A figure tile: its value, the line under it that says what it is compared
     with or which app it is, and the window it names. */
  function kpiLive(ctx) {
    var val = ctx.read('.kpi-val');
    if (!val) return '';
    var meta = ctx.read('.kpi-meta');
    var why = ctx.read('.kpi-why').replace(/\.$/, '');
    return 'This tile reads ' + val + (meta ? ' (' + meta + ')' : '') +
      (why ? ', for ' + lowerFirst(why) : '') + '.';
  }

  function lowerFirst(s) {
    return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  }

  /* ----------------------------------------------------------- anchoring */

  function appRoot() {
    return document.getElementById('app') || document.body;
  }

  /* An element inside a preview state that is not the one on screen is not
     what the operator is looking at, even though it is in the document. */
  function isShown(el) {
    for (var n = el; n && n.getAttribute; n = n.parentNode) {
      if (n.getAttribute('data-state') !== null && n.getAttribute('data-shown') === null) {
        return false;
      }
    }
    return true;
  }

  function titleOf(el) {
    var t = el.querySelector(BAND_TITLES);
    return t ? quote(textOf(t)) : '';
  }

  /* The element a step points at, or null. Never throws: a selector the page
     cannot parse is a missing anchor, not a broken tour. */
  function findAnchor(anchor, root) {
    if (!anchor || !anchor.selector) return null;
    var found;
    try {
      found = list((root || appRoot()).querySelectorAll(anchor.selector));
    } catch (e) {
      return null;
    }
    for (var i = 0; i < found.length; i++) {
      if (!isShown(found[i])) continue;
      if (anchor.title && [].concat(anchor.title).indexOf(titleOf(found[i])) < 0) continue;
      return found[i];
    }
    return null;
  }

  function context(el) {
    return {
      el: el,
      read: function (sel) {
        var n = el && el.querySelector(sel);
        return n ? quote(textOf(n)) : '';
      },
      readAll: function (sel) {
        return el ? list(el.querySelectorAll(sel)).map(function (n) {
          return quote(textOf(n));
        }).filter(Boolean) : [];
      },
      readPairs: function (sel, labelSel, valueSel) {
        return el ? list(el.querySelectorAll(sel)).map(function (n) {
          var l = n.querySelector(labelSel);
          var v = n.querySelector(valueSel);
          return l && v ? quote(textOf(l)) + ' ' + quote(textOf(v)) : '';
        }).filter(Boolean) : [];
      },
      count: function (sel) { return el ? el.querySelectorAll(sel).length : 0; }
    };
  }

  /* Which of the four states the pane's own region is showing. A pane that
     draws no region reads as live. */
  function paneState() {
    var content = document.getElementById('content');
    if (!content) return 'live';
    var shown = list(content.querySelectorAll('[data-shown]')).filter(function (el) {
      return el.getAttribute('data-state') !== null;
    })[0];
    if (!shown) return 'live';
    var states = (shown.getAttribute('data-state') || '').split(/\s+/);
    if (states.indexOf('loading') !== -1) return 'loading';
    if (states.indexOf('empty') !== -1) return 'empty';
    return shown.querySelector('.state-block') && !shown.querySelector('section') ? 'failed' : 'live';
  }

  var STATE_NOTES = {
    loading: 'This part is not on screen yet because the pane is still reading. Close this ' +
      'guide and open it again once the pane has loaded to see it pointed out.',
    empty: 'This part is not on screen because the read came back with nothing to show. The ' +
      'card on the page says which kind of nothing it is.',
    failed: 'This part is not on screen because the pane could not be read. Nothing is a ' +
      'zero: the figures are unread, not absent. Try again from the card on the page.',
    live: 'This part is not on screen right now. A part of a pane is left out when the read ' +
      'behind it came back empty or could not be read, and the pane says so where it would ' +
      'have been.'
  };

  /* ------------------------------------------------------------- roles */

  function role() {
    return session && typeof session.role === 'function' ? session.role() : null;
  }

  function hasRole(roles) {
    if (!roles) return true;
    if (session && typeof session.hasRole === 'function') return session.hasRole(roles);
    return roles.indexOf(role()) !== -1;
  }

  var ROLE_WORDS = { owner: 'owner', operator: 'operator', viewer: 'viewer' };

  function roleWord(r) { return ROLE_WORDS[r] || 'signed-in'; }

  function roleList(roles) {
    var words = roles.map(roleWord);
    if (words.length === 1) return 'the ' + words[0] + ' role';
    return 'the ' + words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1] + ' roles';
  }

  function deniedNote(roles) {
    return 'This is limited to ' + roleList(roles) + '. You are signed in as ' +
      roleWord(role()) + ', so it is not yours to use and the page does not offer it to you. ' +
      'What it does is explained here so you know what to ask an owner for.';
  }

  /* ------------------------------------------------------------ the steps */

  function paneOrder() { return Object.keys(PANES); }

  function rangeWords(pane, filters) {
    if (!pane.range || !filters || !filters.range) return '';
    var label = RANGES[filters.range];
    return label ? 'The Range control is set to ' + label + '. ' : '';
  }

  /* Every pane opens on a step made from its registry entry, so a pane added
     to the registry is described by its own question the day it lands. */
  function introStep(paneId) {
    var pane = PANES[paneId];
    return {
      id: paneId + '-intro', kind: 'intro', title: pane.label,
      /* The title and the question under it, as one block: outlining the
         heading alone drew the line through the question (Stadiora/Aria#12913). */
      anchor: { selector: '.page-head' },
      live: function () {
        var filters = S.filters ? S.filters() : null;
        var words = 'This pane answers: ' + pane.question + ' ' + rangeWords(pane, filters);
        if (pane.scope) {
          words += 'The App control narrows it to one app; the two apps are never added ' +
            'together. ';
        }
        if (pane.env) words += 'The Env control switches between production and staging. ';
        [pane.scopeNote, pane.filterNote].forEach(function (note) {
          if (note) words += 'The filter bar says: ' + note + '. ';
        });
        return words.trim();
      },
      body: ''
    };
  }

  /* A pane the signed-in role may not open. The shell draws a refusal card in
     its place, and the tour explains that card and what is behind it rather
     than pointing at controls that are not there. */
  function deniedPaneStep(paneId) {
    var pane = PANES[paneId];
    var behind = (TOUR[paneId] || []).map(function (s) { return s.title; });
    return {
      id: paneId + '-denied', kind: 'section', title: 'Why this pane is closed to you',
      anchor: { selector: '.state-block' },
      body: pane.label + ' is limited to ' + roleList(pane.roles) + '. You are signed in as ' +
        roleWord(role()) + ', so the page shows a refusal instead of the pane. The server ' +
        'refuses the same reads whatever this page draws.' +
        (behind.length ? ' What is behind it: ' + behind.join(', ') + '.' : ''),
      denied: true
    };
  }

  function stepsFor(paneId) {
    var pane = PANES[paneId];
    if (!pane) return [];
    if (pane.roles && !hasRole(pane.roles)) return [introStep(paneId), deniedPaneStep(paneId)];
    return [introStep(paneId)].concat(TOUR[paneId] || []);
  }

  /* ------------------------------------------------------------ progress */

  function blank() {
    return {
      version: 1,
      tour: { pane: null, step: 0, open: false, dismissed: false, finished: false },
      guide: { pane: null, step: 0, open: false }
    };
  }

  function stepNumber(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  /* Whatever is in storage is read defensively: a key another version wrote,
     or one edited by hand, falls back to no progress rather than a throw. */
  function loadProgress() {
    var p = blank();
    var raw = null;
    try { raw = JSON.parse(global.localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return p;
    var t = raw.tour || {};
    var g = raw.guide || {};
    if (PANES[t.pane]) {
      p.tour.pane = t.pane;
      p.tour.step = stepNumber(t.step);
      p.tour.open = t.open === true;
      p.tour.dismissed = t.dismissed === true;
    }
    p.tour.finished = t.finished === true;
    if (PANES[g.pane]) {
      p.guide.pane = g.pane;
      p.guide.step = stepNumber(g.step);
      p.guide.open = g.open === true;
    }
    return p;
  }

  function saveProgress(p) {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* not kept */ }
  }

  /* -------------------------------------------------------------- dialog */

  var active = null;
  var guideButton = null;
  var railBlock = null;

  function currentPane() {
    return document.body ? document.body.getAttribute('data-pane') : null;
  }

  function focusable(root) {
    return list(root.querySelectorAll('button')).filter(function (el) { return !el.disabled; });
  }

  function isLiveRegion(el) {
    return el.hasAttribute('aria-live') || el.classList.contains('toast-host');
  }

  function clearHighlight() {
    if (active && active.highlighted) {
      active.highlighted.removeAttribute('data-tour-anchor');
      active.highlighted = null;
    }
  }

  function facts(pairs) {
    var dl = h('dl', { className: 'tour-facts' });
    pairs.forEach(function (pair) {
      if (!pair[1]) return;
      dl.appendChild(h('dt', { className: 'tour-fact-term', text: pair[0] }));
      dl.appendChild(h('dd', { className: 'tour-fact-text', text: pair[1] }));
    });
    return dl;
  }

  function metricFacts(m) {
    var def = m.definition ? DEFINITIONS[m.definition] : null;
    return facts([
      ['What it counts', def ? def.quote : m.counts],
      ['Grain and window', m.grain],
      ['Where it comes from', m.source],
      ['Looks healthy when', m.healthy],
      ['Worth a closer look when', m.worrying]
    ]);
  }

  function actionFacts(a) {
    return facts([
      ['What it does', a.does],
      ['Who may do it', a.who],
      ['What gets recorded', a.audited],
      ['What cannot be undone', a.undo]
    ]);
  }

  function nextPane(paneId) {
    var order = paneOrder();
    var at = order.indexOf(paneId);
    return at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  }

  function render() {
    var a = active;
    var step = a.steps[a.index];
    var pane = PANES[a.paneId];
    clearHighlight();

    var el = findAnchor(step.anchor);
    if (el) {
      el.setAttribute('data-tour-anchor', '');
      a.highlighted = el;
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
    }

    a.kicker.textContent = (a.mode === 'tour' ? 'Tour: ' : '') + pane.label + ', step ' +
      (a.index + 1) + ' of ' + a.steps.length;
    a.title.textContent = step.title;
    while (a.body.firstChild) a.body.removeChild(a.body.firstChild);

    var live = '';
    if (el && typeof step.live === 'function') {
      try { live = step.live(context(el)) || ''; } catch (e) { live = ''; }
    }
    if (live) a.body.appendChild(h('p', { className: 'tour-live', text: live }));
    if (step.body) a.body.appendChild(h('p', { className: 'tour-lead', text: step.body }));
    if (step.metric) a.body.appendChild(metricFacts(step.metric));
    if (step.action) a.body.appendChild(actionFacts(step.action));
    if (step.facts) a.body.appendChild(facts(step.facts));

    var denied = step.roles && !hasRole(step.roles);
    if (denied) a.body.appendChild(h('p', { className: 'tour-note', text: deniedNote(step.roles) }));
    else if (!el && !step.denied) {
      a.body.appendChild(h('p', {
        className: 'tour-note', text: step.missing || STATE_NOTES[paneState()] || STATE_NOTES.live
      }));
    }

    var last = a.index === a.steps.length - 1;
    var following = a.mode === 'tour' ? nextPane(a.paneId) : null;
    a.back.disabled = a.index === 0;
    a.next.textContent = !last ? 'Next'
      : a.mode === 'guide' ? 'Done'
        : following ? 'Next: ' + PANES[following].label : 'Finish';

    S.announce('Step ' + (a.index + 1) + ' of ' + a.steps.length + ', ' + pane.label + ': ' +
      step.title + '.');
    remember(true);
  }

  /* Writes where the dialog is. open is whether it should come back after a
     reload. */
  function remember(open) {
    var a = active;
    var p = loadProgress();
    if (a.mode === 'tour') {
      p.tour = { pane: a.paneId, step: a.index, open: open, dismissed: !open, finished: false };
    } else {
      p.guide = { pane: a.paneId, step: a.index, open: open };
    }
    saveProgress(p);
  }

  function go(index) {
    var a = active;
    var from = document.activeElement;
    a.index = Math.max(0, Math.min(index, a.steps.length - 1));
    render();
    if (!from || from.disabled || !a.node.contains(from)) a.next.focus();
  }

  function onNext() {
    var a = active;
    if (a.index < a.steps.length - 1) { go(a.index + 1); return; }
    if (a.mode === 'guide') {
      var done = loadProgress();
      done.guide = { pane: a.paneId, step: 0, open: false };
      saveProgress(done);
      teardown(true);
      return;
    }
    var following = nextPane(a.paneId);
    var p = loadProgress();
    if (following) {
      p.tour = { pane: following, step: 0, open: true, dismissed: false, finished: false };
      saveProgress(p);
      teardown(false);
      var href = S.paneHref(following);
      if (href) global.location.assign(href);
      return;
    }
    p.tour = { pane: null, step: 0, open: false, dismissed: false, finished: true };
    saveProgress(p);
    teardown(true);
    refreshRail();
  }

  /* Close and Escape. The tour is dismissed rather than forgotten: its place
     is kept, and the rail offers to resume it. */
  function dismiss() {
    remember(false);
    teardown(true);
    refreshRail();
  }

  function teardown(restoreFocus) {
    var a = active;
    if (!a) return;
    clearHighlight();
    document.removeEventListener('keydown', a.onKey, true);
    a.inerted.forEach(function (was) {
      if ('inert' in was.el) was.el.inert = was.inert;
      if (was.hidden === null) was.el.removeAttribute('aria-hidden');
      else was.el.setAttribute('aria-hidden', was.hidden);
    });
    a.node.remove();
    active = null;
    if (!restoreFocus) return;
    var back = a.opener && a.opener.parentNode && typeof a.opener.focus === 'function'
      ? a.opener : guideButton;
    if (back && typeof back.focus === 'function') back.focus();
  }

  function openDialog(mode, index, opener) {
    var paneId = currentPane();
    if (!PANES[paneId]) return null;
    if (active) teardown(false);

    var kicker = h('p', { className: 'tour-kicker' });
    var title = h('h2', { className: 'tour-title', id: 'tourTitle' });
    var body = h('div', { className: 'tour-body', id: 'tourBody' });
    var close = h('button', { className: 'btn', type: 'button', text: 'Close' });
    var back = h('button', { className: 'btn', type: 'button', text: 'Back' });
    var next = h('button', { className: 'btn btn-primary', type: 'button', text: 'Next' });
    var card = h('div', { className: 'modal-card tour-card' }, [
      kicker, title, body,
      h('div', { className: 'tour-nav' }, [close, h('div', { className: 'tour-nav-gap' }), back, next])
    ]);
    var node = h('div', {
      className: 'modal tour-modal', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'tourTitle', 'aria-describedby': 'tourBody', tabindex: '-1'
    }, [card]);

    document.body.appendChild(node);
    var inerted = [];
    list(document.body.children).forEach(function (el) {
      if (el === node || isLiveRegion(el)) return;
      inerted.push({ el: el, inert: 'inert' in el ? el.inert : false, hidden: el.getAttribute('aria-hidden') });
      if ('inert' in el) el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    });

    function onKey(e) {
      if (!active || active.node !== node) return;
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
      if (e.key !== 'Tab') return;
      var items = focusable(node);
      if (!items.length) { e.preventDefault(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      var at = document.activeElement;
      var inside = at && node.contains(at) && at !== node;
      if (e.shiftKey && (!inside || at === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || at === last)) { e.preventDefault(); first.focus(); }
    }

    active = {
      mode: mode, paneId: paneId, steps: stepsFor(paneId), index: 0,
      node: node, kicker: kicker, title: title, body: body, back: back, next: next,
      opener: opener || null, inerted: inerted, onKey: onKey, highlighted: null
    };
    active.index = Math.max(0, Math.min(stepNumber(index), active.steps.length - 1));

    close.addEventListener('click', function () { dismiss(); });
    back.addEventListener('click', function () { go(active.index - 1); });
    next.addEventListener('click', function () { onNext(); });
    document.addEventListener('keydown', onKey, true);

    render();
    next.focus();
    return active;
  }

  /* ------------------------------------------------------------ entries */

  function openGuide(opener) {
    var p = loadProgress();
    var paneId = currentPane();
    openDialog('guide', p.guide.pane === paneId ? p.guide.step : 0, opener);
  }

  /* The drawer rail traps focus and inerts the page while it is open, which
     would fight a dialog opened from inside it. It is closed first, through its
     own toggle, and focus then comes back to that toggle. */
  function closeDrawer() {
    var rail = document.getElementById('rail');
    var toggle = document.getElementById('railToggle');
    if (rail && toggle && rail.classList.contains('is-open') && typeof toggle.click === 'function') {
      toggle.click();
      return toggle;
    }
    return null;
  }

  function startTour(fromStart, opener) {
    var p = loadProgress();
    var target = fromStart || p.tour.finished || !p.tour.pane ? paneOrder()[0] : p.tour.pane;
    var step = fromStart || p.tour.finished || !p.tour.pane ? 0 : p.tour.step;
    if (target === currentPane()) {
      var back = closeDrawer();
      openDialog('tour', step, back || opener);
      return;
    }
    p.tour = { pane: target, step: step, open: true, dismissed: false, finished: false };
    saveProgress(p);
    var href = S.paneHref(target);
    if (href) global.location.assign(href);
  }

  function refreshRail() {
    if (!railBlock) return;
    var p = loadProgress();
    while (railBlock.firstChild) railBlock.removeChild(railBlock.firstChild);
    var inProgress = p.tour.pane && !p.tour.finished;
    var main = h('button', {
      className: 'btn btn-sm tour-start', type: 'button',
      text: inProgress ? 'Resume the tour' : p.tour.finished ? 'Take the tour again' : 'Take the tour'
    });
    main.addEventListener('click', function () { startTour(false, main); });
    var row = h('div', { className: 'tour-rail-row' }, [main]);
    if (inProgress) {
      var over = h('button', { className: 'btn btn-sm btn-ghost', type: 'button', text: 'Start over' });
      over.addEventListener('click', function () { startTour(true, over); });
      row.appendChild(over);
    }
    railBlock.appendChild(row);
    railBlock.appendChild(h('p', {
      className: 'tour-rail-note',
      text: inProgress
        ? 'Stopped at ' + PANES[p.tour.pane].label + ', step ' + (p.tour.step + 1) + '.'
        : 'Every pane, what each figure means, and what each control does.'
    }));
  }

  function mountEntries() {
    var end = document.querySelector('.topbar-end');
    if (end && !guideButton) {
      guideButton = h('button', {
        className: 'btn btn-ghost tour-entry', type: 'button',
        'aria-label': 'What am I looking at?'
      }, [S.icon('info'), h('span', { className: 'tour-entry-label', text: 'What am I looking at?' })]);
      guideButton.addEventListener('click', function () { openGuide(guideButton); });
      var theme = document.getElementById('themeBtn');
      if (theme && theme.parentNode === end) end.insertBefore(guideButton, theme);
      else end.appendChild(guideButton);
    }
    var rail = document.getElementById('rail');
    if (rail && !railBlock) {
      railBlock = h('div', { className: 'tour-rail' });
      var foot = rail.querySelector('.rail-foot');
      if (foot) rail.insertBefore(railBlock, foot);
      else rail.appendChild(railBlock);
      refreshRail();
    }
  }

  /* A dialog that was open when the page went away comes back on the page it
     was open on: a reload, or the tour carrying on to the next pane. A
     dismissed tour never reopens by itself. */
  function resume() {
    var p = loadProgress();
    var paneId = currentPane();
    if (p.tour.open && !p.tour.dismissed && p.tour.pane === paneId) {
      openDialog('tour', p.tour.step, null);
    } else if (p.guide.open && p.guide.pane === paneId) {
      openDialog('guide', p.guide.step, null);
    }
  }

  global.addEventListener('ops:ready', function () {
    mountEntries();
    resume();
  });

  global.OpsTour = {
    TOUR: TOUR,
    DEFINITIONS: DEFINITIONS,
    DEFINITION_SOURCE: DEFINITION_SOURCE,
    STORE_KEY: STORE_KEY,
    stepsFor: stepsFor,
    findAnchor: findAnchor
  };
})(window);
