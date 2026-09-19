/* Unit tests for ops/assets/aria.js — the v2 shell runtime.
   Same shape as the pane tests: node:test, node:vm and a hand-written DOM, so
   the repository still needs nothing but Node itself to check itself.

   What is worth testing here is the part of the file a screenshot cannot show:
   the accessible name each chart derives, and the fact that state visibility
   is applied in both directions. The browser check
   (scripts/check-ops-shell-v2.mjs) covers what only a real layout can answer. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = new URL('../ops/assets/aria.js', import.meta.url);

/* ------------------------------------------------------------------- DOM */
/* Attributes are the storage for everything an element knows: class, dataset
   and the aria-* names all read back out of the same map, because that is how
   a browser behaves and because a stub with a private field per accessor will
   happily agree with code that never set the attribute at all. */
function makeDom(tokens) {
  let doc;

  function parseSelector(sel) {
    const parts = sel.trim().split(/(?=[.[])/);
    const tests = [];
    for (const part of parts) {
      if (!part) continue;
      if (part[0] === '.') {
        const cls = part.slice(1);
        tests.push((el) => (el.getAttribute('class') || '').split(/\s+/).includes(cls));
      } else if (part[0] === '[') {
        const m = /^\[([^\]=~]+)(?:([~]?)=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/.exec(part);
        if (!m) throw new Error('selector not supported by the stub: ' + sel);
        const [, name, fuzzy, dq, sq, bare] = m;
        const want = dq !== undefined ? dq : sq !== undefined ? sq : bare;
        tests.push((el) => {
          if (!el.hasAttribute(name)) return false;
          if (want === undefined) return true;
          const got = el.getAttribute(name);
          return fuzzy === '~' ? got.split(/\s+/).includes(want) : got === want;
        });
      } else {
        const tag = part.toLowerCase();
        tests.push((el) => el.tagName.toLowerCase() === tag);
      }
    }
    if (!tests.length) throw new Error('empty selector');
    return (el) => tests.every((t) => t(el));
  }

  function element(tag, ns) {
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      tagName: ns ? tag : tag.toUpperCase(),
      namespaceURI: ns || 'http://www.w3.org/1999/xhtml',
      childNodes: [],
      parentNode: null,
      style: {},
      clientWidth: 0,
      clientHeight: 0,
      textContent: '',
      setAttribute(name, value) { attrs.set(name, String(value)); },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
      hasAttribute(name) { return attrs.has(name); },
      removeAttribute(name) { attrs.delete(name); },
      get attributeNames() { return [...attrs.keys()]; },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = el;
        el.childNodes.push(child);
        return child;
      },
      removeChild(child) {
        const i = el.childNodes.indexOf(child);
        if (i >= 0) el.childNodes.splice(i, 1);
        child.parentNode = null;
        return child;
      },
      replaceChild(next, prev) {
        const i = el.childNodes.indexOf(prev);
        if (i < 0) throw new Error('replaceChild: node is not a child');
        if (next.parentNode) next.parentNode.removeChild(next);
        el.childNodes[i] = next;
        next.parentNode = el;
        prev.parentNode = null;
        return prev;
      },
      addEventListener(name, fn) { listeners.set(name, fn); },
      dispatch(name, ev) {
        const fn = listeners.get(name);
        assert.equal(typeof fn, 'function', `${tag} has no ${name} listener`);
        return fn({ preventDefault() {}, ...ev });
      },
      closest(sel) {
        const match = parseSelector(sel);
        let node = el;
        while (node) {
          if (node.tagName && match(node)) return node;
          node = node.parentNode;
        }
        return null;
      },
      querySelectorAll(sel) {
        const match = parseSelector(sel);
        const out = [];
        (function walk(node) {
          for (const c of node.childNodes) {
            if (c.tagName && match(c)) out.push(c);
            if (c.childNodes) walk(c);
          }
        })(el);
        return out;
      },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    };
    Object.defineProperty(el, 'firstChild', { get: () => el.childNodes[0] || null });
    Object.defineProperty(el, 'children', { get: () => el.childNodes.filter((c) => c.tagName) });
    Object.defineProperty(el, 'className', {
      get: () => el.getAttribute('class') || '',
      set: (v) => el.setAttribute('class', v),
    });
    el.classList = {
      contains: (c) => el.className.split(/\s+/).includes(c),
      add: (c) => { if (!el.classList.contains(c)) el.className = (el.className + ' ' + c).trim(); },
      remove: (c) => {
        el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' ');
      },
      toggle: (c, on) => (on ? el.classList.add(c) : el.classList.remove(c)),
    };
    el.dataset = new Proxy({}, {
      get: (_, k) => {
        if (typeof k !== 'string') return undefined;
        const a = 'data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        return el.hasAttribute(a) ? el.getAttribute(a) : undefined;
      },
      set: (_, k, v) => {
        el.setAttribute('data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v);
        return true;
      },
      has: (_, k) => el.hasAttribute('data-' + String(k)),
    });
    return el;
  }

  const root = element('html');
  doc = {
    documentElement: root,
    createElement: (tag) => element(tag),
    createElementNS: (ns, tag) => element(tag, ns),
    getElementById: (id) => doc.querySelectorAll(`[id="${id}"]`)[0] || null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
  };

  const window = {
    document: doc,
    getComputedStyle: () => ({ getPropertyValue: (n) => tokens[n] || '' }),
    addEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
  };
  window.window = window;
  return { window, doc, root, element };
}

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const SRC = readFileSync(SOURCE, 'utf8');

/* Loads aria.js into a fresh DOM. `body` receives the page markup the test
   needs; nothing is shared between tests. */
function load(build) {
  const dom = makeDom(TOKENS);
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  if (build) build(dom, body);
  vm.createContext(dom.window);
  vm.runInContext(SRC, dom.window, { filename: 'aria.js' });
  return { ...dom, body, Aria: dom.window.Aria };
}

function el(dom, parent, tag, attrs = {}) {
  const node = dom.element(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

/* ============================ the exposed surface ======================= */

test('window.Aria exposes exactly boot, icon, redraw and applyState', () => {
  const { Aria } = load();
  assert.deepEqual(Object.keys(Aria).sort(), ['applyState', 'boot', 'icon', 'redraw']);
  assert.equal(Aria.icons, undefined, 'there is no Aria.icons() accessor');
  for (const k of ['boot', 'icon', 'redraw', 'applyState']) {
    assert.equal(typeof Aria[k], 'function', `Aria.${k} is not callable`);
  }
});

/* ================================= icons =============================== */

test('icon() returns a decorative svg and falls back to info for an unknown name', () => {
  const { Aria } = load();
  const known = Aria.icon('bell', 'ico-lg');
  assert.equal(known.tagName, 'svg');
  assert.equal(known.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(known.getAttribute('aria-hidden'), 'true');
  assert.equal(known.getAttribute('class'), 'ico ico-lg');
  assert.ok(known.children.length > 0, 'the icon drew nothing');

  const unknown = Aria.icon('no-such-icon');
  const info = Aria.icon('info');
  const shape = (svg) => svg.children.map((c) => c.tagName + ':' + (c.getAttribute('d') || ''));
  assert.deepEqual(shape(unknown), shape(info), 'an unknown name did not fall back to info');
  assert.ok(shape(info).length > 0, 'the info fallback itself is empty');
});

test('boot() replaces every <i data-i> with an svg and carries its class across', () => {
  const { doc, body, Aria } = load((dom, b) => {
    const host = el(dom, b, 'span', { class: 'wrap' });
    el(dom, host, 'i', { 'data-i': 'gear', class: 'ico-lg tone-cyan' });
    el(dom, b, 'i', { 'data-i': 'bell' });
  });
  Aria.boot({});
  assert.equal(doc.querySelectorAll('[data-i]').length, 0, 'a placeholder survived boot');
  const svgs = body.querySelectorAll('svg');
  assert.equal(svgs.length, 2);
  assert.ok(
    svgs.some((s) => s.getAttribute('class') === 'ico ico-lg tone-cyan'),
    'the placeholder class was dropped, so a sized icon loses its size'
  );
});

/* ================================== rail =============================== */

function railDom() {
  return load((dom, b) => {
    el(dom, b, 'nav', { id: 'rail' });
    el(dom, b, 'header', { id: 'topbar' });
  });
}

test('the rail groups the panes under the three headings, in order', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ id: 'alerts', title: 'Problems' });

  const rail = doc.getElementById('rail');
  assert.deepEqual(
    rail.querySelectorAll('.nav-group').map((g) => g.textContent),
    ['Right now', 'How we are doing', 'Apps and people']
  );

  const lists = rail.querySelectorAll('.nav-list');
  assert.equal(lists.length, 3, 'one list per group');
  assert.deepEqual(lists.map((l) => l.querySelectorAll('.nav-item').length), [4, 3, 3]);
  for (const l of lists) {
    assert.equal(l.getAttribute('role'), 'group');
    const heading = doc.getElementById(l.getAttribute('aria-labelledby'));
    assert.ok(heading, 'a group points at a heading that is not on the page');
  }
  /* role="listitem" on an <a> replaces the link role, which is why these are
     groups. If someone switches them back, this is what notices. */
  assert.equal(rail.querySelectorAll('[role="listitem"]').length, 0);
  assert.equal(rail.querySelectorAll('[role="list"]').length, 0);
});

test('exactly the current pane is marked aria-current, and it is the one asked for', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ id: 'spend', title: 'Cloud costs' });
  const rail = doc.getElementById('rail');
  const current = rail.querySelectorAll('[aria-current]');
  assert.equal(current.length, 1);
  assert.equal(current[0].getAttribute('aria-current'), 'page');
  assert.equal(current[0].getAttribute('href'), 'spend.html');
  assert.ok(current[0].classList.contains('on'));
  assert.equal(rail.querySelectorAll('.on').length, 1);
});

test('an unknown pane id marks nothing current rather than guessing', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ id: 'not-a-pane' });
  assert.equal(doc.getElementById('rail').querySelectorAll('[aria-current]').length, 0);
});

test('the rail invents no badge, no account and no number when boot() passes none', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ id: 'overview' });
  const rail = doc.getElementById('rail');
  assert.equal(rail.querySelectorAll('.nav-badge').length, 0);
  assert.equal(rail.querySelectorAll('.rail-foot').length, 0);

  const text = (function read(node) {
    return node.childNodes.map((c) => (c.tagName ? read(c) : '')).join(' ') + ' ' + node.textContent;
  })(rail);
  assert.doesNotMatch(text, /\d/, 'the rail rendered a number nobody supplied: ' + text.trim());
  assert.doesNotMatch(text, /@/, 'the rail rendered an address nobody supplied: ' + text.trim());
});

test('a badge renders with a spoken description; the account footer renders initials', () => {
  const { doc, Aria } = railDom();
  Aria.boot({
    id: 'overview',
    badges: { alerts: { label: '3', tone: 'warn', description: '3 open problems' } },
    account: { email: 'sam.patel@example.invalid', meta: 'Owner' },
  });
  const rail = doc.getElementById('rail');
  const badge = rail.querySelectorAll('.nav-badge');
  assert.equal(badge.length, 1);
  assert.equal(badge[0].textContent, '3');
  assert.ok(badge[0].classList.contains('warn'));

  const spoken = rail.querySelectorAll('.sr').map((s) => s.textContent);
  assert.deepEqual(spoken, [', 3 open problems'],
    'a bare number beside a pane name is announced as part of the name');

  const foot = rail.querySelectorAll('.rail-foot');
  assert.equal(foot.length, 1);
  assert.equal(foot[0].querySelector('.who-av').textContent, 'SP');
  assert.equal(foot[0].querySelector('.who-name').textContent, 'sam.patel@example.invalid');
  assert.equal(foot[0].querySelector('.who-meta').textContent, 'Owner');
  assert.equal(foot[0].querySelector('.who-av').getAttribute('aria-hidden'), 'true');
});

test('a page that names no title gets no heading, not the word "undefined"', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ pane: 'index' });
  const heads = doc.querySelectorAll('h1');
  assert.deepEqual(heads.map((e) => e.textContent), [],
    'boot() with no title rendered a heading; an absent title must render nothing');
});

test('a title and a subtitle are both rendered when the page names them', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ pane: 'index', title: 'Right now', sub: 'What is happening' });
  assert.deepEqual(doc.querySelectorAll('h1').map((e) => e.textContent), ['Right now']);
  assert.deepEqual(doc.querySelectorAll('.page-sub').map((e) => e.textContent),
    ['What is happening']);
});

/* ================================= states ============================== */
function stateDom() {
  return load((dom, b) => {
    el(dom, b, 'header', { id: 'topbar' });
    el(dom, b, 'section', { 'data-state': 'live', id: 'liveOnly' });
    el(dom, b, 'section', { 'data-state': 'loading', id: 'loadingOnly' });
    el(dom, b, 'tr', { 'data-state': 'live degraded', id: 'row' });
    el(dom, b, 'span', { 'data-state': 'empty degraded', id: 'pill' });
  });
}

test('applyState shows the matching elements and hides the rest, every time', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ preview: true, state: 'live' });

  const shown = () => doc.querySelectorAll('[data-shown]').map((e) => e.getAttribute('id')).sort();

  assert.deepEqual(shown(), ['liveOnly', 'row']);

  /* The direction that gets missed. Going live -> loading must take data-shown
     OFF the two live elements; a test that only ever checks the new state
     passes just as happily when nothing is ever removed. */
  Aria.applyState('loading');
  assert.deepEqual(shown(), ['loadingOnly']);

  Aria.applyState('degraded');
  assert.deepEqual(shown(), ['pill', 'row']);

  Aria.applyState('empty');
  assert.deepEqual(shown(), ['pill']);

  Aria.applyState('live');
  assert.deepEqual(shown(), ['liveOnly', 'row']);
});

test('applyState changes visibility by attribute only — it never writes a display', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ preview: true, state: 'live' });
  Aria.applyState('degraded');

  for (const e of doc.querySelectorAll('[data-state]')) {
    assert.equal(e.style.display, undefined,
      `${e.getAttribute('id')} got an inline display, which overwrites its own layout type ` +
      '(a shown <tr> must stay table-row, a .pill inline-flex)');
    assert.equal(e.getAttribute('style'), null,
      `${e.getAttribute('id')} got a style attribute, which style-src 'self' blocks anyway`);
  }
});

test('the preview switcher tracks the state in both the class and aria-pressed', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ preview: true, state: 'live' });

  const pressed = () => doc.getElementById('stateSeg').querySelectorAll('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('data-value'));

  assert.deepEqual(pressed(), ['live']);
  Aria.applyState('empty');
  assert.deepEqual(pressed(), ['empty']);
  assert.deepEqual(
    doc.getElementById('stateSeg').querySelectorAll('.on').map((b) => b.getAttribute('data-value')),
    ['empty']
  );
});

test('clicking the switcher applies that state', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ preview: true, state: 'live' });
  const seg = doc.getElementById('stateSeg');
  const target = seg.querySelectorAll('[data-value="empty"]')[0];
  seg.dispatch('click', { target });
  assert.deepEqual(doc.querySelectorAll('[data-shown]').map((e) => e.getAttribute('id')), ['pill']);
});

test('the switcher is absent unless the page asks for it', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ state: 'live' });
  assert.equal(doc.getElementById('stateSeg'), null);
  assert.deepEqual(doc.querySelectorAll('[data-shown]').map((e) => e.getAttribute('id')),
    ['liveOnly', 'row']);
});

/* ================================= charts ==============================
   role="img" makes an svg's whole subtree presentational, so every <text>
   inside a chart is announced to nobody. These assert the names the renderers
   derive instead — the fix from monorepo #9958, which would be silently lost
   by porting the drawing and not the naming. */

/* No topbar here on purpose: renderTop draws a theme-button icon, and an svg
   the test did not ask for is exactly how "the first svg on the page" stops
   meaning "the chart". Queries below are scoped to the chart host anyway. */
function chartDom(build) {
  const dom = load(build);
  dom.chart = (sel) => {
    const host = dom.body.querySelector(sel);
    assert.ok(host, 'no ' + sel + ' on the page');
    return host;
  };
  return dom;
}

test('a standalone sparkline is named with its range and its last value', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-spark': '4,9,2,7', 'data-label': 'Sign-ins' });
  });
  Aria.boot({});
  const svg = chart('[data-spark]').querySelector('svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'Sign-ins, 4 values, low 2, high 9, ending 7');
  assert.equal(svg.getAttribute('aria-hidden'), null);
});

test('a flat sparkline says so rather than reporting a range of zero', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-spark': '5,5,5', 'data-label': 'Errors' });
  });
  Aria.boot({});
  assert.equal(chart('[data-spark]').querySelector('svg').getAttribute('aria-label'),
    'Errors, 3 values, flat at 5');
});

test('a KPI sparkline is hidden, because the KPI number beside it says the same thing', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    const card = el(dom, b, 'div', { class: 'kpi' });
    el(dom, card, 'div', { class: 'kpi-val' }).textContent = '1,284';
    el(dom, card, 'div', { class: 'kpi-spark', 'data-spark': '4,9,2,7' });
  });
  Aria.boot({});
  const svg = chart('.kpi-spark').querySelector('svg');
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('role'), null);
  assert.equal(svg.getAttribute('aria-label'), null);
});

test('an area chart names every series, its range and the span of the x axis', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', {
      'data-area': 'Athletes:cyan:10,40,25;Coaches:violet:5,5,5',
      'data-xaxis': 'Mon,Tue,Wed',
    });
  });
  Aria.boot({});
  const svg = chart('[data-area]').querySelector('svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'),
    'Athletes 10 to 40, Coaches flat at 5 over time, Mon to Wed');
});

test('a bar chart carries its category labels in the name — they exist nowhere else', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', {
      'data-bars': 'Mon:cyan:42;Tue:cyan:51;Wed:rose:8',
      'data-label': 'Runs per day',
    });
  });
  Aria.boot({});
  const svg = chart('[data-bars]').querySelector('svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'Runs per day: Mon 42, Tue 51, Wed 8');

  /* The <text> nodes are drawn and are the reason the name has to exist: they
     are inside role="img", so nothing announces them. */
  const drawn = svg.querySelectorAll('.axis').map((t) => t.textContent);
  assert.deepEqual(drawn, ['Mon', 'Tue', 'Wed']);
});

test('a ribbon reports a single peak by position', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-ribbon': '1,9,3', 'data-label': 'By hour' });
  });
  Aria.boot({});
  const host = chart('[data-ribbon]');
  assert.equal(host.getAttribute('role'), 'img');
  assert.equal(host.getAttribute('aria-label'),
    'By hour, 3 values, low 1, high 9, peak at 2 of 3');
  assert.equal(host.children.length, 3, 'one column per value');
});

test('a tied ribbon maximum is reported as a count, not as a peak at the first one', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-ribbon': '9,1,9,4', 'data-label': 'By hour' });
  });
  Aria.boot({});
  const label = chart('[data-ribbon]').getAttribute('aria-label');
  assert.equal(label, 'By hour, 4 values, low 1, high 9, high reached 2 times');
  assert.doesNotMatch(label, /peak at/,
    'naming one of two equal maxima as the peak describes a spike that is not in the data');
});

test('a gauge is hidden and its number is real text beside it, not only in the ring', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-gauge': '88', 'data-val': '88%', 'data-cap': 'of $650' });
  });
  Aria.boot({});
  const host = chart('[data-gauge]');
  const svg = host.querySelector('svg');
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('role'), null);
  assert.equal(host.querySelector('.gauge-val').textContent, '88%');
  assert.equal(host.querySelector('.gauge-cap').textContent, 'of $650');
});

test('every graphic the renderer produces is either named or explicitly hidden', () => {
  const { body, chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-spark': '1,2,3', 'data-label': 'A' });
    el(dom, b, 'div', { class: 'kpi-spark', 'data-spark': '1,2,3' });
    el(dom, b, 'div', { 'data-area': 'S:cyan:1,2,3', 'data-xaxis': 'a,b,c' });
    el(dom, b, 'div', { 'data-bars': 'a:cyan:1;b:cyan:2', 'data-label': 'B' });
    el(dom, b, 'div', { 'data-gauge': '40' });
    el(dom, b, 'div', { 'data-ribbon': '1,2,3', 'data-label': 'C' });
  });
  Aria.boot({});

  const graphics = [
    ...body.querySelectorAll('svg'),
    ...body.querySelectorAll('[data-ribbon]'),
  ];
  assert.equal(graphics.length, 6, 'not every chart drew');
  assert.ok(chart('[data-bars]'), 'the bar chart host is gone');
  for (const g of graphics) {
    const hidden = g.getAttribute('aria-hidden') === 'true';
    const named = g.getAttribute('role') === 'img' && (g.getAttribute('aria-label') || '').length > 3;
    assert.ok(hidden || named,
      'a graphic is neither named nor hidden, so it is announced as an unlabelled image: ' +
      g.tagName + ' ' + (g.getAttribute('class') || ''));
    assert.ok(!(hidden && named), 'a graphic is both hidden and named');
  }
});

test('redraw() re-derives the names, so a theme change cannot drop them', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-bars': 'Mon:cyan:42', 'data-label': 'Runs per day' });
  });
  Aria.boot({});
  Aria.redraw();
  const svgs = chart('[data-bars]').querySelectorAll('svg');
  assert.equal(svgs.length, 1, 'redraw stacked a second chart instead of replacing the first');
  assert.equal(svgs[0].getAttribute('aria-label'), 'Runs per day: Mon 42');
});

/* ================================= theme =============================== */

test('the theme button reflects what theme.js decided and never decides itself', () => {
  const dom = makeDom(TOKENS);
  const body = dom.element('body');
  dom.root.appendChild(body);
  el(dom, body, 'header', { id: 'topbar' });
  let current = 'light';
  let toggled = 0;
  dom.window.OpsTheme = { current: () => current, toggle() { toggled += 1; current = 'dark'; } };
  vm.createContext(dom.window);
  vm.runInContext(SRC, dom.window, { filename: 'aria.js' });

  dom.window.Aria.boot({});
  const btn = dom.doc.getElementById('themeBtn');
  assert.equal(btn.getAttribute('aria-label'), 'Switch to dark theme');

  btn.dispatch('click');
  assert.equal(toggled, 1, 'the button did not go through OpsTheme');
  assert.equal(btn.getAttribute('aria-label'), 'Switch to light theme');
  assert.equal(dom.root.getAttribute('data-theme'), null,
    'aria.js wrote the theme attribute itself; theme.js owns that, and two writers disagree');
});
