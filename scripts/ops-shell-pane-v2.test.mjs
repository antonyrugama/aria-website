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

test('the registry keeps the two panes that deliberately offer no custom range', () => {
  const { PANES, RANGES } = registryOnly();
  for (const id of ['analytics', 'spend']) {
    assert.ok(PANES[id].range, id + ' lost its range control entirely');
    assert.equal(
      PANES[id].range.indexOf('custom'), -1,
      id + ' offers a custom range, which nothing behind it can honour'
    );
  }
  /* The other direction, so this reads as a decision rather than as a range
     nothing in the dashboard has: What happened does offer a custom window,
     and these two withhold it because their own reads cannot honour one. */
  assert.ok(RANGES.custom, 'the label table lost the custom range it still names');
  assert.ok(PANES.history.range.indexOf('custom') !== -1,
    'the only pane that offers a custom range stopped offering it, so the two '
    + 'panes that withhold one are no longer withholding anything');
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
  for (const suite of ['ops-shell-pane-v2.test.mjs', 'ops-overview-v2.test.mjs']) {
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
