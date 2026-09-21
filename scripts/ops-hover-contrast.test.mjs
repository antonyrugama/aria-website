/* Text contrast on HOVERED table rows, measured from rendered pixels.
 *
 * Stadiora/Aria#5501 says badge inks dip below 4.5:1 on a hovered row. The
 * reason nobody could confirm or refute it: `scripts/check-ops-contrast.mjs`
 * sweeps ~1,632 sites across two themes and four states, and its STATES are
 * ['live','loading','empty','degraded'] -- the pane's DATA states. Not one
 * reading is hovered. That file says so itself at line 1276: "a :hover
 * brightness the sweep never enters". Green there has never meant hover is
 * safe; it means hover was never entered.
 *
 * This is a separate sweep on purpose. Hover is a per-element state that has
 * to be driven one row at a time with real input, so it cannot be folded into
 * a 1,632-site pass without multiplying a run that is already slow.
 *
 * WHAT MAKES A HOVERED READING REAL
 *
 * CSS :hover does not respond to a synthetic mouseover event. It needs real
 * input, so every row here is hovered with CDP Input.dispatchMouseEvent at the
 * row's own coordinates, and the engagement is then PROVEN twice before a
 * single ratio is computed:
 *
 *   1. the row's computed background must differ from its unhovered value, and
 *   2. the rendered pixels of the row must differ from the unhovered capture.
 *
 * Either one alone can lie. A computed style can change while nothing repaints
 * under the text, and pixels can change for a reason that is not hover. If
 * hover never engaged, every reading is an unhovered reading wearing a hover
 * label, which is the exact false-green shape this repository keeps producing.
 *
 * WHAT IS MEASURED
 *
 * The ink is the element's computed colour. The background is not modelled
 * from tokens -- it is read out of the screenshot, because every surface in
 * this stack is translucent: the hover tint is `color-mix(var(--ink) 4%)`, a
 * pill fill is `color-mix(<tone> 15%)`, and the card underneath is a gradient.
 * The composite is what the eye receives, so the composite is what is judged,
 * at the WORST frequent pixel in the element's own box rather than an average.
 *
 * COMPOUND STATES (Stadiora/Aria#10754)
 *
 * A pane sheet can put its own background on the CELLS of a row, and a cell
 * background paints over a row background, so such a pane's hovered row is a
 * backdrop this file would never otherwise see. `pane-users-v2.css` does
 * exactly that: a SELECTED row's cells carry `color-mix(var(--cyan) 10%)` and
 * a selected HOVERED row's carry 15%, over the shared row tint still painting
 * underneath. Neither sweep in this repository had entered that state -- the
 * old one never hovers, and the first revision of this one swept only a pane
 * with no wash of its own.
 *
 * So the users pane is a second subject here, driven to a real selection with
 * a real lookup and a real click before a single row is hovered. Selection is
 * proven on its own terms, the same way hover is: the selected row's cell
 * background must differ from an unselected row's, and the selected HOVERED
 * cell must differ from the selected unhovered one. A compound state that
 * never compounded would otherwise be judged as its own weaker half and pass.
 *
 * NOT COVERED
 *
 * - Tones no subject page composes inside a row. The census reports the tone
 *   vocabulary it judged; TONES_EXPECTED below is the independently stated
 *   list it must cover, and a tone missing from a real hovered row is a
 *   failure, never a silent skip.
 * - Non-table hover surfaces (.nav-item, .btn, .seg button, .card.lift). This
 *   issue is about table rows; those are unswept here.
 * - Selection washes the probe below cannot reach. SELECTION_SUBJECTS is no
 *   longer trusted, nor recognised by selector text: every rule in every
 *   sheet on an aria.css page is adopted ALONE into a shadow root holding a
 *   probe table, and a sheet is collected when the rule actually MOVES a
 *   `th`/`td` computed background and does not move an identically-dressed
 *   non-cell. That decides by paint, so a wash is seen however it is spelled
 *   -- proven on every run by SCAN_SELF_TEST, whose `want/` fixtures include
 *   child-class, descendant, attribute-with-value, bare attribute, `:is()`,
 *   `:where()`, universal child, cell class, `:hover`-only, `@media`-nested
 *   and `:not()`-guarded spellings, and whose `skip/` fixtures include a
 *   row-level wash, a chip, a paintless rule and a transparent one.
 *   What the probe still cannot reach, and so does not collect:
 *     - a wash gated on a position the probe does not occupy
 *       (`td:nth-child(3)`, `tr:nth-of-type(2n)`) -- the probe is one row,
 *       `th` first, `td` second, a non-cell third;
 *     - a wash gated on an ancestor outside the probe chain
 *       (`body.x .tbl td`), which is `div > table.tbl > tbody > tr`;
 *     - `:not()` with nested parens, e.g. `:not(:is(.a, .b))`, which the
 *       token stripper leaves in place;
 *     - a background painted on `::before`/`::after` rather than on the cell,
 *       which is not the cell's own computed background.
 *   Each of those is an UNDER-collection, so it fails silently. The reverse
 *   -- the dynamic-pseudo retry and the `:not()` strip -- can only make more
 *   selectors match, and over-collection surfaces as a loud diff here.
 * - Sheets on pages that do not load aria.css. `ops.css` washes cells
 *   (`table.data th`, `.cohort td.na`) but only login and setup load it and
 *   neither loads aria.css, so there is no row tint to compound with. The
 *   universe is resolved from the pages, not from a name list, so a page that
 *   starts loading both is picked up rather than sailing past an exception.
 * - Contrast only. No hover-specific focus, motion or pointer-target check.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The first subject: the releases pane ends each health row with a pill, which
   is the "badge inside a hoverable table row" pairing #5501 is about. It is
   reachable on an auth stub plus one fixture, and it loads the shared sheet
   the hover tint lives in. */
const SUBJECT = '/ops/releases.html';

/* The second subject, for #10754: the users pane is the only pane whose sheet
   washes a row's CELLS, which is a backdrop the shared tint alone never
   produces. It needs a lookup and a pick before the state exists at all. */
const SUBJECT_USERS = '/ops/users.html';

/* The sheets that put a background on a table CELL in a state the shared
   hover rule cannot reach. Written as a literal contract and checked against
   the sheets below: if a pane grows such a rule and is not swept here, that
   check fails rather than this file quietly judging one pane fewer. A cell
   background is the interesting case precisely because `.tbl` is
   border-collapse: collapse, so it paints OVER the row's hover tint instead
   of being replaced by it. */
const SELECTION_SUBJECTS = ['ops/assets/pane-users-v2.css'];

/* WCAG 2.2 SC 1.4.3, normal text. `.pill` is 11.5px at weight 540, which is
   neither 18pt nor 14pt-bold, so the large-text allowance of 3:1 does not
   apply. Stated here as a contract rather than read from anything under test. */
const AA = 4.5;

/* Every tone the shared sheet defines that the subject must actually compose
   inside a hovered row. Stated independently: if aria.css grows a tone, this
   list does not move with it, and if the subject stops rendering one, the
   sweep fails rather than quietly judging fewer. */
const TONES_EXPECTED = ['up', 'down', 'warn', 'none'];

/* Every tone aria.css gives a .pill. The subject page composes four of them,
   so four is all a sweep of its own rows can ever judge -- and the tightest
   tone by computation is .pill.vio, which this page never draws. The rest are
   therefore COMPOSED into the real table by MATRIX below: real sheets, real
   card, real hover rule, real nesting depth, one pill per row exactly as the
   pane builds them. Written as a literal; the sheet is then checked against
   it, never the other way round. */
const TONES_ALL = ['up', 'down', 'warn', 'info', 'acc', 'vio', 'ghost', 'none'];

/* Rows the subject must draw OF ITS OWN across both themes -- one per health
   signal the fixture declares. A floor written as a literal, never derived
   from the census it polices, and never counting the rows this file composes:
   a floor the matrix can satisfy by itself would pass on a degraded pane that
   rendered no table at all. */
const ROW_FLOOR = 5;

/* The users subject's own floor: the match table the lookup draws. Two
   matches in the fixture, and the account record underneath adds more rows
   still, so a run that judged fewer than two has lost the table this state
   lives in. Literal, for the same reason ROW_FLOOR is. */
const USERS_ROW_FLOOR = 2;

/* Ink sites the sweep must judge inside a row that is BOTH selected and
   hovered, per theme. The picked match row carries a state pill, a tier pill,
   the "Selected" mark, the masked address and a relative timestamp, so this
   is a floor well under what a healthy run reaches -- its job is to fail a run
   in which the compound state collapsed to nothing rather than to describe
   one that worked. */
const COMPOUND_INK_FLOOR = 4;

const THEMES = ['dark', 'light'];
const VIEWPORT = { width: 1440, height: 1000 };

/* Pixel bucketing: 8 quantises antialiased edge pixels away from the flat fill
   without merging two real surfaces. */
const BUCKET = 8;

/* A bucket must hold this share of an element's box to count as a surface the
   text sits on, which keeps a stray antialiased ring out of the judgement. */
const MIN_SHARE = 0.04;

/* The backdrop is read from a SECOND capture of the same box taken with the
   ink made transparent, so no glyph pixel and no antialiased glyph edge can
   ever be mistaken for the surface under the text. An earlier revision tried
   to filter blends by contrast distance instead and a 4.2%-share edge pixel
   between an emerald glyph and its own fill was reported as a 3.982:1
   failure that does not exist. */


const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
};

/* ----------------------------------------------------------------- fixture */

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();
const ADMIN = { id: 'adm_1', email: 'ops@example.invalid', name: 'Ops', role: 'owner', status: 'active' };
const SESSION = { id: 'ses_1', createdAt: ago(HOUR), lastSeenAt: ago(MINUTE) };

/* Shaped after the payload scripts/check-ops-narrow-overflow.mjs already
   drives this pane with, so the pane reaches its live state rather than its
   "one store could not be read" state -- a degraded pane renders no table and
   the sweep would then judge nothing while passing.

   The health signals carry one of every verdict the pane maps to a pill tone,
   so the tone vocabulary TONES_EXPECTED declares is present by construction
   instead of by luck: better -> .pill.up, worse -> .pill.down,
   slightly_worse -> .pill.warn, no_change -> a plain .pill. Every address is
   .invalid, on the same terms as the pane's own fixtures. */
const TRACKS = (state) => [
  { track: 'internal', versionName: '1.1.3', versionCode: '4412', state: 'processing',
    testerCount: 12, fetchedAt: ago(90_000) },
  { track: 'external', versionName: '1.1.3', versionCode: '4412', state: 'in_review',
    testerCount: 240, fetchedAt: ago(90_000) },
  { track: 'production', versionName: '1.1.2', versionCode: '4398', state,
    rolloutBasisPoints: state === 'live' ? 10_000 : 2000,
    rolloutObservedSince: ago(6 * DAY), releasedAt: ago(9 * DAY), fetchedAt: ago(90_000) }
];

const RELEASES = {
  generatedAt: ago(90_000),
  platforms: [
    { platform: 'ios', label: 'iOS', appIdentifier: 'com.example.invalid',
      sourceKey: 'app_store_connect', tracks: TRACKS('live'), unknownTracks: [] },
    { platform: 'android', label: 'Android', appIdentifier: 'com.example.invalid',
      sourceKey: 'google_play', tracks: TRACKS('rolling_out'), unknownTracks: [] }
  ],
  sources: [
    { key: 'app_store_connect', label: 'App Store Connect', status: 'ok',
      lastSuccessAt: ago(90_000), lastAttemptAt: ago(90_000), pollSeconds: 900, mode: 'poll' },
    { key: 'google_play', label: 'Google Play', status: 'ok',
      lastSuccessAt: ago(150_000), lastAttemptAt: ago(150_000), pollSeconds: 900, mode: 'poll' }
  ],
  production: { versionName: '1.1.2', builds: [
    { platform: 'ios', versionCode: '4398' }, { platform: 'android', versionCode: '4398' }] },
  adoption: {
    latestVersion: '1.1.2', sampleSessions: 18_422,
    buckets: [
      { key: 'latest', label: '1.1.2', basisPoints: 6120 },
      { key: 'previous', label: '1.1.1', basisPoints: 2740 },
      { key: 'older', label: 'Older', basisPoints: 1140 }
    ]
  },
  crashFree: { basisPoints: 9962, floorBasisPoints: 9950, windowHours: 24 },
  health: {
    platform: 'android', current: '1.1.2', previous: '1.1.1',
    signals: [
      { key: 'crash_rate', label: 'Crash rate', unit: 'rate_bp', previous: 52, current: 38,
        verdict: 'better' },
      { key: 'anr_rate', label: 'App not responding', unit: 'per_1k', previous: 1.2, current: 3.1,
        verdict: 'worse' },
      { key: 'cold_start', label: 'Cold start', unit: 'millis', previous: 1840, current: 2130,
        verdict: 'slightly_worse' },
      { key: 'sessions', label: 'Sessions', unit: 'count', previous: 18_000, current: 18_422,
        verdict: 'no_change' },
      { key: 'install_size', label: 'Install size', unit: 'bytes', previous: null, current: null,
        verdict: 'unknown' }
    ]
  }
};

/* ----------------------------------------------------- users fixture (#10754)

   Enough of the users pane's payload to reach a match table and an account
   record. Every address is .invalid and every masked value arrives already
   masked, on the same terms as that pane's own fixtures: this file never
   writes a personal value into a page whose first promise is that it does not
   show one. Two matches of the same shape, so the difference between the
   picked row and the other one is being picked and nothing else. */
const PICKED_REF = 'ath_2277';
const OTHER_REF = 'ath_2419';

const USERS_LOOKUP = {
  recorded: { at: ago(1000), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
  matchCount: 2,
  matches: [
    { reference: PICKED_REF, maskedEmail: 'a•••@example.invalid',
      state: { key: 'active', label: 'Active', tone: 'ok' },
      tier: { key: 'pro', label: 'Athlete Pro', brand: true },
      platforms: [{ key: 'mobile', label: 'Mobile' }],
      lastActiveAt: ago(3 * HOUR), flags: [] },
    { reference: OTHER_REF, maskedEmail: 'b•••@example.invalid',
      state: { key: 'active', label: 'Active', tone: 'ok' },
      tier: { key: 'pro', label: 'Athlete Pro', brand: true },
      platforms: [{ key: 'mobile', label: 'Mobile' }],
      lastActiveAt: ago(30 * HOUR), flags: [] }
  ]
};

const USERS_DETAIL = {
  reference: PICKED_REF, kind: 'athlete',
  state: { key: 'active', label: 'Active', tone: 'ok' },
  tier: { key: 'pro', label: 'Athlete Pro', brand: true },
  memberSince: ago(400 * DAY),
  recorded: { at: ago(500), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
  summary: { fields: [
    { key: 'email', label: 'Email', masked: true, maskedValue: 'a•••@example.invalid', reveal: 'allowed' },
    { key: 'locale', label: 'Locale', masked: false, value: 'es-ES' }
  ] },
  activity: { windowDays: 7, events: [
    { occurredAt: ago(3 * HOUR), label: 'Chat reply', tone: 'ok', reference: 'run_88214' }
  ] },
  devices: [{ label: 'iPhone', appVersion: '1.1.2', os: 'iOS 18.2', lastSeenAt: ago(2 * HOUR) }],
  billing: { fields: [{ key: 'tier', label: 'Tier', masked: false, value: 'Athlete Pro' }] },
  access: { windowDays: 90, entries: [
    { occurredAt: ago(2 * DAY), actor: 'ops_owner_1', fields: 'email', reason: 'SUP-4471', revealed: true }
  ] },
  supportActions: { available: [{ key: 'resend', label: 'Resend verification email' }] }
};

function stub(pathname) {
  if (pathname.startsWith('/api/ops/auth/refresh') || pathname.startsWith('/api/ops/auth/login')) {
    return { data: {
      accessToken: 'stub-access', expiresIn: 900, refreshToken: 'stub-refresh-2',
      refreshTokenRotated: true, authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900,
      admin: ADMIN, session: SESSION } };
  }
  if (pathname.startsWith('/api/ops/auth/session')) {
    return { data: { admin: ADMIN, session: SESSION,
      authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900 } };
  }
  if (pathname.startsWith('/api/ops/releases')) return { data: RELEASES };
  if (pathname.startsWith('/api/ops/users/lookup')) return { data: USERS_LOOKUP };
  if (/^\/api\/ops\/users\/[^/]+$/.test(pathname)) return { data: USERS_DETAIL };
  return { data: {} };
}

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
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    } catch { /* browser has not written it yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtools(port, pathname, method) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
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

/* -------------------------------------------------------------------- PNG */


/* Minimal decoder for the 8-bit images Chromium's screenshots produce.
   Dependency-free on purpose: this repository has no package manager. */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null;

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }

  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = line[x];
      let val;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      cur[x] = val & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 3);
  for (let i = 0, n = width * height; i < n; i++) {
    let r, g, b;
    if (colorType === 0) { r = g = b = out[i]; }
    else if (colorType === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (colorType === 3) {
      const idx = out[i];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
    } else if (colorType === 4) { r = g = b = out[i * 2]; }
    else { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; }
    data[i * 3] = r; data[i * 3 + 1] = g; data[i * 3 + 2] = b;
  }
  /* A screenshot composited onto the page is opaque; an alpha channel that is
     not 255 would mean the sample is not the painted colour. Chromium returns
     colour type 2 here, so this is a guard on a decode path that could change
     rather than a mechanism this page exercises. */
  if (colorType === 4 || colorType === 6) {
    for (let i = 0, n = width * height; i < n; i++) {
      const a = colorType === 4 ? out[i * 2 + 1] : out[i * 4 + 3];
      if (a !== 255) throw new Error('screenshot pixel is not opaque, so it is not a painted colour');
    }
  }
  return { width, height, data };
}

/* ------------------------------------------------------------------ colour */


/* Reads the three serialisations Chromium actually emits for a resolved
   colour. `color(srgb …)` is how it serialises a color-mix(), and a parser
   that only understood rgb() is how 40 sites once vanished in silence. A
   syntax this cannot read is REFUSED by name, never skipped. */
function parseColor(str) {
  const s = String(str).trim();
  let m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/i);
  if (m) {
    return { rgb: [+m[1], +m[2], +m[3]], alpha: m[4] === undefined ? 1 : pct(m[4]) };
  }
  m = s.match(/^color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s*(?:\/\s*([\d.%]+)\s*)?\)$/i);
  if (m) {
    return {
      rgb: [+m[1] * 255, +m[2] * 255, +m[3] * 255],
      alpha: m[4] === undefined ? 1 : pct(m[4])
    };
  }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  return null;
}

function pct(v) {
  return String(v).endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
}

function relativeLuminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function hex([r, g, b]) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0').toUpperCase()).join('');
}

/* Group pixels into surfaces. Mean of the real pixels per bucket, so a
   gradient reports the shades it actually holds rather than one average. */
function bucketPixels(px) {
  const counts = new Map();
  for (const [r, g, b] of px) {
    const key = ((r / BUCKET) | 0) * 65536 + ((g / BUCKET) | 0) * 256 + ((b / BUCKET) | 0);
    let e = counts.get(key);
    if (!e) counts.set(key, (e = { n: 0, r: 0, g: 0, b: 0 }));
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  return [...counts.values()]
    .map((e) => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n], n: e.n }))
    .sort((a, b) => b.n - a.n);
}

/* ------------------------------------------------------------- page probes */

/* Transitions and animations off, through CSSOM rather than a <style> element:
   the shell's CSP has no 'unsafe-inline', so an injected stylesheet element is
   blocked and would fail silently. `.skip` transitions its own `top` on focus
   and `.btn` transitions its background, so a photograph taken mid-transition
   is of neither state. */

/* ------------------------------------------------------------- page probes */

/* `.tbl tbody tr` transitions its background over .12s, so a capture taken
   straight after the pointer arrives is of neither state. Motion off through
   CSSOM, because the shell's CSP has no 'unsafe-inline' and an injected
   <style> element would be blocked silently. */
const NO_MOTION = `(() => {
  const s = new CSSStyleSheet();
  s.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
  return JSON.stringify({ sheets: document.adoptedStyleSheets.length });
})()`;

/* Rows, and inside each row the elements that actually paint text on a
   surface. An element holding a pill is not a text site -- its visible text
   belongs to the pill, which paints its own fill over the row -- so anything
   with a background-painting descendant is a container and is skipped as
   such. */
const ROW_CENSUS = `(() => {
  const paints = (el) => {
    const cs = getComputedStyle(el);
    return (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      (cs.backgroundColor && !/^rgba\\(0, 0, 0, 0\\)$|^transparent$/.test(cs.backgroundColor));
  };
  const directText = (el) => [...el.childNodes]
    .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
  const rows = [...document.querySelectorAll('.tbl tbody tr')];
  return JSON.stringify(rows.map((row, r) => {
    row.dataset.hoverRow = String(r);
    const inks = [];
    for (const el of row.querySelectorAll('*')) {
      const text = directText(el);
      if (!text) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      if ([...el.querySelectorAll('*')].some(paints)) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) continue;
      el.dataset.hoverInk = r + '-' + inks.length;
      const nameOf = (n) => (n && n.className && n.className.baseVal === undefined ? String(n.className) : '');
      /* pill() builds span.pill.TONE > span(text), so the element holding the
         text is the INNER span and carries no tone class of its own. Read the
         tone off the nearest .pill ancestor inside this row, or every badge
         reads as untoned and the tone floor below passes on nothing. */
      const badge = el.closest('.pill');
      const cls = nameOf(el);
      const badgeCls = badge && row.contains(badge) ? nameOf(badge) : '';
      inks.push({
        key: r + '-' + (inks.length),
        tag: el.tagName.toLowerCase(), cls, badgeCls,
        tone: badgeCls
          ? (['up','down','warn','info','acc','vio','ghost'].find((t) => badgeCls.split(/\\s+/).includes(t)) || 'none')
          : null,
        text: text.slice(0, 40), color: cs.color
      });
    }
    return { r, inks, matrix: row.dataset.hoverMatrix || null };
  }));
})()`;

/* Ink off, then ink back on, through a constructed stylesheet -- the same
   route NO_MOTION takes, because the shell's CSP has no 'unsafe-inline' and a
   <style> element would be dropped in silence. Only `color` moves, so the box
   does not reflow and the capture is the same geometry with the glyphs gone. */
const HIDE_INK = `(() => {
  if (!window.__hoverHide) {
    window.__hoverHide = new CSSStyleSheet();
    window.__hoverHide.replaceSync('[data-hover-ink] { color: transparent !important; }');
  }
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, window.__hoverHide];
  return JSON.stringify({ hidden: true });
})()`;

const SHOW_INK = `(() => {
  document.adoptedStyleSheets =
    document.adoptedStyleSheets.filter((s) => s !== window.__hoverHide);
  return JSON.stringify({ hidden: false });
})()`;

/* One extra row per tone, appended to the page's own tbody with DOM calls --
   no innerHTML, no style attribute, nothing the shell's CSP forbids. The
   shape is the pane's own: th.t-main for the row header, then a cell holding
   span.pill.TONE > span(text), which is exactly what pane-releases.js's
   pill() builds. These rows are marked so the organic-tone floor below can
   still insist the PAGE drew its own four. */
const MATRIX = `(() => {
  const tbody = document.querySelector('.tbl tbody');
  if (!tbody) return JSON.stringify({ added: 0 });
  for (const el of tbody.querySelectorAll('[data-hover-matrix]')) el.remove();
  const tones = ${JSON.stringify(TONES_ALL)};
  const cols = tbody.querySelector('tr') ? tbody.querySelector('tr').children.length : 2;
  for (const tone of tones) {
    const tr = document.createElement('tr');
    tr.dataset.hoverMatrix = tone;
    const th = document.createElement('th');
    th.setAttribute('scope', 'row');
    th.className = 't-main';
    th.appendChild(document.createTextNode('Tone ' + tone));
    /* The palest ink aria.css pairs with a table row: .tbl .t-sub is
       var(--ink-3) at 11.5px and exists only inside .tbl, so a hover tint that
       is safe behind a pill can still be unsafe behind this. Composed here
       because the subject page's own rows carry no sub-line. */
    const sub = document.createElement('div');
    sub.className = 't-sub';
    sub.appendChild(document.createTextNode('sub line ' + tone));
    th.appendChild(sub);
    tr.appendChild(th);
    for (let c = 1; c < cols - 1; c++) {
      const pad = document.createElement('td');
      pad.className = 'r num';
      pad.appendChild(document.createTextNode('0'));
      tr.appendChild(pad);
    }
    const td = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = tone === 'none' ? 'pill' : 'pill ' + tone;
    const label = document.createElement('span');
    label.appendChild(document.createTextNode('Sample ' + tone));
    pill.appendChild(label);
    td.appendChild(pill);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  return JSON.stringify({ added: tbody.querySelectorAll('[data-hover-matrix]').length });
})()`;

/* --------------------------------------------- the compound state (#10754)

   From the users pane's landing state to a picked match. The form is filled
   through the native value setter and submitted with a real submit event, and
   the pick control is CLICKED, so applySelection, the account read and the
   repaint all actually happen -- a class written by hand would paint the wash
   without proving the pane can reach the state.

   The SECOND match is picked, not the first, so the selected row has an
   unselected row above it as well as the table head: an unselected sibling in
   the same table is what the selection proof below compares against, and it
   has to be one the same sheets and the same nesting depth produced. */
const PICK_MATCH = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const id = document.getElementById('lookupIdentifier');
  const reason = document.getElementById('lookupReason');
  if (!id || !reason) return JSON.stringify({ error: 'the lookup form is not on the page' });
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(id, ${JSON.stringify(PICKED_REF)});
  set(reason, 'SUP-4471');
  id.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 160; i++) { await sleep(50); if (document.querySelectorAll('.match-row-btn').length > 1) break; }
  const picks = [...document.querySelectorAll('.match-row-btn')];
  if (picks.length < 2) return JSON.stringify({ error: 'the lookup drew ' + picks.length + ' match row(s), so there is no unselected sibling to compare against' });
  picks[1].click();
  for (let i = 0; i < 160; i++) { await sleep(50); if (document.querySelector('.match-row.is-selected')) break; }
  await sleep(700);
  const sel = document.querySelector('.match-row.is-selected');
  if (!sel) return JSON.stringify({ error: 'the pick never selected a row' });
  return JSON.stringify({ selected: 1, rows: document.querySelectorAll('.match-row').length });
})()`;

/* Mark the selected row and one unselected row in the SAME table, and report
   the cell background each currently carries. The wash is on the cells, so
   the row's own computed background is not the thing that moved and reading
   it would report every selected row as unselected. */
const SELECTION_CENSUS = `(() => {
  const sel = document.querySelector('.tbl tbody tr.is-selected');
  if (!sel) return JSON.stringify({ selected: null });
  const table = sel.closest('table');
  const other = [...table.querySelectorAll('tbody tr')].find((r) => r !== sel && !r.classList.contains('is-selected'));
  const cellBg = (row) => {
    const cell = row && row.querySelector('th, td');
    return cell ? getComputedStyle(cell).backgroundColor : null;
  };
  sel.dataset.hoverSelected = '1';
  if (other) other.dataset.hoverUnselected = '1';
  return JSON.stringify({
    selected: sel.dataset.hoverRow === undefined ? null : Number(sel.dataset.hoverRow),
    unselected: other && other.dataset.hoverRow !== undefined ? Number(other.dataset.hoverRow) : null,
    selectedCellBg: cellBg(sel), unselectedCellBg: cellBg(other)
  });
})()`;

/* The cell background of a named row, read while whatever state is current is
   current. Used to prove the hovered selected cell is a THIRD surface and not
   the selected one over again. */
const CELL_BG = (r) => `(() => {
  const row = document.querySelector('[data-hover-row="${r}"]');
  const cell = row && row.querySelector('th, td');
  return JSON.stringify({ bg: cell ? getComputedStyle(cell).backgroundColor : null });
})()`;
/* Put the row in view and report where to aim, in viewport coordinates for the
   input dispatch and page coordinates for the clip. A few pixels in from the
   row's left edge lands inside the row and outside every pill. */
const ROW_GEOM = (r) => `(() => {
  const row = document.querySelector('[data-hover-row="${r}"]');
  row.scrollIntoView({ block: 'center', inline: 'nearest' });
  const b = row.getBoundingClientRect();
  return JSON.stringify({
    aim: { x: Math.round(b.left + 4), y: Math.round(b.top + b.height / 2) },
    clip: { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height },
    bg: getComputedStyle(row).backgroundColor
  });
})()`;

const ROW_STATE = (r) => `(() => {
  const row = document.querySelector('[data-hover-row="${r}"]');
  const b = row.getBoundingClientRect();
  return JSON.stringify({
    bg: getComputedStyle(row).backgroundColor,
    hovered: row.matches(':hover'),
    clip: { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height },
    inks: [...row.querySelectorAll('[data-hover-ink]')].map((el) => {
      const r2 = el.getBoundingClientRect();
      return { key: el.dataset.hoverInk, color: getComputedStyle(el).color,
        box: { x: r2.left + scrollX, y: r2.top + scrollY, width: r2.width, height: r2.height } };
    })
  });
})()`;

/* ------------------------------------------------------------ measurement */

async function shoot(clip) {
  const res = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
  });
  return decodePNG(Buffer.from(res.data, 'base64'));
}

function cropPixels(img, clip, box) {
  const x0 = Math.max(0, Math.round(box.x - clip.x));
  const y0 = Math.max(0, Math.round(box.y - clip.y));
  const x1 = Math.min(img.width, Math.round(box.x - clip.x + box.width));
  const y1 = Math.min(img.height, Math.round(box.y - clip.y + box.height));
  const out = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 3;
      out.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  }
  return out;
}

function differs(a, b) {
  if (a.width !== b.width || a.height !== b.height) return true;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return true;
  return false;
}

/* The backdrop is the worst-contrast colour that occupies a real share of the
   ink's own box in the glyph-free capture. A share floor keeps a stray
   sub-pixel from deciding a ratio; the gradient bands under a row comfortably
   clear it. */
function backdropFor(pixels, ink) {
  const buckets = bucketPixels(pixels).filter((b) => b.n / pixels.length >= MIN_SHARE);
  if (!buckets.length) return null;
  return buckets.reduce((w, b) => (contrast(b.rgb, ink) < contrast(w.rgb, ink) ? b : w));
}

/* An ink with alpha < 1 is composited toward its own backdrop, which LOWERS
   the ratio. Assuming opacity here would hide exactly the defect this file
   exists to find, so the ink is composited and the fill is not: the
   conservative direction is chosen per role, not once. */
function composite(fg, bg) {
  if (fg.alpha >= 1) return fg.rgb;
  return fg.rgb.map((c, i) => c * fg.alpha + bg[i] * (1 - fg.alpha));
}

async function hoverAt(x, y) {
  for (const type of ['mouseMoved']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0 });
  }
  await new Promise((r) => setTimeout(r, 60));
}

/* Sweep one subject in one theme: for every row, capture it unhovered, drive
   real pointer input onto it, PROVE the hover rule engaged twice over -- the
   row's own computed background changed AND the painted pixels changed -- and
   only then measure each ink inside it against what is now under it.

   When the subject declares a compound state, it is driven first and proven
   on its own terms before any row is hovered, and the reading for the
   selected row carries the cell backgrounds of all three states so a run in
   which the states collapsed into one another cannot pass as one in which
   they did not. */
async function sweepSubject(theme, subject) {
  await setTheme(theme, true);
  await load(`${base}${subject.url}`);
  await evalJson(NO_MOTION);
  const painted = await evalJson(`JSON.stringify({ theme: document.documentElement.dataset.theme })`);
  assert.equal(painted.theme, theme, `page painted ${painted.theme} when asked for ${theme}`);

  let drive = null;
  if (subject.prepare) {
    drive = await evalJson(subject.prepare);
    assert.ok(!drive.error, `${theme} ${subject.key}: ${drive.error}`);
  }

  let built = null;
  if (subject.matrix) {
    built = await evalJson(MATRIX);
    assert.equal(built.added, TONES_ALL.length,
      `the tone matrix added ${built.added} rows, not the ${TONES_ALL.length} tones declared`);
  }
  const rows = await evalJson(ROW_CENSUS);

  /* Read AFTER ROW_CENSUS, which is what stamps data-hover-row. */
  const selection = subject.selection ? await evalJson(SELECTION_CENSUS) : { selected: null };
  if (subject.selection) {
    assert.notEqual(selection.selected, null,
      `${theme} ${subject.key}: no .tbl row carries .is-selected after the pick, so the ` +
      'compound state this subject exists for was never entered');
    assert.notEqual(selection.unselected, null,
      `${theme} ${subject.key}: the selected row has no unselected sibling in its own table, ` +
      'so "the wash changed something" cannot be told from "every row looks like this"');
    assert.notEqual(selection.selectedCellBg, selection.unselectedCellBg,
      `${theme} ${subject.key}: a selected cell and an unselected cell in the same table both ` +
      `compute ${selection.selectedCellBg}, so selection painted nothing and every reading ` +
      'below would be an unselected reading wearing a selected label');
  }

  const readings = [];
  const unhovered = [];
  const engagement = [];
  for (const row of rows) {
    if (!row.inks.length) continue;
    await hoverAt(2, 2);
    const geom = await evalJson(ROW_GEOM(row.r));
    const off = await evalJson(ROW_STATE(row.r));
    const cellOff = await evalJson(CELL_BG(row.r));
    const imgOff = await shoot(off.clip);

    /* The compound state has two halves and only one of them is hover. The
       wash a selected row carries is on the cells whether or not a pointer is
       near it, and nothing in this repository measures THAT either: the old
       sweep composes synthetic sites on a fixture page and never drives a
       pane to a selection at all. So the selected row is read twice, and the
       unhovered half is judged by its own test below -- a fix that cleared
       only the hovered half would leave the state it is a step up from
       failing, and this file would have called that done. */
    if (row.r === selection.selected) {
      await evalJson(HIDE_INK);
      const bareOff = await shoot(off.clip);
      await evalJson(SHOW_INK);
      assert.ok(differs(imgOff, bareOff),
        `${theme} ${subject.key} row ${row.r}: hiding the ink changed no pixels in the ` +
        'unhovered capture');
      for (const site of row.inks) {
        const live = off.inks.find((i) => i.key === site.key);
        const ink = parseColor(live.color);
        const px = cropPixels(bareOff, off.clip, live.box);
        if (!px.length) continue;
        const bd = backdropFor(px, ink.rgb);
        if (!bd) continue;
        unhovered.push({
          theme, subject: subject.key, row: row.r, key: site.key, tag: site.tag, cls: site.cls,
          tone: site.tone, text: site.text, ink: live.color,
          backdrop: bd.rgb.map((c) => Math.round(c)),
          ratio: +contrast(composite(ink, bd.rgb), bd.rgb).toFixed(3)
        });
      }
    }

    await hoverAt(geom.aim.x, geom.aim.y);
    const on = await evalJson(ROW_STATE(row.r));
    const cellOn = await evalJson(CELL_BG(row.r));
    const imgOn = await shoot(on.clip);

    engagement.push({
      subject: subject.key, r: row.r, matches: on.hovered, bgOff: off.bg, bgOn: on.bg,
      bgChanged: off.bg !== on.bg, pixelsChanged: differs(imgOff, imgOn),
      selected: row.r === selection.selected,
      cellBgOff: cellOff.bg, cellBgOn: cellOn.bg
    });

    await evalJson(HIDE_INK);
    const imgBare = await shoot(on.clip);
    await evalJson(SHOW_INK);
    assert.ok(differs(imgOn, imgBare),
      `${theme} row ${row.r}: hiding the ink changed no pixels, so the glyph-free ` +
      'capture is not glyph-free and every backdrop read from it is unproven');

    for (const site of row.inks) {
      const live = on.inks.find((i) => i.key === site.key);
      const ink = parseColor(live.color);
      assert.ok(ink, `unreadable ink colour ${live.color} at row ${row.r}`);
      const px = cropPixels(imgBare, on.clip, live.box);
      assert.ok(px.length, `empty crop for ${site.key}`);
      const bd = backdropFor(px, ink.rgb);
      if (!bd) continue;
      const fg = composite(ink, bd.rgb);
      readings.push({
        theme, subject: subject.key, row: row.r, matrix: row.matrix,
        selected: row.r === selection.selected,
        key: site.key, tag: site.tag, cls: site.cls,
        badgeCls: site.badgeCls, tone: site.tone,
        text: site.text, ink: live.color, backdrop: bd.rgb.map((c) => Math.round(c)),
        share: +(bd.n / px.length).toFixed(3), ratio: +contrast(fg, bd.rgb).toFixed(3)
      });
    }
  }
  await hoverAt(2, 2);
  /* Counted WITHOUT the composed rows. The matrix appends eight rows of its
     own, so a floor over every row in the tbody would be satisfied by the
     matrix alone and would pass on a pane that rendered nothing -- which is
     the degraded state this subject falls into if its payload is wrong. */
  return { subject: subject.key, readings, unhovered, engagement, selection, drive,
    rowCount: rows.filter((r) => !r.matrix).length };
}

/* ------------------------------------------------------------------- boot */

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-hover-'));

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank'
], { stdio: 'ignore' });

const port = await devtoolsPort(profile);
const targets = await devtools(port, '/json/list');
const pageTarget = targets.find((t) => t.type === 'page');
const cdp = connect(pageTarget.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false
});

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

async function evalJson(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error('page threw: ' + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
  }
  return JSON.parse(res.result.value);
}

let initScript = null;
async function setTheme(theme, session = false) {
  if (initScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('ops-theme', ${JSON.stringify(theme)}); } catch (e) {}` +
      (session
        ? `try { localStorage.setItem('ops-api-base', location.origin); ` +
          `sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' })); } catch (e) {}`
        : '')
  });
  initScript = res.identifier;
  /* Emulated to the OPPOSITE of the stored theme, so a failed storage write
     cannot look like a success. The theme that painted is asserted after load. */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }]
  });
}

async function load(url, settle = 600) {
  cdp.reset();
  await cdp.send('Page.navigate', { url });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, settle));
}

/* The subjects, and what each is here to answer. Declared after the page
   programmes because the users subject carries one. */
const SUBJECTS = [
  { key: 'releases', url: SUBJECT, matrix: true, prepare: null, selection: false,
    rowFloor: ROW_FLOOR },
  { key: 'users', url: SUBJECT_USERS, matrix: false, prepare: PICK_MATCH, selection: true,
    rowFloor: USERS_ROW_FLOOR }
];

/* The sweep is driven once and shared, because it takes a real browser and a
   real pointer per row. Memoised rather than run at import time so that a
   failure inside it is reported as a failing assertion in a named test, not
   as a module that never loaded -- a crash is not a kill. */
let sweepPromise = null;
function sweep() {
  if (!sweepPromise) {
    sweepPromise = (async () => {
      const out = {};
      for (const theme of THEMES) {
        out[theme] = {};
        for (const subject of SUBJECTS) out[theme][subject.key] = await sweepSubject(theme, subject);
      }
      return out;
    })();
  }
  return sweepPromise;
}

/* Every reading in a theme, across every subject, flattened. */
function allReadings(perTheme) {
  return SUBJECTS.flatMap((s) => perTheme[s.key].readings);
}

/* ------------------------------------------------------------------ tests */

test('the subject page is the one that pairs a badge with a table row', async () => {
  const html = fs.readFileSync(path.join(ROOT, SUBJECT.replace(/^\//, '')), 'utf8');
  assert.match(html, /assets\/aria\.css/, `${SUBJECT} does not load aria.css, so it cannot exercise its hover rule`);
  const js = fs.readFileSync(path.join(ROOT, 'ops/assets/pane-releases.js'), 'utf8');
  assert.match(js, /pill\(/, 'pane-releases.js no longer builds pills; the subject page must be re-chosen');
});

/* The compound subject rests on three things the page can drop without any
   assertion here noticing at run time: it must load the shared sheet the
   hover tint lives in, it must load the sheet that washes the cells, and the
   pane must still write the class the wash is keyed to. A page that stopped
   loading pane-users-v2.css would sweep clean and cover nothing. */
test('the compound subject loads both sheets the state needs, and still writes the class', async () => {
  const html = fs.readFileSync(path.join(ROOT, SUBJECT_USERS.replace(/^\//, '')), 'utf8');
  assert.match(html, /assets\/aria\.css/,
    `${SUBJECT_USERS} does not load aria.css, so it cannot exercise the shared hover rule`);
  assert.match(html, /assets\/pane-users-v2\.css/,
    `${SUBJECT_USERS} does not load pane-users-v2.css, so the selection wash is not on the page ` +
    'and every "selected + hovered" reading would be a plain hovered reading');
  const js = fs.readFileSync(path.join(ROOT, 'ops/assets/pane-users.js'), 'utf8');
  assert.match(js, /is-selected/,
    'pane-users.js no longer writes is-selected; the wash is keyed to a class nothing sets');
});

test('the tone list this sweep declares is the tone list aria.css defines', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'ops/assets/aria.css'), 'utf8');
  const found = new Set();
  for (const m of css.matchAll(/^\.pill\.([a-z-]+)\s*\{/gm)) found.add(m[1]);
  const declared = new Set(TONES_ALL.filter((t) => t !== 'none'));
  assert.deepEqual([...found].sort(), [...declared].sort(),
    'aria.css defines a .pill tone this sweep does not compose (or vice versa); ' +
    'TONES_ALL is the contract and must be updated deliberately');
});

test('real pointer input engages :hover on every judged row, in both themes', async () => {
  const all = await sweep();
  for (const theme of THEMES) {
    for (const s of SUBJECTS) {
      const eng = all[theme][s.key].engagement;
      assert.ok(eng.length, `${theme} ${s.key}: no row was driven at all`);
      for (const e of eng) {
        assert.equal(e.matches, true,
          `${theme} ${s.key} row ${e.r}: :hover did not match after pointer input`);
        assert.equal(e.bgChanged, true,
          `${theme} ${s.key} row ${e.r}: computed background stayed ${e.bgOff} under the pointer, ` +
          'so every reading on it would be an unhovered reading wearing a hover label');
        assert.equal(e.pixelsChanged, true,
          `${theme} ${s.key} row ${e.r}: the row repainted no pixels under the pointer`);
      }
    }
  }
});

/* Stadiora/Aria#10754. Hover engagement above is proven on the ROW's own
   background, which is the surface the shared tint moves. A pane that washes
   the CELLS paints over that, so the row's background changing says nothing
   about whether the surface the text actually sits on moved. This binds the
   other half: selected differs from unselected, and selected+hovered differs
   from selected. Without the second arm the compound state could collapse
   onto the plain selected state and every reading below would be a
   single-state reading wearing a compound label. */
test('the selected + hovered state is a third surface, not one of its halves', async () => {
  const all = await sweep();
  for (const theme of THEMES) {
    for (const s of SUBJECTS.filter((x) => x.selection)) {
      const run = all[theme][s.key];
      const picked = run.engagement.find((e) => e.selected);
      assert.ok(picked,
        `${theme} ${s.key}: no hovered row was the selected one, so the compound state ` +
        'was never measured');
      assert.ok(picked.cellBgOff && picked.cellBgOn,
        `${theme} ${s.key}: the selected row's cell background could not be read`);
      assert.notEqual(picked.cellBgOn, picked.cellBgOff,
        `${theme} ${s.key}: the selected row's CELL background stayed ${picked.cellBgOff} ` +
        'under the pointer. The shared hover rule paints the ROW, and a cell background ' +
        'paints over it, so this state is the plain selected state and the readings on it ' +
        'are not compound readings');
      assert.notEqual(picked.cellBgOff, run.selection.unselectedCellBg,
        `${theme} ${s.key}: the selected cell and an unselected cell both compute ` +
        `${picked.cellBgOff}`);
    }
  }
});

/* The reason this file exists at all: the compound state has to be JUDGED,
   not merely reached. A run that entered it and then measured no ink inside
   it would satisfy every proof above and cover nothing. */
test('the compound state carries real ink sites, in both themes', async () => {
  const all = await sweep();
  for (const theme of THEMES) {
    for (const s of SUBJECTS.filter((x) => x.selection)) {
      const compound = all[theme][s.key].readings.filter((r) => r.selected);
      assert.ok(compound.length >= COMPOUND_INK_FLOOR,
        `${theme} ${s.key}: ${compound.length} ink site(s) judged inside the selected hovered ` +
        `row, below the declared floor of ${COMPOUND_INK_FLOOR}`);
    }
  }
});

/* ------------------------------------------- the cell-wash subject scan */

/* Decides, for a stylesheet, whether any rule in it washes a table CELL --
   by adopting each rule ALONE into a shadow root holding a probe table and
   reading what the cell computes before and after. The browser's own engine
   answers the selector and resolves the value, so no spelling of the rule can
   walk past this: `>` or descendant, class or attribute, `:is()` / `:where()`
   grouping, shorthand or longhand, `var()` or `color-mix()` indirection.

   Three things this had to get right, each of which silently returned "no
   sheet washes a cell" for a repository that plainly has one:

     - Chrome's nested-CSS support gives CSSStyleRule its OWN `.cssRules`, so
       a walk that tests `.cssRules` before `.selectorText` recurses into an
       empty list and never yields the rule.
     - A declaration containing `var()` is a pending-substitution value, so
       `rule.style.getPropertyValue('background-color')` returns the EMPTY
       STRING for `background: color-mix(in srgb, var(--cyan) 10%, transparent)`.
       Reading declarations is not value resolution. This reads the rendered
       computed value instead, which is why it needs a real element.
     - A shadow root, so the page's own copy of the sheet under test is not
       already painting the probe -- with the tokens still inheriting across
       the boundary, which is what makes `var(--cyan)` resolve at all.

   Two configurations, because a state can live on the row or on the cell:

     A `ancestor-state` -- tokens on the host/table/tbody/row, cells left
       bare. Catches `tr.is-selected > td`, `tr[aria-selected] td`, `:is(...)
       > th`, `tr.is-selected > *`.
     B `cell-state` -- tokens on the cells too, counted ONLY if an
       identically-dressed NON-cell does not also move. Without that
       differential every chip rule (`.kv .locked`) collects its sheet.

   Selectors carrying a dynamic pseudo-class the probe cannot enter are
   retried with those stripped. That can only make MORE selectors match, so
   its failure direction is over-collection -- which this contract surfaces as
   a loud diff a human resolves, not as silence. */
const CELL_WASH_SCAN = String.raw`((SHEETS) => {
  const DYNAMIC = /:(hover|focus-visible|focus-within|focus|active|target|visited)\b/g;

  const hostEl = document.createElement('div');
  document.body.appendChild(hostEl);
  const root = hostEl.attachShadow({ mode: 'open' });

  function tokens(sel) {
    /* :not(...) contents are stripped before tokens are read. Dressing the
       probe with a class the selector requires to be ABSENT defeats the rule
       and loses a real wash -- tr:not(.plain) > td { background } would go
       uncollected. Stripping can only make more selectors match. */
    const bare = sel.replace(/:not\([^()]*\)/g, '');
    return {
      classes: [...bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]),
      attrs: [...bare.matchAll(/\[\s*([\w-]+)\s*(?:[~|^$*]?=\s*("[^"]*"|'[^']*'|[^\]\s]+))?\s*\]/g)]
        .map((m) => [m[1], m[2] ? m[2].replace(/^["']|["']$/g, '') : ''])
    };
  }

  /* Every candidate carries the SAME child structure, cells and controls
     alike. A control that differs structurally from the cell is not a
     control: with empty spans standing in for a populated <td>,
     .field-error:not(:empty) matched the cell and could not match its
     own control, and the differential collected a form-error rule as a table
     cell wash. */
  function nested(tag) {
    const el = document.createElement(tag);
    const mid = document.createElement('span');
    mid.appendChild(document.createElement('span'));
    el.appendChild(mid);
    return { el, mid };
  }

  /* class is MERGED into the element's list, never assigned over it.
     setAttribute('class', ...) replaced the whole attribute, which wiped the
     tbl marker off the probe table, so every [class~="..."] spelling of a
     wash silently failed to match and was under-collected -- demonstrated on
     the real users sheet, green, measuring nothing.

     classFirst orders the merge. [class^="x"] needs x at the FRONT of the
     attribute and [class$="x"] needs it at the BACK, and one element cannot
     be both, so a rule naming the class attribute is probed in both orders.
     Only such rules pay for it. */
  function build(onCell, t, classFirst) {
    root.replaceChildren();
    const outer = document.createElement('div');
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    const thP = nested('th');
    const tdP = nested('td');
    const sibP = nested('span');
    tr.append(thP.el, tdP.el, sibP.el);
    tbody.appendChild(tr); table.appendChild(tbody); outer.appendChild(table);
    root.appendChild(outer);
    const fromAttr = [];
    for (const [n, v] of t.attrs) if (n === 'class') fromAttr.push(...v.split(/\s+/).filter(Boolean));
    const dress = (el, own) => {
      const mine = own ? [own, ...t.classes] : [...t.classes];
      const list = classFirst ? [...fromAttr, ...mine] : [...mine, ...fromAttr];
      el.setAttribute('class', [...new Set(list)].join(' '));
      for (const [n, v] of t.attrs) if (n !== 'class') el.setAttribute(n, v);
    };
    dress(outer); dress(table, 'tbl'); dress(tbody); dress(tr);
    if (onCell) [thP.el, tdP.el, sibP.el, tdP.mid].forEach((el) => dress(el));
    return { th: thP.el, td: tdP.el, sib: sibP.el, inner: tdP.mid };
  }

  /* 'rgba(0, 0, 0, 0)' and 'color(srgb 0 0 0 / 0)' are the same colour and
     compare unequal as strings, which reports a paint where there is none.
     Chromium serialises color-mix() in the second form. */
  function canon(v) {
    const n = (v.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    if (/^color\(/.test(v)) {
      const a = /\//.test(v) ? n.pop() : 1;
      return [...n.slice(-3).map((x) => x * 255), a];
    }
    if (/^rgba?\(/.test(v)) return [...n.slice(0, 3), n.length > 3 ? n[3] : 1];
    return null;
  }
  function sameColor(a, b) {
    const x = canon(a); const y = canon(b);
    if (!x || !y) return a === b;
    if (x[3] === 0 && y[3] === 0) return true;
    return x.every((v, i) => Math.abs(v - y[i]) < 0.5);
  }
  function bg(el) {
    const s = getComputedStyle(el);
    return { c: s.backgroundColor, i: s.backgroundImage };
  }
  function moved(a, b) { return !sameColor(a.c, b.c) || a.i !== b.i; }

  function* styleRules(list) {
    for (const r of list) {
      if (r.selectorText !== undefined) yield r;
      if (r.cssRules && r.cssRules.length) yield* styleRules(r.cssRules);
    }
  }

  function washes(cssText, sel) {
    let one;
    try { one = new CSSStyleSheet(); one.replaceSync(cssText); } catch (e) { return null; }
    if (!one.cssRules.length) return null;
    const t = tokens(sel);
    const orders = t.attrs.some(([n]) => n === 'class') ? [false, true] : [false];
    for (const classFirst of orders) for (const onCell of [false, true]) {
      const p = build(onCell, t, classFirst);
      const before = [bg(p.th), bg(p.td), bg(p.sib), bg(p.inner)];
      root.adoptedStyleSheets = [one];
      const after = [bg(p.th), bg(p.td), bg(p.sib), bg(p.inner)];
      root.adoptedStyleSheets = [];
      const thMoved = moved(before[0], after[0]);
      const tdMoved = moved(before[1], after[1]);
      const nonCell = moved(before[2], after[2]) || moved(before[3], after[3]);
      if ((thMoved || tdMoved) && (!onCell || !nonCell)) {
        return {
          how: onCell ? 'cell-state' : 'ancestor-state',
          where: [thMoved && 'th', tdMoved && 'td'].filter(Boolean).join('+'),
          value: (thMoved ? after[0] : after[1]).c
        };
      }
    }
    return null;
  }

  const out = {};
  const errors = {};
  let scanned = 0;
  for (const [rel, text] of Object.entries(SHEETS)) {
    const sheet = new CSSStyleSheet();
    try { sheet.replaceSync(text); } catch (e) { errors[rel] = String(e); continue; }
    const hits = [];
    for (const rule of styleRules(sheet.cssRules)) {
      const sel = rule.selectorText;
      if (!sel) continue;
      scanned++;
      let hit = washes(rule.cssText, sel);
      if (!hit) {
        const bare = sel.replace(DYNAMIC, '');
        if (bare !== sel && bare.trim()) {
          hit = washes(rule.cssText.replace(sel, bare), bare);
          if (hit) hit.via = 'dynamic-stripped';
        }
      }
      if (hit) hits.push({ sel: sel.slice(0, 120), ...hit });
    }
    if (hits.length) out[rel] = hits;
  }
  hostEl.remove();

  /* Reported so a caller can prove the tokens resolved. A scan run where
     var(--cyan) is unresolvable computes every wash to transparent and finds
     NOTHING, which is a silent pass. Asserted on the Node side. */
  return JSON.stringify({
    found: out, errors, scanned,
    cyan: getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim()
  });
})(__SHEETS__)`;

async function scanForCellWash(sheets) {
  return await evalJson(CELL_WASH_SCAN.replace('__SHEETS__', JSON.stringify(sheets)));
}

/* The spellings the previous regex could not see, plus the shapes that must
   NOT collect a sheet. Run through the same scanner on every run, so this
   file carries its own proof of sensitivity instead of asserting it once in a
   pull request and then drifting. */
const SCAN_SELF_TEST = {
  'want/child-class.css': '.tbl tbody tr.is-selected > td { background: color-mix(in srgb, var(--cyan) 10%, transparent); }',
  'want/descendant.css': '.tbl tbody tr.is-selected td { background: var(--cyan); }',
  'want/attribute.css': '.tbl tbody tr[aria-selected="true"] > td { background: var(--cyan); }',
  'want/attribute-bare.css': '.tbl tbody tr[data-picked] td { background-color: var(--cyan); }',
  'want/is-group.css': '.tbl tbody :is(tr.is-selected, tr.is-pinned) > th { background: var(--cyan); }',
  'want/where-group.css': '.tbl :where(tr.is-flagged) td { background-image: linear-gradient(var(--cyan), var(--cyan)); }',
  'want/universal-child.css': '.tbl tbody tr.is-selected > * { background: var(--cyan); }',
  'want/cell-class.css': 'td.is-tinted { background: var(--cyan); }',
  'want/hover-only.css': '.tbl tbody tr.is-selected:hover > td { background: var(--cyan); }',
  'want/nested.css': '@media (min-width: 100px) { .tbl tbody tr.is-selected > td { background: var(--cyan); } }',
  /* `:not(...)` in both directions. A wash the selector guards with an
     absence must still be collected (want/not-guard), and a rule that is NOT
     a cell wash must not be collected just because its own `:not()` is
     unsatisfiable on a bare control (skip/not-empty -- the real
     `.field-error:not(:empty)` in pane-evaluations-v2.css, which this probe
     collected in error until the controls were made non-empty too). */
  /* The `class` attribute in all four of its matching forms. These are the
     spellings the probe lost when dress() overwrote `class` instead of
     merging into it: the `tbl` marker went with the assignment, so the
     selector could not match and the wash was silently uncollected. */
  'want/class-word.css': '.tbl tbody tr[class~="is-selected"] > td { background: var(--cyan); }',
  'want/class-sub.css': '.tbl tbody tr[class*="is-select"] > td { background: var(--cyan); }',
  'want/class-prefix.css': '.tbl tbody tr[class^="is-selected"] > td { background: var(--cyan); }',
  'want/class-suffix.css': '.tbl tbody tr[class$="selected"] > td { background: var(--cyan); }',
  'want/not-guard.css': '.tbl tbody tr:not(.plain) > td { background: var(--cyan); }',
  'skip/not-empty.css': '.field-error:not(:empty) { background: var(--cyan); }',
  'skip/row-level.css': '.tbl tbody tr.is-selected { background: var(--cyan); }',
  'skip/chip.css': '.kv .locked { background: var(--cyan); }',
  'skip/no-paint.css': '.tbl tbody tr.is-selected > td { color: var(--cyan); box-shadow: inset 3px 0 0 var(--cyan); }',
  'skip/transparent.css': '.tbl tbody tr.is-selected > td { background: transparent; }'
};

/* The universe the contract is about. A cell wash is only the hazard this
   file sweeps where it lands on the SAME page as `aria.css`'s row hover tint
   -- that is the compound surface. `ops.css` washes cells too (`table.data
   th`, `.cohort td.na`) and is irrelevant here, because the only pages that
   load it, login and setup, do not load `aria.css` at all. Resolved from the
   pages rather than excluded by name, so a page that starts loading both is
   picked up instead of sailing past a hard-coded exception. */
function v2Sheets() {
  const pages = fs.readdirSync(path.join(ROOT, 'ops')).filter((f) => f.endsWith('.html'));
  const universe = new Set();
  let sawAria = false;
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, 'ops', page), 'utf8');
    const hrefs = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
      .map((m) => /href=["']([^"']+)["']/i.exec(m[0]))
      .filter(Boolean)
      .map((m) => path.posix.normalize(path.posix.join('ops', m[1])));
    if (!hrefs.includes('ops/assets/aria.css')) continue;
    sawAria = true;
    for (const h of hrefs) universe.add(h);
  }
  assert.ok(sawAria, 'no ops page links aria.css -- the scan universe resolved empty');
  return [...universe].sort();
}

/* The subject list is a literal, so it can go stale the moment another pane
   grows a cell wash. This resolves the question by MATCHING and PAINTING
   rather than by recognising a string, and insists every sheet carrying a
   cell wash is a subject swept above. A new pane's wash fails here instead of
   going unmeasured. Stadiora/Aria#10764. */
test('the cell-wash scan collects every spelling in its fixture map, and only a wash', async () => {
  await sweep();
  await setTheme('dark', true);
  await load(base + SUBJECT_USERS);

  const res = await scanForCellWash(SCAN_SELF_TEST);
  assert.deepEqual(res.errors, {}, `the scanner could not parse its own fixtures: ${JSON.stringify(res.errors)}`);
  assert.ok(res.cyan, 'the page resolved --cyan to nothing, so every wash computes transparent and the scan is blind');

  const want = Object.keys(SCAN_SELF_TEST).filter((k) => k.startsWith('want/')).sort();
  const got = Object.keys(res.found).sort();
  process.stderr.write(
    `scan self-test: ${res.scanned} rule(s), ${want.length} spelling(s) that must be seen, ` +
    `${Object.keys(SCAN_SELF_TEST).length - want.length} that must not, ${got.length} collected\n`);
  assert.deepEqual(got, want,
    'the scanner does not bind the spellings it claims to. Missing: ' +
    JSON.stringify(want.filter((w) => !got.includes(w))) + '; collected in error: ' +
    JSON.stringify(got.filter((g) => !want.includes(g))) +
    '. Detail: ' + JSON.stringify(res.found));
});

test('every sheet that washes a table CELL on an aria.css page is a subject this sweep drives', async () => {
  await sweep();
  await setTheme('dark', true);
  await load(base + SUBJECT_USERS);

  const universe = v2Sheets();
  assert.ok(universe.includes('ops/assets/aria.css'),
    `the universe resolved without aria.css: ${JSON.stringify(universe)}`);

  const sheets = Object.fromEntries(universe.map((rel) => [rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')]));
  const res = await scanForCellWash(sheets);
  assert.deepEqual(res.errors, {}, `a stylesheet would not parse: ${JSON.stringify(res.errors)}`);
  assert.ok(res.cyan, 'the page resolved --cyan to nothing, so every wash computes transparent and the scan is blind');
  process.stderr.write(
    `cell-wash scan: ${universe.length} sheet(s) on aria.css pages, ${res.scanned} rule(s) matched+painted, ` +
    `${Object.keys(res.found).length} washing a cell: ${JSON.stringify(Object.keys(res.found))}\n`);

  assert.deepEqual(Object.keys(res.found).sort(), [...SELECTION_SUBJECTS].sort(),
    'a stylesheet puts a background on a table CELL in a state the shared hover rule cannot ' +
    'reach, and it is not in SELECTION_SUBJECTS. Such a wash paints OVER the row tint this ' +
    'file sweeps, so it is a backdrop nothing measures until a subject drives it. Found: ' +
    JSON.stringify(res.found, null, 1));

  for (const rel of SELECTION_SUBJECTS) {
    const pane = path.basename(rel).replace(/^pane-|-v2\.css$/g, '');
    assert.ok(SUBJECTS.some((s) => s.selection && s.url.includes(pane)),
      `${rel} washes a cell but no subject with a selection drives ${pane}`);
  }
});

test('the sweep judged a real board, not an empty one', async () => {
  const all = await sweep();
  for (const theme of THEMES) {
    for (const s of SUBJECTS) {
      const { rowCount } = all[theme][s.key];
      assert.ok(rowCount >= s.rowFloor,
        `${theme} ${s.key}: the page drew ${rowCount} table row(s) of its own, below the ` +
        `declared floor of ${s.rowFloor} -- the composed tone rows do not count toward it`);
    }
    const { readings } = all[theme].releases;
    assert.ok(readings.length > 0, `${theme}: zero ink sites measured`);
    const organic = new Set(readings.filter((r) => r.tone && !r.matrix).map((r) => r.tone));
    for (const t of TONES_EXPECTED) {
      assert.ok(organic.has(t),
        `${theme}: tone .pill.${t} never appeared inside a hovered row the PAGE drew; ` +
        `saw ${[...organic].sort().join(', ') || 'none'}`);
    }
    const composed = new Set(readings.filter((r) => r.matrix).map((r) => r.tone));
    for (const t of TONES_ALL) {
      assert.ok(composed.has(t),
        `${theme}: the tone matrix judged no ink for .pill.${t}; ` +
        `saw ${[...composed].sort().join(', ') || 'none'}`);
    }
  }
});

/* The other half of the compound state. A selected row carries its wash with
   or without a pointer on it, and the hovered reading is a STEP UP from this
   one, so a repaint that cleared only the hovered half would leave the state
   underneath it failing while this file reported the pane safe. Bound in its
   own test, and printed, so the two halves can never be confused for each
   other in a log. */
test('the selected row clears AA unhovered as well, not only under the pointer', async () => {
  const all = await sweep();
  const failures = [];
  for (const theme of THEMES) {
    for (const s of SUBJECTS.filter((x) => x.selection)) {
      const rs = [...all[theme][s.key].unhovered].sort((a, b) => a.ratio - b.ratio);
      assert.ok(rs.length >= COMPOUND_INK_FLOOR,
        `${theme} ${s.key}: ${rs.length} ink site(s) judged on the selected row unhovered, ` +
        `below the declared floor of ${COMPOUND_INK_FLOOR}`);
      console.log(`\n${theme}: selected, NOT hovered -- ${rs.length} site(s), worst three:`);
      for (const r of rs.slice(0, 3)) {
        console.log(`  ${r.ratio.toFixed(3)}  ` +
          `${(r.tone ? '.pill.' + r.tone : r.tag + (r.cls ? '.' + r.cls.split(/\s+/).join('.') : '')).padEnd(22)} ` +
          `ink ${r.ink} on ${hex(r.backdrop)}  "${r.text}"`);
      }
      for (const r of rs) if (r.ratio < AA) failures.push(r);
    }
  }
  assert.deepEqual(failures.map((f) =>
    `${f.theme} ${f.subject} selected "${f.text}" ${f.ratio} on ${hex(f.backdrop)}`), [],
  `ink below the ${AA}:1 floor on a selected row that is not hovered`);
});

test('every ink inside a hovered table row clears AA against what is under it', async () => {
  const all = await sweep();
  const failures = [];
  let judged = 0;
  for (const theme of THEMES) {
    for (const r of allReadings(all[theme])) {
      judged++;
      if (r.ratio < AA) failures.push(r);
    }
  }
  /* Printed per theme so a CI log shows the sweep entered both and judged a
     non-zero number of sites in each. A hover sweep that silently judged
     nothing is the worst false green available here, and a count of zero is
     an assertion failure below, not a quiet pass. */
  for (const theme of THEMES) {
    const rs = allReadings(all[theme]).sort((a, b) => a.ratio - b.ratio);
    const rows = SUBJECTS.reduce((n, s) => n + all[theme][s.key].engagement.length, 0);
    const compound = rs.filter((r) => r.selected).length;
    console.log(`\n${theme}: ${rs.length} hovered ink site(s) judged, ` +
      `${rows} row(s) hovered, ${compound} of them selected + hovered; worst five:`);
    for (const r of rs.slice(0, 5)) {
      console.log(`  ${r.ratio.toFixed(3)}  ${r.subject.padEnd(9)}` +
        `${(r.selected ? 'sel+hov ' : '        ')}` +
        `${(r.tone ? '.pill.' + r.tone : r.tag + (r.cls ? '.' + r.cls.split(/\s+/).join('.') : '')).padEnd(22)} ` +
        `ink ${r.ink} on ${hex(r.backdrop)}  "${r.text}"`);
    }
    /* The compound state's own worst sites, printed whether or not they fail,
       so #10754's numbers are in the log of every run rather than only in the
       run that catches a regression. */
    const sel = rs.filter((r) => r.selected);
    if (sel.length) {
      console.log(`${theme}: selected + hovered, worst three of ${sel.length}:`);
      for (const r of sel.slice(0, 3)) {
        console.log(`  ${r.ratio.toFixed(3)}  ` +
          `${(r.tone ? '.pill.' + r.tone : r.tag + (r.cls ? '.' + r.cls.split(/\s+/).join('.') : '')).padEnd(22)} ` +
          `ink ${r.ink} on ${hex(r.backdrop)}  "${r.text}"`);
      }
    }
  }
  assert.ok(judged > 0, 'the sweep judged nothing, which is not a pass');
  assert.deepEqual(failures.map((f) =>
    `${f.theme} ${f.subject}${f.selected ? ' selected+hovered' : ''} ` +
    `${f.tone ? '.pill.' + f.tone : f.tag + '.' + f.cls} "${f.text}" ` +
    `${f.ratio} on ${hex(f.backdrop)}`), [],
  `ink below the ${AA}:1 floor inside a hovered row`);

  if (process.env.OPS_HOVER_CENSUS) {
    console.log('OPS_HOVER_CENSUS_JSON_BEGIN');
    console.log(JSON.stringify(THEMES.reduce((acc, theme) => {
      const row = (r, state) => ({
        subject: r.subject, state, tone: r.tone, tag: r.tag, cls: r.cls,
        text: r.text, ink: r.ink, backdrop: r.backdrop, ratio: r.ratio
      });
      acc[theme] = [
        ...allReadings(all[theme]).map((r) =>
          row(r, r.selected ? 'selected+hovered' : 'hovered')),
        ...SUBJECTS.filter((s) => s.selection)
          .flatMap((s) => all[theme][s.key].unhovered).map((r) => row(r, 'selected'))
      ];
      return acc;
    }, {}), null, 1));
    console.log('OPS_HOVER_CENSUS_JSON_END');
  }
});
