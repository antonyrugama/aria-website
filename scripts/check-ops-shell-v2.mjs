/* Guards the v2 operations shell against the five ways it can break silently.

   None of these can be caught by reading the source. A design system is a set
   of names that only mean anything once a browser has resolved them, and every
   failure below is one where the page still renders, the console stays quiet,
   and the thing is simply wrong:

     1. A token reference that does not exist. `var(--bg-2)` where the
        stylesheet declares no --bg-2 paints nothing at all — no error, no
        warning, no fallback. Every custom property aria.css and aria.js name
        is resolved here through getComputedStyle, which is what the browser
        itself does, rather than matched against the source text.

     2. The preview-state mechanism forcing a display type. Visibility is keyed
        on an attribute so a shown element keeps its own display, and the
        failure mode is invisible in the one case people test: a .stack reads
        as block either way, while a <tr>, a .pill and a .card are destroyed.
        So the assertion is on the computed display of five different element
        types, in every one of the four states.

     3. The pre-paint theme. theme.js applies the theme before first paint and
        aria.js only corrects things after boot, so a check that runs after
        boot cannot see a disagreement between them: the page paints one theme,
        switches, and the test measures the second one. The pre-paint path is
        therefore measured with aria.js BLOCKED, which is the only state in
        which the two can be told apart.

     4. A console error on a pane. This shell is additive — no pane file was
        touched — and the cheapest proof of that is to load every one of them
        and listen.

     5. An icon that draws nothing. Icons take their colour from currentColor
        rather than from a token, so they are not vulnerable to (1) — which is
        why the chart sweep excluded them, and why deleting stroke from icon()
        left sixty invisible icons and a green build (#10308). They get their
        own sweep, with their own count and their own message, over the same
        paint helpers so the two cannot drift, and each sweep marks what it
        swept so that an <svg> claimed by neither is itself a failure.

   Usage:  node scripts/check-ops-shell-v2.mjs
   Chrome: CHROME_PATH, or the usual install locations.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = '/ops/shell-v2.html';
const THEMES = ['dark', 'light'];
const STATES = ['live', 'loading', 'empty', 'degraded'];

/* Every pane page, so a change to the shared assets that broke one of them
   shows up here rather than in production. */
const PANES = [
  '/ops/index.html', '/ops/jobs-live.html', '/ops/run-history.html',
  '/ops/alerts.html', '/ops/analytics.html', '/ops/spend.html',
  '/ops/evaluations.html', '/ops/releases.html', '/ops/users.html',
  '/ops/settings.html', '/ops/login.html', '/ops/setup.html'
];

/* The one value the pre-paint probe reads, where reading the whole palette
   would mean shipping the palette twice. The whole palette is pinned in
   PALETTE below and checked on the booted page; this is the sentinel for
   "which theme painted", not a claim that the palette is only two values. */
const CYAN = { dark: '#22D3EE', light: '#0891B2' };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

/* ------------------------------------------------------------------ stub */

const NOW = Date.parse('2026-08-01T09:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const ADMIN = { id: 'adm_1', email: 'owner@example.invalid', name: 'Owner', role: 'owner' };
const SESSION = { id: 'ses_1', createdAt: ago(600000), lastSeenAt: ago(1000), userAgent: 'check' };

/* Deliberately thin. This check is not testing what a pane draws, it is
   testing that loading it against the shared assets raises nothing, so every
   unknown route answers an empty envelope and a pane that cannot find its
   figures renders its own empty state — which is a state it has to handle. */
function stub(pathname) {
  if (pathname.startsWith('/api/ops/auth/refresh') || pathname.startsWith('/api/ops/auth/login')) {
    return { data: {
      accessToken: 'stub-access', expiresIn: 900, refreshToken: 'stub-refresh-2',
      refreshTokenRotated: true, authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900,
      admin: ADMIN, session: SESSION
    } };
  }
  if (pathname.startsWith('/api/ops/auth/session')) {
    return { data: {
      admin: ADMIN, session: SESSION,
      authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900
    } };
  }
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

/* ------------------------------------------------------------------- CDP */

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

/* Chrome writes the port it actually took to DevToolsActivePort. Asking it
   rather than dictating a port keeps two runs on one machine from silently
   driving each other's browser. */
async function devtoolsPort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
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
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
      return;
    }
    for (const l of listeners) l(m);
    seen.add(m.method);
    for (const w of waiters.splice(0)) w(m.method);
  };
  return {
    ready: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    close: () => ws.close(),
    on(fn) { listeners.push(fn); },
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

/* ----------------------------------------------------------------- probes */

/* Three things measured on the booted page: every custom property :root
   declares, resolved the way the browser resolves it; every property name
   aria.css references through var(); and the value each token that differs
   between the themes actually holds. A name referenced but not declared
   paints nothing. A token that resolves but holds the wrong value paints the
   wrong design — which is the failure mode a resolution check cannot see. */
/* The set of tokens aria.css is required to declare, written here and not read
   out of the stylesheet. Deriving the expectation from the file under test is
   how the first version of this check passed while --cyan-lit was renamed to
   --cyan-lite: it asked the stylesheet what it declared, then asked whether
   those names resolved, and of course they did.

   The first 26 are the set issue #9945 names, minus --bg-2, which the mock
   neither declares nor references (inventing it would be worse). The six -ink
   tokens arrive with the palette's WCAG AA fix (monorepo #10042) and are the
   whole reason status text clears contrast in light. */
const REQUIRED_TOKENS = [
  '--cyan', '--cyan-lit', '--violet', '--emerald', '--amber', '--rose', '--blue',
  '--bg', '--surface', '--surface-2', '--surface-3',
  '--ink', '--ink-2', '--ink-3',
  '--line', '--line-2', '--edge',
  '--shadow-1', '--shadow-2', '--shadow-3',
  '--r-sm', '--r', '--r-lg', '--r-xl',
  '--rail', '--sans', '--mono',
  '--cyan-ink', '--violet-ink', '--emerald-ink', '--amber-ink', '--rose-ink', '--blue-ink',
];

/* Every token whose value differs between the two themes, with the value each
   one is required to hold. Taken from docs/mocks/ops-dashboard-v2/assets/
   aria.css in the Aria monorepo, which is the source of truth: issue #9945
   says the light palette is ported AS WRITTEN, not derived, because a
   mechanical inversion of the dark set fails contrast on white.
 
   All 26, not a sample, and with INVARIANT below that is all 33 tokens plus
   color-scheme. Pinning --cyan alone leaves twelve meaning-bearing
   light values free to move, and the one that matters most is not --cyan: the
   six -ink tokens are the WCAG AA fix from monorepo #10042, and deleting one
   of them silently falls back to :root, where it resolves to the bright base
   colour and drops status text to about 3:1 on its own tint.

   The dark -ink entries are the resolved value, not the literal var(--cyan)
   the file writes, because a custom property's computed value is already
   substituted. Dark is where base and ink are the same colour; light is where
   they diverge.

   INVARIANT holds the seven tokens that are deliberately the SAME in both
   themes — geometry and type, which carry no meaning a theme could change.
   They are pinned for the opposite reason to the palette: a theme block that
   quietly redefined --rail or --mono would be a departure from the design
   nothing else here would notice. color-scheme rides along because it decides
   the colour of things the page does not paint — form controls, scrollbars,
   the canvas behind an overscroll — and it is per-theme, not invariant. */
const INVARIANT = {
  '--r-sm': '8px', '--r': '12px', '--r-lg': '16px', '--r-xl': '22px',
  '--rail': '244px',
  '--sans': "'Geist', 'Inter Tight', 'Inter', -apple-system, system-ui, sans-serif",
  '--mono': "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
};

const COLOR_SCHEME = { dark: 'dark', light: 'light' };

const PALETTE = {
  dark: {
    '--cyan': '#22D3EE', '--cyan-lit': '#67E8F9', '--violet': '#A78BFA',
    '--emerald': '#34D399', '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
    '--cyan-ink': '#22D3EE', '--violet-ink': '#A78BFA', '--emerald-ink': '#34D399',
    '--amber-ink': '#FBBF24', '--rose-ink': '#FB7185', '--blue-ink': '#60A5FA',
    '--bg': '#06080B', '--surface': '#0E1218', '--surface-2': '#141A22', '--surface-3': '#1B222C',
    '--ink': '#E8EEF6', '--ink-2': '#97A6BA', '--ink-3': '#7E8DA3',
    '--line': 'rgba(255, 255, 255, .07)', '--line-2': 'rgba(255, 255, 255, .11)',
    '--edge': 'rgba(255, 255, 255, .06)',
    '--shadow-1': '0 1px 2px rgba(0,0,0,.4)',
    '--shadow-2': '0 4px 16px -4px rgba(0,0,0,.5), 0 1px 3px rgba(0,0,0,.3)',
    '--shadow-3': '0 18px 48px -12px rgba(0,0,0,.7), 0 4px 12px rgba(0,0,0,.4)',
  },
  light: {
    '--cyan': '#0891B2', '--cyan-lit': '#06A9CC', '--violet': '#7C3AED',
    '--emerald': '#059669', '--amber': '#B45309', '--rose': '#E11D48', '--blue': '#2563EB',
    '--cyan-ink': '#155E75', '--violet-ink': '#5B21B6', '--emerald-ink': '#065F46',
    '--amber-ink': '#92400E', '--rose-ink': '#9F1239', '--blue-ink': '#1E40AF',
    '--bg': '#F4F7FB', '--surface': '#FFFFFF', '--surface-2': '#F7FAFD', '--surface-3': '#EDF2F8',
    '--ink': '#0B1220', '--ink-2': '#4A5B70', '--ink-3': '#55637A',
    '--line': 'rgba(11, 18, 32, .09)', '--line-2': 'rgba(11, 18, 32, .15)',
    '--edge': 'rgba(255, 255, 255, .9)',
    '--shadow-1': '0 1px 2px rgba(11,18,32,.06)',
    '--shadow-2': '0 4px 14px -4px rgba(11,18,32,.10), 0 1px 3px rgba(11,18,32,.06)',
    '--shadow-3': '0 18px 44px -14px rgba(11,18,32,.18), 0 3px 10px rgba(11,18,32,.07)',
  },
};

/* Every var(--x) aria.css actually asks for, read off the file. A reference to
   a property that does not exist resolves to the empty string and the browser
   silently drops the declaration — no error, no log, just a missing colour.
   Component-scoped properties (--c, --st, --acc) are set on the elements that
   use them rather than on :root, so they are excluded here and checked by
   being visible at all.

   aria.js does not reference tokens by name in a var(): it reads them with
   getPropertyValue('--' + tone), where the tone comes from a data attribute
   or from the page's own chart config. A scan of this shape cannot see those
   — the name is assembled at runtime — and neither can the palette check,
   because a name that is not a token was never in the stylesheet to compare.
   They are caught downstream instead, on the paint that reached the page:
   SHELL_PROBE fails any chart shape that arrives with no stroke and no fill,
   which is exactly what an unresolved tone produces. */
const LOCAL_TOKENS = new Set(['--c', '--st', '--acc']);
const REFERENCED = [...new Set(
  fs.readFileSync(new URL('../ops/assets/aria.css', import.meta.url), 'utf8')
    .match(/var\(\s*(--[a-z0-9-]+)/g) || []
)].map((m) => m.replace(/var\(\s*/, '')).filter((n) => !LOCAL_TOKENS.has(n));

const TOKENS = (theme) => `(() => {
  const required = ${JSON.stringify(REQUIRED_TOKENS)};
  const referenced = ${JSON.stringify(REFERENCED)};
  const palette = Object.assign({}, ${JSON.stringify(PALETTE[theme])}, ${JSON.stringify(INVARIANT)});
  const colorScheme = ${JSON.stringify(COLOR_SCHEME[theme])};
  const declared = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of rules || []) {
      if (!rule.selectorText || rule.selectorText.indexOf(':root') !== 0) continue;
      for (const name of rule.style) if (name.startsWith('--') && !declared.includes(name)) declared.push(name);
    }
  }
  const computed = getComputedStyle(document.documentElement);
  const read = (n) => computed.getPropertyValue(n).trim().replace(/\\s+/g, ' ').toUpperCase();
  const empty = (n) => computed.getPropertyValue(n).trim() === '';
  const wrong = Object.keys(palette)
    .filter((n) => read(n) !== palette[n].replace(/\\s+/g, ' ').toUpperCase())
    .map((n) => n + ' is ' + (computed.getPropertyValue(n).trim() || '(nothing)') +
      ', the palette writes ' + palette[n]);
  if (computed.colorScheme.trim() !== colorScheme) {
    wrong.push('color-scheme is ' + (computed.colorScheme.trim() || '(nothing)') +
      ', the design writes ' + colorScheme);
  }
  return JSON.stringify({
    declared,
    palettePinned: Object.keys(palette).length,
    wrong,
    missingRequired: required.filter(empty),
    unreferencedExtras: declared.filter((n) => !required.includes(n)),
    danglingReferences: referenced.filter(empty),
    referencedCount: referenced.length,
    unresolved: declared.filter(empty),
    cyan: computed.getPropertyValue('--cyan').trim(),
    theme: document.documentElement.getAttribute('data-theme')
  });
})()`;

/* Every element carrying data-state, with what the browser computed for it.
   Reported whole rather than sampled: the failure this guards against is a
   visibility rule that forces one display type, and sampling one element per
   state is how that gets missed. */
const STATE_PROBE = (state) => `(() => {
  window.Aria.applyState(${JSON.stringify(state)});
  const els = [...document.querySelectorAll('[data-state]')].map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: el.getAttribute('class') || '',
    states: el.getAttribute('data-state').split(/\\s+/),
    shown: el.hasAttribute('data-shown'),
    display: getComputedStyle(el).display
  }));
  return JSON.stringify({
    els,
    segPressed: [...document.querySelectorAll('#stateSeg button[aria-pressed="true"]')]
      .map((b) => b.getAttribute('data-value'))
  });
})()`;

/* ------------------------------------------------------------ paint */

/* Paint, as the browser resolved it. Shared verbatim by the chart sweep and
   the icon sweep, because two copies of this drift and the drift is silent:
   each sweep goes on passing on the class it still understands.

   Three things it has to get right, every one of them learned by running a
   mutation rather than by reading the code:

   - The empty attribute is the fingerprint, not the computed value. A colour
     that resolved to nothing is written as stroke="" — an invalid
     presentation attribute, which the browser drops and then reports the
     INHERITED default for, so getComputedStyle alone reads a plausible lie:
     `none` where a stroke is missing, black where a fill is. Presentation
     attributes inherit, so the nearest ancestor-or-self carrying the
     attribute is the one that decides what this shape asked for.
   - A paint can be a live reference. fill="url(#id)" is not `none`, and the
     gradient it names can hold the empty colour in every one of its stops.
   - Alpha is a number, not a string. Matching the text 'rgba(0, 0, 0, 0)'
     misses `color(srgb 0 0 0 / 0)`, which is how Chromium serialises a
     color-mix() — the shape of monorepo #10255, where a parser that only
     understood rgb() silently dropped 40 sites and 10 real failures with
     them. So the value is parsed, and a syntax this cannot read is reported
     LOUDLY. A checker that skips what it cannot read is worse than no
     checker: it reports a coverage it does not have. */
const PAINT_HELPERS = `
  const PAINTABLE = 'path, rect, circle, line, polyline, polygon, ellipse';
  const SVG_SET = '.wrap svg, main svg, .page svg, #view svg, body svg';

  /* Alpha is all this needs: whether the shape paints, not what colour. */
  const alphaOf = (value) => {
    const s = String(value === null || value === undefined ? '' : value).trim();
    if (!s || s === 'none') return { kind: 'none' };
    if (s === 'transparent') return { kind: 'colour', a: 0 };
    const num = (t) => (/%$/.test(t) ? Number(t.slice(0, -1)) / 100 : Number(t));
    let m = s.match(/^rgba?\\(([^)]*)\\)$/i);
    if (!m) m = s.match(/^color\\(\\s*[a-z0-9-]+([^)]*)\\)$/i);
    if (m) {
      const parts = m[1].trim().split(/[\\s,\\/]+/).filter(Boolean);
      if (parts.length === 3) return { kind: 'colour', a: 1 };
      if (parts.length === 4) {
        const a = num(parts[3]);
        if (!Number.isNaN(a)) return { kind: 'colour', a: a };
      }
    }
    return { kind: 'unreadable' };
  };

  /* null when the shape paints through this channel, otherwise why it does
     not. kind is what the caller keys on; why is what a person reads. */
  const dead = (el, prop) => {
    let carrier = el;
    while (carrier && carrier.getAttribute && !carrier.hasAttribute(prop)) {
      carrier = carrier.parentElement;
      if (carrier && carrier.namespaceURI !== 'http://www.w3.org/2000/svg') carrier = null;
    }
    if (carrier && carrier.getAttribute(prop) === '') {
      return { kind: 'empty-attribute', why: prop + '="" on <' + carrier.tagName +
        '>, which the browser drops — the colour asked for resolved to nothing' };
    }
    const v = getComputedStyle(el)[prop];
    const ref = (v || '').trim().startsWith('url(')
      ? (v.slice(v.indexOf('#') + 1).split(/[)"']/)[0] || '') : '';
    if (ref) {
      const def = document.getElementById(ref);
      if (!def) return { kind: 'missing-ref', why: prop + ' points at #' + ref + ', which does not exist' };
      const stops = [...def.querySelectorAll('stop')];
      if (stops.length && stops.every((s) => s.getAttribute('stop-color') === ''))
        return { kind: 'gradient-empty', why: prop + ' is a gradient whose stops hold no colour' };
      return null;
    }
    const paint = alphaOf(v);
    if (paint.kind === 'unreadable') {
      return { kind: 'unreadable', why: prop + ' is ' + v + ', a colour syntax this check ' +
        'cannot read. Teach alphaOf() the syntax; do not let the sweep skip the shape.' };
    }
    if (paint.kind === 'none') return { kind: 'no-paint', why: prop + ' is ' + (v || 'empty') };
    if (paint.a === 0) return { kind: 'no-paint', why: prop + ' is ' + v + ', which is fully transparent' };
    /* A stroke of zero width is a colour that draws nothing. This is the one
       geometry property read here, and only for the stroke channel: it is the
       channel every icon paints through, so a rule that zeroes it blanks the
       icon while every colour still resolves. Nothing else about geometry —
       opacity, visibility, display, size, viewBox — is read at all. */
    if (prop === 'stroke') {
      const w = getComputedStyle(el).strokeWidth;
      const n = parseFloat(w);
      if (Number.isNaN(n)) {
        return { kind: 'unreadable', why: 'stroke resolves to ' + v + ' but stroke-width is ' +
          w + ', a width this check cannot read. Teach dead() the syntax; do not let the ' +
          'sweep skip the shape.' };
      }
      if (n === 0) {
        return { kind: 'no-paint', why: 'stroke is ' + v + ' but stroke-width is ' + w +
          ', so the stroke draws nothing' };
      }
    }
    return null;
  };

  /* Both channels dead, or one channel whose paint was asked for and came
     back as nothing. A missing gradient reference on its own is not enough:
     the other channel may still be painting the shape. */
  const verdict = (el) => {
    const found = ['stroke', 'fill'].map((p) => dead(el, p)).filter(Boolean);
    const unreadable = found.filter((f) => f.kind === 'unreadable');
    if (unreadable.length) return { unreadable: true, why: unreadable.map((f) => f.why).join(', ') };
    const fatal = found.some((f) => f.kind === 'empty-attribute' || f.kind === 'gradient-empty');
    if (found.length === 2 || fatal) {
      return {
        unpainted: true,
        emptyAttribute: found.some((f) => f.kind === 'empty-attribute'),
        why: found.map((f) => f.why).join(', ')
      };
    }
    return null;
  };
`;

/* What survived boot. Every figure here is a fact the shell is responsible for
   and none of it can be read off the source: the rail is generated, the icons
   are swapped in place, and the chart names are derived from the data. */
const SHELL_PROBE = `(() => {
  ${PAINT_HELPERS}
  const named = [...document.querySelectorAll('svg.chart[role="img"]')]
    .map((s) => s.getAttribute('aria-label'));

  /* aria.js reads its tones with getPropertyValue('--' + tone), which returns
     the empty string for a name that is not a token — misspelled in the
     renderer, or misspelled in the page data that names the tone. The empty
     string is an invalid presentation attribute, so the browser ignores it and
     the shape falls back to no paint: a chart that is named correctly, sized
     correctly, throws nothing, and draws nothing. Neither the resolution check
     nor the palette check can see it, because the name asked for was never in
     the stylesheet to compare against.

     Three things this has to get right, each of which it got wrong first and
     was caught by running the mutation rather than by reading the code:
     - the gauge's svg carries no class, so a selector of svg.chart misses it;
     - a bar is fill="url(#id)", a live reference to a gradient whose stops
       hold the empty colour, so the paint is not none and has to be followed;
     - the empty attribute is the fingerprint, not the computed value, because
       the browser reports the inherited default once it drops the attribute.
     All three now live in PAINT_HELPERS, which the icon sweep shares. */
  const chartSvgs = [...document.querySelectorAll(SVG_SET)]
    .filter((s) => !s.classList.contains('ico'));
  /* Marked, not counted. The icon sweep asserts that the two sweeps partition
     every <svg> on the page, and an assertion that re-runs this selector to
     learn what this sweep saw is a second copy that drifts the moment this one
     narrows — the partition would then be computed from a set nobody swept.
     The mark IS the swept set, so narrowing here shows up there. */
  for (const s of chartSvgs) s.__sweptAsChart = true;
  const shapes = chartSvgs
    .flatMap((s) => [...s.querySelectorAll(PAINTABLE)].map((el) => ({ svg: s, el })));
  const unpainted = [];
  const unreadable = [];
  for (const { svg, el } of shapes) {
    const v = verdict(el);
    if (!v) continue;
    const where = (svg.getAttribute('aria-label') || svg.getAttribute('class') ||
      (svg.hasAttribute('aria-hidden') ? 'a decorative graphic' : 'an unnamed graphic')) +
      ' > ' + el.tagName + ' (' + v.why + ')';
    (v.unreadable ? unreadable : unpainted).push(where);
  }

  return JSON.stringify({
    groups: [...document.querySelectorAll('.nav-group')].map((n) => n.textContent.trim()),
    navItems: document.querySelectorAll('.nav-item').length,
    navItemsWithIcon: document.querySelectorAll('.nav-item > svg.ico').length,
    account: !!document.querySelector('.rail-foot .who-name'),
    unexpandedIcons: document.querySelectorAll('[data-i]').length,
    expandedIcons: document.querySelectorAll('#iconGallery svg.ico').length,
    charts: document.querySelectorAll('svg.chart').length,
    chartShapes: shapes.length,
    unpainted: unpainted,
    unreadablePaint: unreadable,
    namedCharts: named,
    anonymousCharts: [...document.querySelectorAll('svg.chart')]
      .filter((s) => !s.hasAttribute('aria-hidden') && !s.getAttribute('aria-label')).length,
    ribbonName: (document.querySelector('.ribbon[role="img"]') || {}).ariaLabel
      || (document.querySelector('.ribbon') || {}).getAttribute
      && (document.querySelector('.ribbon')).getAttribute('aria-label'),
    api: Object.keys(window.Aria).sort()
  });
})()`;

/* Every icon on the page, swept for paint the same way the charts are.

   The chart sweep excluded icons — `.filter((s) => !s.classList.contains('ico'))`
   — because an icon takes its colour from currentColor rather than from a
   token, so it cannot fail the way an unresolved tone fails. That was a true
   statement about one cause and a false one about coverage: deleting
   `stroke: 'currentColor'` from icon() in ops/assets/aria.js leaves every icon
   in the rail, the top bar and the gallery a blank box, and both suites stay
   green (#10308).

   Two things it measures that a chart sweep would not have to:

   - currentColor is resolved AT THE POINT THE ICON SITS. Reading it on the
     document element answers a different question: a rule that paints one
     subtree transparent leaves the root colour untouched and every icon in
     that subtree invisible. getComputedStyle on the shape itself is the
     resolution the browser actually used for it.
   - An icon with no shapes at all draws nothing. icon() falls back to the
     info glyph for a name it does not know, but an entry that exists and is
     empty is not an unknown name: it produces an <svg> that is correctly
     classed, correctly sized, and empty.

   What it does NOT measure: an ink that resolves to a real colour but is too
   close to what is painted behind it to see. That needs the effective
   background, which on this page is layered gradients and colour-mix alpha
   rather than any one ancestor's background-color, and it is the contrast
   oracle's job (Stadiora/Aria#10287), not this sweep's.

   Nor does it measure most of geometry. The one geometry property it reads is
   stroke-width, and only on the stroke channel, because that is the channel
   every icon paints through. An icon hidden by opacity, visibility, display,
   a zero size or a broken viewBox still passes this sweep: those are paint
   that exists and is not shown, which is a different question from paint that
   was never resolved. */
const ICON_PROBE = `(() => {
  ${PAINT_HELPERS}
  const icons = [...document.querySelectorAll('svg.ico')];
  const allSvgs = [...document.querySelectorAll('svg')];
  /* Marked for the same reason the chart sweep marks: the partition below has
     to be the two sets that were actually swept, not two selectors re-run. */
  for (const s of icons) s.__sweptAsIcon = true;

  /* Icons carry no name of their own — the <i data-i="..."> placeholder they
     replaced is gone by the time this runs — so they are located by what
     holds them. */
  const label = (svg) => {
    const p = svg.parentElement;
    if (!p) return 'a detached icon';
    const cls = (p.getAttribute('class') || '').trim();
    const text = (p.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24);
    return p.tagName.toLowerCase() + (cls ? '.' + cls.split(/\\s+/).join('.') : '') +
      (text ? ' "' + text + '"' : '');
  };

  /* Charts do carry a name, so a graphic that fell out of both sweeps is
     reported by its own identity as well as by what holds it. */
  const graphic = (s) => (s.getAttribute('aria-label') || (s.getAttribute('class') || '').trim() ||
    (s.hasAttribute('aria-hidden') ? 'a decorative graphic' : 'an unnamed graphic')) +
    ' in ' + label(s);

  const unpainted = [];
  const unreadable = [];
  const resolvedToNothing = [];
  const empty = [];
  let shapes = 0;
  for (const svg of icons) {
    const els = [...svg.querySelectorAll(PAINTABLE)];
    shapes += els.length;
    if (!els.length) { empty.push(label(svg)); continue; }
    const why = [];
    let cannotRead = false;
    let fingerprint = false;
    for (const el of els) {
      const v = verdict(el);
      if (!v) continue;
      if (v.unreadable) cannotRead = true;
      if (v.emptyAttribute) fingerprint = true;
      if (why.indexOf(v.why) === -1) why.push(v.why);
    }
    if (!why.length) continue;
    const entry = label(svg) + ' — ' + why.join('; ');
    /* The fingerprint outranks the computed value on purpose. An empty paint
       attribute says a colour lookup came back with nothing, which is true
       whether or not a CSS rule happens to paint the shape anyway — and
       calling that "no paint at all" would be a claim this cannot make. */
    if (cannotRead) unreadable.push(entry);
    else if (fingerprint) resolvedToNothing.push(entry);
    else unpainted.push(entry);
  }

  return JSON.stringify({
    icons: icons.length,
    iconShapes: shapes,
    allSvgs: allSvgs.length,
    /* What the chart sweep marked as it swept, rather than what this file
       thinks the chart sweep selects. */
    chartSvgs: allSvgs.filter((s) => s.__sweptAsChart).length,
    unswept: allSvgs.filter((s) => !s.__sweptAsChart && !s.__sweptAsIcon).map(graphic),
    sweptTwice: allSvgs.filter((s) => s.__sweptAsChart && s.__sweptAsIcon).map(graphic),
    unpainted: unpainted,
    resolvedToNothing: resolvedToNothing,
    unreadablePaint: unreadable,
    shapeless: empty
  });
})()`;

/* Before boot, no state element may be visible: they start hidden so the page
   cannot flash a state it is not in. Measured with aria.js blocked, which is
   the only moment this is observable. */
const PREPAINT_PROBE = `(() => {
  const computed = getComputedStyle(document.documentElement);
  const visible = [...document.querySelectorAll('[data-state]')]
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => el.getAttribute('data-state'));
  return JSON.stringify({
    theme: document.documentElement.getAttribute('data-theme'),
    cyan: computed.getPropertyValue('--cyan').trim(),
    ink: computed.getPropertyValue('--ink').trim(),
    booted: typeof window.Aria !== 'undefined',
    visibleStateElements: visible
  });
})()`;

/* ------------------------------------------------------------------- run */

const failures = [];
const note = (m) => console.log('ok  ' + m);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;
const origin = `http://127.0.0.1:${PORT}`;

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || '/tmp';
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-shell-v2-'));

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
], { stdio: 'ignore' });

let cdp;
let problems = [];
let initScript = null;

/* The theme has to be in storage before the document's first script runs, and
   Runtime.evaluate writes into whatever document is currently loaded — which
   at the start is about:blank, where the write goes nowhere. Registering it as
   an on-new-document script is the only ordering that actually holds, and
   getting it wrong is invisible: theme.js falls back to prefers-color-scheme
   and the page looks fine, just not in the theme the check asked for. */
async function setTheme(theme, media) {
  if (initScript) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  }
  const stored = theme === null ? "localStorage.removeItem('ops-theme');"
    : 'localStorage.setItem(\'ops-theme\', ' + JSON.stringify(theme) + ');';
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      'try {' +
      "localStorage.setItem('ops-api-base', " + JSON.stringify(origin) + ');' +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      stored +
      '} catch (e) {}'
  });
  initScript = res.identifier;
  /* Emulated to the OPPOSITE of the stored theme by default. theme.js falls
     back to prefers-color-scheme when nothing is stored, so matching them
     would make a failed storage write look like a success. */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: media || (theme === 'dark' ? 'light' : 'dark') }]
  });
}

async function load(url, { settle = 1200 } = {}) {
  problems = [];
  cdp.reset();
  await cdp.send('Page.navigate', { url });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, settle));
}

async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || 'probe threw');
  }
  return JSON.parse(res.result.value);
}

try {
  const cdpPort = await devtoolsPort(profile);
  const target = await devtools(cdpPort, '/json/new?about:blank', 'PUT');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');

  /* Both channels, because they carry different failures: Runtime sees
     console.error and an uncaught throw, Log sees the ones the browser itself
     raises — a blocked subresource, a CSP violation, a 404 on an asset. */
  cdp.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push('console.error: ' + m.params.args.map((a) => a.description || a.value).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description
        || m.params.exceptionDetails.text));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      problems.push('browser: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    }
  });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
  });

  /* ---------------------------------------------- the shell, both themes */
  for (const theme of THEMES) {
    await setTheme(theme);
    await load(origin + SHELL);
    if (problems.length) {
      failures.push(`${SHELL} (${theme}) raised:\n      ` + problems.join('\n      '));
    }

    const tokens = await evaluate(TOKENS(theme));
    if (tokens.theme !== theme) {
      failures.push(`${SHELL} (${theme}): documentElement carries data-theme="${tokens.theme}"`);
    }
    if (!tokens.declared.length) {
      failures.push(`${SHELL} (${theme}): aria.css declared no custom properties on :root, so ` +
        'nothing below was actually measured');
    }
    if (tokens.referencedCount < 25) {
      failures.push(`${SHELL} (${theme}): only ${tokens.referencedCount} var() references were ` +
        'read out of aria.css, so the dangling-reference check measured almost nothing');
    }
    if (tokens.missingRequired.length) {
      failures.push(`${SHELL} (${theme}): ${tokens.missingRequired.length} required token(s) ` +
        `resolve to nothing: ${tokens.missingRequired.join(', ')}`);
    }
    if (tokens.danglingReferences.length) {
      failures.push(`${SHELL} (${theme}): aria.css references ` +
        `${tokens.danglingReferences.join(', ')}, which resolve to nothing. A var() naming a ` +
        'property that does not exist drops the whole declaration, silently.');
    }
    if (tokens.unreferencedExtras.length) {
      failures.push(`${SHELL} (${theme}): :root declares ${tokens.unreferencedExtras.join(', ')}, ` +
        'which the required set does not name. Either add it to REQUIRED_TOKENS here with a ' +
        'reason, or it is a stray.');
    }
    if (tokens.unresolved.length) {
      failures.push(`${SHELL} (${theme}): ${tokens.unresolved.length} token(s) declared but ` +
        `resolving to nothing: ${tokens.unresolved.join(', ')}`);
    }
    if (tokens.palettePinned < 33) {
      failures.push(`${SHELL} (${theme}): the palette contract pins only ` +
        `${tokens.palettePinned} tokens, so the comparison below measured almost nothing`);
    }
    if (tokens.wrong.length) {
      failures.push(`${SHELL} (${theme}): ${tokens.wrong.length} token(s) do not hold the value ` +
        `the design writes — ${tokens.wrong.join('; ')}. The design's values are ported as ` +
        'written, not derived. A status ink that falls back to its base colour drops that ' +
        'status text to about 3:1 on its own tint (monorepo #10042); geometry and type are the ' +
        'same in both themes on purpose, so a theme that redefines one is a departure too.');
    }
    note(`${SHELL} ${theme}: ${tokens.declared.length} tokens all resolve, ` +
      `${tokens.palettePinned} hold the exact value the design writes`);

    const shell = await evaluate(SHELL_PROBE);
    const expectGroups = ['Right now', 'How we are doing', 'Apps and people'];
    if (JSON.stringify(shell.groups) !== JSON.stringify(expectGroups)) {
      failures.push(`${SHELL} (${theme}): rail groups are ${JSON.stringify(shell.groups)}`);
    }
    if (shell.navItems !== 10) {
      failures.push(`${SHELL} (${theme}): rail drew ${shell.navItems} panes, expected 10`);
    }
    if (!shell.account) {
      failures.push(`${SHELL} (${theme}): the rail has no account footer`);
    }
    if (shell.unexpandedIcons !== 0) {
      failures.push(`${SHELL} (${theme}): ${shell.unexpandedIcons} <i data-i> placeholder(s) ` +
        'were never expanded');
    }
    if (shell.expandedIcons < 30) {
      failures.push(`${SHELL} (${theme}): the icon gallery drew ${shell.expandedIcons} icons, ` +
        'expected the whole set');
    }
    if (shell.charts < 4) {
      failures.push(`${SHELL} (${theme}): ${shell.charts} charts drawn, expected at least 4`);
    }
    /* A chart can be named, sized, and completely invisible. aria.js resolves
       every series colour through getPropertyValue('--' + tone), which returns
       the empty string for a name that is not a token — in the renderer or in
       the page data that names the tone. stroke="" is ignored, the shape
       inherits no paint, and nothing throws. This is the one class the token
       resolution and palette checks structurally cannot see, because the name
       asked for never reaches the stylesheet at all. */
    if (shell.chartShapes < 15) {
      failures.push(`${SHELL} (${theme}): the charts drew ${shell.chartShapes} paintable ` +
        'shapes, so the paint check below measured almost nothing');
    }
    if (shell.unpainted.length) {
      failures.push(`${SHELL} (${theme}): ${shell.unpainted.length} chart shape(s) reach the ` +
        `page with no paint at all — ${shell.unpainted.join('; ')}. A tone name that is not a ` +
        'token resolves to the empty string, which SVG ignores, so the chart is named and ' +
        'correct and draws nothing.');
    }
    if (shell.unreadablePaint.length) {
      failures.push(`${SHELL} (${theme}): ${shell.unreadablePaint.length} chart shape(s) are ` +
        `painted in a colour syntax this check cannot read — ${shell.unreadablePaint.join('; ')}. ` +
        'It fails rather than skipping them: a sweep that silently drops what it cannot parse ' +
        'reports a coverage it does not have (monorepo #10255).');
    }
    /* The a11y guarantee carried over from the mocks: role="img" makes an
       SVG's whole subtree presentational, so a chart that draws its labels as
       <text> and carries no name announces nothing at all. */
    if (shell.anonymousCharts !== 0) {
      failures.push(`${SHELL} (${theme}): ${shell.anonymousCharts} chart(s) are neither ` +
        'aria-hidden nor named, so they announce as an unlabelled graphic');
    }
    const bars = shell.namedCharts.find((n) => n.startsWith('Sample runs per day'));
    if (!bars || !['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].every((d) => bars.includes(d))) {
      failures.push(`${SHELL} (${theme}): the bar chart's name does not carry its category ` +
        `labels, which live as <text> inside role="img" and are announced to nobody. Got ${bars}`);
    }
    if (!shell.ribbonName || !shell.ribbonName.includes('peak at')) {
      failures.push(`${SHELL} (${theme}): the ribbon has no derived name. Got ${shell.ribbonName}`);
    }
    const api = ['applyState', 'boot', 'icon', 'redraw'];
    if (JSON.stringify(shell.api) !== JSON.stringify(api)) {
      failures.push(`${SHELL} (${theme}): window.Aria exposes ${JSON.stringify(shell.api)}, ` +
        `expected ${JSON.stringify(api)}`);
    }
    note(`${SHELL} ${theme}: rail, icons and ${shell.namedCharts.length} named charts drawn`);

    /* ------------------------------------------------------- the icons */
    /* Its own sweep, its own count and its own message, rather than more
       shapes in the chart figure: 111 icon shapes added to 26 chart shapes
       would make "the charts drew N paintable shapes" a number nobody can
       read, and would let a floor written for charts be satisfied by icons
       alone. */
    const icons = await evaluate(ICON_PROBE);
    const iconFailures = failures.length;
    if (icons.icons < 50) {
      failures.push(`${SHELL} (${theme}): the icon sweep found ${icons.icons} icons, so it ` +
        'measured almost nothing. The shell draws 61.');
    }
    if (icons.iconShapes < 90) {
      failures.push(`${SHELL} (${theme}): those icons hold ${icons.iconShapes} paintable ` +
        'shapes, so the sweep below measured almost nothing. The shell draws 111.');
    }
    /* Those two numbers are a tripwire for a sweep that measured almost
       nothing, not a census: 61 icons with a floor of 50 absorbs ten icons
       that stopped being drawn at all. The rail is the one place a count is
       pinned to a structure rather than to a total, because every nav item
       carries an icon and the number of nav items is already asserted. */
    if (shell.navItemsWithIcon !== shell.navItems) {
      failures.push(`${SHELL} (${theme}): ${shell.navItems} nav item(s) hold ` +
        `${shell.navItemsWithIcon} icon(s). A nav item whose icon is gone is not an icon that ` +
        'fails to paint, so no sweep below can see it: the element is simply not there.');
    }
    /* The two sweeps partition every <svg> on the page between them. This is
       the assertion the excluded-icons gap itself would have failed: a third
       kind of graphic that belongs to neither is a category nothing checks.
       Both halves are read off each sweep's own mark, so narrowing either
       sweep's selector — the mistake this file already made once — moves
       graphics into `unswept` rather than quietly out of the comparison. */
    if (icons.unswept.length) {
      failures.push(`${SHELL} (${theme}): ${icons.unswept.length} of the page's ` +
        `${icons.allSvgs} <svg> element(s) were swept by neither sweep — ` +
        `${icons.unswept.join('; ')}. The chart sweep marked ${icons.chartSvgs} and the icon ` +
        `sweep took ${icons.icons}; nothing checks whether the rest paint.`);
    }
    if (icons.sweptTwice.length) {
      failures.push(`${SHELL} (${theme}): ${icons.sweptTwice.length} <svg> element(s) were ` +
        `swept by both sweeps — ${icons.sweptTwice.join('; ')}. The counts and the messages ` +
        'each assume one sweep owns each graphic.');
    }
    if (icons.shapeless.length) {
      failures.push(`${SHELL} (${theme}): ${icons.shapeless.length} icon(s) hold no paintable ` +
        `shape at all — ${icons.shapeless.join('; ')}. An empty entry in the path map is not an ` +
        'unknown name, so it does not fall back to the info glyph: it draws an empty box.');
    }
    if (icons.unpainted.length) {
      failures.push(`${SHELL} (${theme}): ${icons.unpainted.length} of ${icons.icons} icon(s) ` +
        `reach the page with no paint at all — ${icons.unpainted.slice(0, 6).join('; ')}` +
        (icons.unpainted.length > 6 ? `; and ${icons.unpainted.length - 6} more` : '') +
        '. An icon takes its colour from currentColor rather than from a token, so the chart ' +
        'sweep excluded it; that is a statement about one cause, not about coverage. Deleting ' +
        "stroke from icon() leaves every rail, top bar and gallery icon a blank box (#10308).");
    }
    if (icons.resolvedToNothing.length) {
      failures.push(`${SHELL} (${theme}): ${icons.resolvedToNothing.length} of ${icons.icons} ` +
        'icon(s) carry a paint attribute that resolved to nothing — ' +
        `${icons.resolvedToNothing.slice(0, 6).join('; ')}` +
        (icons.resolvedToNothing.length > 6 ? `; and ${icons.resolvedToNothing.length - 6} more` : '') +
        '. An empty presentation attribute is the fingerprint: the browser drops it and then ' +
        'reports the INHERITED default, so the computed value reads as a plausible lie. Whether ' +
        'a CSS rule happens to paint the shape anyway, the colour asked for came back empty.');
    }
    if (icons.unreadablePaint.length) {
      failures.push(`${SHELL} (${theme}): ${icons.unreadablePaint.length} icon(s) are painted ` +
        `in a colour syntax this check cannot read — ${icons.unreadablePaint.slice(0, 6).join('; ')}` +
        (icons.unreadablePaint.length > 6 ? `; and ${icons.unreadablePaint.length - 6} more` : '') +
        '. It fails rather than skipping them: a sweep that silently drops what it cannot parse ' +
        'reports a coverage it does not have (monorepo #10255).');
    }
    /* Only when nothing above fired. A note that says "all" while a failure
       below says otherwise is the same overclaim in a friendlier voice. */
    if (failures.length === iconFailures) {
      note(`${SHELL} ${theme}: ${icons.icons} icons holding ${icons.iconShapes} shapes all ` +
        'resolve a paint where they sit');
    }

    /* ------------------------------------------------------ four states */
    for (const state of STATES) {
      const seen = await evaluate(STATE_PROBE(state));
      const where = (e) => `${e.tag}.${e.cls.split(' ').filter(Boolean).join('.')}`;

      if (seen.els.length < 8) {
        failures.push(`${SHELL} (${theme}): only ${seen.els.length} [data-state] elements on ` +
          'the page, so the state assertions below measured almost nothing');
      }

      const shown = seen.els.filter((e) => e.states.includes(state));
      const hidden = seen.els.filter((e) => !e.states.includes(state));
      if (!shown.length) {
        failures.push(`${SHELL} (${theme}, ${state}): no element belongs to this state`);
      }

      for (const e of shown) {
        if (!e.shown) {
          failures.push(`${SHELL} (${theme}, ${state}): ${where(e)} belongs to this state but ` +
            'never got data-shown');
        }
        if (e.display === 'none') {
          failures.push(`${SHELL} (${theme}, ${state}): ${where(e)} belongs to this state and ` +
            'is still display:none');
        }
      }
      for (const e of hidden) {
        if (e.shown || e.display !== 'none') {
          failures.push(`${SHELL} (${theme}, ${state}): ${where(e)} belongs to ` +
            `${e.states.join('/')} but computed display:${e.display}`);
        }
      }

      /* The whole reason visibility is keyed on an attribute rather than set
         to display:block. If it were block, every one of these would read
         "block" and the four types below would be gone. */
      const types = new Set(shown.map((e) => e.display));
      for (const needed of ['table-row', 'inline-flex']) {
        if (!types.has(needed)) {
          failures.push(`${SHELL} (${theme}, ${state}): nothing shown for this state computed ` +
            `display:${needed}. Shown types were ${[...types].join(', ')}, which is what a ` +
            'visibility rule that forces a display type looks like.');
        }
      }

      if (JSON.stringify(seen.segPressed) !== JSON.stringify([state])) {
        failures.push(`${SHELL} (${theme}, ${state}): the switcher reports ` +
          `${JSON.stringify(seen.segPressed)} pressed`);
      }
    }
    note(`${SHELL} ${theme}: all four states keep every element's own display type`);
  }

  /* -------------------------------------------------- the pre-paint path */
  /* aria.js blocked. theme.js and aria.css are on their own, which is exactly
     the situation a check that runs after boot can never observe: if the two
     paths disagreed, aria.js would already have corrected the page. */
  await cdp.send('Network.setBlockedURLs', { urls: ['*/assets/aria.js', '*/assets/shell-v2.js'] });
  for (const theme of THEMES) {
    await setTheme(theme);
    await load(origin + SHELL, { settle: 400 });
    const seen = await evaluate(PREPAINT_PROBE);

    if (seen.booted) {
      failures.push(`${SHELL} (${theme}, pre-paint): aria.js still ran, so this measured the ` +
        'post-boot page and proves nothing');
    }
    if (seen.theme !== theme) {
      failures.push(`${SHELL} (${theme}, pre-paint): theme.js painted data-theme="${seen.theme}"`);
    }
    if (seen.cyan.toUpperCase() !== CYAN[theme]) {
      failures.push(`${SHELL} (${theme}, pre-paint): --cyan painted ${seen.cyan}, expected ` +
        `${CYAN[theme]}. The pre-paint path and the runtime path disagree, so the page paints ` +
        'one theme and switches to the other after boot.');
    }
    if (seen.visibleStateElements.length) {
      failures.push(`${SHELL} (${theme}, pre-paint): ` +
        `${seen.visibleStateElements.length} state element(s) are visible before boot ` +
        `(${seen.visibleStateElements.join(' | ')}), so the page flashes a state it is not in`);
    }
    note(`${SHELL} ${theme}: pre-paint theme correct with aria.js blocked, no state flash`);
  }

  /* Nothing stored. theme.js now has to decide from the system, and this is
     the third place the default is written — the branch the two cases above
     can never reach, because they always store a choice. Run in both
     directions: a fallback hard-coded either way passes one and fails the
     other. */
  for (const [media, expected] of [['dark', 'dark'], ['light', 'light']]) {
    await setTheme(null, media);
    await load(origin + SHELL, { settle: 400 });
    const seen = await evaluate(PREPAINT_PROBE);
    if (seen.theme !== expected) {
      failures.push(`${SHELL} (nothing stored, system ${media}): theme.js painted ` +
        `data-theme="${seen.theme}", expected ${expected}`);
    }
    if (seen.cyan.toUpperCase() !== CYAN[expected]) {
      failures.push(`${SHELL} (nothing stored, system ${media}): --cyan painted ${seen.cyan}, ` +
        `expected ${CYAN[expected]}`);
    }
    note(`${SHELL}: with nothing stored and the system on ${media}, the page paints ${expected}`);
  }

  /* All scripting blocked, including theme.js. What paints then is the
     stylesheet's own default, and it has to be the same dark set theme.js
     falls back to — this is the third place the default is written. */
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
  await cdp.send('Runtime.evaluate', {
    expression: "try { localStorage.removeItem('ops-theme'); } catch (e) {}"
  });
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }]
  });
  await load(origin + SHELL, { settle: 400 });
  const bare = await evaluate(`(() => {
    const c = getComputedStyle(document.documentElement);
    return JSON.stringify({
      theme: document.documentElement.getAttribute('data-theme'),
      cyan: c.getPropertyValue('--cyan').trim()
    });
  })()`).catch(() => null);
  /* Runtime.evaluate is how the probe is asked, so script execution has to come
     back on to read the answer; the page was laid out with it off. */
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
  if (bare) {
    if (bare.theme !== null) {
      failures.push(`${SHELL} (no script): documentElement carries data-theme="${bare.theme}", ` +
        'so theme.js ran and this measured nothing');
    }
    if (bare.cyan.toUpperCase() !== CYAN.dark) {
      failures.push(`${SHELL} (no script): with no theme attribute at all the stylesheet paints ` +
        `--cyan ${bare.cyan}, but theme.js falls back to dark (${CYAN.dark}). The CSS default ` +
        'and the script default disagree.');
    }
    note(`${SHELL}: with all scripting blocked the stylesheet default is still dark`);
  } else {
    failures.push(`${SHELL} (no script): the probe could not be read back`);
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await cdp.send('Network.setBlockedURLs', { urls: [] });

  /* ------------------------------------------------------- existing panes */
  /* Nothing in this change touches a pane file. This is the proof. */
  for (const theme of THEMES) {
    await setTheme(theme);
    for (const pane of PANES) {
      await load(origin + pane, { settle: 1500 });
      const rendered = await evaluate(
        '(() => JSON.stringify({ body: document.body.children.length, ' +
        'text: document.body.innerText.trim().length }))()');
      if (problems.length) {
        failures.push(`${pane} (${theme}) raised:\n      ` + problems.join('\n      '));
      } else if (rendered.text < 10) {
        failures.push(`${pane} (${theme}) rendered nothing, so listening for errors proved nothing`);
      } else {
        note(`${pane} ${theme}: rendered, no console errors`);
      }
    }
  }
} finally {
  if (cdp) cdp.close();
  browser.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (failures.length) {
  console.error('\nThe v2 operations shell failed:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}

console.log('\nThe v2 shell holds in both themes, in all four states, and before first paint.');
process.exit(0);
