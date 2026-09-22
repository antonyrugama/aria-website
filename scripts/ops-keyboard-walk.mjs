/* Keyboard-operator walkthrough of the ops dashboard.
 *
 * WHY THIS EXISTS. Forty screenshots exist of what this dashboard looks like.
 * Until this file ran, there was no record of what it is like to USE without
 * a mouse. Stadiora/Aria#10822 — sideways-scrolling tables carrying
 * `tabIndex -1`, so a keyboard operator cannot reach the clipped columns —
 * was found by accident while someone was looking at something else. This
 * finds the rest on purpose.
 *
 * WHAT IT IS NOT. Not a test, deliberately: it is named `.mjs` rather than
 * `.test.mjs` so `ops-pane-tests.yml` does not run it. It reports what is
 * there, including defects this author is not allowed to fix, and a guard
 * that reds CI over someone else's open file is a guard that gets disabled.
 * The findings it produces are filed as issues; the numbers below are the
 * evidence for them.
 *
 * WHAT IT MEASURES. Real `Tab` and `Shift+Tab` key events through CDP's
 * Input domain, on the real pages served over HTTP, booted with the same API
 * stub the test suite uses. Not `element.focus()`, not a synthesised
 * KeyboardEvent — those bypass the browser's own sequential navigation, which
 * is the thing under examination.
 *
 *   1. TAB ORDER vs READING ORDER. Every stop is compared to the previous one
 *      by DOM document order. A backwards jump is a stop the operator reaches
 *      before something that reads earlier.
 *   2. REACHABILITY. Every visible interactive element is enumerated from the
 *      DOM and diffed against the set the walk actually reached.
 *   3. TRAPS. A stop that does not move under Tab, and a walk that never
 *      returns to its first stop within three times the candidate count.
 *   4. SCROLLERS. Elements that scroll sideways or vertically and are not
 *      focusable: their clipped content cannot be reached by keyboard at all.
 *   5. THE SKIP LINK. Where the first Tab lands, what Enter on it does, and
 *      whether what it lands on exists and can hold focus.
 *   6. FOCUS ACROSS A RE-RENDER. The theme toggle is on every pane and
 *      repaints it. Focus is recorded before and after.
 *   7. DOUBLE ANNOUNCEMENT. An element whose `aria-label` disagrees with its
 *      own visible text is read out as the label, and the text the operator
 *      can see is not what they hear.
 *
 * HOW TO RUN.
 *   node scripts/ops-keyboard-walk.mjs [--out ops/keyboard-audit.md]
 * Needs Chrome. Set CHROME_PATH if it is not in a usual place.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stub } from './ops-api-stub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i === -1 ? path.join(ROOT, 'ops', 'keyboard-audit.md') : path.resolve(process.argv[i + 1]);
})();

/* The ten panes, named as the registry names them. shell-v2.html is the rail
   demo and login/setup are not panes, so none of the three is walked here. */
const PANES = [
  { pane: 'overview', url: '/ops/index.html', title: 'Overview' },
  { pane: 'jobs', url: '/ops/jobs-live.html', title: 'Jobs live' },
  { pane: 'history', url: '/ops/run-history.html', title: 'Run history' },
  { pane: 'alerts', url: '/ops/alerts.html', title: 'Alerts' },
  { pane: 'analytics', url: '/ops/analytics.html', title: 'Analytics' },
  { pane: 'spend', url: '/ops/spend.html', title: 'Cloud costs' },
  { pane: 'evals', url: '/ops/evaluations.html', title: 'Evaluations' },
  { pane: 'releases', url: '/ops/releases.html', title: 'Releases' },
  { pane: 'users', url: '/ops/users.html', title: 'Look up a user' },
  { pane: 'settings', url: '/ops/settings.html', title: 'Settings' }
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: '375px', width: 375, height: 812, mobile: true }
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(stub(url.pathname)));
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
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtools(port, pathname) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
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

const tempRoot = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-kbd-walk-'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--hide-scrollbars', '--force-device-scale-factor=1', '--no-sandbox', 'about:blank'
], { stdio: 'ignore' });

const port = await devtoolsPort(profile);
const targets = await devtools(port, '/json/list');
const page = targets.find((t) => t.type === 'page');
const cdp = connect(page.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('DOM.enable');

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { cdp.close(); } catch { /* gone */ }
  try { browser.kill(); } catch { /* gone */ }
  try { server.close(); } catch { /* gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(1); });

async function evalJson(expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (res.exceptionDetails) {
    throw new Error('page threw: ' + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
  }
  return JSON.parse(res.result.value);
}

let initScript = null;
async function load(url, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height,
    deviceScaleFactor: 1, mobile: viewport.mobile
  });
  if (initScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try {' +
      `localStorage.setItem('ops-api-base', ${JSON.stringify(base)});` +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      "localStorage.setItem('ops-theme', 'dark');" +
      '} catch (e) {}'
  });
  initScript = res.identifier;
  cdp.reset();
  await cdp.send('Page.navigate', { url: base + url });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, 600));
}

/* Real key events. `Input.dispatchKeyEvent` goes through the browser's own
   input pipeline, so sequential focus navigation is decided by Chrome rather
   than by this file's idea of what should be focusable next. That is the
   whole point: a walk driven by `element.focus()` would only ever confirm the
   list it was given. */
/* NO `char` EVENT FOR TAB. The first version of this file sent
   rawKeyDown + char('\t') + keyUp, which is how you TYPE a tab character.
   Inside a text field Chrome inserted it and focus never moved, so the walk
   stalled on the first input it met: the Evaluations pane reported a focus
   trap and 27 unreachable controls that were an artefact of the keyboard
   this file was pretending to be. Only Enter carries text here, because
   activating a control is what it is for. */
async function key(name, modifiers = 0) {
  const spec = {
    Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' },
    Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
    Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' }
  }[name];
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, ...spec });
  if (spec.text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', modifiers, ...spec });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...spec });
  await new Promise((r) => setTimeout(r, 25));
}

async function shiftTab() { await key('Tab', 8); }

/* Everything the page state is read through, defined once in the page so the
   walk and the enumeration agree about what "interactive" and "visible"
   mean. Disagreeing definitions would produce a reachability diff that is an
   artefact of this file rather than a fact about the pane. */
const PAGE_HELPERS = `
(() => {
  if (window.__kbd) return;
  /* A CONTROL is a thing you operate. INTERACTIVE additionally admits the
     ARIA roles that make a div behave like one; the two are not the same
     population and the label rule needs the narrower one. */
  const CONTROLS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary';
  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
    '[contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], ' +
    '[role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"]';

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    if (Number(s.opacity) === 0) return false;
    for (let n = el; n; n = n.parentElement) {
      if (n.hasAttribute && n.hasAttribute('inert')) return false;
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  }

  function label(el) {
    if (!el) return '';
    const al = el.getAttribute && el.getAttribute('aria-label');
    if (al) return al.trim();
    const by = el.getAttribute && el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\\s+/).map((id) => document.getElementById(id))
        .filter(Boolean).map((n) => (n.textContent || '').trim()).join(' ');
      if (t) return t;
    }
    return (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  }

  function pathOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 5; n = n.parentElement) {
      let p = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(p + '#' + n.id); break; }
      const cls = (n.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      parts.unshift(p);
    }
    return parts.join(' > ');
  }

  /* IDENTITY IS AN ATTRIBUTE, NOT A POSITION. The first version of this file
     keyed each stop by its CSS path plus its bounding-rect origin, and every
     number it produced was wrong: tabbing scrolls the page, so the SAME
     element answers to a different key on the way round than it did when it
     was enumerated. It inflated the stop count (the cycle was never
     detected), and it reported one unreachable control on nine panes out of
     ten — the control was reached, at a different scroll offset. A stamped
     attribute cannot move. */
  let nextId = 0;
  function idOf(el) {
    if (!el.hasAttribute('data-kbdid')) el.setAttribute('data-kbdid', 'k' + (++nextId));
    return el.getAttribute('data-kbdid');
  }
  function tagAll() { for (const el of document.querySelectorAll('*')) idOf(el); return nextId; }

  function describe(el) {
    if (!el || el === document.body || el === document.documentElement) {
      return { tag: el ? el.tagName.toLowerCase() : 'null', path: el ? el.tagName.toLowerCase() : 'null',
               label: '', tabindex: null, role: null, interactive: false, visible: false, key: 'DOCUMENT' };
    }
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      path: pathOf(el),
      label: label(el),
      tabindex: el.getAttribute('tabindex'),
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      href: el.getAttribute('href'),
      interactive: el.matches(INTERACTIVE),
      visible: visible(el),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      scrolls: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      key: idOf(el)
    };
  }

  window.__kbd = {
    INTERACTIVE, visible, describe, tagAll, idOf,
    active: () => describe(document.activeElement),
    /* Document order rank for every element, keyed by the stamped id, so two
       stops can be compared by reading order without re-querying. */
    ranks: () => {
      const out = {};
      const all = document.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) out[idOf(all[i])] = i;
      return out;
    },
    /* A DISABLED CONTROL IS NOT A REACHABILITY DEFECT. The browser is right
       to skip it, and counting it as unreachable blames the page for
       obeying the spec. Disabled is inherited: a disabled <fieldset>
       disables every control inside it, which is exactly how the three
       production-authority fields on Evaluations are turned off. */
    disabled: (el) => {
      for (let n = el; n; n = n.parentElement) {
        if (n.disabled === true) return true;
      }
      return false;
    },
    candidates: () => Array.from(document.querySelectorAll(INTERACTIVE))
      .filter((el) => visible(el) && !window.__kbd.disabled(el)).map(describe),
    disabledButVisible: () => Array.from(document.querySelectorAll(INTERACTIVE))
      .filter((el) => visible(el) && window.__kbd.disabled(el)).map(describe),

    /* AN ELEMENT THE CODE BELIEVES IS HIDDEN AND THE STYLESHEET KEEPS ON
       SCREEN. A 'hidden' attribute is a UA 'display: none' rule and the
       weakest one in the cascade, so any author display on that element
       defeats it silently. The element then reads as present to a sighted
       operator and is usually disabled or empty underneath. */
    hiddenButPainted: () => Array.from(document.querySelectorAll('[hidden]'))
      .filter((el) => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && el.getBoundingClientRect().height > 0;
      })
      .map((el) => ({ ...describe(el), display: getComputedStyle(el).display,
        controls: el.querySelectorAll(INTERACTIVE).length,
        /* Whether the controls inside are disabled is a CLAIM about them,
           so it is counted rather than asserted. The document used to say
           "the controls inside are disabled" beside a derived control
           count: add one enabled field and the sentence goes false while
           the number beside it stays true. */
        controlsDisabled: Array.from(el.querySelectorAll(INTERACTIVE))
          .filter((c) => window.__kbd.disabled(c)).length,
        selfDisabled: window.__kbd.disabled(el) })),
    scrollers: () => Array.from(document.querySelectorAll('*')).filter((el) => {
      if (!visible(el)) return false;
      const s = getComputedStyle(el);
      const ox = s.overflowX, oy = s.overflowY;
      const canX = (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1;
      const canY = (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      return canX || canY;
    }).map((el) => ({ ...describe(el),
      overflowX: el.scrollWidth - el.clientWidth, overflowY: el.scrollHeight - el.clientHeight,
      ariaLabel: el.getAttribute('aria-label'), ariaLabelledby: el.getAttribute('aria-labelledby'),
      /* THE BROWSER ALREADY RESOLVED THIS. el.tabIndex is the parsed
         value; the attribute is a string that may not be a number at all.
         Both are recorded, and everything downstream reads the resolved
         one -- see the filter below. (No backticks in this comment: the
         whole block is a template literal.) */
      focusable: el.tabIndex >= 0, tabIndexProp: el.tabIndex })),
    /* An element whose aria-label disagrees with its own visible text: the
       operator hears one thing and sees another. */
    /* WCAG 2.5.3 Label in Name is CONTAINMENT, not equality. An accessible
       name may say MORE than the visible text -- "Revoke access for
       owner@ops.invalid" over a button reading "Revoke" is CORRECT, because
       a speech-input user saying "Revoke" still matches it. The defect is
       the visible text being ABSENT from the name, because then the words on
       screen are not the words that work.

       THE FIRST VERSION OF THIS TESTED EQUALITY OVER textContent AND WAS
       WRONG TWICE OVER. It reported 30 findings across 20 walks and every
       one was the instrument: equality condemned the three correct "Revoke"
       buttons, and textContent charged a labelled region with its own
       CONTENTS as its visible label -- nav#rail "Panes" was accused of
       being mislabelled against the entire rail, and an aria-label on an
       <svg> chart against its axis tick numbers. A region's text is what is
       inside it; only a CONTROL has a visible label, and only its own text
       nodes are that label. */
    /* WHAT THE 2.5.3 SWEEP READS IS THE ATTRIBUTE, NOT THE NAME. The
       accessible name is computed, and 'aria-labelledby' OUTRANKS
       'aria-label' in that computation -- Chrome's AX tree reports the
       'aria-label' as 'superseded'. So a control whose visible text is in
       its 'aria-label' and NOT in the heading 'aria-labelledby' points at is
       a real Label-in-Name failure this sweep prints as clean. Rather than
       grow a name-computation engine inside a traversal tool, the claim is
       narrowed to the attribute and the unmeasured population is COUNTED
       here, from the rendered DOM, so NOT COVERED can say how big it is
       instead of calling it "some". */
    /* THE WIDE SELECTOR, BECAUSE THIS IS A DISCLOSURE OF WHAT IS NOT
       MEASURED. CONTROLS is the narrow native-element list; INTERACTIVE
       also takes role=button, role=link, role=tab and friends. A count of
       an unmeasured population that is itself narrower than the sentence
       describing it understates the hole -- the one direction a disclosure
       must never err in. */
    labelledbyControls: () => Array.from(document.querySelectorAll('[aria-labelledby]'))
      .filter((el) => visible(el) && el.matches(INTERACTIVE))
      .map((el) => ({ ...describe(el),
        alsoAriaLabel: el.hasAttribute('aria-label') })),
    mismatchedLabels: () => Array.from(document.querySelectorAll('[aria-label]'))
      .filter((el) => visible(el) && el.matches(CONTROLS))
      .map((el) => ({ ...describe(el),
        ariaLabel: el.getAttribute('aria-label').trim(),
        text: Array.from(el.childNodes).filter((n) => n.nodeType === 3)
          .map((n) => n.textContent).join(' ').replace(/\\s+/g, ' ').trim() }))
      .filter((d) => d.text && !d.ariaLabel.toLowerCase().includes(d.text.toLowerCase())),
    duplicateIds: () => {
      const seen = new Map();
      for (const el of document.querySelectorAll('[id]')) {
        seen.set(el.id, (seen.get(el.id) || 0) + 1);
      }
      return [...seen].filter(([, n]) => n > 1).map(([id, n]) => ({ id, n }));
    }
  };
})(); 'null'`;

async function helpers() {
  await evalJson(PAGE_HELPERS);
  await evalJson("JSON.stringify(window.__kbd.tagAll())");
}

async function active() {
  await helpers();
  return evalJson('JSON.stringify(window.__kbd.active())');
}

/* A FRESH LOAD, not a blur. Blurring moves the active element to <body> but
   leaves Chrome's sequential-navigation STARTING POINT where the last
   experiment left it, so the next Tab resumes mid-page and the walk silently
   begins somewhere other than the top. Reloading is the only reset this file
   trusts, and it is cheap enough at twenty pages. */
async function resetFocus(url, viewport) {
  await load(url, viewport);
  await helpers();
}

/* A CONTROL THAT DOES NOT MOVE ON THE FIRST TAB IS NOT A TRAP. Chrome walks
   the internal fields of a composite input — `datetime-local` has six, one
   per date and time part — before focus leaves the control, so
   `document.activeElement` is unchanged for several presses by design. The
   first version of this file called three unchanged presses a trap, and
   reported a focus trap and 27 unreachable controls on Evaluations that were
   both the expiry field being read correctly by the browser and incorrectly
   by this file. The presses each control consumes are counted and reported
   instead; a trap is declared only past TRAP_PRESSES.

   THE THRESHOLD IS COMPUTED, NOT TYPED. "12, which is twice the widest
   composite Chrome ships" is two facts glued together by a comment, and a
   comment is exactly where the two come apart: Stadiora/Aria#10365 was a
   literal that had drifted from the sentence beside it. Writing the widest
   composite once and multiplying it means the sentence cannot be wrong about
   the number, because it does not contain one. */
const COMPOSITE_MAX = 6;
const TRAP_PRESSES = COMPOSITE_MAX * 2;

/* ONE STOP IS "PRESS UNTIL THE ELEMENT CHANGES", IN BOTH DIRECTIONS. A
   composite input consumes several presses without moving
   `document.activeElement` -- that is `walk()`'s `pressesConsumed` -- so a
   leg that presses once per stop arrives somewhere else entirely. The
   retrace forward leg pressed Tab `core.length` times and landed THIRTEEN
   stops short on evals/desktop, because the pane's composites had eaten the
   difference. Both legs step through this now, so a mismatch means the ORDER
   disagreed rather than the press accounting. Returns the elements landed
   on, and the presses it took to land on them. */
/* WHY A SCROLLER IS NOT IN THE TAB ORDER, READ OFF THE RESOLVED VALUE AND
   THE RAW ATTRIBUTE TOGETHER. There are three distinct answers and the
   document prints the one that applies rather than the one that is usually
   right: no attribute at all, a valid negative index, or a string that is
   not an integer and which the browser therefore resolved to -1. The third
   is the spelling that used to fall out of both tallies. */
function whyUndeclared(s) {
  if (s.tabindex === null) return 'no `tabindex` attribute';
  const n = Number(s.tabindex);
  if (Number.isInteger(n)) return `\`tabindex="${s.tabindex}"\`, which is out of the tab order`;
  return `\`tabindex="${s.tabindex}"\`, which is not a valid integer, so the browser resolves it ` +
    `to ${s.tabIndexProp}`;
}

async function stepStops(n, press) {
  const landed = [];
  let presses = 0;
  let from = (await active()).key;
  for (let i = 0; i < n; i++) {
    let to = from;
    for (let held = 0; held < TRAP_PRESSES && to === from; held++) {
      await press();
      presses++;
      to = (await active()).key;
    }
    landed.push(to);
    if (to === from) break;
    from = to;
  }
  return { landed, presses };
}

async function walk(limit) {
  const stops = [];
  let consumed = 1;
  for (let i = 0; i < limit; i++) {
    await key('Tab');
    const a = await active();
    const prev = stops[stops.length - 1];
    if (prev && prev.key === a.key) {
      consumed++;
      prev.pressesConsumed = consumed;
      if (consumed > TRAP_PRESSES) { prev.trappedAfter = consumed; break; }
      continue;
    }
    consumed = 1;
    stops.push({ ...a, pressesConsumed: 1 });
    if (a.key === 'DOCUMENT' && stops.length > 1) break;
    if (stops.length > 2 && a.key === stops[0].key) break;
  }
  return stops;
}

const results = [];

/* Scoping exists for the mutation battery, which runs this tool once per
   payload and cannot afford twenty walks a time. It narrows WHICH walks run
   and changes nothing about how one runs. */
const ONLY = process.env.KBD_ONLY ? process.env.KBD_ONLY.split(',') : null;
const ONLY_VP = process.env.KBD_VIEWPORT ? process.env.KBD_VIEWPORT.split(',') : null;
/* Scoping the DIALOG probe narrows the sweep in exactly the way the other two
   flags do, so it belongs in the same predicate: `fullSweep` decides whether
   a missing finding means "fixed" or "not looked at", and skipping both
   dialogs is not looking. */
const SKIP_DIALOGS = Boolean(process.env.KBD_SKIP_DIALOGS);

for (const p of PANES) {
  if (ONLY && !ONLY.includes(p.pane)) continue;
  for (const v of VIEWPORTS) {
    if (ONLY_VP && !ONLY_VP.includes(v.name)) continue;
    await load(p.url, v);
    await helpers();

    const title = await evalJson('JSON.stringify(document.title)');
    const candidates = await evalJson('JSON.stringify(window.__kbd.candidates())');
    const scrollers = await evalJson('JSON.stringify(window.__kbd.scrollers())');
    const mismatched = await evalJson('JSON.stringify(window.__kbd.mismatchedLabels())');
    const labelledby = await evalJson('JSON.stringify(window.__kbd.labelledbyControls())');
    const dupIds = await evalJson('JSON.stringify(window.__kbd.duplicateIds())');
    /* WHICH FILES THIS PAGE ACTUALLY LOADED. A mutation battery can prove a
       payload landed in a file by byte comparison and still be measuring
       nothing, because the file is not one the page under test loads. Five
       payloads went into ops/assets/operate.js before this line existed;
       every one applied cleanly, and settings.html has never loaded it --
       ops/assets/settings.js carries its own confirmAction. A byte
       comparison answers "did the edit land", not "is the edited code
       running", and those are different questions. */
    const loaded = await evalJson(`JSON.stringify(performance.getEntriesByType('resource')
      .map((e) => e.name.replace(location.origin, '')).filter((n) => /\\.(js|css)$/.test(n)))`);
    const disabledVisible = await evalJson('JSON.stringify(window.__kbd.disabledButVisible())');
    const hiddenPainted = await evalJson('JSON.stringify(window.__kbd.hiddenButPainted())');

    await resetFocus(p.url, v);
    const limit = Math.max(24, candidates.length * 3);
    const stops = await walk(limit);

    /* Reading order: every stop's position in the document, so a backwards
       step can be named. Read AFTER the walk, from the same live DOM. */
    const ranks = await evalJson('JSON.stringify(window.__kbd.ranks())');
    const rankOf = new Map(Object.entries(ranks));

    /* The wrap-around is not a backwards step: the last Tab of a complete
       cycle returns to the first stop by design, and counting it would put a
       backwards step on every pane that works correctly. Only the stops
       before the cycle closes are compared. */
    const body = stops[stops.length - 1] && stops[stops.length - 1].key === 'DOCUMENT'
      ? stops.slice(0, -1) : stops;
    const ordered = body.length > 1 && body[body.length - 1].key === body[0].key
      ? body.slice(0, -1) : body;
    const backwards = [];
    let lastRank = -1;
    let lastStop = null;
    for (const st of ordered) {
      const r = rankOf.get(st.key);
      if (r === undefined) continue;
      if (r < lastRank) backwards.push({
        path: st.path, stop: st, rank: r, afterRank: lastRank, afterPath: lastStop && lastStop.path
      });
      lastRank = Math.max(lastRank, r);
      lastStop = st;
    }

    const reached = new Set(stops.map((s) => s.key));
    const unreachable = candidates.filter((c) => !reached.has(c.key));
    const unexpected = stops.filter((s) => s.key !== 'DOCUMENT' && !s.interactive);

    /* Reverse walk: Shift+Tab should retrace the forward order. A sequence
       that is not its own reverse is a stop the operator cannot get back to
       the way they came.

       THE COUNTS ARE NOT SYMMETRIC AND THE FIRST VERSION OF THIS GOT IT
       WRONG. After n Tabs focus sits ON stop n-1, so the FIRST Shift+Tab
       already yields stop n-2: n reverse presses walk one step past the top
       and off the document, and comparing n presses against stops[0..n-1]
       reports a mismatch on a page whose reverse order is perfect. It said
       REV-MISMATCH on 16 of 20 walks. n-1 presses retrace stops[n-2..0]. */
    /* AND THE FORWARD COUNT MUST EXCLUDE THE TERMINAL SENTINEL. The walk's
       last entry is not a stop the operator is standing on: it is either
       DOCUMENT (focus left the page) or a repeat of stop 0 (it wrapped).
       Tabbing that many times puts focus one press PAST the last control,
       so the reverse walk starts outside the document, the first Shift+Tab
       is consumed getting back in, and every subsequent key is off by one.
       That is the whole of the remaining REV-MISMATCH: seven walks, all at
       375px, all reported as "got [DOCUMENT, ...expected shifted]".

       BOTH branches are load-bearing and WHICH ONE FIRES IS TIMING-DEPENDENT.
       The same pane at the same viewport ended `wrapped` in four measured runs
       and `left-document` in two, so neither shape can be assumed. When the
       walk ends by wrapping, the off-by-one happens to CANCEL -- the extra Tab
       lands on stop 0 and the first Shift+Tab wraps back to the last control
       -- so dropping this filter is invisible in `reverseMatches` on a wrapping
       walk and visible on a leaving one. The deterministic observable of the
       exclusion is the press count (`reverseGot.length`), which read 3 in six
       unmutated runs across both shapes and 4 with the filter removed. Battery
       rows M9 (press count, kills) and M9b (reverseMatches, survives). */
    const core = stops.filter((s, i) => !(i === stops.length - 1 &&
      (s.key === 'DOCUMENT' || (stops.length > 2 && s.key === stops[0].key))));
    /* THE WHOLE WALK, NOT A PREFIX OF IT. This was `Math.min(core.length, 12)`
       and the document still said "Shift+Tab is the exact inverse of Tab".
       Eight of twenty walks hit that cap. On evals/desktop -- 46 stops, the
       biggest pane here -- the 11 presses covered the skip link, the ten rail
       items and the theme toggle: identical markup on all ten panes, and not
       one control of the pane's own content. A reverse-order defect injected
       at stop 11 was caught and the SAME defect at stop 12 was not. A prefix
       check is a fine thing to run and a false thing to call an exact
       inverse. */
    const fwd = core.length;
    await resetFocus(p.url, v);
    const fwdLeg = await stepStops(fwd, () => key('Tab'));
    /* THE TWO DIRECTIONS HAVE TO COUNT THE SAME THING. The forward walk
       already collapses a composite input to ONE stop -- `datetime-local`
       has six internal fields and eats six presses without moving
       `activeElement` -- but the reverse walk pressed Shift+Tab once per
       EXPECTED STOP, so every composite desynchronised it by five and the
       comparison went element-against-element out of step. Under the old
       11-press prefix this was invisible: evals/desktop has 46 stops and its
       composite sits at 39, so the cap ended the check 28 presses before the
       first field of it. Uncapped it reported a mismatch on that walk. The
       page is not at fault -- Shift+Tab walks a composite backwards exactly
       as Tab walks it forwards -- the instrument was. Press until the
       element CHANGES, bounded by the same trap budget the forward walk
       uses, and compare stops to stops. */
    const revLeg = await stepStops(fwd - 1, () => shiftTab());
    const reverse = revLeg.landed;
    const revPresses = revLeg.presses;
    const reverseExpected = core.slice(0, fwd - 1).map((s) => s.key).reverse();

    /* THE SKIP LINK. Identified from the markup, not assumed to be the first
       stop — assuming it would have made "the first Tab lands on a rail nav
       item" unsayable, and that is the answer on every pane here. Enter is
       pressed only when the first stop really is the skip link, because
       pressing it on a rail item NAVIGATES and takes the page with it. */
    await resetFocus(p.url, v);
    const skipDecl = await evalJson(`JSON.stringify((() => {
      const a = document.querySelector('a.skip, a.skip-link, a[href^="#"][class*="skip"]');
      if (!a) return null;
      const target = a.getAttribute('href') || '';
      const t = target.length > 1 ? document.getElementById(target.slice(1)) : null;
      return {
        present: true, href: target, text: (a.textContent || '').trim(),
        key: window.__kbd.describe(a).key,
        domRank: window.__kbd.ranks()[window.__kbd.describe(a).key],
        visibleWhenBlurred: window.__kbd.visible(a),
        targetExists: !!t,
        targetTag: t ? t.tagName.toLowerCase() : null,
        targetTabindex: t ? t.getAttribute('tabindex') : null,
        targetCanHoldFocus: t ? t.tabIndex >= 0 : false,
        targetLabel: t ? window.__kbd.describe(t).label : null
      };
    })())`);
    await key('Tab');
    const first = await active();
    const firstIsSkip = !!skipDecl && first.key === skipDecl.key;
    let afterSkip = null;
    if (firstIsSkip) {
      await key('Enter');
      await new Promise((r) => setTimeout(r, 250));
      afterSkip = await active();
    }
    const skipTarget = skipDecl;

    /* Focus across a re-render. The theme toggle is on every pane and
       repaints it, so it is the one control that asks this question the same
       way everywhere. */
    await load(p.url, v);
    await helpers();
    const toggle = await evalJson(`JSON.stringify((() => {
      const els = Array.from(document.querySelectorAll(window.__kbd.INTERACTIVE)).filter(window.__kbd.visible);
      const hit = els.find((el) => /theme|dark|light/i.test(window.__kbd.describe(el).label + ' ' + (el.id || '') + ' ' + (el.getAttribute('class') || '')));
      return hit ? window.__kbd.describe(hit) : null;
    })())`);
    let rerender = null;
    if (toggle) {
      await evalJson(`(() => {
        const els = Array.from(document.querySelectorAll(window.__kbd.INTERACTIVE)).filter(window.__kbd.visible);
        const hit = els.find((el) => window.__kbd.describe(el).key === ${JSON.stringify(toggle.key)});
        if (hit) hit.focus();
        return 'null';
      })()`);
      const before = await active();
      await key('Enter');
      await new Promise((r) => setTimeout(r, 500));
      const afterFocus = await active();
      rerender = { control: toggle.label || toggle.path, before: before.key, after: afterFocus.key,
        kept: before.key === afterFocus.key, afterPath: afterFocus.path };
    }

    results.push({
      pane: p.pane, title: p.title, url: p.url, viewport: v.name, documentTitle: title,
      candidates: candidates.length, stops: stops.length,
      stopList: stops, unreachable, unexpected, backwards,
      /* AN EMPTY RETRACE IS NOT A CLEAN ONE. `'' === ''` is true, so a walk
         that made NO reverse press scored exactly like one that retraced
         eleven. Prepending `throw new Error('boot-failed')` to
         shell-pane-v2.js -- what a failed session gate or a syntax error
         looks like -- produced one stop, zero candidates, zero presses, and
         a document reading "Shift+Tab is the exact inverse of Tab on 1 of 1
         walks", "Controls never reached by Tab 0", "Focus traps 0". Every
         predicate over an empty sample is free. This is a third value, and
         the document counts and names it rather than adding it to either
         side. */
      reverseMatches: reverse.length === 0 ? 'no-presses'
        : reverse.join('|') === reverseExpected.join('|'),
      reversePresses: revPresses,
      reverseStops: reverse.length,
      forwardLegPresses: fwdLeg.presses,
      forwardLegLanded: fwdLeg.landed[fwdLeg.landed.length - 1],
      /* THE SECOND TRAVERSAL HAS TO AGREE WITH THE FIRST BEFORE THE RETRACE
         MEANS ANYTHING. The retrace re-walks forward from a reset page and
         then comes back; if that second forward leg landed somewhere other
         than where the first walk said the last core stop was, the reverse
         comparison is being made against a stale expectation and a match is
         luck. This was recorded and never read. */
      forwardLegAgrees: core.length > 0 &&
        fwdLeg.landed[fwdLeg.landed.length - 1] === core[core.length - 1].key,
      reverseGot: reverse, reverseExpected,
      trapped: stops.some((s) => s.trappedAfter !== undefined),
      composites: stops.filter((s) => s.pressesConsumed > 1)
        .map((s) => ({ path: s.path, type: s.type, presses: s.pressesConsumed })),
      /* Termination is an observation, not a verdict. A walk ends either by
         wrapping to the first stop or by leaving the document for browser
         chrome; both are correct and which one happens is not the page's
         choice. Only a trap is a defect. */
      endedBy: stops.length > 2 && stops[stops.length - 1].key === stops[0].key ? 'wrapped'
        : (stops.length && stops[stops.length - 1].key === 'DOCUMENT' ? 'left-document' : 'limit'),
      /* WHETHER A SCROLLER IS FOCUSABLE IS ANSWERED BY THE WALK, NOT BY
         READING tabIndex. Chrome 127+ makes a scroll container focusable
         with no tabindex at all, so el.tabIndex === -1 says nothing; local
         Chrome does it and Safari and Firefox do not. What matters for the
         audit is the DECLARATION: a scroller the page never marks focusable
         is reachable only where the browser volunteers.

         AND `tabindex="-1"` IS A DECLARATION THAT THE ANSWER IS NO. The
         first version tested `tabindex === null`, so the one shape this
         whole tool exists to find -- Stadiora/Aria#10822, a scrolling table
         carrying -1, out of the tab order, its clipped columns unreachable
         -- read as DECLARED and printed 0. Putting -1 back on settings'
         three tables took the pane from 13 stops to 10 and the audit called
         it clean. A declaration only counts if it puts the container IN the
         tab order, so a negative index is undeclared for this purpose and
         says so in its own row. */
      scrollers,
      /* `Number(attr)` IS COERCION, NOT RESOLUTION, AND IT GETS TWO SPELLINGS
         WRONG. `Number('')` is 0, so `tabindex=""` read as DECLARED and
         inflated the declared tally the F1 body leans on. `Number('O')` is
         NaN, which is neither `< 0` nor `>= 0`, so that element left BOTH
         tallies and the audit printed 0 with nothing named -- while Chrome
         resolved both spellings to `el.tabIndex === -1` and dropped the
         settings walk from 13 stops to 11. The browser had already done the
         resolution correctly and this file was re-deriving it from the
         string. The two filters are now exact complements of one recorded
         resolved value, and `scrollerTally` below refuses if they are not. */
      undeclaredScrollers: scrollers.filter((s) => !s.focusable)
        .map((s) => ({ ...s, reachedByWalk: reached.has(s.key), why: whyUndeclared(s) })),
      mismatched, labelledby, dupIds, disabledVisible, hiddenPainted, loaded,
      skip: { declared: skipDecl, first, firstIsSkip, afterSkip, target: skipTarget },
      rerender
    });
    process.stderr.write(`${p.pane}/${v.name}: ${stops.length} stops, ${candidates.length} candidates, ` +
      `${unreachable.length} unreachable, ${scrollers.filter((s) => s.tabindex === null || Number(s.tabindex) < 0).length} undeclared scrollers, ` +
      `${hiddenPainted.length} hidden-but-painted\n`);
  }
}

/* ===================== DIALOGS =========================================
   A trap is the one keyboard defect the base walk cannot see, because the
   base walk never opens anything: it presses Tab and Enter is reserved for
   the skip link, since pressing it on a rail item NAVIGATES.

   Across the ten panes exactly one dialog is reachable from the keyboard --
   the Settings revoke confirmation, three instances of it, built by
   op.confirmAction in ops/assets/operate.js. There is also a drawer in the
   same file, but nothing in the ten panes opens one. Enumerating the openers
   rather than hunting for them is deliberate: a prober that clicks buttons
   looking for a dialog navigates away the moment it guesses wrong, and a
   walk that navigated away reports the next page's stops as this page's.

   FOUR PROPERTIES, EACH MEASURED AND NOT READ OFF THE SOURCE:
     1. focus enters the dialog when it opens;
     2. Tab forward N+1 times never leaves it  (N = controls inside);
     3. Shift+Tab from the first control wraps to the last, not out;
     4. Escape closes it AND returns focus to the control that opened it.
   A dialog that passes 2 and 3 and fails 4 is the common shape: focus is
   kept in, then dropped on the floor at the body when it closes. */
const DIALOGS = [
  { pane: 'settings', url: '/ops/settings.html',
    opener: 'Revoke access for owner@ops.invalid' },
  { pane: 'settings', url: '/ops/settings.html',
    opener: 'Revoke session ses_operator for operator@ops.invalid' }
];
const dialogResults = [];
for (const d of DIALOGS) {
  if (ONLY && !ONLY.includes(d.pane)) continue;
  if (SKIP_DIALOGS) continue;
  await resetFocus(d.url, VIEWPORTS[0]);
  await evalJson('JSON.stringify(window.__kbd.tagAll())');
  const target = await evalJson(`JSON.stringify((() => {
    const el = document.querySelector('[aria-label=' + JSON.stringify(${JSON.stringify(d.opener)}) + ']');
    return el ? window.__kbd.describe(el) : null;
  })())`);
  if (!target) { dialogResults.push({ ...d, found: false }); continue; }

  /* Reached by Tab, never by el.focus(). A dialog opened from a focus the
     operator could not have had is a dialog nobody can open. */
  let presses = 0;
  let at = await active();
  while (at.key !== target.key && presses < 80) { await key('Tab'); at = await active(); presses++; }
  const reachedByTab = at.key === target.key;
  if (!reachedByTab) { dialogResults.push({ ...d, found: true, reachedByTab: false }); continue; }

  await key('Enter');
  await new Promise((r) => setTimeout(r, 400));
  const opened = await evalJson(`JSON.stringify((() => {
    const dlg = document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]');
    if (!dlg) return null;
    window.__kbd.tagAll();
    const inside = Array.from(dlg.querySelectorAll('a[href], button, input, select, textarea'))
      .filter((el) => !el.disabled);
    return { key: window.__kbd.describe(dlg).key, role: dlg.getAttribute('role'),
      ariaModal: dlg.getAttribute('aria-modal'), label: (dlg.getAttribute('aria-label') || '').slice(0, 60),
      labelledby: dlg.getAttribute('aria-labelledby'), controls: inside.length,
      controlKeys: inside.map((el) => window.__kbd.describe(el).key) };
  })())`);
  if (!opened) { dialogResults.push({ ...d, found: true, reachedByTab, opened: false }); continue; }

  const entered = await active();
  const inDialog = async () => evalJson(`JSON.stringify((() => {
    const dlg = document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]');
    return !!(dlg && document.activeElement && dlg.contains(document.activeElement));
  })())`);
  const focusEntered = await inDialog();

  /* One press more than there are controls: a trap that holds for exactly
     as many presses as it has controls is not a trap, it is a coincidence. */
  const escaped = [];
  for (let i = 0; i <= opened.controls; i++) {
    await key('Tab');
    if (!(await inDialog())) escaped.push({ afterPresses: i + 1, at: await active() });
  }
  const heldForward = escaped.length === 0;

  const wrapped = await evalJson(`JSON.stringify((() => {
    const dlg = document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]');
    const els = Array.from(dlg.querySelectorAll('a[href], button, input, select, textarea'))
      .filter((el) => !el.disabled);
    els[0].focus();
    return window.__kbd.describe(els[els.length - 1]).key;
  })())`);
  await shiftTab();
  const backFromFirst = await active();
  const heldBackward = await inDialog();

  await key('Escape');
  await new Promise((r) => setTimeout(r, 400));
  const stillOpen = await evalJson(`JSON.stringify(!!document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]'))`);
  const afterEscape = await active();

  dialogResults.push({ ...d, found: true, reachedByTab, opened: true, openerKey: target.key,
    tabsToOpener: presses, dialog: opened, enteredKey: entered.key, enteredPath: entered.path,
    focusEntered, heldForward, escaped, expectedWrapTo: wrapped,
    backFromFirst: backFromFirst.key, wrapCorrect: backFromFirst.key === wrapped, heldBackward,
    closedByEscape: !stillOpen, focusRestored: afterEscape.key === target.key,
    afterEscapeKey: afterEscape.key, afterEscapePath: afterEscape.path });
  process.stderr.write(`dialog ${d.pane} "${d.opener.slice(0, 34)}": enter=${focusEntered} ` +
    `fwd=${heldForward} back=${heldBackward} wrap=${backFromFirst.key === wrapped} ` +
    `esc=${!stillOpen} restore=${afterEscape.key === target.key}\n`);
}

/* The raw walk record is EVIDENCE FOR THE BATTERY, not a repo artefact: it is
   keyed to one browser build at one moment and would rot in git within a
   week. It is written only when asked for, and never into the tree. */
if (process.env.KBD_JSON) {
  fs.writeFileSync(process.env.KBD_JSON, JSON.stringify({ walks: results, dialogs: dialogResults }, null, 2));
}
/* ===================== THE FINDINGS DOCUMENT ==========================
   Generated FROM the run, never typed. Every count, every element path and
   every ratio in ops/keyboard-audit.md is read out of the record this
   process just produced, so the document cannot disagree with the walk that
   produced it. The prose is fixed; the numbers are not. This is the same
   rule the focus-ring census landed under: derived text is checked, written
   text is a claim.

   ONE EXCEPTION, STATED RATHER THAN HIDDEN: the per-finding prose below
   names files and line numbers found by reading the source. Those are
   verified by the mutation battery, which re-resolves every anchor against
   the restored tree, and not by this generator. */
const R = results;
const D = dialogResults;
const d = R.filter((w) => w.viewport === 'desktop');
const n = R.filter((w) => w.viewport === '375px');
const sum = (rows, f) => rows.reduce((a, w) => a + f(w), 0);
/* DISTINCT ELEMENTS, NOT OCCURRENCES. Every pane is walked at two widths, so
   a headline that sums across walks reports 4 for two elements and then the
   findings list two of them. The count and the list must be the same
   population or one of them is lying.

   AND THE KEY HAS TO SEPARATE SIBLINGS AND FINDING KINDS. `pathOf()` stops at five ancestors
   and two classes, so settings' three `div.tbl-wrap` boxes -- three
   different tables, three different labels -- produce one byte-identical
   path. Keying on the path alone collapsed them: the shipped document said
   the walk found 3 declared scroll containers when its own record held 5,
   and with those three undeclared it printed a headline of 1 above a list of
   3. A single element can also be more than one finding kind, and a key
   shared across kinds either refused for the wrong cause or zeroed the second
   kind. The key now carries the kind plus the element's ORDINAL among
   same-path rows in the same list, and `sameWalkCollision` below turns the
   remaining possibility into a refusal rather than a smaller number. */
const keyed = (rows, f, kind = 'value') => rows.flatMap((w) => {
  const xs = f(w);
  return xs.map((x, i) => ({
    w, x, key: `${kind}|${w.pane}|${x.path}#${xs.filter((y, j) => y.path === x.path && j < i).length}`
  }));
});
const distinct = (rows, f) => new Set(keyed(rows, f).map((r) => r.key)).size;
const list = (rows, f, kind) => keyed(rows, f, kind);
const md = [];
const P = (...x) => md.push(...x);

const totals = {
  walks: R.length,
  panes: new Set(R.map((w) => w.pane)).size,
  viewports: [...new Set(R.map((w) => w.viewport))]
    .map((n) => { const v = VIEWPORTS.find((x) => x.name === n); return `${n} ${v.width}×${v.height}`; })
    .join(' and '),
  stops: sum(R, (w) => w.stops),
  candidates: sum(R, (w) => w.candidates),
  unreachable: sum(R, (w) => w.unreachable.length),
  traps: R.filter((w) => w.trapped).length,
  /* `'no-presses'` IS TRUTHY, so a plain filter would have counted a walk
     that never pressed Shift+Tab as a clean retrace -- the empty-sample
     defect surviving into the summary of the fix for it. */
  reverseOk: R.filter((w) => w.reverseMatches === true).length,
  reverseVacuous: R.filter((w) => w.reverseMatches === 'no-presses').length,
  unexpected: sum(R, (w) => w.unexpected.length),
  wrapped: R.filter((w) => w.endedBy === 'wrapped').length,
  leftDocument: R.filter((w) => w.endedBy === 'left-document').length,
  hitLimit: R.filter((w) => w.endedBy === 'limit').length,
  forwardLegAgrees: R.filter((w) => w.forwardLegAgrees).length,
  reversePresses: sum(R, (w) => w.reversePresses),
  reverseStops: sum(R, (w) => w.reverseStops),
  backwards: sum(R, (w) => w.backwards.length),
  skipFirst: R.filter((w) => w.skip.firstIsSkip).length,
  skipLands: R.filter((w) => w.skip.afterSkip && w.skip.afterSkip.path === 'main#content').length,
  rerenderKept: R.filter((w) => w.rerender && w.rerender.kept).length,
  labels: sum(R, (w) => w.mismatched.length),
  /* The size of what the line above does NOT measure, counted rather than
     described. `nameFromHeading` are controls whose accessible name comes
     from a heading this tool never reads; `nameSuperseded` are the ones
     that ALSO carry an `aria-label`, where the attribute the sweep reads is
     not the name the browser computes. */
  nameFromHeading: distinct(R, (w) => w.labelledby),
  nameSuperseded: distinct(R, (w) => w.labelledby.filter((x) => x.alsoAriaLabel)),
  dupIds: sum(R, (w) => w.dupIds.length),
  /* THE RESOLVED VALUE, NOT THE STRING -- and the exact complement of
     `undeclaredScrollers`, so no scroller can fall out of both tallies the
     way `tabindex="O"` did. `scrollerTally` below refuses if one ever does. */
  declaredScrollers: distinct(R, (w) => w.scrollers.filter((x) => x.focusable)),
  declaredNamedRegions: distinct(R, (w) => w.scrollers.filter((x) => x.focusable &&
    x.role === 'region' && (x.ariaLabel || x.ariaLabelledby))),
  dialogs: D.length,
  dialogsClean: D.filter((x) => x.focusEntered && x.heldForward && x.heldBackward &&
    x.wrapCorrect && x.closedByEscape && x.focusRestored).length
};

/* THE FILED ISSUE NUMBERS, RECONCILED AGAINST THE RUN. A findings document
   that references an issue for a finding the run no longer produces is the
   same defect class as a mutation table naming a line nobody mutated: a
   claim that looks like evidence and is not connected to what ran. So the
   numbers are not prose. Each is keyed to a finding KIND, the generator
   prints it from this map, and a key whose kind the run did not produce
   THROWS rather than printing. A finding with no entry prints as unfiled. */
const FILED = {
  'undeclared-scroller': 'Stadiora/Aria#10868',
  'hidden-painted': 'Stadiora/Aria#10869'
};

const findings = [];

for (const { w, x, key } of list(R, (w) => w.undeclaredScrollers, 'undeclared-scroller')) {
  findings.push({ sev: 'defect', pane: w.pane, viewport: w.viewport, key,
    kind: 'undeclared-scroller',
    title: 'A sideways-scrolling table is never declared keyboard-focusable',
    body: [
      `\`${x.path}\` on **${w.pane}/${w.viewport}** clips **${x.overflowX}px** of content ` +
      `horizontally and has ${x.why}` +
      `. It carries ${x.role ? `\`role="${x.role}"\`` : 'no `role`'} and ` +
      `${x.ariaLabel ? `\`aria-label="${x.ariaLabel}"\`` : (x.ariaLabelledby
        ? `\`aria-labelledby="${x.ariaLabelledby}"\`` : 'neither `aria-label` nor `aria-labelledby`')}.`,
      '',
      /* THE CONSEQUENCE IS A BRANCH ON THE RECORD, NOT A SENTENCE BESIDE IT.
         This used to assert "The walk **did** reach it (stop N of M)"
         unconditionally, and under a payload that put the container out of
         the tab order it printed the not-found sentinel as its own evidence:
         "the walk did reach it (stop -1 of 10)". The reached case and the
         unreached case are opposite findings -- one is a Chrome-version
         footnote, the other is unreachable in every browser including this
         one -- and the unreached case is the worse of the two, so a default
         that prints the milder one is the unsafe direction. */
      x.reachedByWalk
        ? `The walk **did** reach it (stop ${w.stopList.findIndex((s) => s.key === x.key) + 1} of ` +
          `${w.stops}), but only because Chrome 127+ makes a scroll container focusable on its own. ` +
          'Safari and Firefox do not, and neither does any Chrome older than that. It announces as ' +
          `a bare \`${x.tag}\`.`
        : 'The walk **never reached it**: it is out of the tab order in the browser that ran this ' +
          'sweep, which is the browser most willing to volunteer focus to a scroll container. Its ' +
          'clipped content is unreachable from the keyboard here, in Safari and in Firefox alike.',
      '',
      'The pattern Stadiora/Aria#10822 established is a declared, named region — the walk found ' +
      `${totals.declaredScrollers} scroll container${totals.declaredScrollers === 1 ? '' : 's'} ` +
      `the page declares focusable, ${totals.declaredNamedRegions} of them carrying both ` +
      '`role="region"` and an `aria-label`. This one was missed.'
    ].join('\n') });
}

for (const { w, x, key } of list(R, (w) => w.hiddenPainted, 'hidden-painted')) {
  findings.push({ sev: 'defect', pane: w.pane, viewport: w.viewport, key,
    kind: 'hidden-painted',
    title: `An element the code hides is still painted (\`${x.tag}\`)`,
    body: [
      `\`${x.path}\` on **${w.pane}** carries the \`hidden\` attribute and computes to ` +
      `\`display: ${x.display}\`, so it is **${Math.round(x.rect.w)}×${Math.round(x.rect.h)}px of visible ` +
      `interface the code believes is not there**` +
      (x.controls ? `, containing ${x.controls} form controls.` : '.'),
      '',
      '`hidden` is a UA `display: none` rule and the weakest one in the cascade. Any author `display` ' +
      'on the same element silently defeats it.',
      /* THE COUNT WAS DERIVED AND THE CLAUSE NEXT TO IT WAS NOT, WHICH IS THE
         WHOLE BUG IN ONE SENTENCE. Under `control.disabled = false` the
         document printed "0 of the 3 controls inside are `disabled`, so a
         keyboard operator can see 3 labelled fields they can neither reach
         nor operate" -- over three enabled, painted, reachable controls, on
         a run whose own record said `unreachable: 0`. That is the unsafe
         direction: it reports a live operable-hidden-control defect as the
         benign one. All three arms are now branches on the same counts the
         sentence quotes. */
      x.controls
        ? (x.controlsDisabled === x.controls
          ? `\nAll ${x.controls} controls inside are \`disabled\`, so a keyboard operator can see ` +
            `${x.controls} form controls they can neither reach nor operate, with no visible ` +
            'indication of why.'
          : (x.controlsDisabled === 0
            ? `\nNone of the ${x.controls} controls inside is \`disabled\`: they are fully operable ` +
              'form controls inside an element the code believes is not there.'
            : `\n${x.controlsDisabled} of the ${x.controls} controls inside are \`disabled\`; the ` +
              `other ${x.controls - x.controlsDisabled} are fully operable inside an element the ` +
              'code believes is not there.'))
        : (x.selfDisabled
          ? `\nThe ${x.tag} is \`disabled\`, so it is inert as well as invisible to the code that hid it.`
          : `\nThe ${x.tag} is **not** disabled: it is a fully operable control the code has decided ` +
            'should not exist.')
    ].join('\n') });
}

/* COUNTED AND NAMED, OR NEITHER. The retrace column used to be a bare
   fraction: a walk that failed it appeared in the headline as 19/20 and
   nowhere else, which is the same two-populations defect as counting
   findings over twenty walks and listing them over ten. Every walk the
   fraction excludes is enumerated here with the stop it first disagreed on. */
for (const { w, x, key } of list(R, (w) => (w.reverseMatches === false
  ? [{ path: w.reverseGot.findIndex((k, i) => k !== w.reverseExpected[i]) }] : []), 'reverse-order')) {
  const at = x.path;
  findings.push({ sev: 'defect', pane: w.pane, viewport: w.viewport, key,
    kind: 'reverse-order',
    title: 'Shift+Tab does not retrace the Tab order',
    body: `On **${w.pane}/${w.viewport}** the reverse walk diverges at retraced stop ${at}: ` +
      `Shift+Tab landed on \`${w.reverseGot[at]}\` where the forward order says ` +
      `\`${w.reverseExpected[at]}\`. ${w.reverseStops} stops were retraced over ` +
      `${w.reversePresses} presses against ${w.stops} forward stops.` });
}

for (const { w, x, key } of list(R, (w) => w.unreachable, 'unreachable')) {
  findings.push({ sev: 'defect', pane: w.pane, viewport: w.viewport, key,
    kind: 'unreachable',
    title: 'An enabled, visible control is never reached by Tab',
    body: `\`${x.path}\` (${x.tag}, ${Math.round(x.rect.w)}×${Math.round(x.rect.h)}px) on **${w.pane}/${w.viewport}**.` });
}
for (const { w, x, key } of list(R, (w) => w.backwards, 'backwards')) {
  findings.push({ sev: 'defect', pane: w.pane, viewport: w.viewport, key,
    kind: 'backwards',
    title: 'Tab order does not follow reading order',
    body: `\`${x.stop.path}\` (DOM rank ${x.rank}) is reached after \`${x.afterPath}\` (rank ${x.afterRank}).` });
}
for (const { w, x, key } of list(R, (w) => w.mismatched, 'label-in-name')) {
  findings.push({ sev: 'defect', pane: w.pane, viewport: w.viewport, key,
    kind: 'label-in-name',
    title: 'Accessible name does not contain the visible label (WCAG 2.5.3)',
    body: `\`${x.path}\` reads "${x.text}" and is named "${x.ariaLabel}".` });
}
/* A HEADLINE WITH NO LIST UNDER IT IS A COUNT NOBODY CAN ACT ON. Duplicate
   ids were summed into the headline and had no finding kind at all, so a
   real collision would have printed a number above silence -- and the
   headline was an OCCURRENCE count over twenty walks while every other row
   under it counts distinct elements. `keyed()` needs a `path`, which a
   dup-id row does not have, so the id itself is the path. */
for (const { w, x, key } of list(R, (w) => w.dupIds.map((d) => ({ ...d, path: `#${d.id}` })), 'dup-id')) {
  findings.push({ sev: 'defect', pane: w.pane, viewport: w.viewport, key,
    kind: 'dup-id',
    title: 'The same `id` appears more than once in the document',
    body: `\`#${x.id}\` appears ${x.n} times on **${w.pane}/${w.viewport}**. ` +
      'A label, an `aria-labelledby` or a `href="#…"` pointing at it resolves to the first one only.' });
}

/* RECONCILED ONLY ON A FULL SWEEP, because a scoped run has not walked the
   pane most findings live on and "the finding did not reproduce" would then
   mean "you did not look". The first version of this check did not make that
   distinction and refused on every KBD_ONLY run. A partial document says so
   in its own text instead. */
const fullSweep = ONLY === null && ONLY_VP === null && !SKIP_DIALOGS;
if (fullSweep) {
  /* A WALK WITH NOTHING TO WALK IS A REFUSAL. Prepending a `throw` to
     shell-pane-v2.js -- a failed session gate, a syntax error, a pane that
     never mounts -- leaves one stop and zero candidates, and every predicate
     here is then vacuously clean: no unreachable controls, no traps, no
     backwards stops, and a retrace that "matches". The document read exactly
     like a healthy one. Ten panes at two widths cannot produce a walk with
     no focusable content, so this is not a threshold, it is an impossibility
     check. */
  /* A TRUNCATED WALK IS A SHRUNKEN SAMPLE. Ending at the press limit means
     the walk never came back to its first stop and never left the document,
     so the stop list is a PREFIX -- and every count taken over it (stops,
     unreachable, backwards, the retrace) is taken over less page than the
     headline claims. The limit is 3x the candidate count, so reaching it
     means something is cycling; report nothing rather than report short. */
  /* A TRAP IS REPORTED AS A TRAP. `walk()` breaks out on `consumed >
     TRAP_PRESSES`, so a trapped walk ALSO ends at the press limit -- and
     the truncation refusal below fired first, sending whoever read it
     looking for a cycle. The detector's positive result never reached a
     reader, and "Focus traps 0" could only ever print 0 on a full sweep
     because a sweep with one never got that far. Ordering is the whole fix:
     the more specific cause refuses first, naming the stop it stuck on. */
  const trapped = R.filter((w) => w.trapped);
  if (trapped.length) {
    throw new Error(`${trapped.length} walk(s) hit a focus trap ` +
      `(${trapped.map((w) => `${w.pane}/${w.viewport} after stop ` +
        `${w.stopList.findIndex((s) => s.trappedAfter !== undefined) + 1}`).join(', ')}): ` +
      'focus stopped moving before the walk completed, so the stop list is a prefix ' +
      'AND a keyboard operator is stuck on this pane');
  }
  const truncated = R.filter((w) => w.endedBy === 'limit');
  if (truncated.length) {
    throw new Error(`${truncated.length} walk(s) ended at the press limit ` +
      `(${truncated.map((w) => w.pane + '/' + w.viewport).join(', ')}): the stop list is a ` +
      'prefix and every count over it would be short');
  }
  const empty = R.filter((w) => w.candidates === 0);
  if (empty.length) {
    throw new Error(`${empty.length} walk(s) found zero focusable candidates ` +
      `(${empty.map((w) => w.pane + '/' + w.viewport).join(', ')}): the page did not ` +
      'boot, and every clean verdict in this document would be vacuous');
  }
  for (const k of Object.keys(FILED)) {
    if (!findings.some((f) => f.kind === k)) {
      throw new Error(`FILED names ${k} (${FILED[k]}) but this full sweep produced no finding of that kind`);
    }
  }
}

/* EVERY SCROLLER IS IN EXACTLY ONE TALLY. The two filters are complements of
   one recorded boolean, so this cannot fail by arithmetic -- it fails if
   somebody re-derives either side from the attribute string again, which is
   precisely how `tabindex="O"` came to be in neither tally and print a clean
   0, while Chrome had it out of the tab order. This one runs on every run,
   scoped or not: it is an invariant of the instrument, not of the sweep. */
for (const w of R) {
  const d = w.scrollers.filter((x) => x.focusable).length;
  const u = w.undeclaredScrollers.length;
  if (d + u !== w.scrollers.length) {
    throw new Error(`scroller tally on ${w.pane}/${w.viewport}: ${d} declared + ${u} undeclared ` +
      `is not ${w.scrollers.length} scrollers -- a scroller is in both tallies or in neither`);
  }
}
/* ONE POPULATION. The headline counts and the findings list used to be read
   off DIFFERENT sets of walks -- the count over all twenty, the list over
   the ten desktop ones -- so a defect present only at 375px was counted in
   the headline, named nowhere, given no issue number, and the run still
   exited 0. Both numbers are now derived from this one array. A finding
   cannot be counted without being named because the count IS the naming.

   AND A GROUP THAT MATCHED THE SAME WALK TWICE IS A KEY COLLISION, NOT A
   FINDING SEEN TWICE. Each walk visits an element at most once, so a
   duplicate pane/viewport inside one group means two different elements
   collapsed into one key -- the headline would print smaller than its own
   list. That is a refusal, not a smaller number. */
const groups = [];
const byKey = new Map();
for (const f of findings) {
  if (!byKey.has(f.key)) { const g = { ...f, where: [] }; byKey.set(f.key, g); groups.push(g); }
  const g = byKey.get(f.key);
  const seen = `${f.pane}/${f.viewport}`;
  if (g.where.includes(seen)) {
    throw new Error(`finding key ${f.key} matched two elements in the same walk (${seen}): ` +
      'the key collides, so the headline count would print smaller than the list under it');
  }
  g.where.push(seen);
}
const countKind = (k) => groups.filter((g) => g.kind === k).length;


P('# Keyboard-operator walkthrough of the ops dashboard', '');
P('_Generated by `scripts/ops-keyboard-walk.mjs`. Every number below is read out of',
  'the run that produced this file; none is typed. Re-run the tool to regenerate it._', '');
P('Nobody had ever driven this dashboard from a keyboard. Forty screenshots exist of',
  'what it looks like; this is the first record of what it is like to **use** without',
  'a mouse. Contrast is not in scope: `scripts/check-ops-contrast.mjs` owns it and',
  'reports its own site count on every run. Nothing in this document measured a',
  'colour. This is traversal.', '');

P('## What was measured', '');
P('| | |', '|---|---|');
/* THE WIDTHS ARE THE ONES THAT RAN. Typed as "at desktop 1440×900 and
   375×812" this line was false on every scoped run -- the document said it
   had walked two widths while holding one. A description of the sweep is a
   claim about the sweep and gets derived like every other. */
P(`| Panes walked | ${totals.panes}, at ${totals.viewports} — **${totals.walks} walks** |`);
P(`| Tab stops recorded | ${totals.stops} |`);
P(`| Interactive controls found | ${totals.candidates} |`);
P(`| Controls never reached by Tab | **${countKind('unreachable')}** |`);
P(`| Focus traps | **${totals.traps}** |`);
P(`| Walks whose Shift+Tab exactly retraces Tab | ${totals.reverseOk}/${totals.walks}, ` +
  `**${totals.reverseStops} stops retraced** over ${totals.reversePresses} Shift+Tab presses |`);
P(`| Walks that made no Shift+Tab press at all (scored neither way) | **${totals.reverseVacuous}** |`);
P('| Walks where the retrace\'s forward leg landed where the first walk said it would | ' +
  `${totals.forwardLegAgrees}/${totals.walks} |`);
P(`| Stops that jump backwards in reading order | **${countKind('backwards')}** |`);
P(`| Walks where the skip link is the first stop | ${totals.skipFirst}/${totals.walks} |`);
P(`| Walks where it lands on \`main#content\` | ${totals.skipLands}/${totals.walks} |`);
P(`| Walks where focus survives the theme re-render | ${totals.rerenderKept}/${totals.walks} |`);
P(`| \`aria-label\` attributes missing their visible text (WCAG 2.5.3) | ${countKind('label-in-name')} |`);
P(`| Duplicate \`id\` attributes | ${countKind('dup-id')} |`);
P(`| Modal dialogs probed | ${totals.dialogs}, ${totals.dialogsClean} clean on all six properties |`);
P(`| **Scroll containers never declared focusable** | **${countKind('undeclared-scroller')}** |`);
P(`| **Elements marked \`hidden\` that the stylesheet still paints** | **${countKind('hidden-painted')}** |`);
P('');

P('## Findings', '');
if (!groups.length) P('_None._', '');
if (!fullSweep) {
  P('_Scoped run: only part of the dashboard was walked, and the filed-issue ' +
    'reconciliation is skipped. This document is not the audit._', '');
}
let i = 0;
for (const f of groups) {
  i++;
  P(`### F${i}. ${f.title}`, '');
  P(f.body, '');
  P(`Seen on: ${f.where.join(', ')}${f.where.length > 1 ? ` (measured on ${f.where[0]})` : ''}.`, '');
  P(FILED[f.kind] ? `Filed as ${FILED[f.kind]}. Not fixed here: this audit reports, it does not repair.`
    : '**Not filed.**', '');
}

P('## What is clean, and how that is known', '');
/* THE THRESHOLD IS PRINTED FROM THE CONSTANT, NOT BESIDE IT. A literal and a
   sentence describing it drift, and that drift is the whole of
   Stadiora/Aria#10365. The number in this line cannot disagree with the
   number the walk used because it is that number. */
P(`- **No focus traps.** ${totals.walks} walks, ${totals.stops} stops, ` +
  `${totals.traps} traps. A control is called a trap only after **${TRAP_PRESSES}** consecutive ` +
  'Tab presses leave `document.activeElement` unchanged — twice the widest composite input ' +
  `Chrome ships, which is the ${COMPOSITE_MAX}-field \`datetime-local\`.`);
P(`- **Nothing unreachable.** ${totals.candidates} enabled, visible, interactive controls; ` +
  `${countKind('unreachable')} were not reached by Tab.`);
/* TWO NUMBERS THE RUN COMPUTED AND THE DOCUMENT USED TO SWALLOW. Both bear
   on how much the walk is worth: a stop on a non-interactive element is
   either a real defect or a gap in this tool's idea of "interactive", and a
   walk that ran out of document instead of wrapping covered a different
   amount of the page than one that came back round. Printing them is how
   the next reader finds out the tool disagreed with itself. */
P(`- **${totals.unexpected} stops landed on something this tool does not call interactive**, ` +
  `and ${totals.wrapped} of ${totals.walks} walks ended by wrapping back to their first stop ` +
  `(${totals.leftDocument} ran out of document instead, and ${totals.hitLimit} hit the press ` +
  'limit). The terminal stop is timing-dependent in Chrome; the first two endings are both ' +
  'complete walks and neither is a defect. The third is a truncated one, and a full sweep ' +
  'refuses rather than reporting over it.');
P(`- **Tab order is reading order** on all ${totals.walks} walks: ${countKind('backwards')} stops ` +
  'out of DOM order, where a stop is out of order if its element precedes the previous ' +
  'stop\'s element in document order.');
P(`- **Shift+Tab is the exact inverse of Tab** on ${totals.reverseOk} of ${totals.walks} walks, over` +
  ` the WHOLE walk rather than a prefix of it: ${totals.reverseStops} stops retraced against` +
  ` ${totals.stops} forward stops, which took ${totals.reversePresses} presses because a composite` +
  ` input consumes several. ${totals.reverseVacuous} walks made no press and are counted on` +
  ' neither side.');
P(`- **The skip link works.** It is the first stop on ${totals.skipFirst}/${totals.walks} walks and ` +
  `Enter lands focus on \`main#content\` on ${totals.skipLands}/${totals.walks}.`);
P(`- **Focus survives a re-render** on ${totals.rerenderKept}/${totals.walks} walks: the theme toggle ` +
  'rebuilds the pane and focus stays on the button that did it.');
P(`- **No duplicate ids** (${countKind('dup-id')}), and **no \`aria-label\` that drops its visible text** ` +
  `(${countKind('label-in-name')}). That is the attribute, not the computed accessible name — see NOT COVERED.`);
P('');

P('### The modal dialog', '');
P('| dialog | focus enters | holds Tab | holds Shift+Tab | wraps | Escape closes | focus restored |');
P('|---|---|---|---|---|---|---|');
for (const x of D) {
  const t = (v) => (v ? 'yes' : '**NO**');
  P(`| ${x.pane}: "${x.opener}" | ${t(x.focusEntered)} | ${t(x.heldForward)} | ${t(x.heldBackward)} | ` +
    `${t(x.wrapCorrect)} | ${t(x.closedByEscape)} | ${t(x.focusRestored)} |`);
}
P('');
P('Each was opened **by Tab and Enter**, never by `element.focus()`: a dialog opened from a focus',
  'the operator could not have had is a dialog nobody can open. Forward containment is pressed one',
  'time more than the dialog has controls, because a trap that holds for exactly as many presses as',
  'it has controls is a coincidence, not a trap.', '');

const batteryUsedSignals = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'ops-keyboard-walk.battery.mjs'), 'utf8');
  return new Set([...src.matchAll(/\bsignal:\s*'([^']+)'/g)].map((m) => m[1]));
})();
const cleanRowsForBatteryCoverage = [
  { name: 'focus traps', signals: [] },
  { name: 'retrace forward-leg agreement', signals: [] },
  { name: 'backwards reading-order rows', signals: [] },
  { name: 'duplicate `id` rows', signals: [] },
  {
    name: 'theme re-render focus retention',
    signals: ['settingsRerender'],
    note: 'The walk samples focus 500ms after pressing the theme toggle; a slower rebuild could drop focus after that sample.'
  }
];
const unexercisedCleanRows = cleanRowsForBatteryCoverage
  .filter((row) => !row.signals.some((signal) => batteryUsedSignals.has(signal)));

P('## NOT COVERED', '');
/* NARROWING, NOT ANALYSIS. A finding group is keyed by kind, pane, CSS path
   and a per-list ordinal, deliberately without the viewport, so one element
   seen at both widths prints as one finding saying "Seen on: both". The cost
   is that two DIFFERENT same-kind, same-path siblings, each a finding at only
   one of the two widths, would share an ordinal and merge. `sameWalkCollision`
   catches the same-viewport case and refuses; the cross-viewport case is not
   detectable without an identity that survives two separate page loads, which
   the stamped id does not. Today's pages do not reach it. Saying so is
   cheaper and more honest than an identity scheme built for a case that has
   never occurred. */
P('- **Two different same-kind, same-path siblings, each a finding at only one width, would merge',
  '  into one group.** Findings are grouped by kind, pane, CSS path and per-list ordinal so',
  '  one element seen at both widths is one finding. A same-viewport collision within one',
  '  list refuses; the cross-viewport shape does not, and no element in this sweep is in it.');
P(`- **${unexercisedCleanRows.length} clean rows are live measurements, not battery-exercised claims.**`,
  `  This list is derived from the mutation battery's \`signal:\` wiring. The battery does not`,
  `  carry payloads for ${unexercisedCleanRows.map((row) => row.name).join(', ')}.`,
  '  They are printed from the run, but they are not part of the battery coverage claim.');
unexercisedCleanRows.filter((row) => row.note).forEach((row) => {
  P(`  ${row.note}`);
});
P('- **Screen-reader output.** Nothing here listens to a screen reader. "Announced twice" is',
  '  answered only for the two mechanical proxies a browser can be asked about — duplicate `id`',
  '  attributes and `aria-label` attributes that drop their visible text. An element announced',
  '  twice for any other reason would not be seen.');
/* THE NUMBER IN THIS BULLET IS THE SIZE OF THE HOLE, MEASURED. A NOT COVERED
   claim that says "some controls" is unfalsifiable; one that says how many
   moves when the dashboard does, and it came from the run rather than from a
   grep over source text -- `\b` does not match before a digit and a regex
   over the source is not value resolution. */
P(`- **The computed accessible name.** The 2.5.3 row above reads the \`aria-label\` ATTRIBUTE.`,
  `  The name a browser actually computes prefers \`aria-labelledby\`, which outranks it —`,
  `  Chrome's AX tree marks the \`aria-label\` \`superseded\`. This sweep saw`,
  `  **${totals.nameFromHeading} interactive controls named by \`aria-labelledby\`**`,
  `  (${totals.nameSuperseded} of them also carrying an \`aria-label\`), and judged none of them.`,
  '  That count is the HAPPY PATH: the ones this dashboard is known to build — the "Try again"',
  '  buttons the overview and alerts panes name from the heading of the panel that failed —',
  '  exist only after a panel fails to load, and nothing here induces that state.',
  '  A control whose visible text sits in its `aria-label` and not in the heading it points at is',
  '  a real Label-in-Name failure this document prints as clean. `<label>` and `title` are',
  '  likewise unread.');
P('- **Roving-tabindex widgets.** No pane ships one, so arrow-key navigation inside a composite',
  '  widget is untested. If one is added this tool will report its single stop and say nothing',
  '  about whether the arrows work.');
P('- **The rail drawer.** `ops/assets/operate.js` builds a drawer as well as the confirmation',
  `  dialog, but nothing in the ${totals.panes} panes opens one, so it is unmeasured. The`,
  `  ${totals.dialogs} dialogs in the table above are the only overlays reachable from the`,
  '  keyboard in this dashboard.');
P('- **Browsers other than the one that ran.** Everything above is Chrome. The one place that',
  '  matters is called out in the finding that depends on it.');
P('- **Non-Tab keys.** Enter is pressed on exactly three controls — the skip link, the theme',
  '  toggle and the dialog openers. Space, arrows, Home/End and Escape outside a dialog are not',
  '  exercised.');
P('- **Pages that are not panes.** `login.html`, `setup.html` and `shell-v2.html` are outside',
  '  this sweep.', '');

/* THE COUNT IN THE HEADING IS THE LENGTH OF THE LIST. Two numbers used to be
   typed here -- "four defects" and "Three more" -- beside lists that grow
   every time this instrument is caught out. A literal and the list it
   describes drift the moment one of them changes, which is the whole of
   Stadiora/Aria#10365. These are arrays; the numbers are their lengths and
   the numbering is the index. */
const WALKED_INTO = [
  ['**Identity was a position.** Stops were keyed by CSS path plus bounding-rect origin. Tabbing',
   'scrolls the page, so the same element answered to a different key on the way round: cycle',
   'detection never fired, stop counts inflated, and **exactly one unreachable control was',
   'reported on nine panes out of ten**. All ten were reachable. The uniformity is what made it',
   'convincing. A key that moves with the measurement is not an identity; the fix stamps',
   '`data-kbdid` on every element and keys on the attribute.'],
  ['**Tab carried a `char` event.** `rawKeyDown` + `char("\\t")` + `keyUp` is how you *type* a',
   'tab. Inside a text field Chrome inserted one and focus never moved.'],
  ['**`blur()` is not a focus reset.** It moves `activeElement` to `<body>` but leaves Chrome\'s',
   'sequential-navigation starting point wherever it was, so walks silently began mid-page. A',
   'full reload is what finally made the skip link appear as stop 0 — on every pane.'],
  [`**A composite input is not a trap.** \`input[type=datetime-local]\` has ${COMPOSITE_MAX} internal fields, so`,
   '`activeElement` is unchanged for several presses *by design*. The old "3 unchanged presses is',
   'a trap" rule manufactured a trap on Evaluations **and 27 unreachable controls behind it**.',
   `Press counts are reported instead and a trap is declared only past ${TRAP_PRESSES}, twice the widest`,
   'composite Chrome ships.']
];
const READ_INTO = [
  ['**A disabled control is not a reachability defect.** The browser is right to skip it. Counting',
   'it blamed Evaluations for three fields it had deliberately turned off.'],
  ['**Label in Name is containment, not equality.** An accessible name may say *more* than the',
   'visible text. Testing equality condemned three correct "Revoke" buttons, and reading',
   '`textContent` charged a labelled region with its own *contents* — `nav#rail` accused of being',
   'mislabelled against the entire rail. 30 findings across 20 walks, every one the instrument.'],
  ['**The forward and reverse counts are not symmetric.** After *n* Tabs focus sits on stop *n-1*,',
   'so *n* Shift+Tabs walk one step off the document and every key after that is off by one. It',
   'reported a reverse-order mismatch on 16 of 20 walks, all of them correct pages.'],
  ['**And the terminal stop is not deterministic, so that fix cannot be proven the obvious way.**',
   'A walk ends either by wrapping to stop 0 or by dropping out of the document, and the same',
   'pane at the same width was measured both ways across runs. When it wraps, the off-by-one',
   '*cancels* — the extra Tab lands on stop 0 and the first Shift+Tab wraps back — so removing',
   'the fix is invisible in the match result on a wrapping walk and visible on a leaving one.',
   'Scoring it on the match would have been a coin flip with a decimal point. It is scored on',
   'the press count, which was 3 in six unmutated runs across both shapes and 4 without the fix.']
];

P(`## Method notes: ${WALKED_INTO.length} defects in the instrument, each of which printed a confident wrong number`, '');
P('Recorded because they are the most transferable thing this audit produced. Every one of them',
  'produced plausible output that a reader would have believed.', '');
WALKED_INTO.forEach((lines, n) => {
  P(`${n + 1}. ${lines[0]}`, ...lines.slice(1).map((l) => `   ${l}`));
});
P('');
P(`${READ_INTO.length} more were caught by the same discipline while the numbers were being read:`, '');
READ_INTO.forEach((lines) => {
  P(`- ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`));
});
P('');
P('The mutation battery exercises the three filed findings above and the instrument rules named',
  'in its generated table. It does not exercise every clean row in this document; the unexercised',
  'rows are listed under NOT COVERED instead of being claimed as proven.', '');

fs.writeFileSync(OUT, md.join('\n') + '\n');
process.stderr.write(`wrote ${OUT}\n`);

process.stderr.write(`\n${results.length} pane/viewport combinations walked\n`);
cleanup();
