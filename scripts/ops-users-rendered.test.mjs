/* Look up a user, measured in a browser rather than read out of a file.
 *
 * scripts/ops-users-v2.test.mjs is a node:vm harness with no layout engine: it
 * cannot tell a rule that applies from one that is overridden, and it cannot
 * see a pixel. Three things on this pane are only true as drawn, and each has
 * shipped broken before with every other check green (Stadiora/Aria#10456, the
 * picked row painted nothing; #10648, the pressed control looked like the one
 * beside it; the 14px / 44px floors, which a stylesheet can state and a
 * later rule can undo):
 *
 *   1. the account picker: every state of the pick control, resting and under
 *      the pointer, picked and not, reads at WCAG AA over the paint that is
 *      really behind it, in both themes;
 *   2. selection is not colour alone: the picked control differs from the
 *      other one in weight and carries the word "Selected";
 *   3. the layout: at 320, 360, 375 and 390 the pane does not run past the
 *      screen, every control is 44px tall and no text is under 14px, and at
 *      1536 the cards sit two to a row.
 *
 * It serves the real page, answers the operations API from
 * scripts/ops-api-stub.mjs (the "many matches" scene, so what is measured is
 * what the screenshots show), drives a lookup and a pick, and reads computed
 * geometry and rendered PIXELS back out of Chrome. Contrast is measured on a
 * screenshot with every glyph lifted, so what is sampled is the paint UNDER
 * the text, composited by the browser, wash and all. Nothing is cloned or
 * re-parented.
 *
 * FAILS CLOSED. No Chrome, no stub answer, a pane that never reaches the picked
 * state: each throws while this module loads and node --test reports the file
 * as failed. There is no skip path.
 *
 * NOT COVERED: forced-colours; the reveal request itself (scripts/ops-users-v2
 * and ops-diagnostic-mask-sweep own it); the focus ring (scripts/
 * ops-focus-ring-census.test.mjs); any width between the four phone widths and
 * 1536.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stub, USER_REF } from './ops-api-stub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = '/ops/users.html';
const THEMES = ['dark', 'light'];
const PHONES = [320, 360, 375, 390];
const DESKTOP = 1536;
const AA_TEXT = 4.5;
const MIN_TAP = 44;
const MIN_TEXT = 14;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function luminance([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [hi, lo] = [a, b].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/* Chromium serialises a color-mix() as color(srgb r g b / a). A parser that
   understands only rgb() drops those in silence, so anything unreadable is
   refused by name. Ink with alpha is refused too: its contrast depends on
   what is behind it, and reading it as solid errs in the direction that hides
   a defect. */
function opaqueInk(value) {
  const alpha = /^rgba?\([^)]*[\s,/]+([\d.]+)\s*\)$/i.exec(value)
    || /^color\(srgb[^)]*\/\s*([\d.]+)\s*\)$/i.exec(value);
  if (alpha && Number(alpha[1]) < 1) throw new Error('the ink ' + value + ' is translucent');
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
  throw new Error('cannot resolve colour: ' + value);
}
const round = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ chrome */

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH, process.env.CHROME_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH. This check ' +
    'measures rendered pixels and has no meaning without a browser, so it ' +
    'fails rather than skipping.');
}

async function devtoolsPort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    try { const p = Number(fs.readFileSync(file, 'utf8').split('\n')[0]); if (p > 0) return p; }
    catch { /* the browser has not written it yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtoolsJson(port, pathname) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}${pathname}`); if (r.ok) return await r.json(); }
    catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never opened its DevTools endpoint');
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const waiters = [];
  let seen = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
      return;
    }
    seen.add(m.method);
    for (const w of waiters.splice(0)) w(m.method);
  };
  return {
    ready: new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),
    close: () => { try { ws.close(); } catch { /* already gone */ } },
    reset() { seen = new Set(); },
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
    },
    once(method, timeoutMs = 30000) {
      if (seen.has(method)) return Promise.resolve();
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('timed out waiting for ' + method)), timeoutMs);
        const check = (m) => { if (m === method) { clearTimeout(timer); res(); } else waiters.push(check); };
        waiters.push(check);
      });
    },
  };
}

/* ------------------------------------------------------ in-page programmes */

/* From the landing state to a populated match list with the first match
   picked and its record drawn. The form is filled through the native value
   setter and submitted with requestSubmit, and the control is clicked, so
   everything the pane does on a pick actually happens. */
const DRIVE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (sel) => { for (let i = 0; i < 160; i++) { if (document.querySelector(sel)) return true; await sleep(50); } return false; };
  const id = document.getElementById('lookupIdentifier');
  const reason = document.getElementById('lookupReason');
  if (!id || !reason) return 'the lookup form is not on the page';
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(id, ${JSON.stringify(USER_REF)});
  set(reason, 'Support ticket 1042');
  id.form.requestSubmit();
  if (!(await until('.match-row-btn'))) return 'the lookup drew no matches';
  if (document.querySelectorAll('.match-row-btn').length < 2) return 'the scene drew one match, so there is nothing to compare a pick with';
  document.querySelector('.match-row-btn').click();
  if (!(await until('.match-row.is-selected'))) return 'the pick never selected a row';
  if (!(await until('.u-head'))) return 'the pick never drew the account';
  await sleep(500);
  return 'ok';
})()`;

/* Open what a phone has to be able to reach: the filters and the reveal form.
   Clicked, never forced, so the controls drawn are the ones a person gets. */
const OPEN_EVERYTHING = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const filters = document.querySelector('.u-link[aria-controls="lookupFilters"]');
  if (filters && filters.getAttribute('aria-expanded') !== 'true') filters.click();
  const reveal = document.querySelector('.u-act:not([disabled])');
  if (reveal && !document.querySelector('.reveal-form')) reveal.click();
  await sleep(300);
  return JSON.stringify({
    filters: !!filters && filters.getAttribute('aria-expanded') === 'true',
    reveal: !!document.querySelector('.reveal-form')
  });
})()`;

const LIFT_GLYPHS = `(() => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('*, *::before, *::after { color: transparent !important;' +
    ' -webkit-text-fill-color: transparent !important; text-shadow: none !important; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  globalThis.__lift = sheet;
})()`;
const DROP_GLYPHS = `(() => {
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== globalThis.__lift);
})()`;

const SITE = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const btn = el.closest('.match-row-btn') || el;
  const b = btn.getBoundingClientRect();
  return JSON.stringify({
    x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height,
    cx: b.x + b.width / 2, cy: b.y + b.height / 2,
    ink: getComputedStyle(el).color, text: el.textContent.trim(),
    hovered: btn.matches(':hover')
  });
})()`;

/* The worst pixel under the text, as a luminance. Read inside Chrome from the
   PNG Chrome just produced: users.html allows img-src data:, and a canvas
   reads the decoded pixels back, so no PNG decoder lives in this file. */
const WORST_UNDER = (b64, inkLum) => `(async () => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)};
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const ink = ${inkLum};
  let worst = Infinity, worstLum = 0, n = 0, lo = 1, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const L = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    const r = (Math.max(L, ink) + 0.05) / (Math.min(L, ink) + 0.05);
    if (r < worst) { worst = r; worstLum = L; }
    if (L < lo) lo = L; if (L > hi) hi = L;
    n++;
  }
  return JSON.stringify({ worst, worstLum, n, lo, hi });
})()`;

const STYLE = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return JSON.stringify({
    fontWeight: Number(cs.fontWeight), display: cs.display,
    visible: cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
    ariaPressed: el.getAttribute('aria-pressed'), text: el.textContent.trim()
  });
})()`;

/* What overflows, what is too small to hit and what is too small to read, in
   the pane as it stands. The pane has no scroll box of its own, so anything
   that sits past the screen's edge is a defect and not a scrolled-away
   column. Visually hidden nodes are 1px by design and are skipped. */
const MEASURE = `(() => {
  const root = document.querySelector('.users');
  const vw = document.documentElement.clientWidth;
  const shown = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1 ? r : null;
  };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  const out = { vw, docScroll: document.documentElement.scrollWidth, beyond: [], short: [], tiny: [], controls: 0, texts: 0 };
  for (const el of root.querySelectorAll('*')) {
    const r = shown(el);
    if (!r) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) out.beyond.push(name(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  for (const el of root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')) {
    const r = shown(el);
    if (!r) continue;
    out.controls++;
    if (r.height < ${MIN_TAP} - 0.5) out.short.push(name(el) + ' ' + Math.round(r.height * 10) / 10);
  }
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.data.trim() || !n.parentElement || !shown(n.parentElement)) continue;
    out.texts++;
    const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
    if (fs < ${MIN_TEXT} - 0.01) out.tiny.push(name(n.parentElement) + ' ' + fs + 'px "' + n.data.trim().slice(0, 24) + '"');
  }
  const g2 = [...root.querySelectorAll('.grid.g2')].map((g) => [...g.children].map((c) => {
    const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width };
  }));
  out.g2 = g2;
  return JSON.stringify(out);
})()`;

/* --------------------------------------------------------------- the run */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    const body = stub(url.pathname, url.search, { scene: 'users-many' });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
    return;
  }
  const abs = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});

/* The pick control in every state, and the text beside it that sits on the
   same wash. `hover` names the element the pointer rests on, or null. */
const PICK_SITES = {
  'unpicked, at rest': { site: '.match-row:not(.is-selected) .match-row-btn .code', hover: null },
  'unpicked, under the pointer': { site: '.match-row:not(.is-selected) .match-row-btn .code', hover: true },
  'picked, at rest': { site: '.match-row.is-selected .match-row-btn .code', hover: null },
  'picked, under the pointer': { site: '.match-row.is-selected .match-row-btn .code', hover: true },
  'picked row, the word Selected': { site: '.match-row.is-selected .sel-mark', hover: null },
  'picked row, its facts': { site: '.match-row.is-selected .u-dim', hover: null },
  'unpicked row, its facts': { site: '.match-row:not(.is-selected) .u-dim', hover: null },
};

const census = {};
let browser = null;
let cdp = null;
let profile = null;

try {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  profile = fs.mkdtempSync(path.join(process.env.TMPDIR || ROOT, '.ops-users-rendered-'));
  browser = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu',
    '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--force-prefers-reduced-motion', 'about:blank',
  ], { stdio: 'ignore' });

  const port = await devtoolsPort(profile);
  const target = (await devtoolsJson(port, '/json/list')).find((t) => t.type === 'page');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const evaluate = async (expression) => {
    const res = await cdp.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'the in-page probe threw');
    }
    return res.result.value;
  };
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  const viewport = async (width, height, mobile) => {
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile });
    await settle(400);
  };

  /* The paint under one site's glyphs, in the pointer state asked for. The
     pointer is moved with a real mouse event: CSS :hover answers to nothing
     else, and the page reports back whether it is hovered so a pointer that
     missed fails here rather than measuring the resting state twice. */
  const paintUnder = async (name, { site, hover }) => {
    const first = await evaluate(SITE(site));
    if (!first) throw new Error(`no element for "${name}" (${site})`);
    const at = JSON.parse(first);
    if (hover) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.cx, y: at.cy });
    else await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    await settle(250);
    const probe = JSON.parse(await evaluate(SITE(site)));
    assert.equal(probe.hovered, Boolean(hover), `"${name}": the pointer is ${hover ? 'not on' : 'still on'} the control`);
    const ink = opaqueInk(probe.ink);
    await evaluate(LIFT_GLYPHS);
    await settle(100);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: probe.x, y: probe.y, width: Math.ceil(probe.w), height: Math.ceil(probe.h), scale: 1 },
    });
    await evaluate(DROP_GLYPHS);
    const read = JSON.parse(await evaluate(WORST_UNDER(shot.data, luminance(ink))));
    return { text: probe.text, ink: probe.ink, hovered: probe.hovered, ...read,
      ratio: round(ratio(luminance(ink), read.worstLum)) };
  };

  let initScript = null;
  for (const theme of THEMES) {
    if (initScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
    /* The theme and the API base have to be in storage before the document's
       first script runs. Emulated media is the OPPOSITE theme, because
       theme.js falls back to prefers-color-scheme and matching the two would
       make a failed storage write look like a success. */
    initScript = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'try {' +
        "localStorage.setItem('ops-api-base', " + JSON.stringify(origin) + ');' +
        "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
        "localStorage.setItem('ops-theme', " + JSON.stringify(theme) + ');' +
        '} catch (e) {}',
    })).identifier;
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }],
    });
    await viewport(DESKTOP, 1400, false);
    cdp.reset();
    /* A hidden document produces no animation frames, so the second pass
       would render nothing without this. */
    await cdp.send('Page.bringToFront');
    await cdp.send('Page.navigate', { url: origin + PAGE });
    await cdp.once('Page.loadEventFired');
    await settle(800);

    const drove = await evaluate(DRIVE);
    if (drove !== 'ok') throw new Error(`[${theme}] ${PAGE}: ${drove}`);
    const drawn = await evaluate('document.documentElement.getAttribute("data-theme")');
    if (drawn !== theme) throw new Error(`[${theme}] the page drew with data-theme="${drawn}"`);

    const styles = {
      picked: JSON.parse(await evaluate(STYLE('.match-row.is-selected .match-row-btn .code'))),
      unpicked: JSON.parse(await evaluate(STYLE('.match-row:not(.is-selected) .match-row-btn .code'))),
      button: JSON.parse(await evaluate(STYLE('.match-row.is-selected .match-row-btn'))),
      mark: JSON.parse(await evaluate(STYLE('.match-row.is-selected .sel-mark'))),
      otherMark: await evaluate('document.querySelectorAll(".match-row:not(.is-selected) .sel-mark").length'),
      pressedCount: await evaluate('document.querySelectorAll(\'.match-row-btn[aria-pressed="true"]\').length'),
    };

    const paint = {};
    for (const [name, spec] of Object.entries(PICK_SITES)) paint[name] = await paintUnder(name, spec);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });

    const wide = JSON.parse(await evaluate(MEASURE));

    const phones = {};
    for (const width of PHONES) {
      await viewport(width, 900, true);
      const opened = JSON.parse(await evaluate(OPEN_EVERYTHING));
      await settle(200);
      phones[width] = { opened, ...JSON.parse(await evaluate(MEASURE)) };
    }
    census[theme] = { styles, paint, wide, phones };
  }
} catch (err) {
  await shutdown();
  throw err;
}

await shutdown();

if (process.env.OPS_RENDERED_CENSUS) process.stdout.write(JSON.stringify(census, null, 2) + '\n');

async function shutdown() {
  if (cdp) cdp.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const gone = new Promise((r) => {
      const timer = setTimeout(() => r(false), 5000);
      browser.once('exit', () => { clearTimeout(timer); r(true); });
    });
    browser.kill();
    if (!(await gone)) browser.kill('SIGKILL');
  }
  if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } }
  await new Promise((r) => server.close(r));
}

/* ---------------------------------------------------------------- the checks */

test('both themes reached a picked account and every probe read something', () => {
  assert.deepEqual(Object.keys(census).sort(), [...THEMES].sort());
  for (const theme of THEMES) {
    const c = census[theme];
    assert.deepEqual(Object.keys(c.paint), Object.keys(PICK_SITES));
    for (const [name, p] of Object.entries(c.paint)) {
      assert.ok(p.n >= 100, `[${theme}] "${name}" sampled ${p.n} pixels, too few to be a surface`);
      assert.ok(p.text, `[${theme}] "${name}" read no text`);
    }
    assert.deepEqual(Object.keys(c.phones).map(Number), PHONES);
    for (const width of PHONES) {
      assert.deepEqual(c.phones[width].opened, { filters: true, reveal: true },
        `[${theme}] ${width}px: the filters and the reveal form were not both open`);
      assert.ok(c.phones[width].controls >= 8, `[${theme}] ${width}px measured ${c.phones[width].controls} controls`);
      assert.ok(c.phones[width].texts >= 30, `[${theme}] ${width}px measured ${c.phones[width].texts} text runs`);
      assert.equal(c.phones[width].vw, width, `[${theme}] the viewport is ${c.phones[width].vw}, not ${width}`);
    }
  }
});

for (const theme of THEMES) {
  test(`[${theme}] the pick control reads at AA in every state, over the paint that is there`, () => {
    for (const [name, p] of Object.entries(census[theme].paint)) {
      assert.ok(p.ratio >= AA_TEXT,
        `[${theme}] "${name}" (${p.text}) reads ${p.ratio}:1 over its worst pixel, under ${AA_TEXT}:1`);
    }
  });

  test(`[${theme}] the pointer changes what is under an unpicked and a picked control`, () => {
    const { paint } = census[theme];
    for (const [rest, over] of [['unpicked, at rest', 'unpicked, under the pointer'],
      ['picked, at rest', 'picked, under the pointer']]) {
      assert.notEqual(round(paint[rest].worstLum), round(paint[over].worstLum),
        `[${theme}] "${over}" is painted exactly as "${rest}", so hover does nothing`);
    }
  });

  test(`[${theme}] picking is not colour alone: weight and the word Selected carry it`, () => {
    const { styles } = census[theme];
    assert.equal(styles.pressedCount, 1, `[${theme}] ${styles.pressedCount} controls are pressed, not one`);
    assert.equal(styles.button.ariaPressed, 'true');
    assert.ok(styles.picked.fontWeight > styles.unpicked.fontWeight,
      `[${theme}] the picked reference is ${styles.picked.fontWeight}, the other ${styles.unpicked.fontWeight}`);
    assert.ok(styles.mark.visible && /Selected/.test(styles.mark.text),
      `[${theme}] the word Selected is not drawn on the picked row`);
    assert.equal(styles.otherMark, 0, `[${theme}] the word Selected is also on an unpicked row`);
  });

  test(`[${theme}] cards sit two to a row on a wide screen and stack on a phone`, () => {
    const { wide, phones } = census[theme];
    assert.ok(wide.g2.length >= 2, `[${theme}] found ${wide.g2.length} card pairs`);
    for (const [a, b] of wide.g2) {
      assert.ok(Math.abs(a.y - b.y) < 2 && b.x > a.x + a.w - 2, `[${theme}] a pair is not side by side at ${DESKTOP}`);
    }
    for (const width of PHONES) {
      for (const [a, b] of phones[width].g2) {
        assert.ok(b.y > a.y && Math.abs(a.x - b.x) < 2, `[${theme}] a pair is not stacked at ${width}`);
      }
    }
  });

  for (const width of PHONES) {
    test(`[${theme}] at ${width}px nothing runs past the screen, every control is ${MIN_TAP}px and no text is under ${MIN_TEXT}px`, () => {
      const m = census[theme].phones[width];
      assert.ok(m.docScroll <= m.vw, `[${theme}] ${width}px: the page scrolls sideways (${m.docScroll} > ${m.vw})`);
      assert.deepEqual(m.beyond, [], `[${theme}] ${width}px: past the edge`);
      assert.deepEqual(m.short, [], `[${theme}] ${width}px: controls under ${MIN_TAP}px`);
      assert.deepEqual(m.tiny, [], `[${theme}] ${width}px: text under ${MIN_TEXT}px`);
    });
  }

  test(`[${theme}] at ${DESKTOP}px nothing runs past the screen and no text is under ${MIN_TEXT}px`, () => {
    const m = census[theme].wide;
    assert.ok(m.docScroll <= m.vw, `[${theme}] the page scrolls sideways`);
    assert.deepEqual(m.beyond, []);
    assert.deepEqual(m.tiny, []);
  });
}
