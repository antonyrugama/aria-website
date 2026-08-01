/* The problems API, in the words the dashboard says it in.

   Every machine value the operations API can send has exactly one plain
   English rendering, and this is where it lives. Two panes read this API,
   Problems and Overview, and a second copy of these strings is how the same
   state ends up described two different ways on two screens an operator moves
   between in one incident.

   Nothing here touches the DOM or the network. It is the vocabulary, the small
   derivations that both panes need, and nothing else.

   Every lookup falls back to the raw value rather than to a blank. An
   unrecognised state is a fact worth showing; what this file will not do is
   pretend to have translated one it has never seen. */
(function (global) {
  'use strict';

  var SEVERITY_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info' };
  var SEVERITY_TONE = { critical: 'crit', warning: 'warn', info: 'info' };

  var STATUS_LABEL = {
    open: 'Nobody on it',
    acknowledged: 'Someone is on it',
    closed: 'Closed',
    pending: 'Not fired yet'
  };
  var STATUS_TONE = { open: 'crit', acknowledged: 'info', closed: '', pending: '' };

  var CLOSE_REASON_LABEL = {
    resolved: 'Resolved',
    no_action_needed: 'Nothing to do',
    self_resolved: 'Fixed itself'
  };

  var EVENT_LABEL = {
    detected: 'First seen',
    fired: 'Fired',
    acknowledged: 'Taken on',
    condition_cleared: 'The condition stopped',
    condition_returned: 'The condition came back',
    notification_failed: 'A notification did not go out',
    closed: 'Closed'
  };
  var EVENT_TONE = {
    detected: '', fired: 'crit', acknowledged: 'ok',
    condition_cleared: 'ok', condition_returned: 'warn',
    notification_failed: 'warn', closed: 'ok'
  };

  var EVALUATION_LABEL = {
    ok: 'Checking normally',
    firing: 'Firing now',
    insufficient_data: 'Not enough data to judge',
    disabled: 'Turned off',
    error: 'The check itself failed'
  };
  var EVALUATION_TONE = {
    ok: 'ok', firing: 'crit', insufficient_data: 'warn', disabled: 'idle', error: 'crit'
  };

  /* Why a rule cannot reach a verdict, each reading as the end of the sentence
     "it cannot judge yet because ...". */
  var INSUFFICIENT_REASON = {
    no_source_configured: 'nothing is feeding it yet',
    no_samples: 'nothing has come in to measure',
    below_minimum_samples: 'too few measurements so far',
    no_baseline: 'there is no history to compare against'
  };

  var CHANNEL_STATUS = {
    ok: { tone: 'ok', label: 'Connected' },
    failed: { tone: 'crit', label: 'Not getting through' },
    unconfigured: { tone: 'warn', label: 'Not configured' }
  };

  /* Why a channel is not getting through, as the end of "because ...". */
  var CHANNEL_FAILURE = {
    auth: 'it was refused',
    timeout: 'it timed out',
    transport: 'it could not connect',
    http_error: 'the other end returned an error',
    malformed: 'the message was rejected',
    config: 'the setup is wrong'
  };

  /* The pane each problem's work happens in, as the shell files them. The API
     sends the pane key and its label; turning the key into a URL is the only
     thing the client adds, and this is the one place it happens. */
  var PANE_FILE = {
    overview: 'index.html',
    'jobs-live': 'jobs-live.html',
    'run-history': 'run-history.html',
    spend: 'spend.html',
    releases: 'releases.html'
  };

  var CATEGORIES = [
    { value: 'all', label: 'All categories' },
    { value: 'ai_reliability', label: 'AI reliability' },
    { value: 'cost', label: 'Cost' },
    { value: 'release', label: 'Release' },
    { value: 'infrastructure', label: 'Infrastructure' }
  ];

  var SEVERITIES = [
    { value: 'all', label: 'All' },
    { value: 'critical', label: 'Critical' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Info' }
  ];

  /* The API caps a read at 100 problems and offers no second page. That is a
     generous ceiling for a pane whose whole argument is that alert volume
     should stay low, but a page that silently showed the first hundred of two
     hundred would be lying, so every count line says when it was reached. */
  var PAGE = 100;

  /* Worst first, then oldest. Newest is not the same as most important, and a
     queue sorted by arrival buries the thing that has been burning longest. */
  function severityRank(severity) {
    return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
  }

  function time(iso) {
    var t = iso ? new Date(iso) : null;
    return t && isFinite(t.getTime()) ? t.getTime() : null;
  }

  function byWorstThenOldest(a, b) {
    var bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity) return bySeverity;
    return (time(a.firedAt) || 0) - (time(b.firedAt) || 0);
  }

  /* Whether the alerting can be believed, which is a different question from
     whether anything is wrong.

     Three things have to hold: some rules are enabled, they have actually run,
     and at least one of them was able to reach a verdict when it did. A rule
     that is enabled but cannot judge is not a rule that is checking, so it is
     subtracted rather than counted. Both panes lean on this, because "nothing
     is wrong" is only worth printing when something was in a position to
     notice. */
  function armedState(rules) {
    var summary = rules.summary;
    var checking = Math.max(0, summary.enabled - summary.insufficientData);
    return {
      summary: summary,
      rules: rules.rules || [],
      channels: rules.channels || [],
      checking: checking,
      trustworthy: summary.enabled > 0 && summary.lastEvaluatedAt !== null && checking > 0
    };
  }

  /* The problems an operator is being asked to do something about, as opposed
     to the ones somebody already has. */
  function needingAction(problems) {
    return problems.filter(function (p) { return p.status === 'open'; });
  }

  function takenOn(problems) {
    return problems.filter(function (p) { return p.status === 'acknowledged'; });
  }

  function worstSeverity(problems) {
    return problems.reduce(function (worst, p) {
      if (!worst) return p.severity;
      return severityRank(p.severity) < severityRank(worst) ? p.severity : worst;
    }, null);
  }

  global.OpsAlertsModel = {
    SEVERITY_LABEL: SEVERITY_LABEL,
    SEVERITY_TONE: SEVERITY_TONE,
    STATUS_LABEL: STATUS_LABEL,
    STATUS_TONE: STATUS_TONE,
    CLOSE_REASON_LABEL: CLOSE_REASON_LABEL,
    EVENT_LABEL: EVENT_LABEL,
    EVENT_TONE: EVENT_TONE,
    EVALUATION_LABEL: EVALUATION_LABEL,
    EVALUATION_TONE: EVALUATION_TONE,
    INSUFFICIENT_REASON: INSUFFICIENT_REASON,
    CHANNEL_STATUS: CHANNEL_STATUS,
    CHANNEL_FAILURE: CHANNEL_FAILURE,
    PANE_FILE: PANE_FILE,
    CATEGORIES: CATEGORIES,
    SEVERITIES: SEVERITIES,
    PAGE: PAGE,
    severityRank: severityRank,
    time: time,
    byWorstThenOldest: byWorstThenOldest,
    armedState: armedState,
    needingAction: needingAction,
    takenOn: takenOn,
    worstSeverity: worstSeverity
  };
})(window);
