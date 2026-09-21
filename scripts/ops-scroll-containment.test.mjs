/* Guards the operations dashboard against a scroll box that does not contain
   what it appears to contain.

   `overflow-x: auto` on a box makes it scroll sideways and clip what sticks
   out. That is true of ordinary in-flow content, which is why these wrappers
   look correct at a glance. It is not true of an absolutely positioned
   descendant. An absolutely positioned element is clipped by an ancestor's
   overflow only when that ancestor is in its containing-block chain, and a
   `position: static` box is not in anybody's containing-block chain. So a
   static wrapper scrolls its table and clips its table, while a tooltip, a
   menu, a focus halo, a sticky affordance or a visually hidden caption inside
   it is positioned against some card further up and escapes the scroll box
   entirely.

   Stadiora/Aria#10706 derived from the sheets that seven of the eight
   sideways-scrolling wrappers on the v2 panes are static, and recorded the
   impact as none, on the grounds that no pane draws an absolutely positioned
   child inside one. Rendering them says otherwise. Two panes draw a
   `<caption class="sr">` inside the scroller with no interaction at all --
   Problems (`div.scrollx`) and Releases (`div.tbl-scroll`) -- and the
   People pane draws four more behind a search. Their containing block is the
   card outside the wrapper, in both themes and at both widths swept here.

   Nothing paints in the wrong place today, because `.sr` in assets/aria.css is
   a one-pixel box clipped to `rect(0 0 0 0)`: it has no visible extent to
   escape with. So the containment is genuinely broken and the consequence is
   genuinely nil, which is the state an assertion is for. The next child of one
   of these wrappers that has a size is the one that pays, and nothing in this
   repository would have said so.

   WHAT THIS FILE ASSERTS, and how each claim is proved:

   1. Every box that scrolls on an axis contains, in the containing-block
      sense, every absolutely positioned descendant it has -- except the sites
      frozen in KNOWN_ESCAPES below. Proof: not `offsetParent`, which is a
      statement about the DOM. The box is made to scroll and then scrolled, and
      a descendant that belongs to it moves with it. One that is positioned
      against something outside stays exactly where it was. That is the
      observable consequence of the defect, measured rather than inferred.

   2. `offsetParent` and the scroll-follow probe agree on every descendant.
      Two independent readings of the same fact; if they ever disagree, the
      one that is wrong is this file's model of the cascade.

   3. Every frozen escape still reproduces. A baseline keyed per site rots in
      both directions: it absorbs new instances when it is keyed too coarsely,
      and it outlives its own violations when nothing checks that the entries
      are still true. An entry that stops reproducing fails this file and asks
      to be deleted, which is how the seven leave the list one at a time as
      the sheets that own them are repaired.

   4. The sweep judged a non-zero number of scroll boxes, of absolutely
      positioned descendants inside them, and of panes. A containment check
      that silently found nothing to judge is the worst failure available
      here, because it is indistinguishable from a clean board.

   5. `.sr` really is absolutely positioned, read off a rendered element
      rather than out of the stylesheet text. It is the premise the whole
      defect class rests on: if `.sr` stopped being absolute the escapes in
      KNOWN_ESCAPES would silently stop reproducing, and claim 3 would read
      that as repair.

   6. Every box that scrolls is positioned, except the wrappers frozen in
      KNOWN_STATIC_SCROLLERS -- and every frozen wrapper is still static.
      Claims 1 to 3 bind the CONSEQUENCE of the gap, which means they say
      nothing about the three swept wrappers that hold nothing absolutely
      positioned today: repairing one of those would be invisible, and an
      eighth static scroller would cost nothing to add. This is the gap
      itself, which is what the issue asked for. It is an unusual assertion
      in that it is failing-by-design against five entries that this change
      cannot repair, so the entries carry the sheet that repairs them and the
      list empties as those sheets are fixed.

   NOT COVERED, explicitly:

   - Wrappers the shared API stub never renders. Of the eight sideways
     scrolling wrappers declared across the v2 sheets, this sweep reaches
     five: `.scrollx` (Problems), `.tbl-scroll` (Releases) and the `.tbl-wrap`
     of Evaluations, Run history and Settings. `.sp-scroll` (Cloud costs) and
     People's `.tbl-wrap` are static too, but need data or an interaction this
     sweep does not drive, so they are absent from the rendered tree and this
     file judges them not at all. `.u-scroll` (Usage) is the one of the eight
     that already carries `position: relative`, and it does not render here
     either. The floors in claim 4 bind the count that IS swept; they cannot
     bind a box that never existed.
   - `position: fixed` descendants. A fixed element is positioned against the
     viewport and is not clipped by any ancestor's overflow unless that
     ancestor establishes a containing block through `transform`, `filter` or
     `contain`. That is a different rule with different repairs, and the only
     fixed box in this sweep is the navigation rail, which is itself a
     scroller rather than a descendant of one.
   - Whether an escape is VISIBLE. This file measures containment, not paint.
     Every escape it knows about today is a `.sr` caption with no visible
     extent, so a reader should not take a frozen entry as a screenshot
     waiting to happen -- it is a box that will not hold the next thing put
     in it.
   - The repair itself. Adding `position: relative` to the seven static
     wrappers is a change to pane sheets this file does not own. */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stub } from './ops-api-stub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'ops/assets/pane-registry.js';

/* ---------------------------------------------------------------- contracts */

/* Stated here rather than read from the sheets, so that a wrapper losing its
   `position: relative` changes the reading and not the expectation. */
const THEMES = ['dark', 'light'];
const STATES = ['live', 'loading', 'empty', 'degraded'];

/* Two widths for the same reason the narrow-overflow sweep uses two: a table
   that fits at a desk overflows on a phone, and a wrapper only scrolls once
   its content is wider than it is. 1280 catches the one wrapper that overflows
   even at a desk; 375 is the acceptance width the rest of this repository
   measures at. */
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 375, height: 720 }];

/* The scroll distance the follow probe asks for. A descendant of the box moves
   by exactly this much against the viewport; one positioned outside it moves by
   zero. Anything between the two is a third case this file does not model and
   would rather fail on than average away.

   A box with less room than this is scrolled by the room it has instead, down
   to MIN_SCROLL. Below that the two answers -- moved with it, did not move --
   stop being separable from subpixel layout noise, and an unseparable reading
   is reported as no reading rather than as a pass. Releases' table overflows
   by single figures at 375px, which is how this floor came to be stated. */
const SCROLL_BY = 40;
const MIN_SCROLL = 4;

/* Float slack on a rect read back after a scroll. Subpixel layout means an
   element that followed perfectly can report a hair under SCROLL_BY. */
const EPSILON = 0.5;

/* The frozen escapes, keyed per site -- pane, the box, and the descendant that
   escapes it -- rather than per pane or per file. A baseline keyed at a file
   absorbs new instances of its own defect in the files it already excuses.
   Every entry here is asserted to STILL reproduce, so the list cannot outlive
   the violations it was written for.

   Each entry names the sheet that would repair it. None of those sheets is
   editable from this change; they are held by other work in flight. */
const KNOWN_ESCAPES = [
  {
    pane: 'alerts',
    box: 'div.scrollx',
    descendant: 'caption#alertsRulesCaption.sr',
    repairIn: 'ops/assets/pane-alerts-v2.css .scrollx'
  },
  {
    pane: 'releases',
    box: 'div.tbl-scroll',
    descendant: 'caption#releasesHealthCaption.sr',
    repairIn: 'ops/assets/pane-releases-v2.css .tbl-scroll'
  }
];

/* The gap itself, as distinct from its consequence. KNOWN_ESCAPES above
   freezes the two sites where a static wrapper demonstrably fails to contain
   something; this freezes the static wrappers themselves, including the three
   that hold nothing absolutely positioned today and so produce no escape to
   detect. Without it, repairing those three would be invisible to this file
   and adding an eighth static scroller would be free.

   Stadiora/Aria#10706 asks for exactly this -- "a guard can require every
   sideways scroller to be positioned without naming any class" -- so the box
   is found by its own computed overflow and matched on the selector it
   rendered with, not on a list of class names kept in step by hand.

   Every entry is asserted to STILL be static, so an entry outliving its own
   repair fails this file and asks to be deleted. That is how the seven leave
   the list one at a time as the sheets that own them are fixed. */
const KNOWN_STATIC_SCROLLERS = [
  { pane: 'alerts', box: 'div.scrollx', repairIn: 'ops/assets/pane-alerts-v2.css .scrollx' },
  { pane: 'evals', box: 'div.tbl-wrap', repairIn: 'ops/assets/pane-evaluations-v2.css .tbl-wrap' },
  { pane: 'history', box: 'div.tbl-wrap', repairIn: 'ops/assets/pane-run-history-v2.css .tbl-wrap' },
  { pane: 'releases', box: 'div.tbl-scroll', repairIn: 'ops/assets/pane-releases-v2.css .tbl-scroll' },
  { pane: 'settings', box: 'div.tbl-wrap', repairIn: 'ops/assets/pane-settings-v2.css .tbl-wrap' }
];

/* A form control that scrolls its own value is not a layout wrapper and has no
   containing-block question to answer, so it is out of scope rather than
   excused: a <textarea> scrolls by definition and cannot hold a positioned
   descendant at all. */
const NOT_A_WRAPPER = /^(textarea|input|select)/;

/* Floors. Each is the count observed on the tree this file was written
   against, less nothing -- they are not a target, they are the line under
   which the sweep has stopped sweeping. They are deliberately below the
   observed numbers so that a pane legitimately dropping a table does not fail
   them, and deliberately above zero so that a sweep judging nothing does. */
const PANE_FLOOR = 10;
const SCROLLER_FLOOR = 8;
const ABSOLUTE_DESCENDANT_FLOOR = 2;

/* Claim 6 carries its own floor rather than borrowing SCROLLER_FLOOR, because
   it judges a different population: distinct wrapper SITES, after the
   out-of-scope hatch has run. Without it, widening that hatch or excusing
   every site would leave the claim nothing to judge, and a claim with nothing
   to judge passes. 15 distinct sites are observed; this sits under that so a
   pane legitimately dropping a table does not fail it. */
const WRAPPER_FLOOR = 10;

/* ------------------------------------------------------------------ panes */

/* Out of the registry both shells boot from, not out of a second list kept in
   step by hand, so a pane cannot join the app without joining this sweep. */
function readRegistry() {
  const src = fs.readFileSync(path.join(ROOT, REGISTRY), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: REGISTRY });
  const registry = sandbox.window.OpsPaneRegistry;
  if (!registry || !registry.PANES) {
    throw new Error(`${REGISTRY} defined no window.OpsPaneRegistry.PANES`);
  }
  return registry.PANES;
}

const DECLARED = readRegistry();
const PAGES = Object.keys(DECLARED).map((key) => ({ key, url: '/ops/' + DECLARED[key].file }));

/* ----------------------------------------------------------------- server */

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(stub(url.pathname)));
    return;
  }
  const file = path.join(ROOT, url.pathname.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

/* -------------------------------------------------------------------- CDP */

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH, process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'
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

async function devtools(port, pathname, method) {
  for (let i = 0; i < 150; i++) {
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === undefined) return;
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(JSON.stringify(m.error)));
    else p.resolve(m.result);
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

/* ------------------------------------------------------------- page probe */

/* Runs in the page. Finds every box that scrolls on an axis by its own
   computed overflow -- never by class name, because the class names differ per
   sheet and a box that joined the pattern under a new name is exactly what
   this is for -- and reports, for each absolutely positioned descendant,
   whether the box contains it.

   Two independent readings per descendant:

     offsetParent -- the nearest positioned ancestor, which for a non-fixed
       element IS its containing block. A statement about the DOM.

     followed -- the box is scrolled by SCROLL_BY and the descendant's
       viewport rect is read again. A descendant of the box moves with the
       content; one positioned against an ancestor outside the box does not,
       because scrolling is not relayout and its used position was resolved
       against a box that did not move. A statement about what a browser
       actually does, which is the thing the defect is.

   `followed` is null when the box cannot scroll that far, which happens at
   the wider viewport for tables that only overflow on a phone. The reading is
   then offsetParent alone, and the sweep says so rather than implying a
   proof it did not run. */
const PROBE = (scrollBy, minScroll) => `(() => {
  const SCROLL_BY = ${scrollBy};
  const MIN_SCROLL = ${minScroll};
  const label = (el) => el.tagName.toLowerCase() +
    (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\\s+/).join('.') : '');

  const scrollers = [];
  for (const box of document.querySelectorAll('*')) {
    const cs = getComputedStyle(box);
    const axisX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    const axisY = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    if (!axisX && !axisY) continue;
    if (!box.getClientRects().length) continue;

    const descendants = [];
    for (const d of box.querySelectorAll('*')) {
      const ds = getComputedStyle(d);
      /* The position filter runs BEFORE offsetParent is read, and the order is
         load-bearing rather than incidental. offsetParent is not "the nearest
         positioned ancestor": for a STATIC element the HTML spec also returns
         the nearest td, th or table, so a static child of any cell in these
         tables reports its own cell and would look contained no matter where
         its containing block really is. That extra clause is conditioned on
         the element itself being static, so once this line has kept only
         absolutely positioned descendants, offsetParent is the containing
         block. Measured on an unmutated tree: an absolutely positioned div in
         an alerts rule cell reports offsetParent div.card.rules-card, while
         the same div left static reports its td. T4 in the mutation battery
         is this line's proof -- change the keyword it looks for and every
         reading disappears. */
      if (ds.position !== 'absolute') continue;
      if (!d.getClientRects().length) continue;
      const op = d.offsetParent;
      descendants.push({
        el: label(d),
        offsetParent: op ? label(op) : '(none)',
        containedByOffsetParent: op === box || (op !== null && box.contains(op)),
        beforeX: d.getBoundingClientRect().left,
        beforeY: d.getBoundingClientRect().top,
        node: d
      });
    }

    const room = { x: box.scrollWidth - box.clientWidth, y: box.scrollHeight - box.clientHeight };
    const axis = (axisX && room.x >= MIN_SCROLL) ? 'x' : (axisY && room.y >= MIN_SCROLL) ? 'y' : null;
    if (axis && descendants.length) {
      const key = axis === 'x' ? 'scrollLeft' : 'scrollTop';
      const was = box[key];
      box[key] = was + Math.min(SCROLL_BY, room[axis]);
      const moved = box[key] - was;
      for (const d of descendants) {
        const r = d.node.getBoundingClientRect();
        d.movedBy = axis === 'x' ? d.beforeX - r.left : d.beforeY - r.top;
        d.scrolledBy = moved;
      }
      box[key] = was;
    }

    scrollers.push({
      box: label(box),
      position: cs.position,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      scrollAxis: axis,
      descendants: descendants.map((d) => ({
        el: d.el,
        offsetParent: d.offsetParent,
        containedByOffsetParent: d.containedByOffsetParent,
        movedBy: d.movedBy === undefined ? null : d.movedBy,
        scrolledBy: d.scrolledBy === undefined ? null : d.scrolledBy
      }))
    });
  }

  /* The premise the whole defect class rests on, read off a rendered element
     rather than out of the stylesheet's text. A probe is drawn only if the
     page has no .sr of its own, so the usual reading is a real one. */
  let srProbe = document.querySelector('.sr');
  let borrowed = false;
  if (!srProbe) {
    srProbe = document.createElement('span');
    srProbe.className = 'sr';
    document.body.appendChild(srProbe);
    borrowed = true;
  }
  const srPosition = getComputedStyle(srProbe).position;
  if (borrowed) srProbe.remove();

  return {
    path: location.pathname,
    drew: document.querySelectorAll('#content *').length,
    srPosition,
    srWasBorrowed: borrowed,
    scrollers
  };
})()`;

/* ------------------------------------------------------------------ sweep */

let browser = null;
let cdp = null;
let profile = null;
const readings = [];
const panesSeen = new Set();
let srPositions = new Set();

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  profile = fs.mkdtempSync(path.join(fs.realpathSync(process.env.RUNNER_TEMP || ROOT), 'scroll-'));
  browser = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'
  ], { stdio: 'ignore' });

  const port = await devtoolsPort(profile);
  const tab = await devtools(port, '/json/new?about:blank', 'PUT');
  cdp = connect(tab.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  /* Seeded before the document runs rather than after, because the shell
     decides both its session and its theme before it paints: set afterwards
     and every pane answers with the sign-in page instead, which has no tables
     and would make this sweep pass by having nothing to judge. */
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      `localStorage.setItem('ops-api-base', ${JSON.stringify(base)});` +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));"
  });

  for (const page of PAGES) {
    for (const viewport of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false
      });
      for (const theme of THEMES) {
        await cdp.send('Page.navigate', { url: `${base}/ops/index.html` });
        await new Promise((r) => setTimeout(r, 250));
        await cdp.send('Runtime.evaluate', {
          expression: `try { localStorage.setItem('ops-theme', ${JSON.stringify(theme)}); } catch (e) {}`
        });
        await cdp.send('Page.navigate', { url: base + page.url });
        await new Promise((r) => setTimeout(r, 1500));
        for (const state of STATES) {
          await cdp.send('Runtime.evaluate', {
            expression: `window.Aria && window.Aria.applyState && window.Aria.applyState(${JSON.stringify(state)})`
          });
          await new Promise((r) => setTimeout(r, 200));
          const res = await cdp.send('Runtime.evaluate', {
            expression: `JSON.stringify(${PROBE(SCROLL_BY, MIN_SCROLL)})`, returnByValue: true
          });
          const got = JSON.parse(res.result.value || 'null');
          if (!got) throw new Error(`${page.key} returned no probe result`);
          srPositions.add(got.srPosition);
          panesSeen.add(page.key);
          for (const s of got.scrollers) {
            readings.push({ pane: page.key, theme, state, width: viewport.width, ...s });
          }
        }
      }
    }
  }

  const withAbs = readings.filter((r) => r.descendants.length);
  const escapes = withAbs.flatMap((r) => r.descendants
    .filter((d) => !d.containedByOffsetParent)
    .map((d) => `${r.pane} ${r.box} <- ${d.el}`));
  console.log(`# swept ${panesSeen.size} panes x ${THEMES.length} themes x ${STATES.length} ` +
    `states x ${VIEWPORTS.length} widths: ${readings.length} scroll-box observation(s), ` +
    `${withAbs.length} holding an absolutely positioned descendant, ` +
    `${new Set(escapes).size} distinct escape(s)`);
  for (const e of [...new Set(escapes)].sort()) console.log(`#   escapes: ${e}`);

  /* The rendered half of the check reports its own reach, because a probe that
     drove nothing and a board with nothing to drive read the same from a log. */
  const sites = new Set(readings.filter((r) => !NOT_A_WRAPPER.test(r.box))
    .map((r) => `${r.pane} ${r.box}`));
  const staticSites = new Set(readings
    .filter((r) => !NOT_A_WRAPPER.test(r.box) && r.position === 'static')
    .map((r) => `${r.pane} ${r.box}`));
  console.log(`#   ${sites.size} distinct scrolling wrapper site(s), ` +
    `${staticSites.size} of them position: static`);
  const drivenObs = readings.flatMap((r) => r.descendants.filter((d) => d.movedBy !== null));
  const followed = drivenObs.filter((d) => Math.abs(d.movedBy - d.scrolledBy) <= EPSILON).length;
  const stayed = drivenObs.filter((d) => Math.abs(d.movedBy) <= EPSILON).length;
  console.log(`#   scroll-follow drove ${drivenObs.length} descendant observation(s): ` +
    `${followed} moved with the box, ${stayed} stayed behind it`);
});

after(async () => {
  if (cdp) cdp.close();
  if (browser) browser.kill();
  server.close();
  /* The browser unlinks its own lock files as it exits, so a profile removed
     the instant after kill() can still be non-empty. */
  await new Promise((r) => setTimeout(r, 300));
  if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/* ------------------------------------------------------------------ tests */

const frozen = (pane, box, el) => KNOWN_ESCAPES.find(
  (k) => k.pane === pane && k.box === box && k.descendant === el);

test('every scroll box is the containing block for its absolutely positioned children', () => {
  const unexpected = new Map();
  for (const r of readings) {
    for (const d of r.descendants) {
      if (d.containedByOffsetParent) continue;
      if (frozen(r.pane, r.box, d.el)) continue;
      const key = `${r.pane} ${r.box} <- ${d.el}`;
      if (!unexpected.has(key)) {
        unexpected.set(key, `${r.pane}: ${d.el} is positioned against ` +
          `${d.offsetParent}, which is outside the scroll box ${r.box} ` +
          `(position: ${r.position}, overflow-x: ${r.overflowX}). ` +
          `The box scrolls it but cannot clip it. Give ${r.box} a non-static ` +
          `position, or add the site to KNOWN_ESCAPES with the sheet that repairs it. ` +
          `[${r.theme} theme, ${r.state} state, ${r.width}px]`);
      }
    }
  }
  assert.deepEqual([...unexpected.values()], [],
    `${unexpected.size} absolutely positioned element(s) escape a scroll box that is not frozen`);
});

test('the scroll-follow probe agrees with offsetParent on every descendant it could drive', () => {
  const disagreements = [];
  for (const r of readings) {
    for (const d of r.descendants) {
      if (d.movedBy === null) continue;
      const followed = Math.abs(d.movedBy - d.scrolledBy) <= EPSILON;
      const stayed = Math.abs(d.movedBy) <= EPSILON;
      if (!followed && !stayed) {
        disagreements.push(`${r.pane} ${r.box} <- ${d.el} moved ${d.movedBy.toFixed(2)}px ` +
          `when the box scrolled ${d.scrolledBy}px, which is neither following it nor ignoring it`);
        continue;
      }
      if (followed !== d.containedByOffsetParent) {
        disagreements.push(`${r.pane} ${r.box} <- ${d.el}: offsetParent says ` +
          `${d.containedByOffsetParent ? 'contained' : 'escaped'} (${d.offsetParent}) but scrolling ` +
          `the box ${d.scrolledBy}px moved it ${d.movedBy.toFixed(2)}px, which says ` +
          `${followed ? 'contained' : 'escaped'} [${r.theme}, ${r.state}, ${r.width}px]`);
      }
    }
  }
  assert.deepEqual(disagreements, [],
    'the DOM reading and the rendered reading disagree about containment');
});

test('every frozen static scroller is still static, and every other scroller is positioned', () => {
  const stale = [];
  const unexpected = new Map();
  const judged = new Set();
  for (const r of readings) {
    if (NOT_A_WRAPPER.test(r.box)) continue;
    judged.add(`${r.pane} ${r.box}`);
    const excused = KNOWN_STATIC_SCROLLERS
      .some((k) => k.pane === r.pane && k.box === r.box);
    if (r.position === 'static' && !excused) {
      const key = `${r.pane} ${r.box}`;
      if (!unexpected.has(key)) {
        unexpected.set(key, `${r.pane}: ${r.box} scrolls (overflow-x: ${r.overflowX}, ` +
          `overflow-y: ${r.overflowY}) but is position: static, so it establishes no ` +
          `containing block and clips no absolutely positioned descendant. Give it ` +
          `position: relative. [${r.theme} theme, ${r.state} state, ${r.width}px]`);
      }
    }
  }
  for (const k of KNOWN_STATIC_SCROLLERS) {
    const seen = readings.filter((r) => r.pane === k.pane && r.box === k.box);
    if (!seen.length) continue;
    if (seen.every((r) => r.position !== 'static')) {
      stale.push(`${k.pane} ${k.box} is no longer static. If ${k.repairIn} was given a ` +
        `position, delete this entry from KNOWN_STATIC_SCROLLERS; an excuse that outlives ` +
        `its own repair silently excuses the next regression at the same site.`);
    }
  }
  assert.ok(judged.size >= WRAPPER_FLOOR,
    `this claim judged ${judged.size} distinct scrolling wrapper(s), under the floor of ` +
    `${WRAPPER_FLOOR}. Widening the out-of-scope hatch or excusing sites wholesale would ` +
    `otherwise leave nothing to judge, and a claim with nothing to judge passes.`);
  assert.deepEqual(stale, [], 'a frozen static scroller was repaired but is still excused');
  assert.deepEqual([...unexpected.values()], [],
    `${unexpected.size} sideways-scrolling wrapper(s) are position: static and not frozen`);
});

test('every frozen escape still reproduces, and is proved by scrolling the box', () => {
  const missing = [];
  const unproved = [];
  for (const k of KNOWN_ESCAPES) {
    const hits = readings.filter((r) => r.pane === k.pane && r.box === k.box)
      .flatMap((r) => r.descendants
        .filter((d) => d.el === k.descendant && !d.containedByOffsetParent)
        .map((d) => ({ r, d })));
    if (!hits.length) {
      missing.push(`${k.pane} ${k.box} <- ${k.descendant} no longer escapes. ` +
        `If ${k.repairIn} was repaired, delete this entry from KNOWN_ESCAPES; ` +
        `a baseline that outlives its violation hides the next one.`);
      continue;
    }
    const driven = hits.filter(({ d }) => d.movedBy !== null);
    if (!driven.length) {
      unproved.push(`${k.pane} ${k.box} <- ${k.descendant} was seen escaping, but no ` +
        `observation could scroll the box at least ${MIN_SCROLL}px, so nothing demonstrated it`);
      continue;
    }
    const followedAnyway = driven.filter(({ d }) => Math.abs(d.movedBy - d.scrolledBy) <= EPSILON);
    if (followedAnyway.length) {
      unproved.push(`${k.pane} ${k.box} <- ${k.descendant} moved with the box after all`);
    }
  }
  assert.deepEqual(missing, [], 'a frozen escape stopped reproducing');
  assert.deepEqual(unproved, [], 'a frozen escape was never demonstrated by scrolling');
});

test('the sweep judged panes, scroll boxes and absolutely positioned children', () => {
  const scrollers = new Set(readings.map((r) => `${r.pane} ${r.box}`));
  const abs = new Set(readings.flatMap((r) => r.descendants.map((d) => `${r.pane} ${r.box} <- ${d.el}`)));
  const driven = readings.filter((r) => r.descendants.some((d) => d.movedBy !== null));

  assert.ok(panesSeen.size >= PANE_FLOOR,
    `the sweep reached ${panesSeen.size} pane(s), below the declared floor of ${PANE_FLOOR}`);
  assert.ok(scrollers.size >= SCROLLER_FLOOR,
    `the sweep found ${scrollers.size} distinct scroll box(es), below the declared floor of ${SCROLLER_FLOOR}`);
  assert.ok(abs.size >= ABSOLUTE_DESCENDANT_FLOOR,
    `the sweep found ${abs.size} absolutely positioned descendant(s) inside a scroll box, ` +
    `below the declared floor of ${ABSOLUTE_DESCENDANT_FLOOR} — a containment check with ` +
    `nothing to contain passes without judging anything`);
  assert.ok(driven.length > 0,
    'no observation could scroll a box holding an absolutely positioned descendant, so the ' +
    'rendered half of this check never ran and only the DOM reading remained');
});

test('.sr is absolutely positioned, which is what lets it escape a static scroll box', () => {
  assert.deepEqual([...srPositions], ['absolute'],
    'the .sr utility in ops/assets/aria.css is what every frozen escape in this file is made of. ' +
    'If it stops being absolutely positioned those escapes stop reproducing, and the frozen-entry ' +
    'check above would read that as the sheets having been repaired.');
});
