/* Every class these two panes write is painted by a stylesheet they load.
 *
 * WHY THIS FILE IS DIFFERENT FROM THE OTHER PANE TESTS
 *
 * The rest of scripts/*.test.mjs run the panes against scripts/ops-dom-harness.mjs,
 * a fake DOM with no cascade: it can say that an element carries a class and
 * cannot say whether anything paints it. That is the exact blind spot the defect
 * class lives in. Stadiora/Aria#10456 shipped a `is-selected` row on the users
 * pane that no rule matched — the selection was in the DOM, and invisible.
 * Stadiora/Aria#10646 and #10647 are the same fault on these two panes: one class
 * on App releases and ten on Aria quality, written into the DOM and painted by
 * nothing, because ops.css defined most of them and a v2 pane loads aria.css,
 * shell-pane-v2.css and its own sheet, never ops.css.
 *
 * So this file drives real Chrome over the DevTools protocol and asserts on
 * RESOLVED values: computed styles, laid-out geometry, and the accessibility
 * tree. Nothing here reads a stylesheet as text. Asserting that a sheet CONTAINS
 * `.done { ... }` pins the string and not the painting, and would stay green
 * against a rule that is overridden, misspelled in the selector, or scoped to a
 * page the pane is not on.
 *
 * Every assertion binds BOTH arms: the value with the class, and the value the
 * same element takes when the class is removed and the page is laid out again.
 * A rule that is deleted from the stylesheet collapses the two, and the test
 * goes red. That is the mutation this file exists for, and the PR that added it
 * publishes the anchor and payload for each one.
 *
 * It needs a browser and fails closed without one: CHROME_PATH, or Chrome or
 * Chromium on one of the usual paths. The ops-pane-tests workflow's own comment
 * says its job uses only what ships with Node; that is still true of the client
 * below — node:test, node:http, the global WebSocket and fetch, no package —
 * but not of the browser, which this file launches and the others do not.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stub, RELEASES } from './ops-api-stub.mjs';

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
let androidState = null;

/* The evaluations pane's CIEL operations endpoint, which the shared stub does
   not carry. Only the shapes these tests drive: a dataset validation, which is
   what draws .dataset-result, and enough of an approval response that the
   approval cards render rather than erroring. */
function operations(body) {
  const req = body || {};
  const op = String(req.operation || '');
  const envelope = (type, id, value) => ({
    schemaVersion: 'ciel.operation.response.v1',
    requestId: req.requestId, operationId: req.operationId,
    status: 'success', exitCode: 0,
    resource: { type: type, id: id, revision: 1, value: value }
  });
  if (op.indexOf('approval') === 0) {
    return envelope('ciel.evidence-approval', 'apr_9f3c',
      { approvalRequestId: 'apr_9f3c', state: 'pending', revision: 2 });
  }
  return envelope('ciel.dataset-validation', req.requestId, {
    valid: true, issues: [],
    digests: [{ datasetId: 'dataset.example', revision: 1, sha256: 'b'.repeat(64) }]
  });
}

function releasesVariant() {
  const payload = JSON.parse(JSON.stringify(RELEASES));
  const android = payload.platforms.find((p) => p.platform === 'android');
  android.tracks.find((t) => t.track === 'production').state = androidState;
  return { data: payload };
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
        : (url.pathname.startsWith('/api/ops/releases') && androidState)
          ? releasesVariant()
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

/* What the browser is currently showing. Tests are grouped by it so a run
   costs five page loads rather than one per test; a test asking for a state
   that is not up navigates, so the grouping is an optimisation and never a
   correctness assumption about the order tests run in. */
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
  /* The expression is evaluated inside a try because Page.navigate resolves as
     soon as the navigation STARTS: the document under it is whatever was there
     before, or a half-parsed new one with no body yet, and a probe that reaches
     through a null is a wait, not a failure. */
  const guarded = `(() => { try { return !!(${expression}); } catch (e) { return false; } })()`;
  for (let i = 0; i < 300; i++) {
    if (await evaluate(guarded)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for ' + what);
}

/* The declaration the dataset form is driven with, to reach the result view
   that draws .dataset-result. */
const DECLARATION = JSON.stringify({
  schemaVersion: 'ciel.dataset.v1',
  datasets: [{ datasetId: 'dataset.example', revision: 1, cases: [] }],
  fixtureDigests: []
});

async function show(state) {
  if (showing === state.key) return;
  showing = null;
  androidState = state.android || null;

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: state.width, height: 900, deviceScaleFactor: 1, mobile: false
  });

  /* theme.js decides the theme before first paint, out of localStorage, so the
     choice has to be in place before the document exists rather than set on a
     page that has already been laid out in the other one. */
  if (themeScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: themeScript });
  themeScript = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('ops-theme', ${JSON.stringify(state.theme)}); } catch (e) {}`
  })).identifier;

  await cdp.send('Page.navigate', { url: origin + state.url });
  await waitFor("document.body.classList.contains('is-ready')", 'the shell to boot ' + state.url);
  await waitFor(`document.documentElement.getAttribute('data-theme') === ${JSON.stringify(state.theme)}`,
    'the ' + state.theme + ' theme on ' + state.url);
  await waitFor(`document.querySelector(${JSON.stringify(state.ready)})`,
    state.ready + ' on ' + state.url);

  if (state.validate) {
    await evaluate(`(() => {
      const box = document.querySelector('#dataset-input');
      box.value = ${JSON.stringify(DECLARATION)};
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.closest('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    })()`);
    await waitFor("document.querySelector('.dataset-result .evidence-meta-row dt')",
      'the dataset validation result');
  }

  /* The approval band's answer slot is `hidden` between answers, so reaching it
     means asking the band for an answer. A synthetic submit event rather than a
     click: it runs the same handler and skips constraint validation, which is
     how the dataset form above is driven too. */
  if (state.approval) {
    await evaluate(`(() => {
      document.querySelector('#approval-get-id').value = 'apr_9f3c';
      document.querySelector('#approval-get-form')
        .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    })()`);
    await waitFor("(() => { const el = document.querySelector('#approval-result');"
      + ' return el && !el.hidden && el.textContent.length; })()',
      'the approval band to answer');
  }

  /* The quarantine form refuses to submit without a file, and a File cannot be
     assigned to an <input type="file">; DataTransfer is the only way to put one
     there, and it is the same path a real drop takes. */
  if (state.quarantine) {
    await evaluate(`(() => {
      const input = document.querySelector('#evidence-file');
      const carrier = new DataTransfer();
      carrier.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'evidence.bin',
        { type: 'application/octet-stream' }));
      input.files = carrier.files;
      input.closest('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    })()`);
    await waitFor("document.querySelector('.evidence-result .card')",
      'the quarantine answer card');
  }
  showing = state.key;
}

const EVALS_DARK = { key: 'evals/1280/dark', url: '/ops/evaluations.html', width: 1280, theme: 'dark', ready: '#approval-trust-note', validate: true };
const EVALS_LIGHT = { key: 'evals/1280/light', url: '/ops/evaluations.html', width: 1280, theme: 'light', ready: '#approval-trust-note', validate: true };
const EVALS_940 = { key: 'evals/940/dark', url: '/ops/evaluations.html', width: 940, theme: 'dark', ready: '.evidence-form-grid' };
const EVALS_880 = { key: 'evals/880/dark', url: '/ops/evaluations.html', width: 880, theme: 'dark', ready: '.evidence-form-grid' };

/* The two answer states of Stadiora/Aria#10674: the approval band having
   answered, and the evidence form having quarantined something. Both are
   states the pane only reaches when it does the thing it exists to do, which
   is why the classes they draw went unpainted for a release without anybody
   noticing. */
const EVALS_ANSWER_DARK = { key: 'evals/answer/dark', url: '/ops/evaluations.html', width: 1280, theme: 'dark', ready: '#approval-get-form', approval: true, quarantine: true };
const EVALS_ANSWER_LIGHT = { key: 'evals/answer/light', url: '/ops/evaluations.html', width: 1280, theme: 'light', ready: '#approval-get-form', approval: true, quarantine: true };
const SHIP_DARK = { key: 'ship/1280/dark', url: '/ops/releases.html', width: 1280, theme: 'dark', ready: '.pipe-step.done' };
const SHIP_MID = { key: 'ship/1280/dark/in-review', url: '/ops/releases.html', width: 1280, theme: 'dark', ready: '.pipe-step.todo', android: 'in_review' };

/* Chromium's own answer to "what is composited behind this", the one DevTools'
   contrast readout uses. It resolves gradients and translucent stacks, which
   walking parentElement and reading background-color does not: every ancestor
   of a callout here reports a transparent background-color and the card behind
   it is a gradient. */
async function backdrop(selector) {
  /* Read twice around a frame and insist on the same answer: getBackgroundColors
     is resolved against what has been painted, so a read taken while the pane is
     still settling can report the surface a layer up and turn a contrast figure
     into a coin toss. */
  let last = null;
  for (let i = 0; i < 40; i++) {
    const now = await backdropOnce(selector);
    if (now && last && last.join() === now.join()) return now;
    last = now;
    await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  }
  throw new Error(`Chromium never settled on a backdrop for ${selector}`);
}

async function backdropOnce(selector) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `no element matches ${selector}`);
  const answer = await cdp.send('CSS.getBackgroundColors', { nodeId });
  /* An empty answer means Chromium has not painted the stack yet rather than
     that the element has no backdrop, so it is a reason to look again. */
  if (!answer.backgroundColors || !answer.backgroundColors.length) return null;
  return answer.backgroundColors.map(parseColour).reduce((under, over) => composite(under, over));
}

function parseColour(text) {
  let m = /^rgba?\(([^)]+)\)$/.exec(text);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : parts[3]];
  }
  m = /^color\(srgb ([^)]+)\)$/.exec(text);
  if (m) {
    const parts = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return [parts[0] * 255, parts[1] * 255, parts[2] * 255, parts[3] === undefined ? 1 : parts[3]];
  }
  throw new Error('cannot read colour ' + text);
}

const composite = (over, under) => [0, 1, 2]
  .map((i) => over[i] * over[3] + under[i] * (1 - over[3])).concat(1);

const luminance = (colour) => {
  const channel = (v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
};

/* WCAG 2.2 relative contrast, with the ink composited onto the surface first so
   a translucent ink is measured as it is drawn rather than as it is written. */
function contrast(ink, surface) {
  const [light, dark] = [luminance(composite(ink, surface)), luminance(surface)]
    .sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const show3 = (colour) => `rgb(${colour.slice(0, 3).map(Math.round).join(' ')})`;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  profile = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'ops-painted-'));
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
  await cdp.send('CSS.enable');
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
  /* Chrome keeps writing its profile out as it shuts down, and on a CI runner
     it can still be doing so after the process has gone. The directory is
     inside RUNNER_TEMP and the runner discards it either way, so failing to
     remove it is not a reason to fail a test about stylesheets. */
  try {
    if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  } catch (e) { /* the runner sweeps it up */ }
});

/* ===================== Stadiora/Aria#10646 — App releases ================= */

/* The anchor for all three of these is ops/assets/pane-releases-v2.css,
   `.pipe-step.done::before`. Delete that block and the done rail collapses onto
   the base `.pipe-step::before` rule, which is what shipped. */

test('a stage the build is past draws a different rail from one it has not reached', async () => {
  await show(SHIP_DARK);
  const rail = await evaluate(`(() => {
    const step = document.querySelector('.pipe-step.done');
    const read = () => {
      const s = getComputedStyle(step, '::before');
      return {
        height: s.height, left: s.left, right: s.right, top: s.top,
        background: s.backgroundColor
      };
    };
    const on = read();
    step.classList.remove('done');
    step.getBoundingClientRect();
    const off = read();
    step.classList.add('done');
    return { on, off };
  })()`);

  assert.notDeepStrictEqual(rail.on, rail.off,
    'the rail behind a done stage renders exactly as it does with the word `done` taken ' +
    'off the element, so `done` paints nothing — Stadiora/Aria#10646');
  assert.strictEqual(rail.on.height, '3px', 'a done stage should leave a 3px rail');
  assert.strictEqual(rail.off.height, '2px', 'without `done` the base 2px hairline is what is left');

  /* The rail is a shape before it is a colour: it is thicker, and it is drawn
     clear of both nodes instead of running under them. Weight and extent are
     what survive greyscale and forced colours; the tone on top agrees with the
     reading rather than carrying it. */
  assert.strictEqual(rail.on.left, '22px', 'the done rail should start where the 22px node ends');
  assert.strictEqual(rail.off.left, '11px', 'the base rail runs from the node centre');
  /* Both ends, not one. `.pipe-node` is a 16% tint rather than an opaque disc,
     so a rail that runs past the far node is drawn straight through its
     checkmark. Asserted as the resolved value rather than as a difference from
     the base rail, because the height and background differ anyway and an
     inequality would pass with this end unchanged. */
  assert.strictEqual(rail.on.right, '0px',
    `the done rail should stop at the next node's edge, and ends at ${rail.on.right}`);
  assert.strictEqual(rail.off.right, '-11px', 'the base rail runs on to the next node centre');
  /* And the third edge. A 3px rail replacing a 2px one keeps its centreline
     only by rising half a pixel; `9.5px` and `10px` are different strings, so
     the read above separates them on any machine and there is no reason to
     leave the declaration to the whole-rule payload. */
  assert.strictEqual(rail.on.top, '9.5px',
    `the thicker rail should sit half a pixel up to stay centred, and sits at ${rail.on.top}`);
  assert.strictEqual(rail.off.top, '10px', 'the base hairline sits on the 10px line');

  /* And it is opaque, where the base rail is 38% of the tone. Deleting only the
     background line of the rule would leave the height and still be caught. */
  assert.match(rail.on.background, /^rgb\(\d+, \d+, \d+\)$/,
    `the done rail should be the solid tone, and is ${rail.on.background}`);
  assert.notStrictEqual(rail.on.background, rail.off.background);
});

test('the three stage states draw three different rails in one pipeline', async () => {
  await show(SHIP_MID);
  const rails = await evaluate(`(() => {
    const track = document.querySelectorAll('.pipe-track')[1];
    const of = (cls) => {
      const step = track.querySelector('.pipe-step.' + cls);
      if (!step) return null;
      const s = getComputedStyle(step, '::before');
      return { height: s.height, background: s.backgroundColor, image: s.backgroundImage };
    };
    return { done: of('done'), now: of('now'), todo: of('todo') };
  })()`);

  assert.ok(rails.done && rails.now && rails.todo,
    'this fixture should put one stage in each state, and drew ' + JSON.stringify(rails));

  /* Three states, three rails, told apart without reference to hue: solid and
     3px, a 2px hairline, and a dash pattern. */
  assert.strictEqual(rails.done.height, '3px');
  assert.strictEqual(rails.now.height, '2px');
  assert.strictEqual(rails.todo.image.startsWith('repeating-linear-gradient'), true,
    'an unreached stage should draw a dashed rail, and drew ' + rails.todo.image);
  assert.strictEqual(rails.done.image, 'none',
    'a done stage should draw a solid rail, and drew ' + rails.done.image);

  /* Solid against washed, not one hue against another. Done stages are toned
     `ok` and the current stage takes the row's own tone, so two rails painted
     by the SAME base rule already differ in colour: comparing the two colours
     passes with the done rule's `background` line deleted and says nothing.
     What the rule actually does is replace a 38% wash with the tone itself, so
     the reading is alpha, and it holds whatever tone the row is in. */
  assert.strictEqual(parseColour(rails.done.background)[3], 1,
    'the done rail should be the solid tone, and is ' + rails.done.background);
  assert.ok(parseColour(rails.now.background)[3] < 1,
    'the base rail should stay a wash, and is ' + rails.now.background);
});

test('the done rail clears AA non-text contrast against the card behind it', async () => {
  await show(SHIP_DARK);
  const rail = parseColour(await evaluate(
    "getComputedStyle(document.querySelector('.pipe-step.done'), '::before').backgroundColor"));
  const card = await backdrop('.pipe-label');
  const ratio = contrast(rail, card);
  assert.ok(ratio >= 3, `the done rail is ${show3(rail)} on ${show3(card)} — the release ` +
    `card fill behind the pipeline — which is ${ratio.toFixed(2)}:1, under the 3:1 WCAG ` +
    '1.4.11 asks of a graphic that carries meaning');
});

/* The anchor for these two is ops/assets/pane-releases.js, in pipeTrack: the
   aria-current line and the .sr line beside it. */

test('a stage says which of the three states it is in to a reader who cannot see the rail', async () => {
  await show(SHIP_MID);

  /* Resolved from the accessibility tree, not from the markup. A visually
     hidden span is only worth anything if it is still announced, and the
     difference between `clip` and `display: none` is invisible in the DOM. */
  const { nodes } = await cdp.send('Accessibility.getFullAXTree', {});
  const spoken = nodes
    .filter((n) => n.role && n.role.value === 'StaticText' && n.name)
    .map((n) => n.name.value);
  assert.ok(spoken.includes('Done.'),
    'no accessibility node says a passed stage is done; the rail is then the only ' +
    'channel, and a screen reader has none');
  assert.ok(spoken.includes('Not reached.'),
    'no accessibility node says an unreached stage has not been reached');

  /* And the word costs no space on screen. */
  const hidden = await evaluate(`(() => {
    const sr = document.querySelector('.pipe-step.done .sr');
    const box = sr.getBoundingClientRect();
    return { width: box.width, height: box.height, display: getComputedStyle(sr).display };
  })()`);
  assert.ok(hidden.width <= 1 && hidden.height <= 1,
    `the hidden word occupies ${hidden.width}x${hidden.height}px on screen`);
  assert.notStrictEqual(hidden.display, 'none',
    'display:none would take it out of the accessibility tree as well as off the screen');
});

test('the stage the build is at is the only one marked as current', async () => {
  await show(SHIP_MID);
  /* A DOM assertion rather than an accessibility-tree one, and deliberately:
     Chromium's CDP accessibility serialisation does not report `current` as a
     property at all — this page's own sidebar marks its active link
     aria-current="page", the most ordinary use there is, and that does not
     appear in getFullAXTree either. The attribute is the API; the tree cannot
     be asked about it here. The two words above are what the accessibility
     tree does carry. */
  const marked = await evaluate(`(() => {
    const track = document.querySelectorAll('.pipe-track')[1];
    return [...track.querySelectorAll('.pipe-step')].map((step) => ({
      state: step.classList.contains('done') ? 'done'
        : step.classList.contains('now') ? 'now' : 'todo',
      current: step.getAttribute('aria-current')
    }));
  })()`);
  const current = marked.filter((step) => step.current === 'step');
  assert.strictEqual(current.length, 1, 'exactly one stage should be the current one');
  assert.strictEqual(current[0].state, 'now');
  assert.deepStrictEqual(
    marked.filter((step) => step.state !== 'now').map((step) => step.current),
    marked.filter((step) => step.state !== 'now').map(() => null),
    'no stage other than the current one should claim to be current');
});

/* ===================== Stadiora/Aria#10647 — Aria quality ================= */

/* Anchor: ops/assets/pane-evaluations-v2.css, the `.callout-warn` block and the
   `background`/`box-shadow` lines of the `.callout` block above it. Before the
   split, `.callout` was itself amber and `.callout-warn` matched nothing, so
   the warning and the consent boundary beside it were the same box. */

for (const theme of [EVALS_DARK, EVALS_LIGHT]) {
  test(`the warning is not drawn like the sentence beside it, in the ${theme.theme} theme`, async () => {
    await show(theme);
    const read = `(el) => { const s = getComputedStyle(el); return {
      fill: s.backgroundColor, rail: s.borderLeftColor, railWidth: s.borderLeftWidth,
      glyph: getComputedStyle(el.querySelector('svg')).color }; }`;
    const seen = await evaluate(`(() => {
      const read = ${read};
      const warn = document.querySelector('#approval-trust-note');
      const plain = [...document.querySelectorAll('.callout')]
        .find((el) => !el.classList.contains('callout-warn'));
      const on = read(warn);
      warn.classList.remove('callout-warn');
      warn.getBoundingClientRect();
      const off = read(warn);
      warn.classList.add('callout-warn');
      return { on, off, plain: read(plain) };
    })()`);

    assert.notStrictEqual(seen.on.fill, seen.plain.fill,
      'the warning and the consent boundary are filled with the same colour, which is ' +
      'what Stadiora/Aria#10647 reported: callout-warn matched no rule');
    assert.notStrictEqual(seen.on.rail, seen.plain.rail);
    assert.notStrictEqual(seen.on.glyph, seen.plain.glyph);

    /* The other arm. With the modifier taken off, the warning must become the
       plain callout exactly — which is what proves the three differences above
       come from `callout-warn` and not from the id, the order, or the band. */
    assert.deepStrictEqual(seen.off, seen.plain,
      'with callout-warn removed the warning should be indistinguishable from the ' +
      'plain callout, and is not — so something other than the modifier is painting it');
  });

  /* The other half of the split, and the half the two assertions above cannot
     reach: both of them compare two elements that resolve through this same
     base rule, so they move together under any change to it and bind none of
     its values. Put `background` back to the amber it carried before the split
     and the pair above still passes with both boxes amber — which is the
     sentence Stadiora/Aria#10647 opens with.

     Bound against the tokens themselves rather than against the warning, and
     resolved by the browser off this document so the expectation is the live
     cascade's answer in this theme rather than a literal copied out of the
     sheet under test. The probe is a child of the callout, so it resolves the
     tokens in the place they are used. */
  test(`the sentence beside the warning is painted the plain surface, in the ${theme.theme} theme`, async () => {
    await show(theme);
    const seen = await evaluate(`(() => {
      const plain = [...document.querySelectorAll('.callout')]
        .find((el) => !el.classList.contains('callout-warn'));
      const probe = document.createElement('span');
      probe.hidden = true;
      plain.appendChild(probe);
      const token = (name) => {
        probe.style.backgroundColor = 'var(' + name + ')';
        return getComputedStyle(probe).backgroundColor;
      };
      const surface2 = token('--surface-2');
      const line2 = token('--line-2');
      const s = getComputedStyle(plain);
      const out = {
        fill: s.backgroundColor, image: s.backgroundImage, shadow: s.boxShadow,
        surface2, line2
      };
      probe.remove();
      return out;
    })()`);

    assert.match(seen.surface2, /^rgba?\(/, 'the probe should resolve --surface-2 to a colour');
    assert.notStrictEqual(seen.surface2, seen.line2, 'the two tokens should not be one colour');

    assert.strictEqual(seen.fill, seen.surface2,
      `the consent boundary should be filled with --surface-2 (${seen.surface2}) and is ` +
      `filled with ${seen.fill} — a note that is not a warning must not wear the warning tint`);
    assert.strictEqual(seen.shadow, `${seen.line2} 0px 0px 0px 1px inset`,
      `the consent boundary should be ringed by the --line-2 hairline and is ringed by ` +
      `${seen.shadow}`);

    /* `background` is a shorthand over two layers, and the backing colour is
       only one of them: a gradient in the image layer repaints the box amber
       while `backgroundColor` still reports the surface underneath it. So the
       claim is made about what is painted, not about one declaration's colour
       slot — the composited answer Chromium gives for the stack behind the
       note's own heading, which is the reading this pane's contrast figures
       are taken from. Any painted layer that changes what a person sees moves
       this number; `backgroundImage` is asserted beside it so a failure names
       the layer rather than only the colour. */
    assert.strictEqual(seen.image, 'none',
      `the consent boundary should carry no image layer and carries ${seen.image}`);
    const painted = await backdrop('.callout:not(.callout-warn) strong');
    assert.strictEqual(show3(painted), show3(parseColour(seen.surface2)),
      `the colour actually painted behind the consent boundary is ${show3(painted)}, ` +
      `where --surface-2 is ${seen.surface2}`);
  });
}

test('the warning reads as a warning with every colour taken away', async () => {
  await show(EVALS_LIGHT);

  /* Three channels, none of which is hue. */
  const seen = await evaluate(`(() => {
    const warn = document.querySelector('#approval-trust-note');
    const plain = [...document.querySelectorAll('.callout')]
      .find((el) => !el.classList.contains('callout-warn'));
    const paths = (el) => [...el.querySelectorAll('svg path')]
      .map((p) => p.getAttribute('d')).join(' ');
    const alpha = (el) => {
      const m = /rgba?\\(([^)]+)\\)/.exec(getComputedStyle(el).borderLeftColor);
      const parts = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
      return parts[3] === undefined ? 1 : parts[3];
    };
    return {
      word: warn.querySelector('strong').textContent,
      plainWord: plain.querySelector('strong').textContent,
      glyph: paths(warn), plainGlyph: paths(plain),
      railAlpha: alpha(warn), plainRailAlpha: alpha(plain),
      railWidth: getComputedStyle(warn).borderLeftWidth
    };
  })()`);

  /* One. The sentence opens with the word, so a reader who gets no colour at
     all — a printout, a monochrome screen, or simply not knowing that amber
     means caution on this pane — is still told. */
  assert.match(seen.word, /^Warning: /,
    `the warning's own sentence should say so, and reads ${JSON.stringify(seen.word)}`);
  assert.doesNotMatch(seen.plainWord, /^Warning: /,
    'the consent boundary is not a warning and should not open with the word');

  /* Two. A different glyph, which is a shape. Both callouts wore the warning
     triangle before this, so the triangle told them apart from nothing. */
  assert.notStrictEqual(seen.glyph, seen.plainGlyph,
    'the two callouts draw the same glyph, so the glyph distinguishes nothing');
  assert.ok(seen.glyph.length > 0 && seen.plainGlyph.length > 0);

  /* Three. A rail that is present on one and absent on the other. Absence is
     not a hue: a border with zero alpha is invisible under any vision, any
     filter, and in forced-colours mode, where transparent is the one colour a
     user agent is required to leave alone. */
  assert.strictEqual(seen.railWidth, '3px');
  assert.strictEqual(seen.railAlpha, 1, 'the warning should carry an opaque left rail');
  assert.strictEqual(seen.plainRailAlpha, 0, 'the plain callout should carry no rail');
});

for (const theme of [EVALS_DARK, EVALS_LIGHT]) {
  test(`the warning's ink and rail clear AA where they are drawn, in the ${theme.theme} theme`, async () => {
    await show(theme);
    const fill = await backdrop('#approval-trust-note strong');
    const band = await backdrop('.band-title');
    const colourOf = async (selector, property) => parseColour(await evaluate(
      `getComputedStyle(document.querySelector(${JSON.stringify(selector)}))` +
      `[${JSON.stringify(property)}]`));

    const heading = await colourOf('#approval-trust-note strong', 'color');
    const body = await colourOf('#approval-trust-note p', 'color');
    const glyph = await colourOf('#approval-trust-note svg', 'color');
    const rail = await colourOf('#approval-trust-note', 'borderLeftColor');

    const surface = `${show3(fill)}, the warn callout fill — --amber 10% over --surface-2`;
    const check = (ink, what, need, against, name) => {
      const ratio = contrast(ink, against);
      assert.ok(ratio >= need, `${what} is ${show3(ink)} on ${name}, which is ` +
        `${ratio.toFixed(2)}:1 and under ${need}:1`);
    };
    check(heading, 'the warning heading, 13px/580', 4.5, fill, surface);
    check(body, 'the warning body, 12.5px', 4.5, fill, surface);
    check(glyph, 'the warning triangle', 3, fill, surface);
    check(rail, 'the 3px rail, on its inner side', 3, fill, surface);
    check(rail, 'the 3px rail, on its outer side', 3, band,
      `${show3(band)}, the band behind the callout`);
  });
}

/* Anchor: ops/assets/pane-evaluations-v2.css, the `.dataset-form, .dataset-result,
   .evidence-form, .approval-card { max-width: 920px }` rule. ops.css capped only
   .evidence-form, so on a v2 page nothing was capped at all. */

test('every surface a person types into or reads an answer off takes one measure', async () => {
  await show(EVALS_DARK);
  const measured = await evaluate(`(() => {
    const out = {};
    const width = (el) => Math.round(el.getBoundingClientRect().width);
    const bind = (name, el, cls) => {
      const on = width(el);
      el.classList.remove(cls);
      el.getBoundingClientRect();
      const off = width(el);
      el.classList.add(cls);
      out[name] = { on: on, off: off };
    };
    bind('dataset-form', document.querySelector('.dataset-form'), 'dataset-form');
    bind('dataset-result', document.querySelector('.dataset-result'), 'dataset-result');
    bind('evidence-form', document.querySelector('.evidence-form'), 'evidence-form');
    /* The card outside the two-column grid: the two inside it are narrower than
       the measure already, so the cap is a no-op on them and binding one of
       those would assert nothing. */
    bind('approval-card', [...document.querySelectorAll('.approval-card')]
      .find((el) => !el.parentElement.classList.contains('approval-workflow-grid')), 'approval-card');
    /* The handoff grid carries the same cap in a rule of its own, two rules
       down. Bound here rather than beside its alignment, because deleting that
       whole rule takes both declarations and would not tell the two apart. */
    bind('approval-workflow-grid', document.querySelector('.approval-workflow-grid'),
      'approval-workflow-grid');
    return out;
  })()`);

  for (const [name, seen] of Object.entries(measured)) {
    assert.strictEqual(seen.on, 920, `.${name} should be held to the 920px measure, and is ${seen.on}px`);
    assert.ok(seen.off > seen.on, `.${name} renders ${seen.off}px with the class taken off ` +
      'and the same width with it on, so the class is painting nothing');
  }
});

/* Anchor: the `.dataset-form .field-error { overflow-wrap: anywhere }` line.
   ops.css carried it, this sheet did not, and a validation message is one
   unbroken token — a JSON pointer or a digest — with nowhere to break. */

test('a validation message breaks inside an unbroken token, and one outside the dataset form does not', async () => {
  await show(EVALS_DARK);
  const seen = await evaluate(`(() => {
    const token = 'x'.repeat(200);
    const box = (el) => ({ height: Math.round(el.getBoundingClientRect().height),
      scroll: el.scrollWidth, client: el.clientWidth });
    const target = document.querySelector('.dataset-form .field-error');
    /* A control the rule does not cover, in the same pane, at the same width:
       if it wraps too, the wrapping is coming from somewhere else. */
    const control = [...document.querySelectorAll('.field-error')]
      .find((el) => !el.closest('.dataset-form'));
    const before = { target: target.textContent, control: control.textContent };
    target.textContent = token;
    control.textContent = token;
    const on = { target: box(target), control: box(control) };
    const form = document.querySelector('.dataset-form');
    form.classList.remove('dataset-form');
    target.getBoundingClientRect();
    const off = box(target);
    form.classList.add('dataset-form');
    target.textContent = before.target;
    control.textContent = before.control;
    return { on, off };
  })()`);

  assert.ok(seen.on.target.scroll <= seen.on.target.client,
    `the message runs ${seen.on.target.scroll - seen.on.target.client}px out of its box`);
  assert.ok(seen.on.control.scroll > seen.on.control.client,
    'the control message wraps as well, so this proves nothing about the rule — ' +
    'something else on the page is breaking unbroken tokens');
  assert.ok(seen.off.scroll > seen.off.client,
    'the message still wraps with `dataset-form` taken off the form, so the rule ' +
    'under that selector is not what is wrapping it');
  assert.ok(seen.on.target.height > seen.off.height,
    'wrapping should make the message taller, and it is ' +
    `${seen.on.target.height}px wrapped against ${seen.off.height}px unwrapped`);
});

/* Anchor: the `.dataset-result .evidence-meta-row dt { overflow-wrap: anywhere }`
   line. The term is a dataset id and a revision, and a dataset id is one token. */

test('a dataset name in the validation answer breaks inside itself rather than running out of the card', async () => {
  await show(EVALS_DARK);
  const seen = await evaluate(`(() => {
    const token = 'x'.repeat(200);
    const term = document.querySelector('.dataset-result .evidence-meta-row dt');
    const before = term.textContent;
    term.textContent = token;
    const box = (el) => ({ height: Math.round(el.getBoundingClientRect().height),
      scroll: el.scrollWidth, client: el.clientWidth });
    const on = box(term);
    const result = document.querySelector('.dataset-result');
    result.classList.remove('dataset-result');
    term.getBoundingClientRect();
    const off = box(term);
    result.classList.add('dataset-result');
    term.textContent = before;
    return { on, off };
  })()`);

  assert.ok(seen.on.scroll <= seen.on.client,
    `the dataset name runs ${seen.on.scroll - seen.on.client}px out of its box`);
  assert.ok(seen.off.scroll > seen.off.client,
    'the name wraps with `dataset-result` taken off, so the rule under that ' +
    'selector is not what is wrapping it');
  assert.ok(seen.on.height > seen.off.height);
});

/* Anchor: the `.evidence-form-grid` rule and its `@media (max-width: 900px)`
   companion. ops.css gave this class a 14px top margin and nothing else, so on
   a v2 page it inherited aria.css's .g2, which collapses at 980px — 80px wider
   than the .q-grid beside it on the same pane. */

test('the approval field grid holds two columns to the same width as the evidence one', async () => {
  await show(EVALS_940);
  const seen = await evaluate(`(() => {
    const grid = document.querySelector('.evidence-form-grid');
    const read = () => {
      const s = getComputedStyle(grid);
      return { columns: s.gridTemplateColumns.split(' ').length,
        col: s.columnGap, row: s.rowGap };
    };
    const on = read();
    grid.classList.remove('evidence-form-grid');
    grid.getBoundingClientRect();
    const off = read();
    grid.classList.add('evidence-form-grid');
    const q = document.querySelector('.q-grid');
    const qs = q ? getComputedStyle(q) : null;
    return { on, off,
      q: qs ? { columns: qs.gridTemplateColumns.split(' ').length,
        col: qs.columnGap, row: qs.rowGap } : null,
      viewport: document.documentElement.clientWidth };
  })()`);

  assert.strictEqual(seen.viewport, 940, 'this test only says anything between 900 and 980px');
  assert.strictEqual(seen.on.columns, 2, 'the approval field grid should still be two columns at 940px');
  assert.strictEqual(seen.off.columns, 1,
    'aria.css collapses .g2 at 980px, so with `evidence-form-grid` taken off this ' +
    'grid should fall to one column at 940px — it did not, so the rule is not what ' +
    'is holding it open');
  assert.strictEqual(seen.q.columns, seen.on.columns,
    'the two field grids on this pane should behave the same way at the same width');

  /* The gutter is a second declaration in the same rule and needs its own
     reading: deleting `gap` alone leaves the column count untouched, so a
     column-count assertion passes over it. The claim is that this grid takes
     the same gutter as the `.q-grid` beside it, and that the rule is what
     sets it. */
  assert.strictEqual(seen.on.col, seen.q.col,
    `the approval field grid's column gutter is ${seen.on.col} and the evidence ` +
    `grid's beside it is ${seen.q.col}`);
  assert.strictEqual(seen.on.row, seen.q.row,
    `the approval field grid's row gutter is ${seen.on.row} and the evidence ` +
    `grid's beside it is ${seen.q.row}`);
  assert.notStrictEqual(seen.off.col, seen.on.col,
    `the gutter is ${seen.off.col} with \`evidence-form-grid\` taken off as well, so ` +
    'the rule under that selector is not what is setting it');

  /* The other end of the same claim. Holding the grid open at 940px is the
     rule; collapsing it at 880px is the media block, and each of the two can
     be deleted without moving the other, so both are read. */
  await show(EVALS_880);
  const narrow = await evaluate(`(() => {
    const columns = (sel) => getComputedStyle(document.querySelector(sel))
      .gridTemplateColumns.split(' ').length;
    return { grid: columns('.evidence-form-grid'), q: columns('.q-grid'),
      viewport: document.documentElement.clientWidth };
  })()`);

  assert.strictEqual(narrow.viewport, 880, 'this arm only says anything under 900px');
  assert.strictEqual(narrow.grid, 1,
    'under 900px the approval field grid should be a single column, and is ' +
    narrow.grid + ' — the media block is not what is collapsing it');
  assert.strictEqual(narrow.q, 1, 'the evidence grid collapses at the same width');
});

/* Anchor: the `.approval-workflow-grid { align-items: start }` declaration.
   aria.css's .grid stretches its children to the tallest, so the one-field card
   was drawn as tall as the five-field one beside it with the difference left
   empty under its button. */

test('the short step of the approval handoff is not stretched to the tall one', async () => {
  await show(EVALS_DARK);
  const seen = await evaluate(`(() => {
    const grid = document.querySelector('.approval-workflow-grid');
    const heights = () => [...grid.children]
      .map((card) => Math.round(card.getBoundingClientRect().height));
    const on = heights();
    grid.classList.remove('approval-workflow-grid');
    grid.getBoundingClientRect();
    const off = heights();
    grid.classList.add('approval-workflow-grid');
    return { on, off };
  })()`);

  assert.strictEqual(seen.on.length, 2, 'the handoff grid should hold two cards');
  assert.ok(seen.on[0] < seen.on[1],
    `the one-field card is ${seen.on[0]}px and the five-field card ${seen.on[1]}px; ` +
    'equal heights mean the short one is being stretched');
  assert.strictEqual(seen.off[0], seen.off[1],
    'with the class taken off both cards should be stretched to the same height — ' +
    'they are not, so something other than this rule is setting the alignment');
  assert.ok(seen.off[0] - seen.on[0] > 100,
    `taking the rule away adds only ${seen.off[0] - seen.on[0]}px of void to the short card`);
});

/* Anchor: the two `.u-move` rules. The class marks the pills that are a
   movement, was queried by the pane and by ops-pane-evaluations.test.mjs, and
   carried no rule of its own anywhere.

   Both arms are read as resolved values rather than as widths, because a width
   claim about digits is a claim about the font the machine happened to fall
   back to: on this repository's own CI image the fallback face already sets
   digits to one advance, so `font-variant-numeric` changes nothing there and a
   width oracle for it is green for a reason that has nothing to do with the
   rule. What IS font-independent is that mono gives every character one
   advance, sign included — so the column's equal widths are asserted, and it
   is the resolved family and variant that bind them to the rules. */

const MONO = 'Geist Mono';

test('the column of score movements is set in the figure face, and lines up', async () => {
  await show(EVALS_DARK);
  const seen = await evaluate(`(() => {
    const pills = [...document.querySelectorAll('.u-list-end .u-move')];
    const figure = (pill) => pill.querySelector('span');
    const numeric = pills.filter(figure);
    const read = () => numeric.map((pill) => ({
      text: figure(pill).textContent,
      pill: Math.round(pill.getBoundingClientRect().width * 100) / 100,
      family: getComputedStyle(figure(pill)).fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      size: getComputedStyle(figure(pill)).fontSize,
      variant: getComputedStyle(pill).fontVariantNumeric
    }));
    const on = read();
    /* Taken off in place. The rules that paint this are a descendant selector
       and an inherited property, so a clone lifted out of its parent would lose
       both and measure something that is not on the page. */
    numeric.forEach((pill) => pill.classList.remove('u-move'));
    numeric[0].getBoundingClientRect();
    const off = read();
    numeric.forEach((pill) => pill.classList.add('u-move'));
    const words = pills.filter((pill) => !figure(pill))
      .map((pill) => ({ text: pill.textContent.trim(),
        family: getComputedStyle(pill).fontFamily.split(',')[0].replace(/["']/g, '').trim() }));
    return { on, off, words, count: document.querySelectorAll('.u-move').length };
  })()`);

  assert.ok(seen.count > 1, 'there should be a column of movements to line up');
  assert.ok(seen.on.length > 1,
    'the version history should hold more than one numeric movement, and holds ' +
    JSON.stringify(seen.on.map((m) => m.text)));
  assert.ok(seen.on.some((m) => m.text.startsWith('+')) && seen.on.some((m) => m.text.startsWith('-')),
    'the column should hold a rise and a fall, so the sign is part of what has to ' +
    'line up, and holds ' + JSON.stringify(seen.on.map((m) => m.text)));

  const widths = [...new Set(seen.on.map((m) => m.pill))];
  assert.strictEqual(widths.length, 1,
    'every movement in the column should be one width, and they are ' +
    JSON.stringify(seen.on.map((m) => m.text + ' ' + m.pill + 'px')));

  for (const movement of seen.on) {
    assert.strictEqual(movement.family, MONO,
      `${movement.text} is set in ${movement.family}, not the figure face`);
    assert.strictEqual(movement.size, '11px',
      `${movement.text} is ${movement.size}, not the 11px aria.css sets a figure in a pill`);
    assert.strictEqual(movement.variant, 'tabular-nums',
      `${movement.text}'s pill resolves font-variant-numeric to ${movement.variant}`);
  }
  for (const movement of seen.off) {
    assert.notStrictEqual(movement.family, MONO,
      `${movement.text} is still in the figure face with \`u-move\` taken off, so the ` +
      'rule under that selector is not what is setting it');
    assert.strictEqual(movement.variant, 'normal',
      `${movement.text}'s pill still resolves font-variant-numeric to ${movement.variant} ` +
      'with `u-move` taken off');
  }

  /* The other direction of the same rule: a pill holding a word rather than a
     figure is left in the text face, because `.u-move span` reaches the figure
     and not the pill. */
  assert.ok(seen.words.length,
    'the version history should hold at least one worded movement — "flat" or "first scored"');
  for (const word of seen.words) {
    assert.notStrictEqual(word.family, MONO,
      `"${word.text}" is a word, not a figure, and should not be set in the figure face`);
  }
});

/* Anchor: ops/assets/pane-evaluations.js — the shell.cardHead call in
   approvalCard, and the className on approvalGetSubmit. Both classes they
   replaced, `card-hint` and `btn-secondary`, were painted by no stylesheet this
   page loads; `btn-secondary` was never defined in ops.css either. */

test('a card on the approval handoff explains itself in a note, not in a second title', async () => {
  await show(EVALS_DARK);
  const seen = await evaluate(`(() => {
    const card = document.querySelector('.approval-card');
    const read = (sel) => {
      const el = card.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { size: parseFloat(s.fontSize), colour: s.color, text: el.textContent.slice(0, 24) };
    };
    return {
      title: read('.card-title'), note: read('.card-note'),
      hints: document.querySelectorAll('.card-hint').length,
      secondaries: document.querySelectorAll('.btn-secondary').length
    };
  })()`);

  assert.strictEqual(seen.hints, 0,
    'the pane still writes `card-hint`, which no stylesheet it loads defines — ' +
    'Stadiora/Aria#10647');
  assert.strictEqual(seen.secondaries, 0,
    'the pane still writes `btn-secondary`, which is defined in no stylesheet in ' +
    'this repository at all');
  assert.ok(seen.note, 'the card should carry a note under its title');
  assert.ok(seen.note.size < seen.title.size,
    `the note is set at ${seen.note.size}px and the title at ${seen.title.size}px; ` +
    'equal sizes are what the unpainted class produced');
  assert.notStrictEqual(seen.note.colour, seen.title.colour,
    'the note and the title are the same colour, which is what `card-hint` rendered as');
});

/* ============== Stadiora/Aria#10674 — the two answer slots ================ */

/* Three more classes of the same shape as #10647, on the same pane, missed by
   the rendered guard rather than found by it: the guard reports a class only
   where it lands on an element with a box, and both of these slots are empty —
   one of them `hidden` outright — until the band answers. A result slot that is
   hidden until there is a result is precisely where a pane's result styling
   lives, so the filter was blind exactly where the defect was.
 *
 * `form-alert` and `is-ok` land on <div id="approval-result">, written at
 * ops/assets/pane-evaluations.js:850; `evidence-result` on the quarantine
 * answer's container, written at :624. ops.css painted all three and
 * ops/evaluations.html does not load ops.css.
 *
 * Anchor for every mutation below: the named block in
 * ops/assets/pane-evaluations-v2.css, at its own site with its original gating.
 */

test('the answer slot reserves nothing until the band has answered', async () => {
  /* The single most important assertion in this file. `display: flex` on
     `.form-alert` is an author rule and `[hidden]` is a user-agent one, so
     painting this box at all un-hides the empty slot unless something puts the
     hiding back at author level. Painting it naively turns an invisible defect
     into a visible one: an empty bordered box under the approval cards, always.

     Both arms, on one laid-out page: the slot as the pane leaves it between
     answers, and the same element once it has an answer to show. */
  await show(EVALS_ANSWER_DARK);
  const seen = await evaluate(`(() => {
    const el = document.querySelector('#approval-result');
    const read = () => {
      el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return { display: s.display, height: Math.round(box.height), width: Math.round(box.width) };
    };
    const answered = read();
    el.hidden = true;
    const between = read();
    el.hidden = false;
    return { answered, between, restored: read() };
  })()`);

  assert.strictEqual(seen.between.display, 'none',
    'between answers the slot is displayed as `' + seen.between.display + '`, so the ' +
    'empty box is on screen — painting .form-alert without .form-alert[hidden] ' +
    'overrides the user-agent [hidden] rule');
  assert.strictEqual(seen.between.height, 0,
    `between answers the slot still takes ${seen.between.height}px of height`);

  assert.strictEqual(seen.answered.display, 'flex',
    'with an answer to show the slot is displayed as `' + seen.answered.display +
    '`, so the painting is not reaching it');
  assert.ok(seen.answered.height > 0,
    'with an answer to show the slot has no height, so the sentence is not in a box');
  assert.deepStrictEqual(seen.restored, seen.answered,
    'the reading did not survive its own toggle, so one of the two arms above is ' +
    'measuring a page in a state this test put it in and did not put back');
});

for (const theme of [EVALS_ANSWER_DARK, EVALS_ANSWER_LIGHT]) {
  test(`the answer is drawn as a returned answer and not as page copy, in the ${theme.theme} theme`,
    async () => {
      /* Anchor: the `.form-alert` block. Payload: the block deleted, which is
         what ops/evaluations.html shipped — the sentence laid out as an
         anonymous block in the stack, wearing the same face as the page's own
         copy. Each declaration is asserted on its own so that deleting one of
         them is not absorbed by the others. */
      await show(theme);
      const seen = await evaluate(`(() => {
        const el = document.querySelector('#approval-result');
        const read = () => {
          el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            display: s.display, gap: s.columnGap,
            padTop: s.paddingTop, padLeft: s.paddingLeft,
            radius: s.borderTopLeftRadius,
            size: s.fontSize, leading: s.lineHeight,
            fill: s.backgroundColor, image: s.backgroundImage, ring: s.boxShadow
          };
        };
        const on = read();
        el.classList.remove('form-alert');
        const off = read();
        el.classList.add('form-alert');
        return { on, off };
      })()`);

      /* The off arm is the shipped state, stated once: an unpainted div has no
         padding, no corner, no ring and no fill of its own. Every `on`
         assertion below is bound against it rather than against a literal
         copied out of the sheet. */
      assert.deepStrictEqual(
        { pad: seen.off.padTop, radius: seen.off.radius, ring: seen.off.ring, fill: seen.off.fill },
        { pad: '0px', radius: '0px', ring: 'none', fill: 'rgba(0, 0, 0, 0)' },
        'with `form-alert` removed the slot should fall back to a bare block, and does ' +
        'not — so something other than this rule is painting it and the arms below ' +
        'prove nothing');

      assert.notStrictEqual(seen.on.padTop, seen.off.padTop,
        'the answer sits flush against the page with no padding of its own');
      assert.notStrictEqual(seen.on.padLeft, seen.off.padLeft);
      assert.notStrictEqual(seen.on.radius, seen.off.radius,
        'the answer has square corners, so it is not drawn as a box');
      assert.notStrictEqual(seen.on.ring, seen.off.ring,
        'the answer carries no ring, so nothing separates it from the band behind it');
      assert.notStrictEqual(seen.on.fill, seen.off.fill,
        'the answer has no fill of its own, which is what Stadiora/Aria#10674 reported');
      assert.notStrictEqual(seen.on.size, seen.off.size,
        'the answer is set at the page copy size, so `font-size` is not reaching it');
      assert.strictEqual(seen.on.display, 'flex',
        'the answer is displayed as `' + seen.on.display + '`');
      assert.notStrictEqual(seen.on.gap, seen.off.gap,
        'the answer sets no column gap, so `gap` is not reaching it');

      /* `background` is a shorthand over two layers and the backing colour is
         only one of them, so the claim is made about what is painted: a
         gradient in the image layer would repaint this box while
         `backgroundColor` went on reporting the colour underneath it. */
      assert.strictEqual(seen.on.image, 'none',
        `the answer carries an image layer, ${seen.on.image}, which no rule here sets`);
    });
}

for (const theme of [EVALS_ANSWER_DARK, EVALS_ANSWER_LIGHT]) {
  test(`the answer's mark is a shape before it is a colour, in the ${theme.theme} theme`, async () => {
    /* Anchor: the `.form-alert.is-ok` block. Payload: `border-left` deleted
       from it, leaving the tint and the ring — which is the state this repair
       is not allowed to ship in, because `is-ok` would then be carried by hue
       alone. The assertion is on a LENGTH, so no colour can satisfy it.

       And the rail is measured against the fill it sits on for luminance, not
       for hue: a ratio at or above 3:1 is what a non-text mark needs under
       WCAG 2.2 AA, and relative luminance is the greyscale channel, so a rail
       that clears it is a rail a person sees with no colour vision at all. */
    await show(theme);
    const seen = await evaluate(`(() => {
      const el = document.querySelector('#approval-result');
      const read = () => {
        el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return { width: s.borderLeftWidth, style: s.borderLeftStyle, colour: s.borderLeftColor };
      };
      const on = read();
      el.classList.remove('is-ok');
      const off = read();
      el.classList.add('is-ok');
      const probe = document.createElement('span');
      probe.hidden = true;
      el.appendChild(probe);
      probe.style.backgroundColor = 'var(--emerald)';
      const emerald = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { on, off, emerald, fill: getComputedStyle(el).backgroundColor };
    })()`);

    assert.strictEqual(seen.off.width, '0px',
      'the slot carries a left border without `is-ok`, so the rail is not the ' +
      'modifier\'s and removing the state would leave the mark behind');
    assert.strictEqual(seen.on.width, '3px',
      `the completed-read rail measures ${seen.on.width}, not 3px — a mark that is ` +
      'only a tint is carried by colour alone');
    assert.strictEqual(seen.on.style, 'solid',
      `the rail is drawn \`${seen.on.style}\`, which at this width reads as an edge`);
    assert.strictEqual(seen.on.colour, seen.emerald,
      `the rail is ${seen.on.colour} where --emerald resolves to ${seen.emerald}`);

    const ratio = contrast(parseColour(seen.on.colour), parseColour(seen.fill));
    assert.ok(ratio >= 3,
      `the rail is ${ratio.toFixed(2)}:1 against the fill it sits on (${seen.fill}), ` +
      'under the 3:1 a non-text mark needs — at that ratio it disappears in greyscale ' +
      'and the state is carried by hue alone');
  });
}

for (const theme of [EVALS_ANSWER_DARK, EVALS_ANSWER_LIGHT]) {
  test(`the answer's tint is emerald over the pane's own surface, in the ${theme.theme} theme`,
    async () => {
      /* The other half of the split, and the half the shape test cannot reach:
         it binds the two `background` declarations — the base's neutral surface
         and the modifier's tint over it — against the tokens themselves,
         resolved by the browser off this document rather than copied out of the
         sheet. Without this, putting the base back to the amber a warning wears
         leaves every assertion above green.

         The composited reading rather than `backgroundColor`, for the layer
         reason above, taken on the element's own text so the stack behind the
         sentence is what is measured. */
      await show(theme);
      const seen = await evaluate(`(() => {
        const el = document.querySelector('#approval-result');
        const probe = document.createElement('span');
        probe.hidden = true;
        el.appendChild(probe);
        const token = (name) => {
          probe.style.backgroundColor = 'var(' + name + ')';
          return getComputedStyle(probe).backgroundColor;
        };
        const surface2 = token('--surface-2');
        const line2 = token('--line-2');
        const emerald = token('--emerald');
        probe.remove();
        const read = () => {
          el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return { fill: s.backgroundColor, ring: s.boxShadow };
        };
        const on = read();
        el.classList.remove('is-ok');
        const off = read();
        el.classList.add('is-ok');
        return { on, off, surface2, line2, emerald };
      })()`);

      assert.match(seen.surface2, /^rgba?\(/, 'the probe should resolve --surface-2 to a colour');
      assert.notStrictEqual(seen.surface2, seen.emerald, 'the two tokens should not be one colour');

      assert.strictEqual(seen.off.fill, seen.surface2,
        `without \`is-ok\` the slot should be filled with --surface-2 (${seen.surface2}) ` +
        `and is filled with ${seen.off.fill} — the base rule's own background`);
      assert.strictEqual(seen.off.ring, `${seen.line2} 0px 0px 0px 1px inset`,
        `without \`is-ok\` the slot should be ringed by the --line-2 hairline and is ` +
        `ringed by ${seen.off.ring}`);

      assert.notStrictEqual(seen.on.fill, seen.off.fill,
        'the state changes nothing about the fill, so the tint is not reaching it');
      assert.notStrictEqual(seen.on.ring, seen.off.ring,
        'the state changes nothing about the ring');

      /* Relational rather than a restatement of the recipe: the tint has to sit
         BETWEEN the neutral surface and the token it is mixed from, on the
         channel that token is strongest in. A tint mixed from some other hue,
         or no tint at all, fails this without the test ever naming a
         percentage. */
      const [tint, plain, pure] =
        [seen.on.fill, seen.off.fill, seen.emerald].map(parseColour);
      const green = (c) => c[1] - (c[0] + c[2]) / 2;
      assert.ok(green(tint) > green(plain),
        `the answer's fill (${show3(tint)}) is no greener than the plain surface ` +
        `(${show3(plain)}), so whatever is tinting it is not --emerald`);
      assert.ok(green(tint) < green(pure),
        `the answer's fill (${show3(tint)}) is at or past pure --emerald ` +
        `(${show3(pure)}), so it is a fill rather than a tint over the surface`);

      const painted = await backdrop('#approval-result');
      assert.strictEqual(show3(painted), show3(tint),
        `the colour actually painted behind the answer is ${show3(painted)} where the ` +
        `element reports ${show3(tint)} — a layer this test is not reading is painting it`);
    });
}

test('the re-authentication modal keeps its own alert, unrepainted by the pane', async () => {
  /* The leak arm. `.form-alert` is written by four places in this repository
     and only one of them is this pane: session.js puts one inside the
     re-authentication modal, which shell-pane-v2.css paints, and login.js and
     setup.js put one on pages that load ops.css instead. So the rule added here
     declares nothing that `.modal-card .form-alert` does not also declare, and
     that sheet is the more specific selector — which means the modal's alert
     has to come out unchanged. This asserts it does, against the same element
     placed outside a modal card in the same document. */
  await show(EVALS_ANSWER_DARK);
  const seen = await evaluate(`(() => {
    const read = (el) => {
      el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { padTop: s.paddingTop, padLeft: s.paddingLeft, colour: s.color, fill: s.backgroundColor };
    };
    const host = document.querySelector('.band') || document.body;

    const card = document.createElement('div');
    card.className = 'modal-card';
    const inModal = document.createElement('div');
    inModal.className = 'form-alert';
    inModal.textContent = 'Wrong password.';
    card.appendChild(inModal);
    host.appendChild(card);

    const loose = document.createElement('div');
    loose.className = 'form-alert';
    loose.textContent = 'Wrong password.';
    host.appendChild(loose);

    const probe = document.createElement('span');
    probe.hidden = true;
    host.appendChild(probe);
    probe.style.backgroundColor = 'var(--rose-ink)';
    const roseInk = getComputedStyle(probe).backgroundColor;

    const out = { inModal: read(inModal), loose: read(loose), roseInk };
    probe.remove();
    card.remove();
    loose.remove();
    return out;
  })()`);

  assert.strictEqual(seen.inModal.colour, seen.roseInk,
    `the modal's alert is set in ${seen.inModal.colour} where --rose-ink resolves to ` +
    `${seen.roseInk} — this pane's rule has taken over an element it does not own`);
  assert.notStrictEqual(seen.inModal.padTop, seen.loose.padTop,
    'the modal alert and a loose one are padded identically, so the more specific ' +
    'rule in shell-pane-v2.css is no longer winning');
  assert.notStrictEqual(seen.inModal.fill, seen.loose.fill,
    'the modal alert and a loose one are filled identically');
  assert.notStrictEqual(seen.loose.colour, seen.roseInk,
    'a loose alert is drawn in the modal ink, so the two rules are not separable ' +
    'and this test cannot tell a leak from a coincidence');
});

for (const theme of [EVALS_ANSWER_DARK, EVALS_ANSWER_LIGHT]) {
  test(`the quarantine answer takes the same measure as the form above it, in the ${theme.theme} theme`,
    async () => {
      /* Anchor: `.evidence-result` in the `max-width: 920px` group. Payload:
         the selector removed from that group, which is what shipped — the
         answer running the full width of the band while the form that produced
         it stops short, two measures in one column.

         Bound against the form's own laid-out width rather than against 920,
         so the assertion is "the answer is the width of its question" and not a
         literal copied out of the rule. */
      await show(theme);
      const seen = await evaluate(`(() => {
        const answer = document.querySelector('.evidence-result');
        const form = document.querySelector('.evidence-form');
        const read = () => {
          answer.getBoundingClientRect();
          return {
            answer: Math.round(answer.getBoundingClientRect().width),
            cap: getComputedStyle(answer).maxWidth
          };
        };
        const on = read();
        answer.classList.remove('evidence-result');
        const off = read();
        answer.classList.add('evidence-result');
        return { on, off, form: Math.round(form.getBoundingClientRect().width),
          band: Math.round(answer.parentElement.getBoundingClientRect().width) };
      })()`);

      assert.ok(seen.band > seen.form,
        `the band is ${seen.band}px and the form ${seen.form}px; with nothing to ` +
        'measure against, this test cannot tell a capped answer from an uncapped one');
      assert.strictEqual(seen.off.answer, seen.band,
        `with the class removed the answer should run the full ${seen.band}px of the ` +
        `band and runs ${seen.off.answer}px`);
      assert.strictEqual(seen.on.answer, seen.form,
        `the quarantine answer is ${seen.on.answer}px wide where the form that produced ` +
        `it is ${seen.form}px — ops.css capped both and this sheet arrived capping neither`);
      assert.notStrictEqual(seen.on.cap, seen.off.cap,
        'the answer resolves the same max-width with and without the class');
    });
}
