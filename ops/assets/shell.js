/* The operations shell: rail, top bar, filter bar, and the boot gate.

   Every pane page is the same six lines of HTML with a data-page attribute.
   The pane registry below is the single place that knows what a pane is
   called, what question it owns, which filters are real for it, and which
   delivery wave builds it. A pane page cannot drift from the rail because
   neither of them is written twice.

   Nothing in this file uses innerHTML. The shell is built as DOM with
   textContent, so no value that arrives from the API, the querystring, or
   storage can become markup. On a page whose whole job is to display
   production operational data to an administrator, that is worth the few
   extra lines. */
(function (global) {
  'use strict';

  var session = global.OpsSession;
  var icons = global.OpsIcons;

  /* ------------------------------------------------------- pane registry */

  /* wave       which delivery slice builds the pane's contents
     scope      the All / Mobile / Coaches Web control applies
     scopeNote  shown in the filter bar where the absence needs explaining
     range      false, or the list of ranges this pane offers
     env        the production / staging control applies
     filterNote shown in the filter bar for a control a built pane cannot yet
                honour, so the absence is stated rather than faked
     roles      roles allowed to open the pane at all, omitted means everyone

     A pane that has been built declares only the filters its own reads can act
     on. A control that changes nothing is worse than no control: picking
     Staging and being left looking at production, with the selection sitting
     in the bar as though it had been applied, is the failure mode that matters
     here. Where a filter is in the approved design but nothing can carry it
     yet, filterNote says so where the control would have been. */
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
      question: 'Are people using it, is it working, is anything urgent?',
      /* Everything Overview draws today is the state of things right now,
         across every app, in production. None of the three controls can be
         carried into the read that answers it. */
      wave: 'W2', scope: false, range: false, env: false,
      filterNote: 'App, range and environment filters do not apply here yet'
    },
    jobs: {
      file: 'jobs-live.html', icon: 'live', label: 'Happening now', group: 'Right now',
      question: 'What is Aria working on, and is anything stuck?',
      wave: 'W2', scope: true, range: false, env: true
    },
    history: {
      file: 'run-history.html', icon: 'history', label: 'What happened', group: 'Right now',
      question: 'Why did this fail, and is it happening to other people?',
      wave: 'W2', scope: true, range: ['24h', '7d', '30d', 'custom'], rangeDefault: '7d', env: true
    },
    alerts: {
      file: 'alerts.html', icon: 'alerts', label: 'Problems', group: 'Right now',
      question: 'What needs a person right now, and who is on it?',
      /* The window is real: it is applied to the problems that were read, and
         the count line under the list says so. The environment is not, because
         a problem carries no environment to filter on. */
      wave: 'W2', scope: false, range: ['open', '7d', '30d'], env: false,
      filterNote: 'Problems are production only, so there is no environment filter'
    },
    analytics: {
      file: 'analytics.html', icon: 'analytics', label: 'People and usage', group: 'How we are doing',
      question: 'Who is using the app, and is that growing?',
      wave: 'W3', scope: true, range: ['7d', '14d', '30d', '90d', 'custom'], rangeDefault: '30d', env: true
    },
    spend: {
      file: 'spend.html', icon: 'spend', label: 'Cloud costs', group: 'How we are doing',
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
      question: 'Is Aria giving better or worse answers than before?',
      tag: 'soon', deferred: true, wave: null, scope: false, range: false, env: false
    },
    releases: {
      file: 'releases.html', icon: 'release', label: 'App releases', group: 'Apps and people',
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
      question: 'What is going on with this one account?',
      wave: 'W4', scope: true, range: false, env: false
    },
    settings: {
      file: 'settings.html', icon: 'settings', label: 'Settings', group: 'Apps and people',
      question: 'Who can get in, what do we keep, and for how long?',
      wave: 'W5', scope: false, range: false, env: false, roles: ['owner']
    }
  };

  var GROUPS = ['Right now', 'How we are doing', 'Apps and people'];

  /* Pane contents, supplied by the pane's own module.

     A pane page loads this file and then its own module, which calls
     definePane() as it executes. A pane with no registration renders the
     not-built state, which is what every pane a later wave builds still does.

     The shell must not read this until the parser has run every script on the
     page, and "the session call is slower than parsing" is not a substitute
     for waiting. A classic script blocks the parser, but while the browser is
     *downloading* the next one the event loop is free, so the response to the
     session call can land, and its handler run, in the gap between this file
     executing and the pane's module executing. Against a fast server that race
     is lost more often than won, and it renders the pane as not built while
     its module is sitting one request behind. init() therefore waits for the
     document to finish parsing before it asks what a pane's contents are. */
  var paneContent = {};
  function definePane(id, render) { paneContent[id] = render; }

  function whenParsed() {
    if (document.readyState !== 'loading') return Promise.resolve();
    return new Promise(function (resolve) {
      document.addEventListener('DOMContentLoaded', function () { resolve(); }, { once: true });
    });
  }

  var SCOPES = [
    { v: 'all', l: 'All' },
    { v: 'mobile', l: 'Mobile' },
    { v: 'coaches', l: 'Coaches Web' }
  ];

  var ENVS = [
    { v: 'production', l: 'Production' },
    { v: 'staging', l: 'Staging' }
  ];

  /* ------------------------------------------------------- DOM shorthand */

  function h(tag, opts, children) {
    var el = document.createElement(tag);
    opts = opts || {};
    if (opts.className) el.className = opts.className;
    if (opts.text !== undefined) el.textContent = opts.text;
    Object.keys(opts).forEach(function (k) {
      if (k === 'className' || k === 'text') return;
      el.setAttribute(k, opts[k]);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function icon(name, cls) { return icons.icon(name, cls); }

  /* --------------------------------------------------------- filter state */

  /* Filter selections live in the querystring so a pane can be linked to, and
     reloading keeps what was on screen. W2 onward reads these; W1 only proves
     they round trip. */
  var filters = { scope: 'all', range: null, env: 'production' };

  function readFilters(pane) {
    var q = new URLSearchParams(global.location.search);

    var scope = q.get('scope');
    filters.scope = (pane.scope && SCOPES.some(function (s) { return s.v === scope; }))
      ? scope : 'all';

    if (pane.range) {
      var r = q.get('range');
      filters.range = pane.range.indexOf(r) !== -1
        ? r
        : (pane.rangeDefault || pane.range[0]);
    } else {
      filters.range = null;
    }

    var env = q.get('env');
    filters.env = (pane.env && ENVS.some(function (e) { return e.v === env; }))
      ? env : 'production';
  }

  function writeFilters(pane) {
    var q = new URLSearchParams(global.location.search);
    if (pane.scope) q.set('scope', filters.scope); else q.delete('scope');
    if (pane.range) q.set('range', filters.range); else q.delete('range');
    if (pane.env) q.set('env', filters.env); else q.delete('env');
    var qs = q.toString();
    global.history.replaceState(null, '',
      global.location.pathname + (qs ? '?' + qs : ''));
    refreshNavHrefs();
    emitFilters();
  }

  /* Fired for the selection the pane starts with as well as for every change
     to it. A pane that only hears about changes has to duplicate the reading
     of the querystring to know what it is showing before the operator touches
     anything, which is the sort of duplication this bar exists to remove. */
  function emitFilters() {
    global.dispatchEvent(new CustomEvent('ops:filters', { detail: shallow(filters) }));
  }

  /* Rail links are built with the filter selection baked in, so they have to
     be rebuilt when it changes. Without this, changing the range and then
     moving pane silently drops you back to the default window. */
  var navLinks = [];
  function refreshNavHrefs() {
    navLinks.forEach(function (entry) {
      entry.el.setAttribute('href', paneHref(entry.pane));
    });
  }

  function shallow(o) {
    var c = {};
    Object.keys(o).forEach(function (k) { c[k] = o[k]; });
    return c;
  }

  /* Carries the current filter selection onto a rail link, so moving between
     panes keeps the window you were looking at instead of silently resetting
     it. Only the filters the destination actually has are carried. */
  function paneHref(pane) {
    var q = new URLSearchParams();
    if (pane.scope) q.set('scope', filters.scope);
    if (pane.range && pane.range.indexOf(filters.range) !== -1) q.set('range', filters.range);
    if (pane.env) q.set('env', filters.env);
    var qs = q.toString();
    return pane.file + (qs ? '?' + qs : '');
  }

  /* ------------------------------------------------------------ the rail */

  function initials(name, email) {
    var source = (name || email || '').trim();
    if (!source) return '?';
    var parts = source.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  function roleLabel(r) {
    if (r === 'owner') return 'Owner';
    if (r === 'operator') return 'Operator';
    if (r === 'viewer') return 'Viewer';
    return 'Signed in';
  }

  function sessionLabel() {
    var d = session.daysLeft();
    if (d === null) return '';
    if (d === 0) return 'session ends today';
    return 'session ' + d + 'd left';
  }

  function renderRail(activeId) {
    navLinks = [];
    var rail = h('aside', { className: 'rail', id: 'rail', 'aria-label': 'Dashboard panes' });

    rail.appendChild(h('div', { className: 'rail-brand' }, [
      h('div', { className: 'rail-mark', 'aria-hidden': 'true' }, [
        h('img', { src: 'assets/aria-mark.png', alt: '', width: '18', height: '18' })
      ]),
      h('div', {}, [
        h('div', { className: 'rail-title', text: 'Aria Operations' }),
        h('div', { className: 'rail-sub', text: 'Private, admin only' })
      ])
    ]));

    var nav = h('nav', { 'aria-label': 'Panes' });
    GROUPS.forEach(function (groupName) {
      var group = h('div', { className: 'rail-group' });
      var labelId = 'railGroup' + groupName.replace(/[^A-Za-z]/g, '');
      group.appendChild(h('div', { className: 'rail-group-label', id: labelId, text: groupName }));

      var list = h('ul', { className: 'rail-list', 'aria-labelledby': labelId, role: 'list' });
      Object.keys(PANES).forEach(function (id) {
        var pane = PANES[id];
        if (pane.group !== groupName) return;

        var allowed = !pane.roles || session.hasRole(pane.roles);
        var item = h('li');

        /* Always a real link, even where the role cannot use the pane. The
           destination renders a denied state that names the role it needs,
           which is a better answer than a dead span: aria-disabled means
           nothing on a bare element, and a title is mouse-only. */
        var link = h('a', {
          className: 'nav-item' + (id === activeId ? ' is-active' : '') +
                     (allowed ? '' : ' is-locked'),
          href: paneHref(pane)
        });
        if (id === activeId) link.setAttribute('aria-current', 'page');
        navLinks.push({ el: link, pane: pane });

        link.appendChild(icon(pane.icon));
        link.appendChild(h('span', { text: pane.label }));

        if (!allowed) {
          link.appendChild(h('span', { className: 'nav-count', text: 'owner' }));
          link.appendChild(h('span', { className: 'sr-only', text: ', owner access only' }));
        } else if (pane.tag) {
          link.appendChild(h('span', { className: 'nav-count', text: pane.tag }));
        }

        item.appendChild(link);
        list.appendChild(item);
      });

      group.appendChild(list);
      nav.appendChild(group);
    });
    rail.appendChild(nav);

    var admin = session.state.admin || {};
    var foot = h('div', { className: 'rail-foot' }, [
      h('div', {
        className: 'avatar',
        'aria-hidden': 'true',
        text: initials(admin.displayName, admin.email)
      }),
      h('div', { className: 'rail-who' }, [
        h('div', { className: 'small strong truncate', text: admin.email || 'Signed in' }),
        h('div', {
          className: 'tiny muted',
          text: [roleLabel(admin.role), sessionLabel()].filter(Boolean).join(', ')
        })
      ])
    ]);

    var out = h('button', {
      className: 'icon-btn', type: 'button', id: 'signOut',
      'aria-label': 'Sign out', title: 'Sign out'
    });
    out.appendChild(icon('signout'));
    out.addEventListener('click', function () {
      out.disabled = true;
      session.signOut();
    });
    foot.appendChild(out);
    rail.appendChild(foot);

    return rail;
  }

  /* ---------------------------------------------------------- the top bar */

  function renderTopbar(pane) {
    var bar = h('header', { className: 'topbar' });

    var toggle = h('button', {
      className: 'icon-btn rail-toggle', type: 'button', id: 'railToggle',
      'aria-label': 'Open navigation', 'aria-expanded': 'false', 'aria-controls': 'rail'
    });
    toggle.appendChild(icon('menu'));
    bar.appendChild(toggle);

    bar.appendChild(h('h1', { className: 'page-title', text: pane.label }));
    if (pane.question) {
      bar.appendChild(h('p', { className: 'page-question', text: pane.question }));
    }

    var right = h('div', { className: 'topbar-right' });
    var theme = h('button', {
      className: 'icon-btn', type: 'button', id: 'themeToggle',
      'aria-label': 'Switch colour theme', title: 'Switch colour theme'
    });
    theme.appendChild(h('span', { className: 'theme-dark-only' }, [icon('sun')]));
    theme.appendChild(h('span', { className: 'theme-light-only' }, [icon('moon')]));
    theme.addEventListener('click', function () {
      var next = global.OpsTheme.toggle();
      announce('Theme switched to ' + next);
    });
    right.appendChild(theme);
    bar.appendChild(right);

    return bar;
  }

  /* -------------------------------------------------------- the filter bar */

  function segment(ariaLabel, options, current, onPick) {
    var seg = h('div', { className: 'seg', role: 'group', 'aria-label': ariaLabel });
    options.forEach(function (o) {
      var b = h('button', {
        type: 'button', text: o.l,
        'aria-pressed': String(o.v === current)
      });
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) {
          x.setAttribute('aria-pressed', 'false');
        });
        b.setAttribute('aria-pressed', 'true');
        onPick(o.v);
      });
      seg.appendChild(b);
    });
    return seg;
  }

  /* The range control this bar drew, and the pane it was drawn for. A pane
     owns its own filters but not this one, and a pane that offers to clear
     every filter has to be able to reach the one the shell holds. Without
     this, "clear the filters" clears the pane's own two and silently leaves
     the window in place, which is a button that does not keep the promise
     printed beside it. */
  var rangeControl = null;
  var rangePane = null;

  /* Puts the range back to the window the pane starts on. Answers whether it
     changed anything, so a caller can tell a reload it must do itself from one
     the filter event is already about to cause. */
  function resetRange() {
    if (!rangePane || !rangePane.range || !rangeControl) return false;
    var startsOn = rangePane.rangeDefault || rangePane.range[0];
    if (filters.range === startsOn) return false;
    filters.range = startsOn;
    rangeControl.value = startsOn;
    writeFilters(rangePane);
    return true;
  }

  function renderFilters(pane) {
    if (!pane.scope && !pane.range && !pane.env && !pane.scopeNote && !pane.filterNote) {
      return null;
    }

    var bar = h('div', { className: 'filterbar' });

    if (pane.scope) {
      bar.appendChild(h('div', { className: 'filter-item' }, [
        h('span', { className: 'filter-label', text: 'App' }),
        segment('App scope', SCOPES, filters.scope, function (v) {
          filters.scope = v;
          writeFilters(pane);
        })
      ]));
      bar.appendChild(h('div', { className: 'filter-sep', 'aria-hidden': 'true' }));
    }

    if (pane.range) {
      var range = h('select', { className: 'select', id: 'fRange' });
      pane.range.forEach(function (v) {
        var o = h('option', { value: v, text: RANGES[v] || v });
        if (v === filters.range) o.selected = true;
        range.appendChild(o);
      });
      range.addEventListener('change', function () {
        filters.range = range.value;
        writeFilters(pane);
      });
      rangeControl = range;
      rangePane = pane;
      bar.appendChild(h('div', { className: 'filter-item' }, [
        h('label', { className: 'filter-label', for: 'fRange', text: 'Range' }),
        range
      ]));
    }

    if (pane.env) {
      var env = h('select', { className: 'select', id: 'fEnv' });
      ENVS.forEach(function (e) {
        var o = h('option', { value: e.v, text: e.l });
        if (e.v === filters.env) o.selected = true;
        env.appendChild(o);
      });
      env.addEventListener('change', function () {
        filters.env = env.value;
        writeFilters(pane);
      });
      bar.appendChild(h('div', { className: 'filter-item filter-gap' }, [
        h('label', { className: 'filter-label', for: 'fEnv', text: 'Env' }),
        env
      ]));
    }

    /* The explicit not-applicable pattern. Cloud spend is billed per piece of
       infrastructure, not per app, so splitting a shared bill by client would
       be an invented number. Saying so beats leaving a gap where a control
       used to be, and it beats by a much wider margin a control that moves and
       changes nothing. */
    [pane.scopeNote, pane.filterNote].forEach(function (note) {
      if (note) bar.appendChild(h('span', { className: 'badge filter-gap', text: note }));
    });

    return bar;
  }

  /* ------------------------------------------------------- pane contents */

  /* level defaults to 2, because a state block normally sits under the pane
     title in the top bar. The boot-failure card renders with no shell around
     it, so it passes 1 and becomes the page's only heading. */
  function stateBlock(iconName, title, lines, level) {
    var block = h('div', { className: 'state-block' });
    block.appendChild(icon(iconName));
    block.appendChild(h('h' + (level || 2), { className: 'state-title', text: title }));
    lines.forEach(function (l) {
      block.appendChild(h('p', { className: 'state-desc', text: l }));
    });
    return block;
  }

  /* What a pane shows before the wave that builds it has shipped. An empty
     screen and a broken screen look identical, so this one says which it is,
     which release changes it, and what the current release did deliver. */
  function renderNotBuilt(pane) {
    var wrap = h('div', { className: 'notbuilt' });
    var card = h('div', { className: 'card' });

    var block = stateBlock('build', 'Not built yet', [
      pane.label + ' is part of ' + pane.wave + ', the ' +
        (WAVES[pane.wave] || '').toLowerCase() + '. Nothing behind this page ' +
        'is built yet, and nothing is being hidden from you.',
      'When it lands it answers: ' + pane.question
    ]);

    var chip = h('p', {}, [
      h('span', { className: 'notbuilt-wave', text: pane.wave + ' · ' + (WAVES[pane.wave] || '') })
    ]);
    block.appendChild(chip);
    card.appendChild(block);

    /* Deliberately names no release. Panes ship in waves, so a sentence naming
       the current one is wrong the day the next one lands, and it would be
       rewritten by every wave in turn. What stays true is which parts exist. */
    var foot = h('div', { className: 'card-foot' }, [
      h('span', {
        text: 'The sign in, the session, the navigation, and the design system ' +
              'every pane is drawn with are built and working.'
      })
    ]);
    card.appendChild(foot);
    wrap.appendChild(card);
    return wrap;
  }

  /* Aria quality keeps the banner it carries in the approved mock. It is not
     waiting on a wave; the scoring harness behind it is its own project. */
  function renderDeferred(pane) {
    var wrap = h('div', { className: 'stack' });

    var callout = h('div', { className: 'callout callout-ai' });
    callout.appendChild(icon('clock'));
    var body = h('div');
    body.appendChild(h('strong', { text: 'Coming soon.' }));
    body.appendChild(document.createTextNode(
      ' This pane ships after the first dashboard release, as its own project. ' +
      'Everything designed for it is approved direction, nothing behind it is built yet. ' +
      "Until then, Aria's answer quality is watched the way it is today, by reading real conversations."
    ));
    callout.appendChild(body);
    wrap.appendChild(callout);

    var card = h('div', { className: 'card' });
    card.appendChild(stateBlock('eval', 'Nothing to show yet', [
      'The design for ' + pane.label + ' is approved, but the scoring harness that ' +
      'would fill it is a separate project and is not part of the first dashboard release.',
      'It answers: ' + pane.question
    ]));
    wrap.appendChild(card);
    return wrap;
  }

  /* A pane the signed-in role may not open. Named plainly, with the role that
     would be needed, because "nothing here" is the wrong answer to "why". */
  function renderDenied(pane) {
    var wrap = h('div', { className: 'notbuilt' });
    var card = h('div', { className: 'card' });
    card.appendChild(stateBlock('lock', 'Owner access only', [
      pane.label + ' is limited to the owner role. You are signed in as ' +
        roleLabel(session.role()).toLowerCase() + '.',
      'Changing settings, managing administrators, and reading the access record ' +
        'are owner actions. Ask an owner if you need something here.'
    ]));
    wrap.appendChild(card);
    return wrap;
  }

  /* --------------------------------------------------- rail as a drawer */

  /* Below 860px the rail is an overlay, which makes it a dialog: it has to
     trap focus while it is open, close on Escape, and hand focus back to the
     control that opened it. */
  function wireRail() {
    var rail = document.getElementById('rail');
    var toggle = document.getElementById('railToggle');
    if (!rail || !toggle) return;

    var scrim = null;
    var inerted = [];

    /* An element whose whole job is to announce. The live region and the toast
       host are appended to the body, so they are siblings of the app wrapper
       and would otherwise be inerted along with it, and a live region carrying
       aria-hidden announces nothing. Neither holds focusable content, so
       leaving them out costs the drawer's modality nothing. */
    function isLiveRegion(el) {
      return el.hasAttribute('aria-live') || el.classList.contains('toast-host');
    }

    /* The scrim stops a pointer reaching the shell behind the drawer, but a
       virtual cursor walks straight past a scrim. Everything that is not the
       rail goes inert as well, so the drawer is genuinely modal for a screen
       reader and not only for a mouse. */
    function setBackgroundInert(on) {
      if (!on) {
        inerted.forEach(function (el) {
          if ('inert' in el) el.inert = false;
          el.removeAttribute('aria-hidden');
        });
        inerted = [];
        return;
      }
      /* The rail sits inside the app wrapper, so "everything else" is not a
         list of body children: it is the rail's siblings at every level up to
         the body. Inerting an ancestor of the rail would inert the rail. */
      inerted = [];
      var node = rail;
      while (node && node !== document.body && node.parentElement) {
        var parent = node.parentElement;
        var self = node;
        Array.prototype.forEach.call(parent.children, function (sib) {
          if (sib !== self && sib !== scrim && !isLiveRegion(sib)) inerted.push(sib);
        });
        node = parent;
      }
      inerted.forEach(function (el) {
        if ('inert' in el) el.inert = true;
        el.setAttribute('aria-hidden', 'true');
      });
    }

    function open() {
      rail.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close navigation');
      /* A scrim, so the pane behind cannot be tapped by accident and it is
         obvious the rail is the thing being interacted with. */
      scrim = h('div', { className: 'scrim is-open' });
      scrim.addEventListener('click', function () { close(); });
      document.body.appendChild(scrim);
      /* The rail lives inside the app wrapper, so inert has to be applied
         after the scrim exists and must skip the rail's own ancestors. */
      setBackgroundInert(true);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('focusin', onFocusIn, true);
      var first = rail.querySelector('a, button');
      if (first) first.focus();
    }

    function close(restore) {
      rail.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation');
      setBackgroundInert(false);
      if (scrim) { scrim.remove(); scrim = null; }
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      if (restore !== false) toggle.focus();
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var items = rail.querySelectorAll('a, button');
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function onFocusIn(e) {
      if (!rail.contains(e.target)) {
        var first = rail.querySelector('a, button');
        if (first) first.focus();
      }
    }

    toggle.addEventListener('click', function () {
      if (rail.classList.contains('is-open')) close();
      else open();
    });

    /* Growing past the breakpoint turns the overlay back into a permanent
       column, at which point trapping focus inside it would be a bug. */
    var mq = global.matchMedia('(max-width: 860px)');
    var onBreakpoint = function (e) {
      if (!e.matches && rail.classList.contains('is-open')) close(false);
    };
    if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
    else if (mq.addListener) mq.addListener(onBreakpoint);  /* Safari below 14 */
  }

  /* ---------------------------------------------------- shared behaviours */

  /* Tabs, kept in the design system so the panes that grow them in W2 onward
     inherit a real tablist: arrow keys move between tabs, Home and End jump
     to the ends, and only the selected tab is in the tab order. */
  function wireTabs(root) {
    (root || document).querySelectorAll('[role="tablist"]').forEach(function (list) {
      var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
      if (!tabs.length) return;

      function select(tab) {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute('aria-controls') || '');
          if (panel) panel.hidden = !on;
        });
        tab.focus();
      }

      tabs.forEach(function (tab, i) {
        tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
        tab.addEventListener('click', function () { select(tab); });
        tab.addEventListener('keydown', function (e) {
          var next = null;
          if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
          else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
          else if (e.key === 'Home') next = tabs[0];
          else if (e.key === 'End') next = tabs[tabs.length - 1];
          if (next) { e.preventDefault(); select(next); }
        });
      });
    });
  }

  var liveRegion = null;

  /* Polite announcements for changes a sighted operator sees but a screen
     reader would otherwise miss, such as the theme flipping. */
  function announce(message) {
    if (!liveRegion) {
      liveRegion = h('div', { className: 'sr-only', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = message;
  }

  function toast(iconName, message) {
    var host = document.querySelector('.toast-host');
    if (!host) {
      host = h('div', { className: 'toast-host' });
      document.body.appendChild(host);
    }
    var t = h('div', { className: 'toast', role: 'status' });
    t.appendChild(icon(iconName));
    t.appendChild(h('div', { text: message }));
    host.appendChild(t);
    global.setTimeout(function () { t.remove(); }, 4000);
  }

  /* ------------------------------------------------------------- booting */

  function setGate(name) {
    document.body.className = 'is-' + name;
  }

  /* Each gate carries its own h1 and its own <main>, so that the heading and
     landmark structure is correct while that gate is the only thing on screen.
     Once the outcome is known the losing gates come out of the document
     entirely: display:none would keep them out of the accessibility tree, but
     removing them leaves exactly one h1 and exactly one <main> rather than one
     of each that counts and others that do not. */
  function dropGates(selectors) {
    selectors.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) el.remove();
    });
  }

  /* "Could not check your session" is the right sentence for a database wobble
     behind the auth guard and the wrong one for "your role does not allow
     this". The code decides the heading. */
  var FAILURE_TITLES = {
    ops_role_insufficient: 'Your role does not allow this',
    ops_reauth_rate_limited: 'Too many attempts',
    ops_login_rate_limited: 'Too many attempts',
    ops_route_missing: 'That page is not there',
    ops_bad_response: 'The operations API answered with something unreadable',
    ops_storage_unavailable: 'This browser would not store your session'
  };

  /* The second line of the card, which is a promise about what just happened
     and has to be true of the failure in hand. */
  var FAILURE_NOTES = {
    ops_storage_unavailable:
      'Nothing has been signed out, and the session is still live on the server. ' +
      'It is this browser that cannot keep hold of it.'
  };

  function renderFailure(err) {
    var host = document.getElementById('gateFailed');
    if (!host) return;
    host.textContent = '';

    var code = err && err.code;
    var card = h('div', { className: 'card' });
    var block = stateBlock('warn', FAILURE_TITLES[code] || 'Could not check your session', [
      err && err.message ? err.message :
        'The operations API did not answer. Your session has not been ended.',
      FAILURE_NOTES[code] || 'Nothing has been signed out. Try again in a moment.'
    ], 1);

    var row = h('div', { className: 'row mt' });
    var retry = h('button', { className: 'btn btn-primary', type: 'button', text: 'Try again' });
    retry.addEventListener('click', function () { global.location.reload(); });
    var out = h('button', { className: 'btn', type: 'button', text: 'Sign out' });
    out.addEventListener('click', function () {
      /* The whole sign-out, not the local half of one. Dropping the stored
         credential here and calling it done left the session alive on the
         server for every other copy of it, which is the opposite of what the
         button says. signOut() revokes first and clears afterwards, and it
         resolves whether or not the call got through. */
      out.disabled = true;
      session.signOut();
    });
    row.appendChild(retry);
    row.appendChild(out);
    block.appendChild(row);

    card.appendChild(block);
    host.appendChild(card);
    setGate('failed');
    dropGates(['.gate-boot', '.gate-app']);
    /* The boot placeholder said "Checking your session" and then silently
       became something else. Move focus so a screen reader is told. */
    host.focus();
  }

  /* Boots a pane page. The app markup stays hidden behind the gate until the
     API has confirmed a session, so there is no state in which a partly built
     shell is on screen: it is the boot placeholder, the failure card, or the
     real thing. */
  function init() {
    var pageId = document.body.getAttribute('data-page');
    var pane = PANES[pageId];
    if (!pane) throw new Error('Unknown pane: ' + pageId);

    document.title = pane.label + ' | Aria Operations';
    setGate('booting');

    session.boot().then(whenParsed).then(function () {
      readFilters(pane);

      var app = document.getElementById('app');
      app.textContent = '';
      app.appendChild(renderRail(pageId));

      var main = h('div', { className: 'main' });
      main.appendChild(renderTopbar(pane));
      var bar = renderFilters(pane);
      if (bar) main.appendChild(bar);

      var content = h('main', { className: 'content', id: 'content', tabindex: '-1' });
      if (pane.roles && !session.hasRole(pane.roles)) content.appendChild(renderDenied(pane));
      else if (pane.deferred) content.appendChild(renderDeferred(pane));
      else if (paneContent[pageId]) paneContent[pageId](content, pane);
      else content.appendChild(renderNotBuilt(pane));
      main.appendChild(content);

      app.appendChild(main);
      setGate('ready');
      dropGates(['.gate-boot', '.gate-failed']);

      wireRail();
      wireTabs(app);

      /* Both events fire after the session is confirmed and the shell is in
         the document, so a pane script that adds its listeners while this file
         is still booting cannot miss them. ops:ready is the signal that
         #content exists; ops:filters then carries the starting selection. */
      global.dispatchEvent(new CustomEvent('ops:ready', {
        detail: { pane: pageId, filters: shallow(filters) }
      }));
      emitFilters();
    }).catch(function (err) {
      /* A terminal failure has already navigated to the sign-in screen and
         its promise never settles, so anything arriving here is a fault the
         operator can retry rather than a session that has ended. */
      renderFailure(err);
    });
  }

  /* Pane pages carry no script of their own. Loading this file on a page that
     names a pane is the whole contract, which is what keeps ten near-identical
     HTML files from drifting apart. */
  if (document.body && PANES[document.body.getAttribute('data-page')]) init();

  global.OpsShell = {
    init: init,
    definePane: definePane,
    panes: PANES,
    filters: function () { return shallow(filters); },
    resetRange: resetRange,
    h: h,
    icon: icon,
    toast: toast,
    announce: announce,
    stateBlock: stateBlock,
    wireTabs: wireTabs
  };
})(window);
