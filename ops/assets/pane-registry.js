/* The pane registry: the one place that knows what a pane is called, what
   question it owns, which filters are real for it, which roles may open it,
   and which delivery wave builds it.

   This used to live inside assets/shell.js. It moved out when the v2 shell
   arrived: a pane page boots one pane shell, more than one exists here, and
   a second copy of this table is the one way a pane page could start
   disagreeing with the rail about its own name, its own question, or which
   roles may open it. Whichever pane shell a page boots reads this file; no
   shell declares a pane. How many there are, and which panes are on which,
   are deliberately not written: a population not written cannot go stale.

   Loaded before whichever shell a page uses. A page that loads a shell and not
   this file throws at boot rather than rendering a shell with no panes in it;
   scripts/ops-shell-pane-v2.test.mjs asserts the pairing across every page in
   ops/ so that a missing tag is caught here rather than in production.

   Public surface: window.OpsPaneRegistry = { PANES, GROUPS, WAVES, RANGES,
   SCOPES, ENVS }. Everything on it is read-only by convention; nothing mutates
   it. */
(function (global) {
  'use strict';

  /* wave       which delivery slice builds the pane's contents
     scope      the All / Mobile / Coaches Web control applies
     scopeNote  shown in the filter bar where the absence needs explaining
     range      false, or the list of ranges this pane offers
     env        the production / staging control applies
     filterNote shown in the filter bar for a control a built pane cannot yet
                honour, so the absence is stated rather than faked
     roles      roles allowed to open the pane at all, omitted means everyone
     railId     the id this pane answers to in the v2 rail, which assets/aria.js
                declares and this file cannot edit. It is written out per pane
                rather than derived because one of them differs from the key
                here (evals answers to quality), and a rule with an exception is
                a lookup table wearing a disguise. scripts/ops-shell-pane-v2.test.mjs checks every one of
                them against aria.js's own list, so the pair cannot drift.

     A pane that has been built declares only the filters its own reads can act
     on. A control that changes nothing is worse than no control: picking
     Staging and being left looking at production, with the selection sitting
     in the bar as though it had been applied, is the failure mode that matters
     here. The same goes for one value inside a list: a window whose only
     outcome is a refusal card is an option in name only, which is why no pane
     below offers 'custom' even though RANGES still names it.

     Where a filter is in the approved design but nothing can carry it yet,
     filterNote says so where the control would have been.

     scripts/ops-registry-filters.test.mjs holds this to the panes themselves.
     It boots every pane that declares a filter, once per value the registry
     offers, and reads back the call the pane made, so a filter declared here
     that never reaches a read, and a value whose only answer is a refusal,
     both turn it red. Declaring one is therefore a claim about behaviour
     rather than a line in a table. That file's own header states what it does
     not cover and where uncovered claims are held instead; this comment does
     not repeat it, because a copy of a coverage map goes stale the day the
     map moves and nothing turns red when it does. */
  var WAVES = {
    W2: 'Operate panes',
    W3: 'Understand panes',
    W4: 'Ship and support panes',
    W5: 'Settings pane'
  };

  var RANGES = {
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days',
    '14d': 'Last 14 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    'month': 'This month',
    'last-month': 'Last month',
    '3m': 'Last 3 months',
    '12m': 'Last 12 months',
    'open': 'Open now',
    'custom': 'Custom'
  };

  var PANES = {
    overview: {
      file: 'index.html', icon: 'overview', label: 'Overview', group: 'Right now',
      railId: 'overview',
      question: 'Are people using it, is it working, is anything urgent?',
      /* Everything Overview draws today is the state of things right now,
         across every app, in production. None of the three controls can be
         carried into the read that answers it. */
      wave: 'W2', scope: false, range: false, env: false,
      filterNote: 'App, range and environment filters do not apply here yet'
    },
    jobs: {
      file: 'jobs-live.html', icon: 'live', label: 'Happening now', group: 'Right now',
      railId: 'jobs',
      question: 'What is Aria working on, and is anything stuck?',
      /* The pane now reads GET /api/ops/jobs, and none of the three controls
         survives the change either. The job lifecycle record is keyed by job
         type rather than by app, so no app narrows it; it is written by
         production workers only, so an environment control has one answer; and
         a range control would contradict the page, which is the present tense
         and always covers exactly now. A control that cannot reach the read
         behind it says the narrowing is available when it is not, which is the
         same defect as a button with no route. The note below is what is
         actually true about them. */
      wave: 'W2', scope: false, range: false, env: false,
      filterNote: 'The job lifecycle record is kept per job type and is written by production ' +
        'workers only, so there is no app or environment filter'
    },
    history: {
      file: 'run-history.html', icon: 'history', label: 'What happened', group: 'Right now',
      railId: 'history',
      question: 'Why did this fail, and is it happening to other people?',
      /* The window is real: the pane applies it to the problems that came
         back, and every figure is labelled with it. The app and environment
         controls were not, for the same two reasons as Happening now above.
         Custom is gone from the window list for the reason it is absent from
         the two panes below: this bar carries a range name and nothing else,
         so a custom window has no start and no end, and the only outcome it
         could reach was a refusal card. A value whose one answer is a refusal
         is an option in name only. */
      wave: 'W2', scope: false, range: ['24h', '7d', '30d'], rangeDefault: '7d', env: false,
      filterNote: 'The alerting record is kept per request type and covers production only, ' +
        'so there is no app or environment filter'
    },
    alerts: {
      file: 'alerts.html', icon: 'alerts', label: 'Problems', group: 'Right now',
      railId: 'alerts',
      question: 'What needs a person right now, and who is on it?',
      /* The window is real: it is applied to the problems that were read, and
         the count line under the list says so. The environment is not, because
         a problem carries no environment to filter on. */
      wave: 'W2', scope: false, range: ['open', '7d', '30d'], env: false,
      filterNote: 'Problems are production only, so there is no environment filter'
    },
    analytics: {
      file: 'analytics.html', icon: 'analytics', label: 'People and usage', group: 'How we are doing',
      railId: 'analytics',
      question: 'Who is using the app, and is that growing?',
      /* Custom is deliberately not offered, for the same reason as Cloud costs
         below and one that bites harder here. This bar carries a range name and
         nothing else, so a custom window reaches the usage API with no start and
         no end. That route does not refuse it: it answers over the widest window
         retention allows. Left in the list it would draw confident figures for a
         window the operator never chose, with nothing on screen saying so, which
         is worse than the cost pane's honest failure card. It comes back when
         this bar grows date controls to fill it. */
      wave: 'W3', scope: true, range: ['7d', '14d', '30d', '90d'], rangeDefault: '30d', env: true
    },
    spend: {
      file: 'spend.html', icon: 'spend', label: 'Cloud costs', group: 'How we are doing',
      railId: 'spend',
      question: 'What are we paying for, and is anything unusual?',
      /* Custom is deliberately not offered. This bar carries a range name and
         nothing else, so a custom window arrives at the cost API with no start
         and no end, and that route refuses it (ops_cost_range_unsupported)
         rather than inventing bounds. Left in the list it would be a selectable
         option whose only outcome is a failure card with a retry that cannot
         succeed. It comes back when this bar grows date controls to fill it. */
      wave: 'W3', scope: false, scopeNote: 'Scope filter not applicable',
      range: ['month', 'last-month', '3m', '12m'], env: false
    },
    evals: {
      file: 'evaluations.html', icon: 'eval', label: 'Aria quality', group: 'How we are doing',
      railId: 'quality',
      question: 'Can I validate dataset declarations or quarantine evidence?',
      wave: 'W3', scope: false, range: false, env: false, roles: ['owner', 'operator', 'viewer'],
      filterNote: 'These actions use supplied declarations or evidence, not app, date or environment filters'
    },
    releases: {
      file: 'releases.html', icon: 'release', label: 'App releases', group: 'Apps and people',
      railId: 'releases',
      question: 'Which app version is where, and is the newest one healthy?',
      /* No range. Every figure on this pane is the current state of a store
         track: ops_release_snapshots is upserted per track, so it holds what is
         on that track now and no history to window. The read API accepts and
         echoes a range, but not one field in the response varies by it, so a
         range control here would move, repaint identically, and imply a filter
         that does not exist. That is the failure this registry exists to
         prevent, so the control is removed rather than labelled. */
      wave: 'W4', scope: false, range: false, env: false,
      filterNote: 'Store tracks are current state, so there is no window to choose'
    },
    users: {
      file: 'users.html', icon: 'users', label: 'Look up a user', group: 'Apps and people',
      railId: 'users',
      question: 'What is going on with this one account?',
      wave: 'W4', scope: true, range: false, env: false
    },
    settings: {
      file: 'settings.html', icon: 'settings', label: 'Settings', group: 'Apps and people',
      railId: 'settings',
      question: 'Who can get in, what do we keep, and for how long?',
      wave: 'W5', scope: false, range: false, env: false, roles: ['owner']
    }
  };

  var GROUPS = ['Right now', 'How we are doing', 'Apps and people'];

  var SCOPES = [
    { v: 'all', l: 'All' },
    { v: 'mobile', l: 'Mobile' },
    { v: 'coaches', l: 'Coaches Web' }
  ];

  var ENVS = [
    { v: 'production', l: 'Production' },
    { v: 'staging', l: 'Staging' }
  ];

  global.OpsPaneRegistry = {
    PANES: PANES,
    GROUPS: GROUPS,
    WAVES: WAVES,
    RANGES: RANGES,
    SCOPES: SCOPES,
    ENVS: ENVS
  };
})(window);
