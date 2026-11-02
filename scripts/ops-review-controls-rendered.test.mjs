/* The Human review controls, measured where they are drawn.

   scripts/ops-pane-review-admin.test.mjs runs the pane in a node:vm harness
   with no layout engine, so it can read what the pane writes but never what a
   browser resolves from it. An earlier version of its CSS test searched the
   whole stylesheet for any `min-height: 44px` and scanned only that sheet for
   small fonts. Both stayed green while the Review button's own rule dropped
   from 44px to 20px (another rule still said 44px), and while the shared
   `.btn-sm` fell from 11.5px to 10px (the button takes its size from there,
   not from a rule in that sheet). The button measured 11.5px, under the 14px
   the design contract sets for body text, and nothing noticed.

   So this file asserts nothing about source text. It serves the real page and
   the stub API over HTTP, drives the pane to a queue and to an opened item,
   and reads the box and the computed font size of the controls themselves out
   of Chrome, the way a person meets them:

     - the Review action in each queue row (`.review-row .btn`);
     - the controls of the opened item: every field, every label, the rows of
       the item's detail and the submit action;
     - the Reload action a partly read queue offers.

   Every control is asserted at 390px and at 1536px against the two numbers in
   the contract, 44px of height and 14px of text. The count of what was
   measured is asserted as well, so a pane that draws nothing is a failure and
   not a pass.

   Real Chrome over CDP and the stub API, the way the other rendered oracles
   here work. The test needs a Chrome (CHROME_PATH), as they do, and has no
   skip path.

   NOT COVERED:

     - Width 320, 360 and 375. scripts/check-ops-narrow-overflow.mjs sweeps
       the page for overflow at those; the two widths here are a phone and a
       desktop, which is where the two layouts differ.
     - The light theme. Size and height do not change with the theme, so one
       theme is measured; colour is the contrast guards' to judge.
     - The adjudication form. It draws the same `.review-form` controls and is
       reached only by an item with two visible disputed labels, which the
       stub does not carry.
     - A control the pane does not draw. A new action that no state here
       reaches is unmeasured. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stub, REVIEW_QUEUE, REVIEW_ITEM } from './ops-api-stub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = '/ops/review.html';
const MIN_TARGET = 44;
const MIN_BODY_TEXT = 14;
const HEIGHT = 900;
const WIDTHS = [390, 1536];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/* What the queue route answers: the stub's own, or the same queue with one
   source it could not read. */
let queue = 'whole';

function answer(pathname, search) {
  if (queue === 'partial' && pathname.startsWith('/api/ops/seval/admin/reviews/queue')) {
    return { data: { items: REVIEW_QUEUE, partial: true, omissions: ['One review source did not answer.'] } };
  }
  return stub(pathname, search);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(answer(url.pathname, url.search)));
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
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH.');
}

async function devtoolsPort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    try {
      const p = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (p > 0) return p;
    } catch { /* browser has not written it yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtools(port, pathname) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
      if (res.ok) return await res.json();
    } catch { /* browser not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never opened its DevTools endpoint');
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const waiters = [];
  const seen = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
      return;
    }
    seen.add(m.method);
    for (const w of waiters.splice(0)) w(m.method);
  };
  return {
    ready: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    close: () => ws.close(),
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    once(method, timeoutMs = 30000) {
      if (seen.has(method)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for ' + method)), timeoutMs);
        const check = (m) => {
          if (m === method) { clearTimeout(timer); resolve(); }
          else waiters.push(check);
        };
        waiters.push(check);
      });
    },
    reset() { seen.delete('Page.loadEventFired'); }
  };
}

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-review-controls-'));

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
], { stdio: 'ignore' });

const cdpPort = await devtoolsPort(profile);
const targets = await devtools(cdpPort, '/json/list');
const target = targets.find((t) => t.type === 'page');
const cdp = connect(target.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { cdp.close(); } catch { /* already gone */ }
  try { browser.kill(); } catch { /* already gone */ }
  try { server.close(); } catch { /* already gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}
after(cleanup);
process.on('exit', cleanup);

async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error('page threw: ' + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
  }
  return JSON.parse(res.result.value);
}

/* A readiness poll needs its own path: a probe that reaches through a null
   while the document is still being replaced is a wait, not a failure. */
async function waitInPage(expression, what) {
  const guarded = `JSON.stringify({ ok: (() => { try { return !!(${expression}); } catch (e) { return false; } })() })`;
  for (let i = 0; i < 300; i++) {
    if ((await evaluate(guarded)).ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for ' + what);
}

let initScript = null;
async function open(width) {
  if (initScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try { localStorage.setItem('ops-theme', 'dark'); } catch (e) {}" +
      `try { localStorage.setItem('ops-api-base', ${JSON.stringify(origin)});` +
      " sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' })); } catch (e) {}"
  });
  initScript = res.identifier;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT, deviceScaleFactor: 1, mobile: width < 700 });
  await cdp.send('Page.navigate', { url: 'about:blank' });
  cdp.reset();
  await cdp.send('Page.navigate', { url: origin + PAGE });
  await cdp.once('Page.loadEventFired');
  await waitInPage("document.body.classList.contains('is-ready')", `${PAGE} to boot at ${width}px`);
  await waitInPage("document.querySelector('.review-row')", 'the review queue to draw');
}

/* The box and the resolved text size of every element a selector names, where
   it is drawn. `centre` is whether the element is what a thumb reaches at its
   own middle, once it is scrolled to the middle of the screen. */
const MEASURE = (selector) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  return JSON.stringify({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    items: els.map((el) => {
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        at: el.tagName.toLowerCase() + '.' + String(el.getAttribute('class') || ''),
        text: (el.textContent || '').trim().slice(0, 40),
        h: r.height, w: r.width, size: parseFloat(cs.fontSize),
        shown: cs.display !== 'none' && r.width > 0 && r.height > 0,
        centre: !!hit && (hit === el || el.contains(hit))
      };
    })
  });
})()`;

async function measure(selector, expected) {
  const read = await evaluate(MEASURE(selector));
  assert.equal(read.items.length, expected, `${selector} matched ${read.items.length} elements, not the ${expected} this state draws`);
  for (const item of read.items) assert.ok(item.shown, `${item.at} "${item.text}" is not drawn`);
  return read;
}

/* Every run of text under a selector, with the size it is drawn at. This is the
   sweep that does not depend on knowing the pane's class names: a new line of
   small text anywhere in the queue or the opened item is found. */
async function smallText(selector) {
  const read = await evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    if (!root) return JSON.stringify({ runs: -1, small: [] });
    let runs = 0;
    const small = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (!text) continue;
      const el = node.parentElement;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      runs += 1;
      const size = parseFloat(cs.fontSize);
      if (size < ${MIN_BODY_TEXT}) small.push(el.tagName.toLowerCase() + '.' + el.className + ' ' + size + 'px "' + text.slice(0, 30) + '"');
    }
    return JSON.stringify({ runs, small });
  })()`);
  return read;
}

function needTarget(read, what) {
  for (const item of read.items) {
    assert.ok(item.h >= MIN_TARGET - 0.01,
      `${what} "${item.text}" measures ${item.h}px tall, under the ${MIN_TARGET}px tap target`);
  }
}

function needText(read, what) {
  for (const item of read.items) {
    assert.ok(item.size >= MIN_BODY_TEXT,
      `${what} "${item.text}" computes to ${item.size}px, under the ${MIN_BODY_TEXT}px minimum body text`);
  }
}

for (const width of WIDTHS) {
  test(`every Review action in the queue is a 44px target with 14px text, at ${width}px`, async () => {
    queue = 'whole';
    await open(width);
    const actions = await measure('.review-row .btn', REVIEW_QUEUE.length);
    assert.equal(actions.viewport, width, `asked for ${width}px and the document reports ${actions.viewport}px`);
    needTarget(actions, 'the Review action');
    needText(actions, 'the Review action');
    for (const item of actions.items) {
      assert.ok(item.centre, `the middle of "${item.text}" is covered by something that is not the action`);
    }
    needText(await measure('.review-row-name', REVIEW_QUEUE.length), 'a row\'s statement');
    needText(await measure('.review-row-meta', REVIEW_QUEUE.length), 'a row\'s detail line');
    const sweep = await smallText('.review-list');
    assert.ok(sweep.runs >= REVIEW_QUEUE.length * 2, `the queue sweep read ${sweep.runs} runs of text, too few to be the queue`);
    assert.deepEqual(sweep.small, [], `text under ${MIN_BODY_TEXT}px in the queue: ${sweep.small.join('; ')}`);
    assert.ok(actions.scrollWidth <= width, `the page scrolls sideways: ${actions.scrollWidth}px in ${width}px`);
  });

  test(`the opened item's fields, labels, details and submit are 44px targets with 14px text, at ${width}px`, async () => {
    queue = 'whole';
    await open(width);
    await evaluate("(() => { document.querySelector('.review-row .btn').click(); return '1'; })()");
    await waitInPage("document.querySelector('.review-detail .review-form')", 'the opened item to draw');
    await new Promise((r) => setTimeout(r, 250));

    const fields = await measure('.review-detail .review-input', 4);
    needTarget(fields, 'a field');
    needText(fields, 'a field');
    needText(await measure('.review-detail .review-field label', 4), 'a field label');

    const submit = await measure('.review-detail .review-form button[type="submit"]', 1);
    needTarget(submit, 'the submit action');
    needText(submit, 'the submit action');
    assert.ok(submit.items[0].centre, 'the middle of the submit action is covered by something that is not the action');

    const labels = await measure('.review-detail .review-meta dt', 8);
    const values = await measure('.review-detail .review-meta dd', 8);
    needText(labels, 'a detail label');
    needText(values, 'a detail value');

    /* The exact versions being rated are in the detail, in full. */
    const digests = await evaluate(`JSON.stringify([...document.querySelectorAll('.review-detail .review-digest')]
      .map((el) => el.textContent.trim()))`);
    assert.deepEqual(digests, [REVIEW_ITEM.outcomeDigest, REVIEW_ITEM.criterionDigest],
      'the opened detail does not carry the full outcome and criterion digests');
    const sweep = await smallText('.review-detail');
    assert.ok(sweep.runs >= 20, `the detail sweep read ${sweep.runs} runs of text, too few to be the opened item`);
    assert.deepEqual(sweep.small, [], `text under ${MIN_BODY_TEXT}px in the opened item: ${sweep.small.join('; ')}`);
    assert.ok(fields.scrollWidth <= width, `the page scrolls sideways: ${fields.scrollWidth}px in ${width}px`);
  });

  test(`the Reload action a partly read queue offers is a 44px target with 14px text, at ${width}px`, async () => {
    queue = 'partial';
    try {
      await open(width);
      await waitInPage("document.querySelector('.review-layout > .review-actions .btn')", 'the Reload action to draw');
      const reload = await measure('.review-layout > .review-actions .btn', 1);
      needTarget(reload, 'the Reload action');
      needText(reload, 'the Reload action');
      assert.ok(reload.items[0].centre, 'the middle of the Reload action is covered by something that is not the action');
    } finally {
      queue = 'whole';
    }
  });
}
