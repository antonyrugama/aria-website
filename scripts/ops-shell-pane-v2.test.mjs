/* Unit tests for ops/assets/shell-pane-v2.js and ops/assets/pane-registry.js —
   the v2 pane bootstrap and the table both shells read.

   What is worth testing here is what a screenshot cannot show and what the two
   headless-Chrome checks do not reach: that the rail and the registry cannot
   drift apart, that the filter bar draws exactly what a pane declared and
   nothing else, that a role without access gets a named refusal rather than a
   blank pane, that a pane with no module says so, that the three gates are
   mutually exclusive, and that the formatters this file carries agree with the
   v1 ones it was ported from.

   Every test here has a published mutation in the pull request: the exact file
   and the exact original line whose removal or inversion makes that test fail.
   A test with no such line is a test that pins nothing. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const V1_SHELL_SRC = read('assets/shell.js');
/* The re-authentication dialog is raised by assets/session.js over whatever
   page is open, so on a v2 pane it is this shell's furniture even though this
   file does not build it. */
const SESSION_SRC = read('assets/session.js');
/* The two stylesheets EVERY v2 pane page loads, in load order. A pane's own
   sheet is deliberately not in this list: a dialog styled by one of those is
   styled on one pane out of ten, which is the defect, not the fix. */
const SHARED_SHEETS = [
  ['assets/aria.css', read('assets/aria.css')],
  ['assets/shell-pane-v2.css', read('assets/shell-pane-v2.css')],
];

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

/* ------------------------------------------------------------- the page */

/* The markup ops/index.html carries, as the bootstrap expects to find it:
   three mutually exclusive gates, each with its own heading and landmark. */
function buildPage(dom, body, paneId) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', paneId);
  body.className = 'is-booting';

  /* Every ops page opens with the skip link, outside the app wrapper. It is
     the one body-level sibling the drawer's inert walk has to reach past its
     own level to find, so leaving it out of this page would make a walk that
     only inerts the rail's own siblings look complete. */
  el(body, 'a', { class: 'skip', href: '#content' }).textContent = 'Skip to content';

  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';

  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });

  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
  return body;
}

function fakeSession(options) {
  const opts = options || {};
  const role = opts.role || 'owner';
  const admin = opts.admin === null ? null : (opts.admin || {
    displayName: 'Owner', email: 'owner@example.invalid', role,
  });
  return {
    state: { admin },
    boot: () => (opts.bootRejects
      ? Promise.reject(opts.bootRejects)
      : Promise.resolve({ admin })),
    call: opts.call || (() => Promise.resolve({ data: {} })),
    signOut: () => Promise.resolve(),
    role: () => role,
    hasRole: (roles) => !roles || roles.indexOf(role) !== -1,
    daysLeft: () => (opts.daysLeft === undefined ? 12 : opts.daysLeft),
  };
}

/* Loads the registry, aria.js and the bootstrap onto one page, the way a pane
   page loads them, and lets the promise chain inside init() settle. */
async function bootPane(paneId, options) {
  const opts = options || {};
  const dom = makeDom({
    tokens: TOKENS,
    href: opts.href || 'https://ops.example.invalid/ops/' + (opts.file || 'index.html'),
    matchMedia: opts.matchMedia,
    readyState: opts.readyState,
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body, paneId);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = fakeSession(opts.session);

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  const shell = dom.window.OpsPaneShell;
  /* The moment a pane's own module executes: after the bootstrap's script tag,
     before its asynchronous boot has finished. It is the only place a pane can
     add a listener and still be certain of hearing ops:ready. */
  if (opts.onLoad) opts.onLoad(dom.window, shell);
  /* A pane module registers itself with OpsPaneShell.definePane and builds its
     nodes with OpsPaneShell.h, so the test callbacks are handed the shell
     rather than reaching for a document they cannot see yet. */
  if (opts.definePane) {
    shell.definePane(paneId, (content, pane) => opts.definePane(content, pane, shell));
  }

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  /* The rest of the document arriving. A pane module is a later <script> tag,
     so anything registered here is registered after the bootstrap has already
     started. */
  if (opts.lateDefinePane) {
    shell.definePane(paneId, (content, pane) => opts.lateDefinePane(content, pane, shell));
  }
  if (opts.readyState === 'loading') {
    dom.doc.readyState = 'complete';
    dom.doc.dispatch('DOMContentLoaded');
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r));
  }

  return { ...dom, body, shell, registry: dom.window.OpsPaneRegistry, Aria: dom.window.Aria };
}

function registryOnly() {
  const dom = makeDom({ tokens: TOKENS });
  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  return dom.window.OpsPaneRegistry;
}

/* =============================== the registry ========================== */

test('shell.js refuses to load without the registry, and reads it when it is there', () => {
  const bare = makeDom({ tokens: TOKENS });
  vm.createContext(bare.window);
  assert.throws(
    () => vm.runInContext(V1_SHELL_SRC, bare.window, { filename: 'shell.js' }),
    /pane-registry\.js must load before/,
    'the v1 shell carried on without the shared table'
  );

  const withIt = makeDom({ tokens: TOKENS });
  withIt.window.OpsSession = fakeSession();
  vm.createContext(withIt.window);
  vm.runInContext(REGISTRY_SRC, withIt.window, { filename: 'pane-registry.js' });
  vm.runInContext(V1_SHELL_SRC, withIt.window, { filename: 'shell.js' });
  assert.equal(
    withIt.window.OpsShell.panes,
    withIt.window.OpsPaneRegistry.PANES,
    'the v1 shell kept its own copy of the table instead of reading the shared one'
  );
});

test('the v2 bootstrap refuses to load without the registry or without aria.js', () => {
  const noRegistry = makeDom({ tokens: TOKENS });
  noRegistry.window.Aria = { icon: () => null, boot() {}, applyState() {} };
  vm.createContext(noRegistry.window);
  assert.throws(
    () => vm.runInContext(SHELL_SRC, noRegistry.window, { filename: 'shell-pane-v2.js' }),
    /pane-registry\.js must load before/
  );

  const noAria = makeDom({ tokens: TOKENS });
  vm.createContext(noAria.window);
  vm.runInContext(REGISTRY_SRC, noAria.window, { filename: 'pane-registry.js' });
  assert.throws(
    () => vm.runInContext(SHELL_SRC, noAria.window, { filename: 'shell-pane-v2.js' }),
    /aria\.js must load before/
  );
});

test('every ops page that loads shell.js loads the registry first', () => {
  const dir = new URL('./', OPS);
  const pages = readdirSync(dir).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 10, 'the page list came back suspiciously short');

  let checked = 0;
  for (const page of pages) {
    const html = readFileSync(new URL(page, dir), 'utf8');
    const shellAt = html.indexOf('assets/shell.js');
    const v2At = html.indexOf('assets/shell-pane-v2.js');
    if (shellAt < 0 && v2At < 0) continue;
    checked += 1;
    const registryAt = html.indexOf('assets/pane-registry.js');
    assert.ok(registryAt >= 0, page + ' loads a shell without loading the registry');
    const usesAt = shellAt >= 0 ? shellAt : v2At;
    assert.ok(registryAt < usesAt, page + ' loads the registry after the shell that needs it');
  }
  assert.ok(checked >= 10, 'expected every pane page to load a shell, found ' + checked);
});

test('no pane offers a custom range, because no bar on this dashboard can supply one', () => {
  const { PANES, RANGES } = registryOnly();
  const offering = Object.keys(PANES).filter((id) => Array.isArray(PANES[id].range)
    && PANES[id].range.indexOf('custom') !== -1);
  assert.deepEqual(offering, [],
    'a pane offers a custom range and this bar carries a range name and nothing '
    + 'else, so the only answer behind it is a refusal: ' + offering.join(', '));

  /* The label outlives the last pane that offered it, deliberately. It is the
     word a bar with date controls would use, and deleting it would take the
     only statement of what the value means with it. What happened offered one
     until the honesty pass; analytics and spend never did. */
  assert.ok(RANGES.custom, 'the label table lost the custom range it still names');

  /* So this cannot pass by every pane losing its range control. */
  const windowed = Object.keys(PANES).filter((id) => Array.isArray(PANES[id].range));
  assert.ok(windowed.length >= 3,
    'the range control has all but left the dashboard, so the assertion above '
    + 'is close to vacuous: ' + windowed.join(', '));
});

/* ============================ registry meets rail ====================== */

test('every pane the registry names is on the rail, at the href and label it gave', async () => {
  const { doc, registry } = await bootPane('overview', { definePane: () => {} });
  const rail = doc.getElementById('rail');
  const items = rail.querySelectorAll('.nav-item');

  const railed = Object.keys(registry.PANES).filter((id) => registry.PANES[id].railId);
  assert.equal(items.length, railed.length,
    'the rail and the registry disagree about how many panes there are');

  for (const id of railed) {
    const pane = registry.PANES[id];
    const matches = items.filter((a) => (a.getAttribute('href') || '').split('?')[0] === pane.file);
    assert.equal(matches.length, 1,
      'the rail has ' + matches.length + ' items for ' + pane.file + ', expected exactly one');
    assert.equal(matches[0].getAttribute('data-rail-id'), pane.railId,
      pane.file + ' was stamped with the wrong rail id, so its badge would land elsewhere');
    assert.match(allText(matches[0]), new RegExp(pane.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      pane.file + ' is on the rail under a different name than the registry gives it');
  }
});

test('every railId the registry gives is an id aria.js actually has', async () => {
  const registry = registryOnly();
  const railed = Object.keys(registry.PANES).filter((id) => registry.PANES[id].railId);

  /* aria.js keeps its own list of rail items and this file cannot edit it, so
     the pairing is checked through the one thing aria.js does with an id:
     it marks that item as the current page. An id aria.js does not have marks
     nothing, which is a rail with no "you are here" on it. */
  for (const id of railed) {
    const { doc } = await bootPane(id, {
      file: registry.PANES[id].file, definePane: () => {},
    });
    const current = doc.getElementById('rail').querySelectorAll('[aria-current]');
    assert.equal(current.length, 1,
      id + ' has railId "' + registry.PANES[id].railId
      + '", which aria.js does not know: ' + current.length + ' items marked current');
  }

  /* The other direction, so the check above cannot pass by aria.js marking
     everything. */
  const { doc } = await bootPane('overview', { definePane: () => {} });
  const rail = doc.getElementById('rail');
  assert.equal(rail.querySelectorAll('[aria-current]').length, 1);
  assert.ok(rail.querySelectorAll('.nav-item').length > 1,
    'the rail has one item, so "marked once" says nothing');
});

test('the pane being viewed is the one marked current, and it is marked once', async () => {
  const { doc, registry } = await bootPane('spend', {
    file: 'spend.html', definePane: () => {},
  });
  const current = doc.getElementById('rail').querySelectorAll('[aria-current]');
  assert.equal(current.length, 1);
  assert.equal(
    (current[0].getAttribute('href') || '').split('?')[0],
    registry.PANES.spend.file
  );
});

/* ============================== the filter bar ========================= */

/* The controls a bar actually drew, by kind, so a test can compare them
   against what the pane declared rather than against a screenshot. */
function controlsOn(doc) {
  const bar = doc.querySelector('.filters');
  if (!bar) return { present: false, app: 0, range: 0, env: 0, notes: [] };
  return {
    present: true,
    app: bar.querySelectorAll('.seg').length,
    range: bar.querySelectorAll('[id="fRange"]').length,
    env: bar.querySelectorAll('[id="fEnv"]').length,
    notes: bar.querySelectorAll('.filter-note').map((n) => n.textContent),
  };
}

test('a pane is offered exactly the filters it declared, and never one more', async () => {
  const registry = registryOnly();
  for (const id of Object.keys(registry.PANES)) {
    const pane = registry.PANES[id];
    const { doc } = await bootPane(id, { file: pane.file, definePane: () => {} });
    const drawn = controlsOn(doc);

    assert.equal(drawn.app, pane.scope ? 1 : 0,
      id + (pane.scope ? ' lost its App control' : ' grew an App control it cannot honour'));
    assert.equal(drawn.range, pane.range ? 1 : 0,
      id + (pane.range ? ' lost its Range control' : ' grew a Range control it cannot honour'));
    assert.equal(drawn.env, pane.env ? 1 : 0,
      id + (pane.env ? ' lost its Env control' : ' grew an Env control it cannot honour'));
  }
});

test('a pane whose design shows a control nothing can carry says so where it would be', async () => {
  const registry = registryOnly();
  const noted = Object.keys(registry.PANES)
    .filter((id) => registry.PANES[id].filterNote || registry.PANES[id].scopeNote);
  assert.ok(noted.length >= 3, 'the registry stopped stating any absent control');

  for (const id of noted) {
    const pane = registry.PANES[id];
    const { doc } = await bootPane(id, { file: pane.file, definePane: () => {} });
    const drawn = controlsOn(doc);
    for (const note of [pane.scopeNote, pane.filterNote]) {
      if (!note) continue;
      assert.ok(drawn.notes.indexOf(note) !== -1,
        id + ' dropped the note that says the control is missing: ' + note);
    }
  }
});

test('Overview offers no control at all and states the absence instead', async () => {
  const { doc } = await bootPane('overview', { definePane: () => {} });
  const drawn = controlsOn(doc);
  assert.equal(drawn.present, true, 'the bar vanished, so the absence is unstated');
  assert.deepEqual([drawn.app, drawn.range, drawn.env], [0, 0, 0]);
  assert.equal(doc.querySelector('.filters').querySelectorAll('select').length, 0);
  assert.equal(doc.querySelector('.filters').querySelectorAll('button').length, 0);
  assert.equal(drawn.notes.length, 1);
  assert.match(drawn.notes[0], /do not apply here yet/);
});

test('the range control starts on the pane default, not on the first option', async () => {
  const registry = registryOnly();
  const withDefault = Object.keys(registry.PANES).filter((id) => {
    const p = registry.PANES[id];
    return p.range && p.rangeDefault && p.range[0] !== p.rangeDefault;
  });
  assert.ok(withDefault.length >= 1, 'no pane distinguishes its default from its first option');

  for (const id of withDefault) {
    const pane = registry.PANES[id];
    const { shell } = await bootPane(id, { file: pane.file, definePane: () => {} });
    assert.equal(shell.filters().range, pane.rangeDefault,
      id + ' opened on ' + shell.filters().range + ' instead of its declared default');
  }
});

test('a range the pane does not offer is refused rather than accepted from the URL', async () => {
  const registry = registryOnly();
  const pane = registry.PANES.analytics;
  const { shell } = await bootPane('analytics', {
    file: 'analytics.html',
    href: 'https://ops.example.invalid/ops/analytics.html?range=custom',
    definePane: () => {},
  });
  assert.equal(shell.filters().range, pane.rangeDefault || pane.range[0],
    'a range that is not on the pane was taken from the querystring');
});

test('a link to another pane carries only the filters that pane has', async () => {
  const registry = registryOnly();
  const { shell } = await bootPane('analytics', {
    file: 'analytics.html',
    href: 'https://ops.example.invalid/ops/analytics.html?range=30d&env=staging&scope=aria',
    definePane: () => {},
  });

  const query = (href) => new URLSearchParams((href.split('?')[1] || ''));

  /* Every destination, not one: the rule is that a link carries the filters
     the destination has and never one it has not. */
  for (const id of Object.keys(registry.PANES)) {
    const pane = registry.PANES[id];
    const href = shell.paneHref(id);
    assert.equal(href.split('?')[0], pane.file, id + ' was linked to the wrong file');
    const carried = [...query(href).keys()];
    for (const key of carried) {
      assert.ok(pane[key], id + ' was sent a ' + key + ' it cannot act on');
    }
    if (pane.env) {
      assert.equal(query(href).get('env'), 'staging',
        id + ' has an Env control but dropped the environment on the way in');
    }
    if (!pane.scope && !pane.range && !pane.env) {
      assert.equal(href.indexOf('?'), -1,
        id + ' was linked to with a querystring it will ignore');
    }
  }

  /* The one the rule is really about: a range the destination does not offer
     is dropped rather than carried into a control that cannot show it. */
  const spendHref = shell.paneHref('spend');
  const spendRange = query(spendHref).get('range');
  if (spendRange !== null) {
    assert.ok(registry.PANES.spend.range.indexOf(spendRange) !== -1,
      'spend.html was handed the range ' + spendRange + ', which it does not offer');
  }
});

/* =========================== the pane's own controls ==================== */

/* The children of the filter bar, as class names in document order. Order is
   the assertion: the notes state an absent control and belong at the end of
   the bar, so a pane's own control has to land before them and after the
   shell's. */
function barOrder(doc) {
  const bar = doc.querySelector('.filters');
  return bar ? bar.childNodes.map((n) => n.getAttribute('class') || n.tagName) : null;
}

test("a pane's own control lands in the shared bar, before the notes", async () => {
  const { doc } = await bootPane('alerts', {
    file: 'alerts.html',
    definePane: (content, pane, shell) => {
      shell.paneFilters([shell.h('span', { className: 'filter-label', text: 'Severity' })]);
    },
  });

  const order = barOrder(doc);
  const slot = order.findIndex((c) => c.indexOf('filters-pane') !== -1);
  const note = order.findIndex((c) => c.indexOf('filter-note') !== -1);
  assert.ok(slot !== -1, 'the pane slot is not in the bar at all: ' + JSON.stringify(order));
  assert.ok(note !== -1, 'this pane has no filter note, so the order proves nothing');
  assert.ok(slot < note,
    'the pane control landed after the note that states an absent control: ' +
    JSON.stringify(order));

  /* And the shell's own control is still there. A slot that replaced the bar
     rather than joining it would pass every assertion above. */
  assert.equal(doc.querySelector('.filters').querySelectorAll('[id="fRange"]').length, 1,
    "the pane's control took the shell's range control off the bar");
});

test('a pane that renders its controls again replaces them rather than adding more', async () => {
  let shellRef = null;
  const { doc } = await bootPane('alerts', {
    file: 'alerts.html',
    definePane: (content, pane, shell) => {
      shellRef = shell;
      shell.paneFilters([shell.h('div', { className: 'seg', text: 'first' })]);
    },
  });

  const slot = doc.querySelector('.filters-pane');
  assert.equal(slot.childNodes.length, 1);
  assert.equal(slot.childNodes[0].textContent, 'first');

  shellRef.paneFilters([shellRef.h('div', { className: 'seg', text: 'second' })]);
  assert.equal(doc.querySelectorAll('.filters-pane').length, 1,
    'a second render grew a second slot');
  assert.equal(slot.childNodes.length, 1,
    'a re-render stacked the new controls on top of the old ones: ' +
    slot.childNodes.map((n) => n.textContent).join(', '));
  assert.equal(slot.childNodes[0].textContent, 'second');
});

test('a pane with no filter bar of its own gets one rather than losing its control', async () => {
  const registry = registryOnly();
  const bare = Object.keys(registry.PANES).filter((id) => {
    const p = registry.PANES[id];
    return !p.scope && !p.range && !p.env && !p.scopeNote && !p.filterNote;
  });
  assert.ok(bare.length >= 1, 'every pane now declares a filter, so this proves nothing');

  const id = bare[0];
  const { doc } = await bootPane(id, {
    file: registry.PANES[id].file,
    definePane: (content, pane, shell) => {
      shell.paneFilters([shell.h('div', { className: 'seg', text: 'mine' })]);
    },
  });

  const bar = doc.querySelector('.filters');
  assert.ok(bar, id + ' has no shell filters, so the control had nowhere to go');
  assert.equal(bar.querySelectorAll('.filters-pane').length, 1);
  assert.equal(bar.querySelector('.filters-pane').childNodes[0].textContent, 'mine');

  /* Where it went matters as much as that it went somewhere: above the
     content, not after it. */
  const main = doc.querySelector('.main');
  const kids = main.childNodes;
  assert.ok(kids.indexOf(bar) < kids.findIndex((n) => n.getAttribute('id') === 'content'),
    'the bar was put after the content');
});

/* ================================ role gating ========================== */

const ROLES = ['owner', 'operator', 'viewer'];

/* The panes a role can actually be shut out of. A pane that lists every role
   is documenting who may open it, not gating anything, so it is no test of the
   gate. */
function gatedPanes(registry) {
  return Object.keys(registry.PANES).filter((id) => {
    const roles = registry.PANES[id].roles;
    return roles && ROLES.some((r) => roles.indexOf(r) === -1);
  });
}

test('a role without access gets a named refusal, and one with access gets the pane', async () => {
  const registry = registryOnly();
  const gated = gatedPanes(registry);
  assert.ok(gated.length >= 1, 'no pane in the registry shuts any role out any more');

  for (const id of gated) {
    const pane = registry.PANES[id];
    const outsider = ROLES.find((r) => pane.roles.indexOf(r) === -1);

    const denied = await bootPane(id, {
      file: pane.file,
      session: { role: outsider },
      definePane: (content, p, shell) => {
        content.appendChild(shell.h('p', { text: 'the pane drew this' }));
      },
    });
    const deniedText = allText(denied.doc.getElementById('content'));
    assert.match(deniedText, /do not have access/, id + ' opened for ' + outsider);
    assert.doesNotMatch(deniedText, /the pane drew this/,
      id + ' ran its own module for ' + outsider + ', a role it shuts out');
    assert.match(deniedText, new RegExp(outsider, 'i'),
      id + ' refused ' + outsider + ' without saying what they are signed in as');
    assert.ok(deniedText.length > 40, id + ' refused ' + outsider + ' with a blank pane');

    const allowed = await bootPane(id, {
      file: pane.file,
      session: { role: pane.roles[0] },
      definePane: (content, p, shell) => {
        content.appendChild(shell.h('p', { text: 'the pane drew this' }));
      },
    });
    const allowedText = allText(allowed.doc.getElementById('content'));
    assert.match(allowedText, /the pane drew this/,
      id + ' was refused to ' + pane.roles[0] + ', a role it lists');
    assert.doesNotMatch(allowedText, /do not have access/);
  }
});

test('the rail marks a pane this role cannot open, in words as well as in tone', async () => {
  const registry = registryOnly();
  const gated = gatedPanes(registry)[0];
  const pane = registry.PANES[gated];
  const outsider = ROLES.find((r) => pane.roles.indexOf(r) === -1);

  const { doc } = await bootPane('overview', {
    session: { role: outsider }, definePane: () => {},
  });
  const item = doc.getElementById('rail')
    .querySelectorAll('[data-rail-id="' + pane.railId + '"]')[0];
  assert.ok(item, 'the gated pane left the rail');
  assert.match(allText(item), /locked/, 'the locked pane is marked by colour alone');
  assert.match(allText(item), new RegExp(pane.roles[0]),
    'the rail says locked without saying who it is locked to');

  const open = await bootPane('overview', {
    session: { role: pane.roles[0] }, definePane: () => {},
  });
  const openItem = open.doc.getElementById('rail')
    .querySelectorAll('[data-rail-id="' + pane.railId + '"]')[0];
  assert.doesNotMatch(allText(openItem), /locked/,
    'a pane this role can open is still marked locked');
  assert.equal(open.doc.getElementById('rail').querySelectorAll('.nav-badge').length, 0,
    'a badge appeared for a role that is locked out of nothing');
});

/* ============================ pane registration ======================== */

test('a pane with no module on the page says it is not built, and names the wave', async () => {
  const { doc, registry } = await bootPane('releases', { file: 'releases.html' });
  const content = allText(doc.getElementById('content'));
  assert.match(content, /Not built yet/);
  assert.match(content, new RegExp(registry.PANES.releases.wave));
  assert.match(content, new RegExp(
    registry.PANES.releases.question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ));
});

test('a pane module that loads after the bootstrap still draws, because parsing is waited for', async () => {
  /* The <script> that registers a pane comes after the one that boots the
     shell, so on a slow document the shell can reach "which pane is this" with
     nothing registered yet. Waiting for parsing is what stops script order
     deciding whether a built pane renders as built. */
  const { doc } = await bootPane('releases', {
    file: 'releases.html',
    readyState: 'loading',
    lateDefinePane: (content, pane, shell) => {
      content.appendChild(shell.h('p', { text: 'registered after the shell started' }));
    },
  });
  const text = allText(doc.getElementById('content'));
  assert.match(text, /registered after the shell started/,
    'a pane module that loaded after the shell was treated as not built');
  assert.doesNotMatch(text, /Not built yet/);
});

test('a pane with a module draws it and never the not-built state', async () => {
  let gotPane = null;
  const { doc, registry } = await bootPane('releases', {
    file: 'releases.html',
    definePane: (content, pane, shell) => {
      gotPane = pane;
      content.appendChild(shell.h('p', { text: 'built and drawn' }));
    },
  });
  const content = allText(doc.getElementById('content'));
  assert.match(content, /built and drawn/);
  assert.doesNotMatch(content, /Not built yet/);
  assert.equal(gotPane, registry.PANES.releases,
    'the pane module was handed something other than its own registry entry');
});

/* ================================ the gates ============================ */

test('a confirmed session leaves exactly one main, one h1 and no other gate', async () => {
  const { doc, body } = await bootPane('overview', { definePane: () => {} });
  assert.equal(body.className, 'is-ready');
  assert.equal(doc.querySelectorAll('.gate-boot').length, 0, 'the boot gate stayed on the page');
  assert.equal(doc.querySelectorAll('.gate-failed').length, 0, 'the failed gate stayed on the page');
  assert.equal(doc.querySelectorAll('main').length, 1, 'more than one landmark survived');
  assert.equal(doc.querySelectorAll('h1').length, 1, 'more than one h1 survived');
});

test('a session that cannot be checked shows the failure and takes the other gates away', async () => {
  const err = new Error('The operations API did not answer.');
  err.code = 'ops_bad_response';
  const { doc, body } = await bootPane('overview', {
    session: { bootRejects: err }, definePane: () => {},
  });

  assert.equal(body.className, 'is-failed');
  assert.equal(doc.querySelectorAll('.gate-boot').length, 0);
  assert.equal(doc.querySelectorAll('.gate-app').length, 0, 'the app gate survived a failed boot');
  assert.equal(doc.querySelectorAll('#app').length, 0, 'a half-built shell is still in the document');

  const failed = doc.getElementById('gateFailed');
  assert.match(allText(failed), /unreadable/, 'the failure code was not translated');
  assert.match(allText(failed), /Nothing has been signed out/);
  assert.equal(doc.activeElement, failed, 'focus was left on a gate that is gone');
});

test('nothing renders before the session resolves', async () => {
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  const dom = makeDom({ tokens: TOKENS });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body, 'overview');
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = fakeSession({});
  dom.window.OpsSession.boot = () => gate;

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(body.className, 'is-booting');
  assert.equal(dom.doc.querySelectorAll('#rail').length, 0, 'the rail was drawn before the gate');
  assert.equal(dom.doc.querySelectorAll('#content').length, 0);
  assert.equal(dom.doc.getElementById('app').children.length, 0);

  release({ admin: { role: 'owner' } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(body.className, 'is-ready');
  assert.equal(dom.doc.querySelectorAll('#rail').length, 1);
});

/* ============================== rail badges ============================ */

test('the rail carries no count nobody passed, and a count taken away goes away', async () => {
  const { doc, shell } = await bootPane('overview', { definePane: () => {} });
  const rail = doc.getElementById('rail');
  assert.equal(rail.querySelectorAll('.nav-badge').length, 0,
    'a badge appeared that no pane asked for');

  shell.setBadge('alerts', { label: '2', tone: 'hot', description: '2 problems with nobody on them' });
  const badges = rail.querySelectorAll('.nav-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, '2');
  const item = rail.querySelectorAll('[data-rail-id="alerts"]')[0];
  assert.match(allText(item), /2 problems with nobody on them/,
    'the count is a bare number to a screen reader');

  shell.setBadge('alerts', null);
  assert.equal(rail.querySelectorAll('.nav-badge').length, 0, 'a stale count survived');
  assert.equal(rail.querySelectorAll('.nav-badge-sr').length, 0,
    'the spoken half of a removed count survived');

  shell.setBadge('alerts', { label: '', description: 'nothing' });
  assert.equal(rail.querySelectorAll('.nav-badge').length, 0,
    'an empty label was drawn as a badge');
});

test('the account footer comes from the session and is absent when there is none', async () => {
  const signedIn = await bootPane('overview', { definePane: () => {} });
  const foot = signedIn.doc.querySelector('.rail-foot');
  assert.ok(foot, 'a confirmed session drew no account footer');
  assert.match(allText(foot), /owner@example\.invalid/);
  assert.match(allText(foot), /Owner/);

  const anonymous = await bootPane('overview', {
    session: { admin: null }, definePane: () => {},
  });
  assert.equal(anonymous.doc.querySelectorAll('.rail-foot').length, 0,
    'an account footer was invented for a session with no admin on it');
});

/* ============================ the four states ========================== */

test('each of the four states shows its own content and hides the other three', async () => {
  let region = null;
  const { doc } = await bootPane('overview', {
    definePane: (content) => { region = doc.window ? null : null; },
  });
  /* definePane above runs before `doc` is assigned, so the region is taken
     from the shell afterwards over the same content element. */
  const boot = await bootPane('overview', {
    definePane: (content) => { content.setAttribute('data-content', 'yes'); },
  });
  const shell = boot.shell;
  const content = boot.doc.getElementById('content');
  region = shell.region(content);

  const shown = () => findAll(content, (n) => n.hasAttribute('data-state'))
    .filter((n) => n.hasAttribute('data-shown'))
    .map((n) => n.getAttribute('data-state'));

  region.loading([{ type: 'block', height: 10 }]);
  assert.deepEqual(shown(), ['loading']);

  const live = boot.doc.createElement('p');
  live.textContent = 'the figures';
  region.show(live);
  assert.deepEqual(shown(), ['live degraded']);

  const nothing = boot.doc.createElement('p');
  nothing.textContent = 'nothing here';
  region.empty(nothing);
  assert.deepEqual(shown(), ['empty']);

  region.failed(new Error('the read did not land'), null);
  assert.deepEqual(shown(), ['live degraded'],
    'a failed read fell into the empty state, which claims there is nothing here');
  assert.match(allText(content), /the read did not land/);
  assert.match(allText(content), /Nothing here is a zero/);
});

/* ============================== formatters ============================= */

/* The bootstrap carries its own copy of the v1 formatters, because both v1
   modules read OpsShell at module scope and would drag the v1 design system
   onto a v2 page. Two implementations of "what does a person read here" is a
   real risk while both systems are live, so both are run over one table. */
function v1Formatters() {
  const dom = makeDom({ tokens: TOKENS });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  dom.window.OpsSession = fakeSession();
  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(V1_SHELL_SRC, dom.window, { filename: 'shell.js' });
  vm.runInContext(read('assets/operate.js'), dom.window, { filename: 'operate.js' });
  vm.runInContext(read('assets/alerts-model.js'), dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(read('assets/pane-data.js'), dom.window, { filename: 'pane-data.js' });
  return { operate: dom.window.OpsOperate, data: dom.window.OpsPaneData };
}

const ISO = '2026-08-01T09:00:00.000Z';
const NUMBERS = [0, 1, 7, 49, 50, 999, 1000, 1234567, -3, 0.4, 0.5, 1.5, NaN, Infinity];
const MAYBE = [null, undefined, '', 'not a date', ISO, '2026-08-01T00:00:00.000Z'];

test('every formatter the bootstrap carries agrees with the v1 one it came from', async () => {
  const { shell } = await bootPane('overview', { definePane: () => {} });
  const v1 = v1Formatters();
  const fmt = shell.fmt;

  for (const n of NUMBERS) {
    assert.equal(fmt.isNum(n), v1.operate.fmt.isNum(n), 'isNum disagreed on ' + n);
    assert.equal(fmt.int(n), v1.operate.fmt.int(n), 'int disagreed on ' + n);
    assert.equal(fmt.plural(n, 'day'), v1.operate.fmt.plural(n, 'day'),
      'plural disagreed on ' + n);
    assert.equal(fmt.plural(n, 'person', 'people'), v1.operate.fmt.plural(n, 'person', 'people'),
      'plural with an irregular plural disagreed on ' + n);
    assert.equal(fmt.percent(n), v1.data.percent(n), 'percent disagreed on ' + n);
    assert.equal(fmt.signedPercent(n), v1.data.signedPercent(n),
      'signedPercent disagreed on ' + n);
    assert.equal(fmt.money(n, 'USD'), v1.data.money(n, 'USD'), 'money disagreed on ' + n);
    assert.equal(fmt.hours(n), v1.data.hours(n), 'hours disagreed on ' + n);
  }

  for (const v of MAYBE) {
    assert.equal(fmt.clock(v), v1.operate.fmt.clock(v), 'clock disagreed on ' + v);
    assert.equal(fmt.stamp(v), v1.operate.fmt.stamp(v), 'stamp disagreed on ' + v);
    assert.equal(fmt.utcStamp(v), v1.data.utcStamp(v), 'utcStamp disagreed on ' + v);
    assert.equal(fmt.utcDay(v), v1.data.utcDay(v), 'utcDay disagreed on ' + v);
    assert.equal(fmt.hoursSince(v), v1.data.hoursSince(v), 'hoursSince disagreed on ' + v);
  }

  /* ago() and since() are read against a fixed clock, because both are
     relative to now and would otherwise agree by racing rather than by
     matching. */
  const now = Date.parse('2026-08-01T12:00:00.000Z');
  const realNow = Date.now;
  Date.now = () => now;
  try {
    for (const v of MAYBE.concat(['2026-08-01T11:59:30.000Z', '2026-07-30T09:00:00.000Z'])) {
      assert.equal(fmt.ago(v), v1.operate.fmt.ago(v), 'ago disagreed on ' + v);
      assert.equal(fmt.since(v), v1.operate.fmt.since(v), 'since disagreed on ' + v);
    }
  } finally {
    Date.now = realNow;
  }
});

test('a formatter handed nothing prints the same placeholder on both systems', async () => {
  const { shell } = await bootPane('overview', { definePane: () => {} });
  const v1 = v1Formatters();
  for (const missing of [null, undefined, NaN, 'x']) {
    assert.equal(shell.fmt.int(missing), v1.operate.fmt.int(missing));
    assert.equal(shell.fmt.money(missing, 'USD'), v1.data.money(missing, 'USD'));
    assert.doesNotMatch(String(shell.fmt.int(missing)), /NaN|undefined/);
    assert.doesNotMatch(String(shell.fmt.money(missing, 'USD')), /NaN|undefined/);
  }
});

/* ============================== the fixture hook ======================= */

test('the local fixture hook is off anywhere that is not this machine', async () => {
  const off = await bootPane('overview', {
    href: 'https://ops.example.invalid/ops/index.html', definePane: () => {},
  });
  assert.equal(off.shell.isLoopback(), false);

  const on = await bootPane('overview', {
    href: 'http://127.0.0.1:8000/ops/index.html', definePane: () => {},
  });
  assert.equal(on.shell.isLoopback(), true);
});

test('a fixture path with a control character or whitespace in it is refused', async () => {
  const { shell } = await bootPane('overview', {
    href: 'http://127.0.0.1:8000/ops/index.html', definePane: () => {},
  });
  assert.equal(shell.safeHref('fixtures/o\u0000k.json'), null);
  assert.equal(shell.safeHref('fixtures/o k.json'), null);
  assert.ok(shell.safeHref('fixtures/ok.json'), 'a same-origin relative path was refused');
});

/* The three refusals below are separate tests because each one is the only
   thing that binds one line of safeHref(). Rolled into one test they would
   pass on any single line surviving, which is exactly how the first published
   evidence for this helper came to claim a line was pinned when it was not.

   Same-origin absolutes and same-host protocol-relatives are the cases that
   matter: a cross-origin string is caught by the origin comparison as well, so
   a test that only sends evil.example.invalid cannot tell the scheme test and
   the origin test apart. */
test('a fixture path written as an absolute URL is refused, even on this origin', async () => {
  const { shell } = await bootPane('overview', {
    href: 'http://127.0.0.1:8000/ops/index.html', definePane: () => {},
  });
  assert.equal(shell.safeHref('http://127.0.0.1:8000/ops/fixtures/ok.json'), null);
  assert.equal(shell.safeHref('javascript:alert(1)'), null);
});

test('a fixture path written protocol-relative is refused, even to this host', async () => {
  const { shell } = await bootPane('overview', {
    href: 'http://127.0.0.1:8000/ops/index.html', definePane: () => {},
  });
  assert.equal(shell.safeHref('//127.0.0.1:8000/ops/fixtures/ok.json'), null);
  assert.equal(shell.safeHref('\\\\127.0.0.1:8000/ops/fixtures/ok.json'), null);
});

test('a fixture path off this origin is refused', async () => {
  const { shell } = await bootPane('overview', {
    href: 'http://127.0.0.1:8000/ops/index.html', definePane: () => {},
  });
  assert.equal(shell.safeHref('http://evil.example.invalid/x.json'), null);
  assert.equal(shell.safeHref('//evil.example.invalid/x.json'), null);
});

/* Round eight: the module docblock listed 18 of the 23 exported names and
   ops/README.md's table listed 22, while both called themselves "the whole
   surface". Three sibling panes are being built against those two documents,
   so a name they omit is a name nobody uses and a name they invent is a
   support question.

   Both directions are asserted, because the one-direction version of this test
   would pass on a document that listed a function the module does not export. */
function documentedInDocblock(src) {
  const start = src.indexOf('Public surface — window.OpsPaneShell:');
  assert.ok(start > 0, 'the docblock no longer names its public surface');
  const end = src.indexOf('That list is the whole of it', start);
  assert.ok(end > start, 'the docblock no longer closes its public surface list');
  const names = new Set();
  for (const line of src.slice(start, end).split('\n')) {
    /* The left column: everything before the run of spaces that starts the
       description. A continuation line is indented past it and has none. */
    const m = /^\s{5}(\S.*?)(?:\s{2,}|$)/.exec(line);
    if (!m) continue;
    for (const part of m[1].split('/')) {
      const name = part.trim().replace(/\(.*$/, '');
      if (/^[a-zA-Z][A-Za-z0-9]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

function documentedInReadme(src) {
  const start = src.indexOf('`window.OpsPaneShell` is the whole surface');
  assert.ok(start > 0, 'ops/README.md no longer names the bootstrap surface');
  const end = src.indexOf('\n\n', src.indexOf('|---|---|', start));
  const names = new Set();
  for (const row of src.slice(start, end).split('\n')) {
    if (!row.startsWith('| `')) continue;
    const left = row.slice(1, row.indexOf('|', 1));
    for (const [, name] of left.matchAll(/`([A-Za-z][A-Za-z0-9]*)(?:\([^`]*\))?`/g)) names.add(name);
  }
  return names;
}

test('the docblock and the README name exactly what the module exports', async () => {
  const dom = await bootPane('overview', {});
  const exported = Object.keys(dom.shell).sort();
  assert.ok(exported.length > 15, 'only ' + exported.length + ' names exported, so this is not reading the module');

  for (const [where, documented] of [
    ['the shell-pane-v2.js docblock', documentedInDocblock(SHELL_SRC)],
    ['ops/README.md', documentedInReadme(read('README.md'))],
  ]) {
    const missing = exported.filter((name) => !documented.has(name));
    const invented = [...documented].filter((name) => exported.indexOf(name) === -1);
    assert.deepEqual(missing, [], where + ' does not name ' + missing.join(', ') +
      ', which the module exports');
    assert.deepEqual(invented, [], where + ' names ' + invented.join(', ') +
      ', which the module does not export');
  }
});

/* ================= the re-authentication dialog, on a v2 pane =========== */

/* assets/session.js raises one dialog over whatever page is open, asking for
   the password again in front of a privileged action, and it writes v1 class
   names that assets/ops.css styles. A v2 pane loads none of ops.css, so the
   dialog rendered on all nine of them as unstyled block content over a dimmed
   backdrop until shell-pane-v2.css carried the rules across
   (Stadiora/Aria#10447). ops/spend.html is still a v1 page and was never
   affected. No v2 suite rendered session.js markup at all, which
   is why nothing said so.

   Everything below opens the real dialog, over a real booted pane, and reads
   the real sheets. */

/* Opens the dialog the way the shell's own code would: over a booted pane,
   with both live-region hosts already created, from a control that had focus.
   session.js is loaded after the shell so the shell keeps the fake session it
   captured at module scope and the real promptReauth is still the one on
   test. */
/* Every close path in the dialog resolves its promise, so a pending promise
   is a defect rather than a slow answer. Bounded so it is reported as one. */
const PENDING = Symbol('still pending');
function settled(promise) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(PENDING), 50))])
    .then((v) => { assert.notEqual(v, PENDING, 'the dialog never settled, so nothing closed it'); return v; });
}

async function openReauth(options) {  const opts = options || {};
  const dom = await bootPane(opts.pane || 'overview', {
    definePane: (content, pane, shell) => {
      content.appendChild(shell.h('button', { type: 'button', id: 'act', text: 'Suspend' }));
    },
    ...opts,
  });

  /* Created before the dialog opens, because the exclusion they exist for
     cannot be tested against hosts that were never created. */
  dom.shell.announce('ready');
  dom.shell.toast('check', 'saved');

  dom.window.OpsApi = {
    OpsApiError: function OpsApiError(message) { this.message = message; },
    call: () => Promise.resolve({ data: {} }),
  };
  dom.window.navigator = { userAgent: 'node' };
  dom.window.crypto = globalThis.crypto;
  vm.runInContext(SESSION_SRC, dom.window, { filename: 'session.js' });
  const session = dom.window.OpsSession;

  /* The stub has no `inert`, so `'inert' in el` is false on it and only the
     aria-hidden half of the backdrop would be exercised. Seeding the property
     is what a browser presents, and it puts the other half on test. */
  const seedInert = (el) => { el.inert = false; };
  dom.body.children.forEach(seedInert);
  const appWrap = dom.doc.getElementById('app');
  if (appWrap) appWrap.children.forEach(seedInert);

  const invoker = dom.doc.getElementById('act');
  if (invoker) invoker.focus();

  const pending = session.promptReauth(opts.maxAgeSeconds || 300);
  const modal = dom.body.children.filter((el) => el.classList.contains('modal'))[0];
  const scrim = dom.body.children.filter((el) => el.classList.contains('scrim'))[0];
  assert.ok(modal, 'session.js raised no dialog');
  return {
    ...dom, session, pending, invoker, modal, scrim,
    card: modal.querySelector('.modal-card'),
    input: modal.querySelector('.field-input'),
    alert: modal.querySelector('.form-alert'),
    title: modal.querySelector('.sec-title'),
    hint: modal.querySelector('.field-hint'),
  };
}

/* --------------------- the sheets a v2 pane loads, as a cascade --------- */

/* Enough CSS to answer one question: given the two sheets every v2 pane page
   loads, in that order, which declaration wins on THIS element of the dialog
   that session.js actually built. Asserting that a selector string is present
   in a file would pin the string; this resolves the cascade over the real
   element tree, so a rule that exists but cannot reach the dialog counts for
   nothing.

   What it reads: class, id, type and attribute selectors, `:empty`,
   descendant combinators, and `@media` width queries. `[data-theme="light"]`
   is read the same way a browser reads it, against the attribute the harness
   root actually carries, so the caller resolves the sheet once per theme
   rather than once. Review round two found this pass resolving the dark
   theme ONLY, with every light-theme rule aimed at the dialog dismissed in
   silence, and found a readable `[attr]` or `#id` compound matched STRICTLY
   inside a pass documented as loose — the same unsafe direction as the
   sibling-combinator hole above, in a different token type.

   What it REFUSES BY NAME rather than skipping: an `!important` declaration,
   a media feature it cannot evaluate, and any selector it cannot read that
   COULD still reach the dialog — reachability judged by the loosest reading
   of each combinator in turn, `>` and descendant both read as "some
   ancestor", `+` and `~` both read as "some earlier sibling", every
   unreadable pseudo taken as matching, so a rule is only dismissed when no
   reading of it applies here. Reading a sibling combinator as a descendant
   would NARROW instead, and a sibling rule aimed at the dialog would be
   dropped before the refusal could fire. A guard that silently drops what it
   cannot parse reports a clean sweep over the half of the sheet it
   understood.

   NOT COVERED: interaction and structural state — `:hover`, `:focus-visible`,
   `:disabled`, `::before` and the like are excluded from the resting cascade
   by design, so nothing here says what the dialog looks like while a control
   is hovered or focused, and the outranking sweep below skips every rule
   carrying a `:` for the same reason.

   NOT COVERED: a declaration that reaches the dialog through a selector
   naming NONE of the classes, ids or attribute names this tree carries — a
   bare type selector (`input { … }`), a universal, or an attribute this tree
   does not have. The candidate filter below never considers those rules. It
   reads ids and attribute names as well as classes, and collects them from
   the dialog's ancestors as well as from the dialog, because `#reauthPassword`
   and `[type="password"]` are on the field and `[data-theme]` is on <html>;
   a classes-only filter dropped all three.

   NOT COVERED: anything only a layout engine can answer — computed size,
   wrapping, overlap. The pixels are measured in a browser and reported on the
   pull request. */

const STATE_PSEUDO = /^:(hover|focus|focus-visible|focus-within|active|disabled|checked|visited|target|placeholder)$/;

function tokenise(compound) {
  const tokens = [];
  let i = 0;
  while (i < compound.length) {
    const rest = compound.slice(i);
    const m = /^(\*|[a-zA-Z][-\w]*|\.[-\w]+|#[-\w]+|\[[^\]]*\]|::?[-\w]+(?:\([^)]*\))?)/.exec(rest);
    if (!m) return null;
    tokens.push(m[1]);
    i += m[1].length;
  }
  return tokens.length ? tokens : null;
}

function classesOf(el) { return (el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }

/* A browser reflects `el.id = 'x'` and `el.type = 'password'` back onto the
   attribute; the harness keeps them as plain properties, so a rule aimed at
   either would be invisible here for a reason that does not exist in the
   product. session.js writes both onto the password field (`session.js:1040`
   and `:1041`), which is the element this suite asserts a font size on. */
const REFLECTED = { id: 'id', class: 'className', type: 'type', for: 'htmlFor' };

function attrOf(el, name) {
  if (el.hasAttribute && el.hasAttribute(name)) return el.getAttribute(name);
  const prop = REFLECTED[name];
  const got = prop ? el[prop] : undefined;
  return got === undefined || got === null || got === '' ? null : String(got);
}

/* `:has(> .x)` and `:has(.x)` only — one compound, one optional child
   combinator. Anything richer is refused by name rather than guessed at. */
const HAS_ARG = /^:has\(\s*(>\s*)?([^\s()>+~,]+)\s*\)$/;

function descendants(el, out = []) {
  for (const child of el.children || []) { out.push(child); descendants(child, out); }
  return out;
}

function matchToken(token, el, loose) {
  if (token[0] === '.') return classesOf(el).indexOf(token.slice(1)) !== -1;
  if (token[0] === '#') return attrOf(el, 'id') === token.slice(1);
  if (token[0] === '[') {
    const m = /^\[([^\]=~]+)(?:([~]?)=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/.exec(token);
    if (!m) return !!loose;
    const [, name, fuzzy, dq, sq, bare] = m;
    const got = attrOf(el, name);
    if (got === null) return false;
    const want = dq !== undefined ? dq : sq !== undefined ? sq : bare;
    if (want === undefined) return true;
    return fuzzy === '~' ? got.split(/\s+/).indexOf(want) !== -1 : got === want;
  }
  if (token[0] === ':') {
    if (token === ':empty') return (el.childNodes || []).length === 0;
    const has = HAS_ARG.exec(token);
    if (has) {
      const pool = has[1] ? (el.children || []) : descendants(el);
      return pool.some((d) => matchCompound(has[2], d, false));
    }
    if (token.startsWith(':has(')) throw new Error('REFUSED, unreadable :has() argument: ' + token);
    return !!loose;
  }
  if (token === '*') return true;
  return el.tagName.toLowerCase() === token.toLowerCase();
}

function matchCompound(compound, el, loose) {
  const tokens = tokenise(compound);
  if (!tokens) return !!loose;
  return tokens.every((t) => matchToken(t, el, loose));
}

/* Backtracking, not nearest-ancestor: `.a .b .c` can need a farther `.b`. */
function matchChain(compounds, index, node, loose) {
  if (index < 0) return true;
  let at = node;
  while (at && at.tagName) {
    if (matchCompound(compounds[index], at, loose)
      && matchChain(compounds, index - 1, at.parentNode, loose)) return true;
    at = at.parentNode;
  }
  return false;
}

function selectorMatches(compounds, el, loose) {
  if (!matchCompound(compounds[compounds.length - 1], el, loose)) return false;
  return matchChain(compounds, compounds.length - 2, el.parentNode, loose);
}

/* The reachability pass keeps each combinator rather than throwing it away.
   Reading `>` as a descendant WIDENS, so a rule written with one is still
   considered and then refused by name below. Reading `+` or `~` as a
   descendant NARROWS, and a sibling rule that genuinely reaches the dialog
   would be dismissed here instead -- silently, which is the one thing this
   resolver promises not to do. session.js appends the label and the password
   field back to back inside the card, so `.field-label + .field-input` is a
   live shape on this exact tree, not a hypothetical one. */
function parseSelector(selector) {
  const trimmed = selector.trim();
  const masked = maskGroups(trimmed);
  const parts = []; let at = 0;
  const re = /\s*([>+~])\s*|\s+/g;
  let m;
  while ((m = re.exec(masked))) {
    parts.push({ compound: trimmed.slice(at, m.index), after: m[1] || ' ' });
    at = m.index + m[0].length;
  }
  parts.push({ compound: trimmed.slice(at), after: null });
  return parts.every((p) => p.compound) && parts.length ? parts : null;
}

function reachesFrom(parts, index, node) {
  if (index < 0) return true;
  const pool = [];
  if (parts[index].after === '+' || parts[index].after === '~') {
    /* Any earlier sibling, not only the adjacent one: `+` is a special case
       of `~`, so taking both as `~` is the wider reading. */
    for (const sib of (node.parentNode ? node.parentNode.children : [])) {
      if (sib === node) break;
      pool.push(sib);
    }
  } else {
    let at = node.parentNode;
    while (at && at.tagName) { pool.push(at); at = at.parentNode; }
  }
  return pool.some((cand) => matchCompound(parts[index].compound, cand, true)
    && reachesFrom(parts, index - 1, cand));
}

function selectorReaches(selector, el) {
  const parts = parseSelector(selector);
  if (!parts) return true;
  if (!matchCompound(parts[parts.length - 1].compound, el, true)) return false;
  return reachesFrom(parts, parts.length - 2, el);
}

/* Splitting and combinator detection happen at bracket depth zero, so a `>`
   inside `:has(> .x)` or a space inside `[a="b c"]` is not read as structure. */
function maskGroups(selector) {
  let depth = 0; let out = '';
  for (const ch of selector) {
    if (ch === '(' || ch === '[') { depth += 1; out += ch; continue; }
    if (ch === ')' || ch === ']') { depth -= 1; out += ch; continue; }
    out += depth > 0 ? '\u0000' : ch;
  }
  return out;
}

function splitSelector(selector, pattern) {
  const masked = maskGroups(selector);
  const parts = []; let at = 0;
  const re = new RegExp(pattern, 'g');
  let m;
  while ((m = re.exec(masked))) { parts.push(selector.slice(at, m.index)); at = m.index + m[0].length; }
  parts.push(selector.slice(at));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function hasCombinator(selector) { return /[>+~]/.test(maskGroups(selector)); }

function specificity(compounds) {
  let ids = 0; let classes = 0; let types = 0;
  for (const compound of compounds) {
    for (const t of tokenise(compound) || []) {
      if (t[0] === '#') ids += 1;
      else if (t[0] === '.' || t[0] === '[') classes += 1;
      else if (t.startsWith('::')) types += 1;
      /* `:has()` contributes the specificity of its argument, not its own. */
      else if (HAS_ARG.test(t)) { const s = specificity([HAS_ARG.exec(t)[2]]); ids += Math.floor(s / 10000); classes += Math.floor((s % 10000) / 100); types += s % 100; }
      else if (t[0] === ':') classes += 1;
      else if (t !== '*') types += 1;
    }
  }
  return ids * 10000 + classes * 100 + types;
}

function cssRules(src, sheet) {
  const out = [];
  (function walk(text, media) {
    let i = 0;
    while (i < text.length) {
      const brace = text.indexOf('{', i);
      if (brace < 0) break;
      const prelude = text.slice(i, brace).trim();
      let depth = 1;
      let j = brace + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
        j += 1;
      }
      const body = text.slice(brace + 1, j - 1);
      if (prelude[0] === '@') {
        if (/^@media\b/.test(prelude)) {
          walk(body, (media || []).concat(prelude.slice(6).trim().split(/\s+and\s+/)));
        } else if (!/^@(keyframes|font-face)\b/.test(prelude)) {
          throw new Error('REFUSED, unreadable at-rule in ' + sheet + ': ' + prelude);
        }
      } else {
        for (const one of prelude.split(',')) {
          const selector = one.trim();
          if (selector) out.push({ sheet, selector, body, media: media || [], order: out.length });
        }
      }
      i = j;
    }
  })(src.replace(/\/\*[\s\S]*?\*\//g, ''), null);
  return out;
}

function declarations(rule) {
  const map = new Map();
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let i = 0; i < rule.body.length; i += 1) {
    const c = rule.body[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ';' && depth === 0) { parts.push(rule.body.slice(start, i)); start = i + 1; }
  }
  parts.push(rule.body.slice(start));
  for (const part of parts) {
    if (!part.trim()) continue;
    const at = part.indexOf(':');
    assert.ok(at > 0, 'REFUSED, unreadable declaration in ' + rule.sheet + ' ' + rule.selector + ': ' + part.trim());
    const value = part.slice(at + 1).trim();
    assert.ok(!/!important/.test(value),
      'REFUSED, !important reaches the dialog from ' + rule.sheet + ' ' + rule.selector +
      ' and this resolver does not order importance');
    map.set(part.slice(0, at).trim(), value);
  }
  return map;
}

function mediaMatches(queries, env) {
  return queries.every((q) => {
    const m = /^\((max|min)-width:\s*(\d+)px\)$/.exec(q);
    if (m) return m[1] === 'max' ? env.width <= Number(m[2]) : env.width >= Number(m[2]);
    if (q === '(prefers-reduced-motion: reduce)') return !!env.reducedMotion;
    throw new Error('REFUSED, unreadable media query: ' + q);
  });
}

/* Every element of the dialog, with the sheets' rules already narrowed to the
   ones that could possibly touch it. */
function dialogTree(root) {
  const out = [];
  (function walk(node) {
    for (const child of node.childNodes || []) {
      if (!child.tagName) continue;
      out.push(child);
      walk(child);
    }
  })({ childNodes: root });
  return out;
}

function cascade(nodes, sheets) {
  /* The candidate filter. A rule is considered when it names something this
     tree actually carries. Classes alone are not enough: session.js writes
     `id="reauthPassword"` and `type="password"` onto the password field, and
     shell-pane-v2.css themes the dialog through `[data-theme="light"]` on
     <html>, so ids and attribute names count too, and they are collected from
     the dialog's ANCESTORS as well as from the dialog itself. */
  const named = new Set();
  const seen = new Set();
  for (const start of nodes) {
    for (let el = start; el && el.tagName; el = el.parentNode) {
      if (seen.has(el)) break;
      seen.add(el);
      for (const c of classesOf(el)) named.add('\\.' + c + '(?![-\\w])');
      const id = attrOf(el, 'id');
      if (id) named.add('#' + id + '(?![-\\w])');
      for (const a of (el.attributeNames || [])) named.add('\\[\\s*' + a + '(?=[\\]~^$*|=\\s])');
      for (const a of Object.keys(REFLECTED)) {
        if (attrOf(el, a) !== null) named.add('\\[\\s*' + a + '(?=[\\]~^$*|=\\s])');
      }
    }
  }
  const CANDIDATE = new RegExp([...named].join('|'));

  const rules = [];
  let order = 0;
  for (const [sheet, src] of sheets) {
    for (const rule of cssRules(src, sheet)) {
      if (!CANDIDATE.test(rule.selector)) continue;
      rule.order = order;
      order += 1;

      /* The loosest possible reading, combinator by combinator: descendant
         and child both read as "some ancestor", adjacent and general sibling
         both read as "some earlier sibling", every unreadable pseudo taken as
         matching. A rule no element here matches even under that reading
         cannot apply here under any reading, so it is dismissed rather than
         refused. */
      const reaches = nodes.some((el) => selectorReaches(rule.selector, el));
      if (!reaches) continue;

      if (hasCombinator(rule.selector)) {
        throw new Error('REFUSED, a combinator this resolver cannot read reaches the dialog: ' +
          sheet + ' ' + rule.selector);
      }
      const compounds = splitSelector(rule.selector, '\\s+');
      for (const compound of compounds) {
        const tokens = tokenise(compound);
        if (!tokens) throw new Error('REFUSED, unreadable selector reaches the dialog: ' + rule.selector);
        for (const t of tokens) {
          if (t[0] !== ':' || t === ':empty' || HAS_ARG.test(t)) continue;
          if (t.startsWith('::') || STATE_PSEUDO.test(t)) { rule.state = true; continue; }
          throw new Error('REFUSED, unreadable pseudo reaches the dialog: ' + rule.selector);
        }
      }
      rule.compounds = compounds;
      rule.specificity = specificity(compounds);
      rule.decls = declarations(rule);
      rules.push(rule);
    }
  }
  assert.ok(rules.length >= 6, 'only ' + rules.length + ' rules reach the dialog, so this is not reading the sheets');

  return function resolve(el, env) {
    const won = new Map();
    for (const rule of rules) {
      if (rule.state) continue;
      if (!mediaMatches(rule.media, env)) continue;
      if (!selectorMatches(rule.compounds, el, false)) continue;
      for (const [name, value] of rule.decls) {
        const prev = won.get(name);
        if (!prev || prev.specificity < rule.specificity
          || (prev.specificity === rule.specificity && prev.order < rule.order)) {
          won.set(name, { value, specificity: rule.specificity, order: rule.order, from: rule.sheet + ' { ' + rule.selector + ' }' });
        }
      }
    }
    return won;
  };
}

/* The declared class rules that reach an element, whichever of the two shared
   sheets they came from. */
function styledClasses(nodes, sheets) {
  const rules = [];
  for (const [sheet, src] of sheets) for (const rule of cssRules(src, sheet)) rules.push({ ...rule, sheet });
  const out = new Map();
  for (const el of nodes) {
    for (const cls of classesOf(el)) {
      const hit = rules.some((rule) => {
        if (!new RegExp('\\.' + cls + '(?![-\\w])').test(rule.selector)) return false;
        const parts = parseSelector(rule.selector);
        if (!parts) return false;
        const last = parts[parts.length - 1].compound;
        if (!new RegExp('\\.' + cls + '(?![-\\w])').test(last)) return false;
        if (!selectorReaches(rule.selector, el)) return false;
        /* A rule that reaches the class but declares nothing paints nothing,
           so it must not count as the class being styled. Nor does one whose
           at-rule condition can never match at a width the product is used
           at — `@media (min-width: 5000px)` is a rule that exists and never
           applies, which is the same nothing wearing a selector. */
        if (!declarations(rule).size) return false;
        return [1440, 375].some((width) => mediaMatches(rule.media, { width }));
      });
      if (!hit) out.set(cls, el.tagName.toLowerCase());
    }
  }
  return out;
}

test('every class the re-authentication dialog writes is styled by a sheet every v2 pane loads', async () => {
  const { modal, scrim } = await openReauth();
  const nodes = [scrim, modal, ...dialogTree([modal])];
  assert.ok(nodes.length >= 10,
    'only ' + nodes.length + ' elements in the dialog, so this is not reading session.js');

  const written = new Set();
  for (const el of nodes) for (const c of classesOf(el)) written.add(c);
  for (const want of ['scrim', 'modal', 'modal-card', 'sec-title', 'field-hint',
    'form-alert', 'field-label', 'field-input', 'btn', 'spacer']) {
    assert.ok(written.has(want), 'the dialog no longer writes ' + want +
      ', so this sweep is aimed at markup that has moved');
  }

  const unstyled = styledClasses(nodes, SHARED_SHEETS);

  /* One class the dialog writes carries no rule on a v2 pane, and is listed
     here with its reason rather than given a rule that would do nothing.
     `is-open` is v1's visibility toggle: ops.css starts `.scrim` at opacity 0
     with pointer-events off and `.scrim.is-open` turns both back on. The v2
     scrim has no hidden default — the drawer appends one and removes it — so
     there is nothing for the modifier to turn on, and `.scrim` alone paints
     the backdrop. Asserted in both directions, so a second inert class cannot
     join it quietly and this one cannot be silently given a rule either. */
  assert.deepEqual([...unstyled.keys()].sort(), ['is-open'],
    'a v2 pane loads no rule for ' + [...unstyled].map(([c, tag]) => '.' + c + ' (on <' + tag + '>)').join(', ') +
    ', so the re-authentication dialog paints as unstyled block content on every v2 pane');
  assert.equal(unstyled.get('is-open'), 'div', 'is-open moved off the scrim, so its exemption no longer describes it');
});

test('the dialog is painted as a dialog: over the page, on its own surface, bounded, at both widths and in both themes', async () => {
  const { root, modal, scrim, card, input, alert, title, hint } = await openReauth();
  const nodes = [scrim, modal, ...dialogTree([modal])];
  const padding = {};

  /* Both themes, not one. This sheet themes the dialog through
     `[data-theme="light"]` on <html>, so a cascade resolved against a root
     carrying no theme answers for dark only and a light-theme rule aimed at
     the dialog goes unread. Seeding the root is what a page does before
     paint, and it puts the other half of the sheet on test. */
  for (const theme of ['dark', 'light']) {
    root.setAttribute('data-theme', theme);
    const resolve = cascade(nodes, SHARED_SHEETS);

  for (const width of [1440, 375]) {
    const env = { width, theme };
    const at = (el) => resolve(el, env);
    const value = (el, prop) => { const d = at(el).get(prop); return d ? d.value : null; };
    const where = ' at ' + width + 'px in the ' + theme + ' theme';

    /* Before anything about HOW it is painted: that it is painted at all.
       Every earlier assertion here reads a specific property on a specific
       element, so a rule that simply removes the dialog from the page --
       `[data-theme="light"] .modal-card { display: none; }` is the shape,
       and it only has to outrank `.modal-card` to win -- satisfies all of
       them and hides the feature in half the product. Asserted over the
       whole tree, because the layer, the card and the field each take it
       away on their own. */
    for (const el of nodes) {
      const what = el.tagName.toLowerCase() + (classesOf(el).length ? '.' + classesOf(el).join('.') : '');
      assert.notEqual(value(el, 'display'), 'none',
        what + ' is display:none' + where + ', so the dialog is not on the page at all');
      assert.notEqual(value(el, 'visibility'), 'hidden',
        what + ' is visibility:hidden' + where + ', so the dialog is on the page and invisible');
      assert.notEqual(String(value(el, 'opacity')), '0',
        what + ' is opacity:0' + where + ', so the dialog is on the page and invisible');
      assert.notEqual(value(el, 'content-visibility'), 'hidden',
        what + ' is content-visibility:hidden' + where + ', so the dialog renders nothing');
    }

    assert.equal(value(modal, 'position'), 'fixed', 'the dialog does not sit over the page' + where);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      assert.equal(value(modal, side), '0', 'the dialog does not reach the ' + side + ' of the viewport' + where);
    }

    /* Both directions. Asserting only that the dialog names a z-index would
       stay green if the scrim were raised above it. */
    const above = Number(value(modal, 'z-index'));
    const below = Number(value(scrim, 'z-index'));
    assert.ok(isFinite(above) && isFinite(below), 'the dialog or the scrim stopped naming a z-index' + where);
    assert.ok(above > below,
      'the scrim paints at ' + below + ' and the dialog at ' + above + where +
      ', so the dialog is behind its own backdrop');

    /* A dimmed page with no card on it is the defect this fixes, so the card
       has to carry its own paint, its own edge and a width that stops. */
    assert.match(value(card, 'background') || '', /var\(--surface/,
      'the dialog card has no surface of its own' + where);
    assert.match(value(card, 'box-shadow') || '', /var\(--/,
      'the dialog card has no edge or elevation of its own' + where);
    assert.match(value(card, 'width') || '', /^min\(\d+px, 100%\)$/,
      'the dialog card is unbounded' + where + ', so it fills whatever it is opened over');
    assert.ok(Number.parseFloat(value(card, 'padding')) > 0,
      'the dialog card has no padding' + where);
    /* A flex child with `auto` cross-axis margin is what keeps a card taller
       than the viewport scrollable instead of clipped past the top edge. */
    assert.equal(value(card, 'margin'), 'auto',
      'the dialog card does not centre itself in the scrolling layer' + where +
      ', so a card taller than the viewport loses its top to the edge');

    /* iOS zooms the page for any input under 16px, and this one is typed. */
    assert.ok(Number.parseFloat(value(input, 'font-size')) >= 16,
      'the password field is ' + value(input, 'font-size') + where + ', which makes iOS zoom the page');
    assert.equal(value(input, 'width'), '100%', 'the password field is not a field-width box' + where);
    assert.match(value(input, 'background') || '', /var\(--surface/,
      'the password field has no surface, so it is a browser default box' + where);
    /* WCAG 2.5.8 target size. The field is the one thing on this dialog a
       phone user has to hit before they can type. */
    assert.ok(Number.parseFloat(value(input, 'min-height')) >= 44,
      'the password field is ' + value(input, 'min-height') + ' tall' + where +
      ', under the 44px touch target');

    /* The heading is the dialog's accessible name, and it has to read as a
       heading rather than as another line of the prose beneath it. */
    const titleSize = Number.parseFloat(value(title, 'font-size'));
    const hintSize = Number.parseFloat(value(hint, 'font-size'));
    assert.ok(isFinite(titleSize) && isFinite(hintSize),
      'the dialog title or its hint stopped naming a font size' + where);
    assert.ok(titleSize > hintSize,
      'the dialog title is ' + titleSize + 'px and its hint ' + hintSize + 'px' + where +
      ', so the name of the dialog does not read as its name');
    assert.ok(Number.parseFloat(value(title, 'font-weight')) > 400,
      'the dialog title is not weighted apart from body text' + where);

    /* role="alert" and the same ink as the prose above it is a message that is
       announced and invisible. */
    assert.equal(value(alert, 'color'), 'var(--rose-ink)',
      'the refusal message is not painted in the danger ink' + where);
    assert.notEqual(value(alert, 'color'), value(card, 'color'),
      'the refusal message reads exactly like the prose above it' + where);

    padding[theme + width] = { layer: value(modal, 'padding'), card: value(card, 'padding') };
  }

  /* The breakpoint has to bind, not merely exist: a phone gives up less of a
     420px card to margin than a desktop does, so both boxes come in. */
  assert.ok(Number.parseFloat(padding[theme + 375].layer) < Number.parseFloat(padding[theme + 1440].layer),
    'the layer keeps its ' + padding[theme + 1440].layer + ' gutter at 375px in the ' + theme +
    ' theme, so the card is narrower than it needs to be');
  assert.ok(Number.parseFloat(padding[theme + 375].card) < Number.parseFloat(padding[theme + 1440].card),
    'the card keeps its ' + padding[theme + 1440].card + ' padding at 375px in the ' + theme +
    ' theme, so less of the phone is the dialog');
  }

  /* Both themes were actually resolved, so a future root that stops carrying
     the attribute cannot quietly collapse this test back to one of them. */
  assert.deepEqual(Object.keys(padding).sort(), ['dark1440', 'dark375', 'light1440', 'light375']);
});

test('the dialog reserves no box while its alert is empty, and stays in the document either way', async () => {
  const { modal, scrim, alert, text } = await openReauth();
  const nodes = [scrim, modal, ...dialogTree([modal])];
  const resolve = cascade(nodes, SHARED_SHEETS);
  const value = (el, prop) => { const d = resolve(el, { width: 1440 }).get(prop); return d ? d.value : null; };

  assert.equal(alert.childNodes.length, 0, 'session.js stopped opening the dialog with an empty alert');
  assert.equal(value(alert, 'padding'), '0', 'the empty alert reserves a padded box above the password field');
  assert.equal(value(alert, 'background'), 'none', 'the empty alert paints a danger tint with nothing in it');
  assert.equal(value(alert, 'margin-top'), '0', 'the empty alert reserves the .mt gap above itself');

  /* A live region that is not rendered is not in the accessibility tree, so
     the empty state must collapse by losing its paint rather than its box. */
  assert.notEqual(value(alert, 'display'), 'none',
    'the empty alert is display:none, so revealing it with its text is the unreliable half of how role="alert" announces');

  /* And the other direction: the collapse must not survive the message. */
  alert.appendChild(text('That password did not match.'));
  assert.equal(value(alert, 'padding'), '10px 12px',
    'the alert does not take its box back once it carries a message');
  assert.match(value(alert, 'background') || '', /color-mix/,
    'the alert does not take its danger tint back once it carries a message');
});

test('the dialog outranks every pane sheet that declares a field class of its own', async () => {
  const { modal, scrim } = await openReauth();
  const nodes = [scrim, modal, ...dialogTree([modal])];
  const shared = cascade(nodes, SHARED_SHEETS);

  const dir = new URL('assets/', OPS);
  const paneSheets = readdirSync(dir).filter((f) => /^pane-.*-v2\.css$/.test(f));
  assert.ok(paneSheets.length >= 5, 'only ' + paneSheets.length + ' pane sheets found');

  let contested = 0;
  for (const file of paneSheets) {
    const src = readFileSync(new URL(file, dir), 'utf8');
    for (const rule of cssRules(src, 'assets/' + file)) {
      const hits = nodes.filter((el) => selectorReaches(rule.selector, el));
      if (!hits.length) continue;
      if (/:/.test(rule.selector)) continue;
      const parts = parseSelector(rule.selector);
      if (!parts) continue;
      if (hasCombinator(rule.selector)) {
        throw new Error('REFUSED, a pane sheet aims a combinator at the dialog: ' +
          'assets/' + file + ' ' + rule.selector);
      }
      const theirs = specificity(splitSelector(rule.selector, '\\s+'));
      /* Every node the rule reaches, not just the first: the same selector can
         land on the label and the field, and only one of them may be answered. */
      for (const el of hits) {
        for (const name of declarations(rule).keys()) {
          const ours = shared(el, { width: 1440 }).get(name);
          assert.ok(ours, 'assets/' + file + ' { ' + rule.selector + ' } declares ' + name +
            ' on ' + el.tagName.toLowerCase() + '.' + [...classesOf(el)].join('.') +
            ' and no shared sheet does, so the dialog looks different on that pane');
          assert.ok(ours.specificity > theirs,
            'assets/' + file + ' { ' + rule.selector + ' } outranks ' + ours.from + ' for ' + name +
            ', so the dialog is styled by whichever pane you happen to be on');
          contested += 1;
        }
      }
    }
  }
  assert.ok(contested >= 5,
    'only ' + contested + ' pane declarations contest the dialog, so this is not reading the pane sheets');
});

test('every page that boots the v2 pane shell also loads the sheet that styles the dialog', () => {
  const dir = new URL('./', OPS);
  const pages = readdirSync(dir).filter((f) => f.endsWith('.html'));
  let checked = 0;
  for (const page of pages) {
    const html = readFileSync(new URL(page, dir), 'utf8');
    if (html.indexOf('assets/shell-pane-v2.js') < 0) continue;
    checked += 1;
    assert.ok(html.indexOf('assets/shell-pane-v2.css') >= 0,
      page + ' boots the v2 pane shell without the stylesheet that styles its dialog');
    assert.ok(html.indexOf('assets/session.js') >= 0,
      page + ' boots the v2 pane shell without the module that raises the dialog');
    assert.ok(html.indexOf('assets/ops.css') < 0,
      page + ' loads both design systems, which is the collision the v2 split exists to avoid');
  }
  assert.ok(checked >= 9, 'only ' + checked + ' v2 pane pages found, so this is not reading the pages');
});

/* ---------------- what the dialog does, not what it looks like ---------- */

test('the dialog names itself, is modal, and moves focus to the field it is asking about', async () => {
  const { doc, modal, input, invoker } = await openReauth();

  assert.equal(modal.getAttribute('role'), 'dialog', 'the dialog is not a dialog');
  assert.equal(modal.getAttribute('aria-modal'), 'true', 'the dialog does not claim modality');

  const labelledBy = modal.getAttribute('aria-labelledby');
  assert.ok(labelledBy, 'the dialog carries no accessible name');
  const namer = dialogTree([modal]).filter((el) => (el.getAttribute('id') || el.id) === labelledBy)[0];
  assert.ok(namer, 'aria-labelledby points at ' + labelledBy + ', which is not in the dialog');
  assert.match(allText(namer) || namer.textContent, /password/i,
    'the dialog is named "' + namer.textContent + '", which does not say what is being asked for');

  assert.equal(doc.activeElement, input, 'the dialog opened without moving focus into itself');
  assert.notEqual(doc.activeElement, invoker, 'focus stayed on the page behind the dialog');
  assert.equal(input.type, 'password', 'the field being focused is not a password field');
});

test('Escape closes the dialog, refuses the action, and gives focus back to what opened it', async () => {
  const { doc, body, pending, invoker } = await openReauth();
  assert.equal(doc.activeElement === invoker, false, 'the dialog never took focus, so returning it proves nothing');

  doc.dispatch('keydown', { key: 'Escape' });
  /* Raced rather than awaited: a dialog that refuses to close leaves this
     promise pending forever, and a test that hangs reports nothing and takes
     the CI job with it. */
  assert.equal(await settled(pending), false, 'Escape did not close the dialog as a refusal');
  assert.equal(doc.activeElement, invoker, 'focus was dropped instead of returned to the control that opened it');
  assert.equal(body.children.filter((el) => el.classList.contains('modal')).length, 0,
    'the dialog is still in the document after it closed');
  assert.equal(body.children.filter((el) => el.classList.contains('scrim')).length, 0,
    'the backdrop is still in the document after the dialog closed');
  assert.equal(doc.listenerCount('keydown'), 0, 'the dialog left its key handler on the document');
  assert.equal(doc.listenerCount('focusin'), 0, 'the dialog left its focus handler on the document');
});

test('focus cannot walk out of the open dialog, in either direction', async () => {
  const { doc, modal, invoker } = await openReauth();
  const items = modal.querySelectorAll('button, input');
  assert.ok(items.length >= 3, 'the dialog has too few controls to trap anything');
  const first = items[0];
  const last = items[items.length - 1];

  /* Tab off the end wraps to the start, and shift+Tab off the start wraps to
     the end. One direction on its own would pass on a trap that leaks
     backwards into the page behind it. */
  last.focus();
  doc.dispatch('keydown', { key: 'Tab' });
  assert.equal(doc.activeElement, first, 'Tab off the last control left the dialog');
  first.focus();
  doc.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(doc.activeElement, last, 'shift+Tab off the first control left the dialog');

  /* Focus reset to the page, which matches neither wrap branch: browser
     chrome hands it back to <body>, and a virtual cursor can put it anywhere. */
  invoker.focus();
  doc.dispatch('focusin', { target: invoker });
  assert.equal(doc.activeElement, first,
    'focus landing outside the dialog was left there, so the trap only holds for Tab');
});

test('the page behind the dialog goes inert and comes back, and the live regions never do', async () => {
  const { doc, body, modal, scrim, pending } = await openReauth();
  const live = body.children.filter((el) => el.getAttribute('aria-live'))[0];
  const toasts = body.children.filter((el) => el.classList.contains('toast-host'))[0];
  assert.ok(live && toasts, 'neither live-region host was created, so the exclusion is untested');

  const backdrop = body.children.filter((el) => el !== modal && el !== scrim && el !== live && el !== toasts);
  assert.ok(backdrop.length >= 1, 'nothing is behind the dialog, so inerting it proves nothing');
  for (const el of backdrop) {
    assert.equal(el.getAttribute('aria-hidden'), 'true', 'the page behind the dialog is still exposed');
    assert.equal(el.inert, true, 'the page behind the dialog is still reachable by a pointer');
  }

  /* A live region carrying aria-hidden announces nothing, so inerting one
     would silence exactly the messages a dialog is most likely to produce. */
  for (const el of [live, toasts]) {
    assert.equal(el.getAttribute('aria-hidden'), null,
      'a live region was hidden from assistive tech while the dialog was open');
    assert.equal(el.inert, false, 'a live region was inerted while the dialog was open');
  }
  assert.equal(modal.getAttribute('aria-hidden'), null, 'the dialog hid itself');
  assert.equal(scrim.getAttribute('aria-hidden'), null, 'the backdrop was inerted, so clicking it does nothing');

  /* The other direction. A test that only checks inert goes ON passes on a
     shell that never takes it off, which leaves the page permanently dead. */
  doc.dispatch('keydown', { key: 'Escape' });
  await settled(pending);
  for (const el of backdrop) {
    assert.equal(el.getAttribute('aria-hidden'), null,
      'the page stayed hidden from assistive tech after the dialog closed');
    assert.equal(el.inert, false, 'the page stayed inert after the dialog closed, so nothing on it can be used');
  }
});

/* ======================== the rail as a phone drawer ==================== */

/* Below 980px the rail is an overlay, and an overlay is a dialog: it traps
   focus, closes on Escape, hands focus back to the control that opened it,
   and takes the rest of the page out of the accessibility tree while it is
   open. None of that had an assertion (Stadiora/Aria#10352). */

const PHONE = { '(max-width: 980px)': true };

async function openDrawer(options) {
  const opts = options || {};
  const dom = await bootPane('overview', {
    matchMedia: PHONE,
    definePane: (content, pane, shell) => {
      content.appendChild(shell.h('button', { type: 'button', id: 'act', text: 'Suspend' }));
    },
    ...opts,
  });
  dom.shell.announce('ready');
  dom.shell.toast('check', 'saved');

  const rail = dom.doc.getElementById('rail');
  const toggle = dom.doc.getElementById('railToggle');
  assert.ok(rail && toggle, 'the pane shell drew no rail or no toggle for it');

  const seedInert = (el) => { el.inert = false; };
  dom.body.children.forEach(seedInert);
  let node = rail;
  while (node && node !== dom.body && node.parentNode) {
    node.parentNode.children.forEach(seedInert);
    node = node.parentNode;
  }

  if (!opts.leaveClosed) toggle.dispatch('click');
  return { ...dom, rail, toggle };
}

test('the phone drawer opens, says so, and puts focus on the first thing in it', async () => {
  const { doc, body, rail, toggle } = await openDrawer();

  assert.equal(rail.classList.contains('is-open'), true, 'the drawer did not open');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'the toggle still reads as collapsed');
  assert.match(toggle.getAttribute('aria-label'), /close/i,
    'the toggle still offers to open the drawer that is already open');
  assert.equal(body.children.filter((el) => el.classList.contains('scrim')).length, 1,
    'the drawer opened without a backdrop');
  assert.equal(doc.activeElement, rail.querySelector('a'),
    'the drawer opened without moving focus into itself');
});

test('the phone drawer closes on Escape and on its own toggle, both times handing focus back', async () => {
  for (const [how, close] of [
    ['Escape', ({ doc }) => doc.dispatch('keydown', { key: 'Escape' })],
    ['the toggle', ({ toggle }) => toggle.dispatch('click')],
  ]) {
    const open = await openDrawer();
    close(open);
    assert.equal(open.rail.classList.contains('is-open'), false, how + ' left the drawer open');
    assert.equal(open.toggle.getAttribute('aria-expanded'), 'false', how + ' left the toggle reading as expanded');
    assert.match(open.toggle.getAttribute('aria-label'), /open/i,
      how + ' left the toggle offering to close a drawer that is shut');
    assert.equal(open.body.children.filter((el) => el.classList.contains('scrim')).length, 0,
      how + ' left the backdrop over the page');
    assert.equal(open.doc.activeElement, open.toggle,
      how + ' dropped focus instead of returning it to the toggle');
    assert.equal(open.doc.listenerCount('keydown'), 0, how + ' left the drawer key handler on the document');
    assert.equal(open.doc.listenerCount('focusin'), 0, how + ' left the drawer focus handler on the document');
  }
});

test('focus cannot walk out of the open phone drawer, in either direction', async () => {
  const { doc, rail, toggle } = await openDrawer();
  const items = rail.querySelectorAll('a, button');
  assert.ok(items.length >= 3, 'the rail has too few items to trap anything');
  const first = items[0];
  const last = items[items.length - 1];

  last.focus();
  doc.dispatch('keydown', { key: 'Tab' });
  assert.equal(doc.activeElement, first, 'Tab off the last rail item left the drawer');
  first.focus();
  doc.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(doc.activeElement, last, 'shift+Tab off the first rail item left the drawer');

  toggle.focus();
  doc.dispatch('focusin', { target: toggle });
  assert.equal(doc.activeElement, first,
    'focus landing outside the drawer was left there, so the trap only holds for Tab');
});

test('the page behind the phone drawer goes inert and comes back, and the live regions never do', async () => {
  const { doc, body, rail } = await openDrawer();
  const live = body.children.filter((el) => el.getAttribute('aria-live'))[0];
  const toasts = body.children.filter((el) => el.classList.contains('toast-host'))[0];
  const scrim = body.children.filter((el) => el.classList.contains('scrim'))[0];
  assert.ok(live && toasts && scrim, 'the drawer opened without the hosts this exclusion is about');

  /* Everything that is not the rail, at every level up to the body — the rail
     is inside the app wrapper, so a list of body children would inert the
     rail's own ancestor and take the drawer with it. */
  const hidden = [];
  const ancestors = [];
  let node = rail;
  while (node && node !== body && node.parentNode) {
    for (const sib of node.parentNode.children) if (sib !== node) hidden.push(sib);
    node = node.parentNode;
    if (node !== body) ancestors.push(node);
  }
  const expected = hidden.filter((el) => el !== scrim && el !== live && el !== toasts);
  assert.ok(expected.length >= 1, 'nothing sits behind the drawer, so inerting it proves nothing');
  assert.ok(expected.indexOf(rail.parentNode.children.filter((el) => el !== rail)[0]) !== -1,
    "the rail's own sibling is not among what went inert, so the walk never left the body's children");
  assert.ok(ancestors.length >= 1, 'the rail is a body child here, so the ancestor case is untested');

  /* Both ends of the walk, not just the near one. The skip link is a body
     child and the rail is two levels down, so a walk that stops at the rail's
     own siblings leaves the first thing on the page reachable. */
  const skip = body.children.filter((el) => el.classList.contains('skip'))[0];
  assert.ok(skip, 'this page has no skip link, so the far end of the walk is untested');
  assert.ok(expected.indexOf(skip) !== -1,
    'the skip link is not among what went inert, so the walk stopped at the rail\'s own level');

  for (const el of expected) {
    assert.equal(el.getAttribute('aria-hidden'), 'true', 'the page behind the drawer is still exposed');
    assert.equal(el.inert, true, 'the page behind the drawer is still reachable by a pointer');
  }
  assert.equal(rail.getAttribute('aria-hidden'), null, 'the drawer inerted itself');
  /* The other half of the same walk: inerting an ancestor of the rail would
     inert the rail with it, and the drawer would open already dead. */
  for (const el of ancestors) {
    assert.equal(el.getAttribute('aria-hidden'), null, 'an ancestor of the rail was hidden, taking the drawer with it');
    assert.equal(el.inert, false, 'an ancestor of the rail was inerted, taking the drawer with it');
  }
  for (const el of [live, toasts, scrim]) {
    assert.equal(el.getAttribute('aria-hidden'), null,
      'a live region or the backdrop was hidden from assistive tech while the drawer was open');
    assert.notEqual(el.inert, true, 'a live region or the backdrop was inerted while the drawer was open');
  }

  doc.dispatch('keydown', { key: 'Escape' });
  for (const el of expected) {
    assert.equal(el.getAttribute('aria-hidden'), null, 'the page stayed hidden after the drawer closed');
    assert.equal(el.inert, false, 'the page stayed inert after the drawer closed');
  }
});

test('growing past the breakpoint closes the drawer, and does not snatch focus to do it', async () => {
  const { doc, body, window, rail, toggle } = await openDrawer();
  const inside = rail.querySelector('a');
  assert.equal(doc.activeElement, inside, 'the drawer did not open onto its first item');

  /* The overlay becomes a permanent column again, at which point trapping
     focus in it would be the bug. Nothing about that is a reason to move the
     operator's focus to the toggle. */
  const mq = window.media.filter((m) => m.media === '(max-width: 980px)')[0];
  assert.ok(mq, 'the drawer stopped listening to the breakpoint it is keyed on');
  mq.set(false);

  assert.equal(rail.classList.contains('is-open'), false, 'the drawer stayed open on a desktop width');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'the toggle still reads as expanded');
  assert.equal(body.children.filter((el) => el.classList.contains('scrim')).length, 0,
    'the backdrop stayed over a page with no drawer on it');
  assert.notEqual(doc.activeElement, toggle,
    'widening the window moved focus to a control the operator never used, which on a desktop width is hidden');
});

/* ========================= the two lifecycle events ===================== */

/* A pane module is a later <script> on the page, so it adds its listeners
   after this file has executed and before its asynchronous boot finishes.
   Both events have to fire after that, and in this order, or a pane has to
   read the querystring itself — which is the duplication the shared filter
   bar exists to remove. */

function listenFor(win, log) {
  for (const name of ['ops:ready', 'ops:filters']) {
    win.addEventListener(name, (e) => log.push({ name, detail: e.detail }));
  }
}

test('a pane hears ops:ready before ops:filters, and both carry the starting selection', async () => {
  const log = [];
  const { doc, shell } = await bootPane('analytics', {
    file: 'analytics.html',
    href: 'https://ops.example.invalid/ops/analytics.html?range=90d',
    onLoad: (win) => listenFor(win, log),
    definePane: () => {},
  });

  assert.deepEqual(log.map((e) => e.name), ['ops:ready', 'ops:filters'],
    'the shell fired ' + log.map((e) => e.name).join(' then ') + ' instead of ops:ready then ops:filters');

  const [ready, filters] = log;
  assert.equal(ready.detail.pane, 'analytics', 'ops:ready did not say which pane it is');
  assert.deepEqual(ready.detail.filters, shell.filters(), 'ops:ready carried a selection nobody is showing');
  assert.deepEqual(filters.detail, shell.filters(), 'ops:filters carried a selection nobody is showing');
  assert.equal(filters.detail.range, '90d', 'the starting selection lost the range the URL asked for');

  /* The docblock's own claim: ops:ready is the signal that #content exists. */
  assert.ok(doc.getElementById('content'), 'ops:ready fired on a page with no #content to draw into');

  /* A copy, not the shell's own object: a pane that stores the detail and a
     shell that mutates it in place disagree about what is on screen. */
  ready.detail.filters.range = 'tampered';
  filters.detail.range = 'tampered';
  assert.equal(shell.filters().range, '90d', 'a pane can rewrite the shell selection through the event detail');
});

test('ops:filters fires again on every change, and ops:ready never does', async () => {
  const log = [];
  const { doc, shell } = await bootPane('analytics', {
    file: 'analytics.html',
    onLoad: (win) => listenFor(win, log),
    definePane: () => {},
  });
  const started = shell.filters().range;

  const select = doc.querySelector('.filters').querySelectorAll('select')[0];
  assert.ok(select, 'the analytics bar drew no control to change');
  const other = findAll(select, (el) => el.tagName === 'OPTION')
    .map((el) => el.getAttribute('value'))
    .filter((v) => v && v !== started)[0];
  assert.ok(other, 'the range control offers nothing but the value it started on');

  select.value = other;
  select.dispatch('change');

  assert.equal(log.filter((e) => e.name === 'ops:ready').length, 1,
    'ops:ready fired again for a filter change, so a pane rebuilds itself from scratch on every pick');
  const emitted = log.filter((e) => e.name === 'ops:filters');
  assert.equal(emitted.length, 2, 'a filter change emitted ' + (emitted.length - 1) + ' ops:filters events');
  assert.equal(emitted[1].detail.range, other, 'ops:filters carried the old selection after a change');
  assert.deepEqual(emitted[1].detail, shell.filters(), 'ops:filters and the shell disagree about the selection');

  /* The other direction: resetting back to the default is a change too, and a
     shell that only emitted on the way out would leave every pane showing the
     window the operator just cleared. */
  assert.equal(shell.resetRange(), true, 'the shell does not consider the reset a change');
  const after = log.filter((e) => e.name === 'ops:filters');
  assert.equal(after.length, 3, 'resetting the range emitted no ops:filters');
  assert.equal(after[2].detail.range, started, 'the reset emitted something other than the pane default');
});

/* Round nine: this PR made ops/README.md a test input (the surface-parity test
   above reads it) without adding it to the workflow's paths filter, so a
   README-only change started no job and the guard held nothing on exactly the
   pull requests it exists for. The same filter had already been widened once
   in this PR, for ops/*.html, for the same reason — which is what makes this
   worth a guard rather than a third one-line fix.

   What is covered: every path these two suites name as a LITERAL — the
   `read('…')` arguments, the SHEETS list, the suite files themselves and the
   shared DOM harness — has to be matched by the paths filter of both the
   pull_request and the push trigger.

   NOT COVERED: an input reached by a computed path, and an input read by a
   suite other than these two. */
function workflowPaths(yml, trigger) {
  const at = yml.indexOf('\n  ' + trigger + ':');
  assert.ok(at > 0, 'ops-pane-tests.yml has no ' + trigger + ' trigger');
  const from = yml.indexOf('paths:', at);
  assert.ok(from > at, trigger + ' has no paths filter');
  const globs = [];
  for (const line of yml.slice(from).split('\n').slice(1)) {
    const m = /^\s+- '(.+)'$/.exec(line);
    if (!m) break;
    globs.push(m[1]);
  }
  assert.ok(globs.length >= 3, trigger + "'s paths filter reads as " + globs.length + ' entries');
  return globs;
}

/* The subset of glob syntax this workflow uses: `**` crosses directories, `*`
   does not, everything else is literal. */
function globMatches(glob, file) {
  const rx = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp('^' + rx + '$').test(file);
}

function suiteInputs() {
  const files = ['scripts/ops-dom-harness.mjs'];
  for (const suite of ['ops-shell-pane-v2.test.mjs', 'ops-overview-v2.test.mjs',
    'ops-alerts-v2.test.mjs']) {
    files.push('scripts/' + suite);
    const src = readFileSync(new URL('./' + suite, import.meta.url), 'utf8');
    for (const [, rel] of src.matchAll(/\bread\('([^']+)'\)/g)) files.push('ops/' + rel);
    for (const [, list] of src.matchAll(/const SHEETS = \[([^\]]+)\]/g)) {
      for (const [, one] of list.matchAll(/'([^']+)'/g)) files.push(one);
    }
  }
  /* Existing files only: the scan sees its own docblock, whose `read('…')`
     is prose rather than an input. A real input that stopped existing would
     fail the suite that reads it, not this list. */
  return [...new Set(files)].filter((f) => existsSync(new URL('../' + f, import.meta.url))).sort();
}

test('every file these suites read also triggers the job that runs them', () => {
  const yml = readFileSync(new URL('../.github/workflows/ops-pane-tests.yml', import.meta.url), 'utf8');
  const inputs = suiteInputs();
  assert.ok(inputs.length >= 8, 'only ' + inputs.length + ' inputs found, so this is not reading the suites');
  assert.ok(inputs.indexOf('ops/README.md') !== -1,
    'the surface-parity test reads ops/README.md, so it has to be in this list');

  for (const trigger of ['pull_request', 'push']) {
    const globs = workflowPaths(yml, trigger);
    const missed = inputs.filter((f) => !globs.some((g) => globMatches(g, f)));
    assert.deepEqual(missed, [], trigger + ' does not start the job for ' + missed.join(', ') +
      ', which these suites read');
  }
});
