/* The per-character reach rule in scripts/check-ops-result-view.mjs, run
   without a browser. The helpers are sliced out of the probe that guard sends
   to Chrome and evaluated against hand-built Range geometry, so this asserts
   the arithmetic and branch choice, not what Chrome lays out. It runs in
   .github/workflows/ops-result-view.yml ahead of the rendered sweep, and in
   ops-pane-tests.yml with every other scripts/*.test.mjs.

   Round 18 of antonyrugama/aria-website#93 supplied the fixtures: a text node
   laid out on one line whose rect crosses the edge of the allowed area. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('./check-ops-result-view.mjs', import.meta.url), 'utf8');

const slice = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to);
  assert.ok(start > 0 && end > start, `anchors ${from} … ${to} not found in order`);
  return text.slice(start, end);
};

const probe = vm.runInNewContext(
  slice(source, 'const probeFor = ', '/* ------------------------------------------------------------------- run */')
    + '\nprobeFor(["2.9.1"]);'
);
const helpers = slice(probe, '  const root = document.documentElement;', '  const markers = ')
  + '\n({ shows });';

const CHAR = 10;
const rect = (left, width) => ({
  left, right: left + width, top: 100, bottom: 116, width, height: 16
});

/* One carrier holding `value`, its characters CHAR px wide starting at
   `left`, in a 1280x900 viewport. splitAt puts the same characters in two
   adjacent text nodes, which gives each part its own rect. */
function shows({ value, left, fixed, splitAt }) {
  const root = { clientWidth: 1280, scrollWidth: 1280, clientHeight: 900, scrollHeight: 1695 };
  const carrier = {
    nodeType: 1, parentElement: root, childNodes: [],
    style: {
      display: 'inline', visibility: 'visible', contentVisibility: 'visible',
      position: fixed ? 'fixed' : 'absolute'
    },
    getBoundingClientRect: () => rect(left, value.length * CHAR),
    checkVisibility: () => true
  };
  const parts = splitAt === undefined ? [value] : [value.slice(0, splitAt), value.slice(splitAt)];
  let offset = 0;
  for (const nodeValue of parts) {
    carrier.childNodes.push({ nodeType: 3, parentElement: carrier, nodeValue, left: left + offset * CHAR });
    offset += nodeValue.length;
  }
  const document = {
    documentElement: root,
    createRange() {
      let node, from, to;
      return {
        selectNodeContents(n) { node = n; from = 0; to = n.nodeValue.length; },
        setStart(n, i) { node = n; from = i; },
        setEnd(n, i) { node = n; to = i; },
        getClientRects() { return [rect(node.left + from * CHAR, (to - from) * CHAR)]; }
      };
    }
  };
  const fns = vm.runInNewContext(helpers, {
    document, window: { scrollX: 0, scrollY: 0 }, getComputedStyle: (el) => el.style
  });
  return fns.shows(carrier, '2.9.1');
}

test('a single-line marker wholly inside the viewport shows', () => {
  assert.equal(shows({ value: 'xx2.9.1', left: 100, fixed: true }), true);
});

test('a fixed single line does not lend its on-screen prefix to characters past the viewport', () => {
  // "xx" sits at 1260-1280, "2.9.1" at 1280-1330: every marker character is off screen.
  assert.equal(shows({ value: 'xx2.9.1', left: 1260, fixed: true, splitAt: 2 }), false,
    'control: the same characters in their own node are rejected');
  assert.equal(shows({ value: 'xx2.9.1', left: 1260, fixed: true }), false,
    'off-viewport marker must not borrow its prefix rectangle');
});

test('an absolute single line does not lend its on-page suffix to characters left of the document', () => {
  // "2.9.1" sits at -50-0, "xx" at 0-20: every marker character is off the document.
  assert.equal(shows({ value: '2.9.1xx', left: -50, fixed: false, splitAt: 5 }), false,
    'control: the same characters in their own node are rejected');
  assert.equal(shows({ value: '2.9.1xx', left: -50, fixed: false }), false,
    'off-document marker must not borrow its suffix rectangle');
});
