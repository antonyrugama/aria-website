/* Two selector-reading helpers in scripts/check-ops-result-view.mjs, run
   without a browser (Stadiora/Aria#10675). As in
   ops-result-view-geometry.test.mjs, the code is sliced out of the probe that
   guard sends to Chrome and evaluated here, so these assert the helpers the
   guard really runs rather than a copy of them.

   1. The selector-list split behind `byClass`. A comma inside :is(), :where(),
      :not() or an attribute value does not end a clause. ops.css writes
      `body:is([data-page="releases"], [data-page="users"]) :is(.badge-crit, …)`,
      and a split on every comma turns that into pieces Chrome refuses, which
      the guard then counts as painted without checking.
   2. Rule 2 of `peerFor`. A candidate peer drawn one level out has to share a
      class with the marked element, unless both of them carry none. The empty
      set is a subset of every set, so a subset test on its own accepted any
      class-less row of another table as the peer of a selected row. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('./check-ops-result-view.mjs', import.meta.url), 'utf8');

const slice = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start > 0 && end > start, `anchors ${from} … ${to} not found in order`);
  return text.slice(start, end);
};

const probe = vm.runInNewContext(
  slice(source, 'const probeFor = ', '/* ------------------------------------------------------------------- run */')
    + '\nprobeFor(["2.9.1"]);'
);

/* `byClass` as the guard builds it: class -> the clauses that name it.
   Through JSON, so the result is built from this realm's Object and Array
   and deepEqual compares values rather than prototypes. */
const clausesByClass = (rules) => JSON.parse(vm.runInNewContext(
  slice(probe, '  const withoutNot = ', '  /* Does a rule from a loaded sheet reach THIS')
    + '\nJSON.stringify(Object.fromEntries(byClass));',
  { rules }
));

const positiveLine = /^ {2}const positive = .*$/m.exec(probe);
assert.ok(positiveLine, 'the probe no longer declares positive() on one line');
const peerFor = (content, el, attr) => vm.runInNewContext(
  positiveLine[0] + '\n'
    + slice(probe, '  const classSet = ', '  const pairs = [];')
    + '\npeerFor(el, attr);',
  { content, el, attr }
);

test('a comma inside :is() or an attribute value does not split a clause', () => {
  const clause = 'body:is([data-page="releases"], [data-page="users"]) '
    + ':is(.badge-crit, .flagchip.is-crit)';
  const quoted = '[title="a, b"].quoted-cls';
  const got = clausesByClass([clause, quoted]);
  assert.deepEqual(got['badge-crit'], [clause]);
  assert.deepEqual(got['flagchip'], [clause]);
  assert.deepEqual(got['is-crit'], [clause]);
  assert.deepEqual(got['quoted-cls'], [quoted]);
});

test('a class listed inside :not(a, b) is not counted as painted', () => {
  const got = clausesByClass(['.keep:not(.refused-a, .refused-b)']);
  assert.deepEqual(Object.keys(got), ['keep']);
});

test('a top-level selector list still splits into its clauses', () => {
  const got = clausesByClass(['.one, .two > .three']);
  assert.deepEqual(got, { one: ['.one'], two: ['.two > .three'], three: ['.two > .three'] });
});

test('a paren inside a quoted value does not move the split depth', () => {
  const got = clausesByClass(['.q[title=")"], .r']);
  assert.deepEqual(got, { q: ['.q[title=")"]'], r: ['.r'] });
});

/* Nested functional pseudo-classes: the depth has to count back down one
   level at a time. A walk that reset to zero on any `)` would split the first
   list after `:not(.a)` and the second after `:is(.a)`. */
test('a comma inside a nested pseudo-class does not split a clause', () => {
  const first = '.x:is(:not(.a), .b)';
  const second = '.k:not(:is(.a), .refused)';
  const got = clausesByClass([first + ', .y', second]);
  assert.deepEqual(got, { x: [first], b: [first], y: ['.y'], k: [second] });
});

/* A hand-built element tree: just the surface peerFor() reads. */
function el(tag, attrs, children) {
  const node = {
    tagName: tag.toUpperCase(),
    attrs: attrs || {},
    parentElement: null,
    children: children || [],
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
  };
  for (const child of node.children) child.parentElement = node;
  return node;
}
function root(children) {
  const node = el('div', { id: 'content' }, children);
  node.querySelectorAll = (tag) => {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c.tagName === tag.toUpperCase()) out.push(c);
        walk(c);
      }
    };
    walk(node);
    return out;
  };
  return node;
}

test('a class-less row of another table is not the peer of a selected row', () => {
  const selected = el('tr', { class: 'is-selected', 'aria-current': 'true' });
  const unrelated = el('tr', {});
  const content = root([
    el('table', { class: 'tbl' }, [el('tbody', {}, [selected])]),
    el('table', { class: 'tbl' }, [el('tbody', {}, [unrelated])]),
  ]);
  assert.equal(peerFor(content, selected, 'aria-current'), null);
});

test('rule 2 still finds the twin that shares the marked element\'s class', () => {
  const pressed = el('button', { class: 'match-row-btn', 'aria-pressed': 'true' });
  const bare = el('button', {});
  const twin = el('button', { class: 'match-row-btn', 'aria-pressed': 'false' });
  const content = root([
    el('table', {}, [el('tbody', {}, [
      el('tr', {}, [el('td', {}, [pressed])]),
      el('tr', {}, [el('td', {}, [bare])]),
      el('tr', {}, [el('td', {}, [twin])]),
    ])]),
  ]);
  const peer = peerFor(content, pressed, 'aria-pressed');
  assert.ok(peer, 'rule 2 found no peer for the pressed button');
  assert.equal(peer.node, twin);
  assert.match(peer.rule, /same shape in another td/);
});

test('rule 2 pairs two class-less elements, and rejects a class the marked one lacks', () => {
  const pressed = el('button', { 'aria-pressed': 'true' });
  const styled = el('button', { class: 'other' });
  const bare = el('button', {});
  const content = root([
    el('div', {}, [el('span', {}, [pressed])]),
    el('div', {}, [el('span', {}, [styled])]),
    el('div', {}, [el('span', {}, [bare])]),
  ]);
  const peer = peerFor(content, pressed, 'aria-pressed');
  assert.ok(peer, 'two class-less buttons of the same shape were not paired');
  assert.equal(peer.node, bare);
});
