/* Scratch: serve ops/ + the repo's API stub, screenshot Health states.
   usage: node shoot.mjs <outDir> [state ...] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const WT = process.env.WT || '/data/ianrowe/worktrees/r54-ops-health';
const require = createRequire('/data/ianrowe/git/harvey-realestate-mocks/package.json');
const { chromium } = require('playwright-core');
const stubMod = await import(WT + '/scripts/ops-api-stub.mjs');
const { stub } = stubMod;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

let scene = 'health';
let override = null;
let role = null; // (pathname, search) => payload | {fail:true} | undefined

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    const o = override && override(url.pathname, url.search);
    if (o && o.fail) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'upstream_failed', message: 'The service did not answer.' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const body = o || stub(url.pathname, url.search, { scene });
    if (role && body && body.data && body.data.admin) body.data.admin = Object.assign({}, body.data.admin, { role });
    res.end(JSON.stringify(body));
    return;
  }
  const abs = path.join(WT, decodeURIComponent(url.pathname));
  if (!abs.startsWith(WT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const only = process.argv.slice(3);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/data/ianrowe/tmp/r54h/chrome-nosandbox'
});

const STATES = {
  full: {},
  empty: { override: (p) => {
    if (p.startsWith('/api/ops/alerts/problems')) return { data: { problems: [] } };
    if (p === '/api/ops/jobs') return { data: { generatedAt: new Date().toISOString(), recording: { state: 'recording', lastRecordedAt: new Date().toISOString() }, queue: { open: 0, byState: [{ state: 'queued', jobs: 0 }, { state: 'running', jobs: 0 }, { state: 'canceling', jobs: 0 }], lanes: [] }, workingSet: { limit: 50, returned: 0, truncated: false, jobs: [] }, attention: { completeness: 'whole_queue', stuck: [], abandoned: [] } } };
    if (p === '/api/ops/runs') return { data: { window: { range: '24h', endExclusiveAt: new Date().toISOString() }, coverage: { state: 'ready', coversWindow: true }, summary: { runs: 0, completed: 0, failed: 0, canceled: 0, unfinished: 0 }, runs: [] } };
  } },
  partial: { override: (p) => {
    if (p === '/api/ops/runs') return { fail: true };
    if (p.startsWith('/api/ops/costs')) return { fail: true };
  } },
  error: { override: (p) => (p.startsWith('/api/ops/alerts') || p === '/api/ops/jobs' || p === '/api/ops/runs' ? { fail: true } : undefined) },
  queue: { role: 'owner' },
  critical: { scene: 'default' },
  /* Pending reports as the stub's own queue has them (due two hours on). */
  safety: { role: 'owner' },
  /* One past its deadline, one with no deadline at all. */
  safetyLate: { role: 'owner', override: (p) => {
    if (!p.startsWith('/api/ops/moderation/reports')) return undefined;
    const { MODERATION_REPORTS } = stubMod;
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    return { data: { nextCursor: null, items: MODERATION_REPORTS.map((r, n) => ({ ...r, actionDueAt: n === 2 ? null : ago(n === 0 ? 3 : 1) })) } };
  } },
  safetyFail: { role: 'owner', override: (p) => (p.startsWith('/api/ops/moderation/reports') ? { fail: true } : undefined) },
  safetyNone: { role: 'owner', override: (p) => (p.startsWith('/api/ops/moderation/reports') ? { data: { items: [], nextCursor: null } } : undefined) }
};

async function shoot(name, { width, height, theme, state, page: route = '/ops/alerts.html', measure = [], styles = null }) {
  const spec = STATES[state];
  scene = spec.scene || 'health';
  override = spec.override || null;
  role = spec.role === undefined ? 'viewer' : spec.role;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(([o, t]) => {
    try {
      localStorage.setItem('ops-api-base', o);
      sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));
      localStorage.setItem('ops-theme', t);
    } catch (e) {}
  }, [origin, theme]);
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(origin + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const boxes = await page.evaluate((sels) => sels.map((s) => Array.from(document.querySelectorAll(s)).map((n) => {
    const b = n.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top + window.scrollY), text: (n.textContent || '').trim().slice(0, 60) };
  })), measure);
  console.log(name, 'overflow', overflow, measure.length ? JSON.stringify(Object.fromEntries(measure.map((s, i) => [s, boxes[i]]))) : '');
  if (styles) {
    /* Every element under `styles`, as tag.class plus the computed properties
       that decide how it looks, so two checkouts can be compared by diff. */
    const dump = await page.evaluate((root) => {
      const keys = ['display', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderTopStyle', 'borderRadius',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'fontSize', 'fontWeight',
        'fontFamily', 'lineHeight', 'letterSpacing', 'minHeight', 'width', 'opacity'];
      const top = document.querySelector(root);
      if (!top) return null;
      return [top, ...top.querySelectorAll('*')].slice(0, 400).map((n) => {
        const c = getComputedStyle(n);
        return [n.tagName.toLowerCase() + '.' + String(n.getAttribute('class') || ''), Object.fromEntries(keys.map((k) => [k, c[k]]))];
      });
    }, styles);
    fs.writeFileSync(path.join(out, name + '.styles.json'), JSON.stringify(dump, null, 1));
  }
  await ctx.close();
}

const SAFETY_BOXES = ['#health-safety .prob-row', '#health-safety .prob-view', '#health-safety .prob-retry .btn', '#health-problems .prob-row', '#health-problems .prob-view'];
const jobs = [
  ['health-safety-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'safety', measure: SAFETY_BOXES }],
  ['health-safety-phone', { width: 390, height: 1700, theme: 'dark', state: 'safety', measure: SAFETY_BOXES }],
  ['health-safety-late-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'safetyLate', measure: SAFETY_BOXES }],
  ['health-safety-late-phone', { width: 390, height: 1700, theme: 'dark', state: 'safetyLate', measure: SAFETY_BOXES }],
  ['health-safety-fail-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'safetyFail', measure: SAFETY_BOXES }],
  ['health-safety-fail-phone', { width: 390, height: 1700, theme: 'dark', state: 'safetyFail', measure: SAFETY_BOXES }],
  ['health-safety-none-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'safetyNone', measure: SAFETY_BOXES }],
  ['health-safety-light-desktop', { width: 1536, height: 1024, theme: 'light', state: 'safety', measure: SAFETY_BOXES }],
  ['problems-queue-desktop', { width: 1536, height: 1400, theme: 'dark', state: 'safety', page: '/ops/problems.html', styles: '.ugc-queue', measure: ['.ugc-queue', '.ugc-queue select', '.ugc-queue button'] }],
  ['problems-queue-phone', { width: 390, height: 2400, theme: 'dark', state: 'safety', page: '/ops/problems.html', styles: '.ugc-queue', measure: ['.ugc-queue', '.ugc-queue select'] }],
  /* WT=<a checkout of main> node shoot.mjs ... main-queue-*: where the queue was drawn on main. */
  ['main-queue-desktop', { width: 1536, height: 1400, theme: 'dark', state: 'safety', page: '/ops/alerts.html', styles: '.ugc-queue', measure: ['.ugc-queue', '.ugc-queue select', '.ugc-queue button'] }],
  ['main-queue-phone', { width: 390, height: 2400, theme: 'dark', state: 'safety', page: '/ops/alerts.html', styles: '.ugc-queue', measure: ['.ugc-queue', '.ugc-queue select'] }],
  ['health-viewer-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'full', measure: SAFETY_BOXES }],
  ['health-critical-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'critical' }],
  ['health-critical-phone', { width: 390, height: 1500, theme: 'dark', state: 'critical' }],
  ['health-phone-375', { width: 375, height: 1500, theme: 'dark', state: 'full' }],
  ['health-desktop-dark', { width: 1536, height: 1024, theme: 'dark', state: 'full' }],
  ['health-phone-dark', { width: 390, height: 1500, theme: 'dark', state: 'full' }],
  ['health-desktop-light', { width: 1536, height: 1024, theme: 'light', state: 'full' }],
  ['health-phone-light', { width: 390, height: 1500, theme: 'light', state: 'full' }],
  ['health-empty-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'empty' }],
  ['health-empty-phone', { width: 390, height: 1500, theme: 'dark', state: 'empty' }],
  ['health-partial-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'partial' }],
  ['health-partial-phone', { width: 390, height: 1500, theme: 'dark', state: 'partial' }],
  ['health-error-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'error' }],
  ['health-error-phone', { width: 390, height: 1500, theme: 'dark', state: 'error' }],
  ['health-phone-320', { width: 320, height: 1500, theme: 'dark', state: 'full' }],
  ['health-phone-360', { width: 360, height: 1500, theme: 'dark', state: 'full' }]
];
for (const [name, spec] of jobs) {
  if (only.length && !only.includes(name)) continue;
  await shoot(name, spec);
}
await browser.close();
server.close();
