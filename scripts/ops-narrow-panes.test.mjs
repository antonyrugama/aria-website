/* What the two panes do at a phone width, resolved from the rendered page.
 *
 * Two defects, one shape: at 375px both panes were laid out by rules written
 * for a desktop and never looked at narrow, because the approved mock set has
 * no drawing of either pane on a phone — docs/mocks/ops-dashboard-v2's
 * evaluations.html carries no media query at all and the whole set stops at
 * 560px.
 *
 *   Stadiora/Aria#10826  the four-stage release track wrapped into a 2x2 grid,
 *                        so one progression drew as two, each with its own
 *                        rail, and "Released" read as the start of a second
 *                        one. A false statement rather than a cramped layout.
 *
 *   Stadiora/Aria#10827  Aria quality was 7841px — 9.7 screens of an 812px
 *                        phone — of stacked forms with no index, 42% of it
 *                        previewing a scoring harness that does not exist.
 *
 *   Stadiora/Aria#10809  the approval answer is a role="status" live region
 *                        that was revealed and filled in one task, so the
 *                        region was born holding its text and an assistive
 *                        technology had no earlier state to diff it against.
 *
 * Everything here is measured from laid-out geometry, resolved computed style
 * or the real accessibility tree. Nothing reads a stylesheet as text: this
 * repository has shipped a guard that asserted a sheet CONTAINS a rule and
 * stayed green while the rule painted nothing (Stadiora/Aria#10456), and a
 * source-grep assertion pins the string rather than the painting.
 *
 * Both arms of every invariant are bound. A test that only proves a band can
 * be opened does not notice a pane that never closes one, and a test that only
 * proves the track is vertical at 375 does not notice that it went vertical at
 * 1280 as well.
 *
 * It needs a browser and fails closed without one: CHROME_PATH, or Chrome or
 * Chromium on the usual paths. CI runs it on ubuntu-latest, which is a
 * documented exception for this repository's ops guards.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stub } from './ops-api-stub.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* ---------------------------------------------------------------- serving */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

/* The stub ships one App releases payload, in which every build has reached its
   last stage — so both rows are done, done, done, current and no stage is ever
   `todo`. One test needs all three rails in one pipeline at once, and the pane
   asks for /api/ops/releases with no querystring (ops-releases-v2.test.mjs
   asserts that it does), so the variant is selected here rather than in the URL. */
/* The evaluations pane's CIEL operations endpoint. The shared stub does not
   carry it, and the approval half of this file needs a resource back to drive
   the answer slot. The pane sends `operationId`, not `operation`. */
function operations(body) {
  const req = body || {};
  const op = String(req.operationId || '');
  const envelope = (type, id, value) => ({
    schemaVersion: 'ciel.operation.response.v1',
    requestId: req.requestId,
    operationId: req.operationId,
    status: 'success',
    exitCode: 0,
    resource: { type, id, revision: 1, value }
  });
  if (op.indexOf('ciel.approval.') === 0) {
    const asked = (req.input && req.input.approvalRequestId) || 'apr_9f3c';
    return envelope('ciel.evidence-approval', asked,
      { approvalRequestId: asked, state: 'pending', revision: 2 });
  }
  return envelope('ciel.dataset-validation', req.requestId,
    { valid: true, issues: [], digests: [] });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      const answer = url.pathname.startsWith('/api/ops/ciel/operations')
        ? operations(body)
        : stub(url.pathname);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(answer));
    });
    return;
  }
  const abs = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});

/* -------------------------------------------------------------------- CDP */

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH, process.env.CHROME_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH. This file cannot ' +
    'fall back to the fake DOM: a fake DOM has no cascade, and the cascade is the ' +
    'thing under test.');
}

/* Chrome writes the port it actually took to DevToolsActivePort. Asking it
   rather than dictating one is what keeps two runs on one machine from
   silently driving each other's browser. */
async function devtoolsPort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    try {
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtools(port, pathname, method) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
      if (res.ok) return await res.json();
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never opened its DevTools endpoint');
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  };
  return {
    ready: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    close: () => ws.close(),
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }
  };
}


let cdp;
let browser;
let profile;
let origin;
let themeScript = null;
let showing = null;

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error('probe threw: ' + (result.exceptionDetails.exception
      ? result.exceptionDetails.exception.description
      : result.exceptionDetails.text));
  }
  return result.result.value;
}

async function waitFor(expression, what) {
  const guarded = `(() => { try { return !!(${expression}); } catch (e) { return false; } })()`;
  for (let i = 0; i < 300; i++) {
    if (await evaluate(guarded)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for ' + what);
}


before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  profile = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'ops-narrow-'));
  browser = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
  ], { stdio: 'ignore' });

  const port = await devtoolsPort(profile);
  const target = await devtools(port, '/json/new?about:blank', 'PUT');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try {' +
      `localStorage.setItem('ops-api-base', ${JSON.stringify(origin)});` +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      '} catch (e) {}'
  });
});

after(async () => {
  if (cdp) cdp.close();
  if (browser) {
    const gone = new Promise((done) => browser.once('exit', done));
    browser.kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
  }
  server.close();
  /* Chrome is still writing its profile out as it shuts down, and the runner
     discards RUNNER_TEMP either way, so failing to remove it is not a reason
     to fail a test about layout. */
  try {
    if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  } catch (e) { /* the runner sweeps it up */ }
});

/* The two panes at the four widths this file has something to say about.
   940 and 1280 are the wide arms: 940 is above the 900 fold point and below
   the 980 the release row collapses at, and 1280 is plain desktop. */
const SHIP_375 = { key: 'ship/375', url: '/ops/releases.html', width: 375, theme: 'dark', ready: '.pipe-step.done' };
const SHIP_1280 = { key: 'ship/1280', url: '/ops/releases.html', width: 1280, theme: 'dark', ready: '.pipe-step.done' };
const EVALS_375 = { key: 'evals/375', url: '/ops/evaluations.html', width: 375, theme: 'dark', ready: '.band-fold' };
const EVALS_375_LIGHT = { key: 'evals/375/light', url: '/ops/evaluations.html', width: 375, theme: 'light', ready: '.band-fold' };

const EVALS_1280 = { key: 'evals/1280', url: '/ops/evaluations.html', width: 1280, theme: 'dark', ready: '.band-head' };

async function show(state) {
  if (showing === state.key) return;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: state.width, height: 900, deviceScaleFactor: 1, mobile: false
  });
  if (themeScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: themeScript });
  themeScript = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('ops-theme', ${JSON.stringify(state.theme)}); } catch (e) {}`
  })).identifier;
  await cdp.send('Page.navigate', { url: origin + state.url });
  await waitFor("document.body.classList.contains('is-ready')", `the shell on ${state.url}`);
  await waitFor(`document.querySelector(${JSON.stringify(state.ready)})`, `${state.ready} at ${state.width}`);
  await waitFor(`document.documentElement.getAttribute('data-theme') === ${JSON.stringify(state.theme)}`,
    `the ${state.theme} theme`);
  showing = state.key;
}

/* Resets the page so a test that opened a fold cannot change what the next
   test sees. Cheaper than a navigation and states it rather than relying on
   the order node:test happens to run them in. */
async function reshow(state) {
  showing = null;
  await show(state);
}

/* =============== Stadiora/Aria#10826 — the release track ================== */

/* The anchor for the three vertical-rail tests is the
   `@media (max-width: 560px)` block at the foot of
   ops/assets/pane-releases-v2.css. Delete it and the track falls back to the
   2x2 grid that shipped. */

test('at 375 the four stages are one column, not two rows of two', async () => {
  await show(SHIP_375);
  const seen = await evaluate(`(() => {
    const track = document.querySelector('.pipe-track');
    const steps = [...track.children].map((li) => {
      const box = li.getBoundingClientRect();
      return { label: li.querySelector('.pipe-label').textContent,
        top: Math.round(box.top), left: Math.round(box.left) };
    });
    return { count: steps.length,
      rows: [...new Set(steps.map((s) => s.top))].length,
      columns: [...new Set(steps.map((s) => s.left))].length,
      labels: steps.map((s) => s.label) };
  })()`);

  /* Derived from the track rather than typed, so a fifth stage cannot make
     this assertion quietly weaker than it reads. */
  assert.equal(seen.rows, seen.count,
    `all ${seen.count} stages should sit on their own row at 375: ${JSON.stringify(seen.labels)}`);
  assert.equal(seen.columns, 1, 'the stages should share one left edge at 375');
});

test('at 1280 the four stages are one row, not one column', async () => {
  await show(SHIP_1280);
  const seen = await evaluate(`(() => {
    const steps = [...document.querySelector('.pipe-track').children].map((li) => {
      const box = li.getBoundingClientRect();
      return { top: Math.round(box.top), left: Math.round(box.left) };
    });
    return { count: steps.length,
      rows: [...new Set(steps.map((s) => s.top))].length,
      columns: [...new Set(steps.map((s) => s.left))].length };
  })()`);

  /* The other arm. Turning the track vertical at every width would satisfy
     the test above and wreck the pane. */
  assert.equal(seen.rows, 1, 'the stages should share one row at 1280');
  assert.equal(seen.columns, seen.count, 'each stage should have its own column at 1280');
});

test('at 375 the rail runs unbroken from the first stage to the last', async () => {
  await show(SHIP_375);
  const rails = await evaluate(`(() => {
    const steps = [...document.querySelector('.pipe-track').children];
    /* The ::before box is not an element, so it is reconstructed from the
       step's own border box and the resolved values — which is a resolution
       of the rendered value, not a read of the sheet.

       The bottom edge comes from the USED HEIGHT, not from the 'bottom'
       inset, and the difference is not pedantry. An absolutely positioned box
       with 'top', 'bottom' and 'height' all set is over-constrained, and CSS
       resolves that by ignoring 'bottom'. Deriving the run from 'bottom'
       therefore reports the rail the sheet asks for rather than the rail
       Chrome draws: deleting 'height: auto' from the '.done' rule collapses
       every rail to 3px on screen and left this test green, which is the
       false green the battery for this PR caught in its own author's work. */
    return steps.map((li, i) => {
      const box = li.getBoundingClientRect();
      const before = getComputedStyle(li, '::before');
      const node = li.querySelector('.pipe-node').getBoundingClientRect();
      const next = steps[i + 1] ? steps[i + 1].querySelector('.pipe-node').getBoundingClientRect() : null;
      const shown = before.display !== 'none';
      const railTop = box.top + parseFloat(before.top);
      const railBottom = railTop + parseFloat(before.height);
      return { label: li.querySelector('.pipe-label').textContent,
        last: i === steps.length - 1,
        shown,
        run: shown ? +(railBottom - railTop).toFixed(1) : 0,
        fromNode: shown ? +(railTop - node.bottom).toFixed(1) : null,
        toNextNode: (shown && next) ? +(next.top - railBottom).toFixed(1) : null,
        railCentre: shown ? +(parseFloat(before.left) + parseFloat(before.width) / 2).toFixed(2) : null,
        nodeCentre: +(node.left - box.left + node.width / 2).toFixed(2) };
    });
  })()`);

  for (const rail of rails) {
    if (rail.last) {
      assert.equal(rail.shown, false, 'the last stage should have no rail after it');
      continue;
    }
    assert.equal(rail.shown, true, `${rail.label} should carry a rail to the stage after it`);
    /* Continuity is the whole point: a rail that starts below the node it
       leaves or stops above the node it reaches draws a column of dashes,
       which is this sheet's own spelling for a stage nobody has got to. */
    assert.equal(rail.fromNode, 0, `${rail.label}: the rail should start at its node's edge`);
    assert.equal(rail.toNextNode, 0, `${rail.label}: the rail should reach the next node`);
    assert.ok(rail.run >= 15, `${rail.label}: a ${rail.run}px rail reads as a dot, not a connector`);
    assert.equal(rail.railCentre, rail.nodeCentre,
      `${rail.label}: the rail should run down the middle of the nodes`);
  }
});

test('at 375 no stage but the last has its rail switched off', async () => {
  await show(SHIP_375);
  const hidden = await evaluate(`(() => {
    const steps = [...document.querySelector('.pipe-track').children];
    return steps.map((li, i) => ({ label: li.querySelector('.pipe-label').textContent, i,
        off: getComputedStyle(li, '::before').display === 'none' }))
      .filter((s) => s.off && s.i !== steps.length - 1)
      .map((s) => s.label);
  })()`);

  /* The rule that shipped was `.pipe-step:nth-child(2)::before { display:
     none }` — the half-fix that hid the connector dangling off the end of the
     first row and left two progressions on screen. Naming the offenders
     rather than counting them makes the failure say which stage lost its
     rail. */
  assert.deepEqual(hidden, [], 'only the last stage may have no rail after it');
});

/* ============== Stadiora/Aria#10827 — the Aria quality folds ============== */

test('at 375 every band starts closed and the page is an index', async () => {
  await reshow(EVALS_375);
  const seen = await evaluate(`(() => {
    const bands = [...document.querySelectorAll('.band')];
    return { bands: bands.length,
      open: bands.filter((b) => b.querySelector('.band-fold').getAttribute('aria-expanded') === 'true').length,
      bodiesWithHeight: bands.filter((b) => b.querySelector('.band-body').getBoundingClientRect().height > 0).length,
      controls: bands.filter((b) => b.querySelector('.band-fold')).length,
      docHeight: document.documentElement.scrollHeight };
  })()`);

  assert.ok(seen.bands >= 6, `expected the pane's bands, saw ${seen.bands}`);
  assert.equal(seen.controls, seen.bands, 'every band should carry a fold control at 375');
  assert.equal(seen.open, 0, 'every band should start closed at 375');
  /* The body being `hidden` is not the same fact as the body taking no room:
     `.band-body` is painted `display: flex` by this pane's sheet, and an
     author display beats the user-agent `[hidden]` rule. This is the
     assertion that notices if `.band-body[hidden]` is ever deleted. */
  assert.equal(seen.bodiesWithHeight, 0, 'a closed band should take no vertical room');
  /* The pane measured 7841px before this. The ceiling is loose on purpose —
     it is here to catch the folds not applying at all, not to freeze a
     layout to the pixel. */
  assert.ok(seen.docHeight < 2500,
    `the folded pane should be an index, not ${seen.docHeight}px of forms`);
});

test('at 375 a band opens when its control is pressed, and closes again', async () => {
  await reshow(EVALS_375);
  const cycle = await evaluate(`(async () => {
    const band = document.querySelector('.band');
    const button = band.querySelector('.band-fold');
    const body = band.querySelector('.band-body');
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const read = () => ({ expanded: button.getAttribute('aria-expanded'),
      hidden: body.hidden, height: Math.round(body.getBoundingClientRect().height) });
    const shut = read();
    button.click(); await frame();
    const open = read();
    button.click(); await frame();
    return { shut, open, again: read() };
  })()`);

  assert.deepEqual(cycle.shut, { expanded: 'false', hidden: true, height: 0 });
  assert.equal(cycle.open.expanded, 'true', 'pressing the control should expand the band');
  assert.equal(cycle.open.hidden, false, 'an expanded band should not be hidden');
  assert.ok(cycle.open.height > 100, `an expanded band should have its content, saw ${cycle.open.height}px`);
  /* Both arms. A fold that opens and never closes passes every assertion
     above and is not a fold. */
  assert.deepEqual(cycle.again, { expanded: 'false', hidden: true, height: 0 },
    'pressing the control again should close the band');
});

test('above the fold width there is no control and nothing is folded', async () => {
  await reshow(EVALS_1280);
  const seen = await evaluate(`(() => {
    const bands = [...document.querySelectorAll('.band')];
    const button = document.querySelector('.band-fold');
    return { bands: bands.length,
      display: getComputedStyle(button).display,
      closed: bands.filter((b) => b.querySelector('.band-body').hidden).length,
      claiming: [...document.querySelectorAll('.band-fold')]
        .filter((b) => b.hasAttribute('aria-expanded')).length,
      bodiesWithoutHeight: bands.filter((b) => b.querySelector('.band-body').getBoundingClientRect().height === 0).length };
  })()`);

  assert.equal(seen.display, 'none', 'the fold control should not be laid out at 1280');
  assert.equal(seen.closed, 0, 'no band should be folded at 1280');
  assert.equal(seen.bodiesWithoutHeight, 0, 'every band should show its content at 1280');
  /* There is no disclosure at this width: the control is not laid out and the
     body is never collapsed. A button claiming aria-expanded here is claiming
     a widget that does not exist, which is the shape check-ops-result-view
     refuses to judge because nothing on the page shows the other state. */
  assert.equal(seen.claiming, 0,
    'no fold control should carry aria-expanded at a width where it is not offered');
});

test('the fold control is a button in the accessibility tree, named by its band', async () => {
  await reshow(EVALS_375);
  const { backendNodeId, title } = await evaluate(`(() => {
    const band = document.querySelector('.band');
    window.__fold = band.querySelector('.band-fold');
    return { backendNodeId: 0, title: band.querySelector('.band-title').textContent };
  })()`);
  void backendNodeId;

  const remote = await cdp.send('Runtime.evaluate', { expression: 'window.__fold' });
  const described = await cdp.send('DOM.describeNode', { objectId: remote.result.objectId });
  const ax = await cdp.send('Accessibility.getPartialAXTree', {
    backendNodeId: described.node.backendNodeId, fetchRelatives: false
  });
  const self = ax.nodes.find((n) => n.backendDOMNodeId === described.node.backendNodeId);

  /* Resolved from the accessibility tree rather than from the attributes that
     were written. aria-labelledby pointing at an id that does not exist
     produces markup that looks correct and a button announced as nothing at
     all, and this repository has already shipped a role="img" whose <text>
     child was announced to nobody. */
  assert.ok(self, 'the fold control should be in the accessibility tree');
  assert.equal(self.role.value, 'button');
  assert.equal(self.name.value, title,
    'the control should be announced with its own band\'s name');
  const expanded = (self.properties || []).find((p) => p.name === 'expanded');
  assert.ok(expanded, 'the control should carry an expanded state');
  assert.equal(expanded.value.value, false);
});

test('the fold control leaves the accessibility tree above the fold width', async () => {
  await reshow(EVALS_1280);
  const remote = await cdp.send('Runtime.evaluate', {
    expression: "document.querySelector('.band-fold')"
  });
  const described = await cdp.send('DOM.describeNode', { objectId: remote.result.objectId });
  const ax = await cdp.send('Accessibility.getPartialAXTree', {
    backendNodeId: described.node.backendNodeId, fetchRelatives: false
  });
  const self = ax.nodes.find((n) => n.backendDOMNodeId === described.node.backendNodeId);

  /* display:none is what takes it out, and the other arm of the test above:
     a control that stays announced at desktop is a phantom button on a pane
     that has nothing to fold. */
  assert.ok(!self || self.ignored === true,
    'the fold control should be ignored by the accessibility tree at 1280');
});

test('the body wrapper keeps the spacing the band used to give its children', async () => {
  await reshow(EVALS_1280);
  const seen = await evaluate(`(() => {
    const band = [...document.querySelectorAll('.band')]
      .find((b) => b.querySelector('.band-body').children.length > 1);
    const body = band.querySelector('.band-body');
    const kids = [...body.children].map((el) => el.getBoundingClientRect());
    const gaps = [];
    for (let i = 1; i < kids.length; i++) gaps.push(+(kids[i].top - kids[i - 1].bottom).toFixed(1));
    const cs = getComputedStyle(body);
    return { bandGap: getComputedStyle(band).rowGap, bodyGap: cs.rowGap,
      display: cs.display, direction: cs.flexDirection, gaps };
  })()`);

  /* aria.css:365 makes .band a column flex container with a 13px gap, so its
     children were spaced by their parent. Interposing .band-body without
     restoring that container collapses every one of those gaps to nothing —
     at every width, desktop included. Measured between the laid-out children
     rather than read off the rule, because the rule existing is not the fact
     that matters. */
  assert.equal(seen.display, 'flex');
  assert.equal(seen.direction, 'column');
  assert.equal(seen.bodyGap, seen.bandGap,
    'the wrapper should keep the gap the band it replaced was giving');
  assert.ok(seen.gaps.length > 0, 'expected a band whose body has more than one child');
  for (const gap of seen.gaps) {
    assert.equal(gap, parseFloat(seen.bandGap),
      `children of the body should stay ${seen.bandGap} apart, saw ${gap}px`);
  }
});

/* ============ Stadiora/Aria#10809 — the answer slot's live region ========= */

test('the answer region is revealed empty in one task and filled in a later one', async () => {
  await reshow(EVALS_375);
  const record = await evaluate(`(async () => {
    const slot = document.querySelector('#approval-result');
    /* A MutationObserver callback runs once per task, after that task's
       mutations. That is the same model an assistive technology uses to
       decide whether a live region changed, so what this records is what an
       announcement would have to be derived from. */
    const seen = [];
    const observer = new MutationObserver(() => {
      seen.push({ hidden: slot.hidden, text: slot.textContent.length });
    });
    observer.observe(slot, { attributes: true, childList: true, characterData: true, subtree: true });

    document.querySelector('#approval-get-id').value = 'apr_9f3c';
    document.querySelector('#approval-get-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (seen.length && seen[seen.length - 1].text > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    observer.disconnect();
    return seen;
  })()`);

  const filled = record.findIndex((r) => r.text > 0);
  assert.ok(filled >= 0, `the answer never arrived: ${JSON.stringify(record)}`);
  /* The defect: reveal and fill in one task gives a single record in which
     the region is already visible AND already holding its text, so there is
     no earlier state to diff it against and the announcement can be nothing.
     The fix has to produce a task where it is visible and empty. */
  const revealedEmpty = record
    .slice(0, filled)
    .some((r) => r.hidden === false && r.text === 0);
  assert.ok(revealedEmpty,
    'the region should be visible and empty for a task before its text lands: '
    + JSON.stringify(record));
});

test('an answer region that is visible and empty takes up no room', async () => {
  await reshow(EVALS_375);
  const box = await evaluate(`(() => {
    const slot = document.querySelector('#approval-result');
    slot.textContent = '';
    slot.hidden = false;
    const rect = slot.getBoundingClientRect();
    const cs = getComputedStyle(slot);
    return { height: Math.round(rect.height), display: cs.display,
      padding: cs.paddingTop, shadow: cs.boxShadow, border: cs.borderLeftWidth };
  })()`);

  /* The reveal above buys its task at the cost of a frame in which a 28px
     bordered box could appear empty and then fill. `display` must stay as it
     is: `visibility`, `display: none` and a zero height would each take the
     region back out of the accessibility tree and undo the reveal. */
  assert.notEqual(box.display, 'none', 'the empty region must stay in the accessibility tree');
  assert.equal(box.height, 0, 'a visible but empty answer region should have no extent');
  assert.equal(box.padding, '0px');
  assert.equal(box.border, '0px');
  assert.equal(box.shadow, 'none');
});

test('the light theme folds and rails the same way', async () => {
  await reshow(EVALS_375_LIGHT);
  const seen = await evaluate(`(() => {
    const bands = [...document.querySelectorAll('.band')];
    return { open: bands.filter((b) => b.querySelector('.band-fold').getAttribute('aria-expanded') === 'true').length,
      controlShown: getComputedStyle(document.querySelector('.band-fold')).display };
  })()`);

  /* Theme is a data attribute on the root and the fold is not painted per
     theme, but this pane has shipped a rule that only worked in one of them
     before, so it is cheaper to bind it than to argue about it. */
  assert.equal(seen.open, 0);
  assert.notEqual(seen.controlShown, 'none');
});

/* ===================== the state on a second channel ===================== */

test('at 375 the chevron turns over when the band opens', async () => {
  await reshow(EVALS_375);
  const seen = await evaluate(`(async () => {
    const button = document.querySelector('.band-fold');
    const svg = button.querySelector('svg');
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const read = () => getComputedStyle(svg).transform;
    const shut = read();
    button.click(); await frame(); await frame();
    const open = read();
    button.click(); await frame(); await frame();
    return { shut, open, again: read(), width: Math.round(svg.getBoundingClientRect().width) };
  })()`);

  /* aria-expanded is the whole story for a screen reader and none of it for
     everybody else, so the state carries on a second channel that is not
     colour: the glyph points at the content it would reveal, and points back
     at the head once the content is there. Asserted as the resolved matrix
     rather than the declaration, so a rule that fails to match — which is
     exactly what #10456 shipped — cannot pass this.

     `rotate(180deg)` resolves to matrix(-1, 0, 0, -1, 0, 0). Compared to the
     shut state rather than to that literal so the direction, not the spelling,
     is what is bound. */
  assert.equal(seen.shut, 'none',
    `a closed band's chevron should sit unrotated, saw ${seen.shut}`);
  assert.notEqual(seen.open, seen.shut,
    'an open band should not draw the same chevron as a closed one');
  assert.match(seen.open, /^matrix\(-1,\s*0,\s*0,\s*-1/,
    `an open band's chevron should be turned over, saw ${seen.open}`);
  /* Both arms: a chevron stuck upside down is as wrong as one that never
     turns, and only the pair rules out a rule matching unconditionally. */
  assert.equal(seen.again, seen.shut,
    'closing the band again should put the chevron back');
  assert.ok(seen.width >= 14, `the glyph should be drawn, saw ${seen.width}px`);
});

test('at 375 the fold control is a finger-sized target clear of its own title', async () => {
  await reshow(EVALS_375);
  const seen = await evaluate(`(() => {
    const band = document.querySelector('.band');
    const button = band.querySelector('.band-fold');
    const title = band.querySelector('.band-title');
    const b = button.getBoundingClientRect();
    const t = title.getBoundingClientRect();
    const head = band.querySelector('.band-head').getBoundingClientRect();
    return {
      w: Math.round(b.width), h: Math.round(b.height),
      onScreen: b.left >= 0 && b.right <= document.documentElement.clientWidth,
      overlapsTitle: b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top,
      /* Pinned, measured as an offset from the head's own top right corner.
         The head is a wrapping flex row; a control left in that flow lands
         under the text rather than beside it and pushes the head taller. The
         tolerance is a few pixels rather than 'head.top - 8', which was
         loose enough to accept a button sitting 65px down and 42px in — the
         state the battery produced by deleting the pin, with this assertion
         still green. */
      fromTop: Math.round(b.top - head.top),
      fromRight: Math.round(head.right - b.right)
    };
  })()`);

  assert.ok(seen.w >= 36 && seen.h >= 36,
    `the control should be at least a 36px target, saw ${seen.w}x${seen.h}`);
  assert.equal(seen.onScreen, true, 'the control should be inside the viewport at 375');
  assert.equal(seen.overlapsTitle, false, 'the control should not sit on top of its band title');
  assert.ok(seen.fromTop <= 8,
    `the control should sit at the top of its band head, saw ${seen.fromTop}px down`);
  assert.ok(seen.fromRight <= 8,
    `the control should sit against the head's right edge, saw ${seen.fromRight}px in`);
});

test('at 375 a stage that has not been reached still rails down the column', async () => {
  await show(SHIP_375);
  const seen = await evaluate(`(() => {
    /* The live fixture carries no 'todo' stage, so the class is put on a
       stage to resolve what the sheet would draw for one. Restored before the
       read returns, so no later test sees it. */
    const steps = [...document.querySelector('.pipe-track').children];
    const step = steps[0];
    const had = step.className;
    step.className = 'pipe-step todo';
    const cs = getComputedStyle(step, '::before');
    const out = { width: cs.width, height: cs.height, image: cs.backgroundImage,
      left: cs.left, top: cs.top, bottom: cs.bottom, right: cs.right };
    step.className = had;
    return out;
  })()`);

  await show(SHIP_1280);
  const wide = await evaluate(`(() => {
    const step = document.querySelector('.pipe-track').children[0];
    const had = step.className;
    step.className = 'pipe-step todo';
    const cs = getComputedStyle(step, '::before');
    const out = { width: cs.width, height: cs.height, image: cs.backgroundImage };
    step.className = had;
    return out;
  })()`);

  /* Vertical: a narrow strip taller than it is wide. The horizontal form was
     the other way round, so this fails if the 560 block does not apply. */
  assert.ok(parseFloat(seen.width) <= 4,
    `an unreached stage's rail should be a narrow vertical strip, saw ${seen.width} wide`);
  assert.ok(parseFloat(seen.height) > parseFloat(seen.width),
    `it should be taller than it is wide, saw ${seen.width} x ${seen.height}`);
  /* `right` is not readable here: getComputedStyle resolves `auto` to a used
     pixel value on a positioned element, so the assertion that the horizontal
     rail's `right` was unset has to be made through its consequence. Unset it
     is not, and the strip spans the step instead of the gutter — which is what
     the width above rules out. This binds the run: a rail under an unreached
     stage that is only a few pixels long reads as a gap, and four gaps down a
     column read as no rail at all. */
  assert.ok(parseFloat(seen.height) >= 15,
    `it should run a real distance, saw ${seen.height}`);
  /* The dashes have to run down the rail, not across it: the base rule's
     `90deg` on a 2px-wide vertical strip draws one dash filling the whole
     run — a solid line, which is this sheet's spelling for a stage that HAS
     been reached, so the rail would say the opposite of what it means.

     Bound through the resolved value and its other arm rather than by
     matching `180deg` in the text: 180deg IS the default direction, so Chrome
     serialises it away and the computed value carries no angle at all. A
     regex looking for the angle it was written with could never match, which
     is the same shape as a source grep that pins a string instead of a
     behaviour. 90deg is not the default, so it survives serialisation — the
     horizontal arm below is what gives this one its teeth. */
  assert.equal(/\d+deg|to (top|bottom|left|right)/.test(seen.image), false,
    `at 375 the dashes should run down the column, which is the default ` +
    `direction and carries no angle, saw ${seen.image}`);
  assert.match(wide.image, /90deg/,
    `at 1280 the same dashes should run along the row, saw ${wide.image}`);
  assert.notEqual(seen.image, wide.image,
    'the unreached rail should not be drawn the same way at both widths');
});
