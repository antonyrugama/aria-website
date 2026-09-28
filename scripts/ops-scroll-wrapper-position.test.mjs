/* Every box an ops stylesheet makes scroll sideways is positioned, decided by
   parsing the sheets rather than by reading them for a string.

   WHY THIS EXISTS

   `overflow-x` clips only a descendant whose containing block is the box, and
   an absolutely positioned descendant resolves its containing block to the
   nearest POSITIONED ancestor. A static scroll box therefore does not clip an
   absolutely positioned child: an `.sr` caption inside a table wider than a
   phone resolves past the box, escapes its clip and can widen the page.
   Stadiora/Aria#10706 found seven of eight v2 wrappers static and asked for a
   rule-block check that fails on any scroller with no positioning declaration.

   scripts/ops-scroll-containment.test.mjs asserts the consequence in Chrome,
   but only for the panes and states the shared stub renders. This file judges
   every rule in every sheet under ops/assets, rendered or not, so a scroller
   on a pane the stub never draws (Cloud costs' `.sp-scroll` was one) is held
   to the same rule.

   WHAT IT DECIDES

   A rule scrolls sideways when its computed `overflow-x` is `auto`, `scroll`
   or `overlay`, spelled as the longhand or as the `overflow` shorthand, whose
   first value is the x axis. For each selector such a rule names, the same
   sheet has to declare `position` on that exact selector with a value other
   of `relative`, `absolute`, `fixed` or `sticky`, and every `position` it
   declares there must be one of those, so `static`, `initial`, `unset` and
   `revert` all fail. Rules inside `@media`, `@supports`, `@container`,
   `@layer`, `@scope` and `@starting-style` count, because the parse
   flattens them.

   The parse refuses what it cannot read rather than skipping it: a block
   at-rule it does not know, or a style rule with a nested rule inside it,
   throws and fails the sweep by name. Only at-rules that cannot hold a style
   rule (`@keyframes`, `@font-face` and the like) are passed over.

   NOT COVERED

   - A selector spelled differently from the one that scrolls. `.a` scrolls
     and `div.a` is positioned is two selectors here, though a browser may
     apply both to one element. The check asks for the position beside the
     overflow, which is where every repaired wrapper carries it.
   - A containing block made some other way (`transform`, `filter`,
     `contain: paint`, `will-change`). None of the wrappers uses one, and the
     check would report such a box as unpositioned.
   - Inline `style` attributes and styles a script sets. Only sheets are read.
   - Scrollers on the y axis only. They clip nothing sideways, so they cannot
     widen the page, which is the harm this guards. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'ops/assets');

/* Splits on top-level commas only, so `:is(.a, .b)` stays one selector. */
function splitSelectors(prelude) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i += 1) {
    const ch = prelude[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(prelude.slice(start, i));
      start = i + 1;
    }
  }
  out.push(prelude.slice(start));
  return out.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

const GROUPING = /^@(media|supports|container|layer|scope|starting-style)\b/i;
const NO_STYLE_RULES = /^@(-webkit-)?(keyframes|font-face|property|page|counter-style|font-feature-values|font-palette-values)\b/i;

/* Style rules with their selector lists, grouping at-rule bodies flattened
   in, comments removed first so prose naming a selector is not read as one.
   Throws on a block it cannot read, so an unread rule is a named failure and
   never a silently unjudged box. */
function cssRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    /* Statement at-rules (`@import …;`, `@layer a, b;`) end at a semicolon
       and carry no block, so the prelude is what follows the last one. */
    const prelude = src.slice(i, open).split(';').pop().trim();
    let depth = 0;
    let end = open;
    for (; end < src.length; end += 1) {
      if (src[end] === '{') depth += 1;
      else if (src[end] === '}') { depth -= 1; if (depth === 0) break; }
    }
    const body = src.slice(open + 1, end);
    if (prelude.startsWith('@')) {
      if (GROUPING.test(prelude)) out.push(...cssRules(body));
      else if (!NO_STYLE_RULES.test(prelude)) {
        throw new Error(`cannot read the at-rule "${prelude}": teach cssRules() to flatten it or to pass over it`);
      }
    } else if (prelude) {
      if (body.includes('{')) {
        throw new Error(`"${prelude}" holds a nested rule, which cssRules() does not read`);
      }
      out.push({ selectors: splitSelectors(prelude), body });
    }
    i = end + 1;
  }
  return out;
}

/* [property, value] pairs in source order. Property names are lower-cased
   (a browser reads `POSITION:` as `position:`); `!important` is dropped
   because it does not change whether a value is static. */
function declarations(body) {
  return body.split(';')
    .map((d) => /^\s*([^:]+?)\s*:\s*([\s\S]*?)\s*$/.exec(d))
    .filter(Boolean)
    .map(([, prop, value]) => [
      prop.startsWith('--') ? prop : prop.toLowerCase(),
      value.replace(/\s*!\s*important$/i, '').trim().toLowerCase()
    ]);
}

const SCROLLS = /^(auto|scroll|overlay)$/;
const POSITIONED = /^(relative|absolute|fixed|sticky)$/;

function scrollsSideways(body) {
  return declarations(body).some(([prop, value]) =>
    (prop === 'overflow-x' && SCROLLS.test(value)) ||
    (prop === 'overflow' && SCROLLS.test(value.split(/\s+/)[0])));
}

/* Every sideways scroller one sheet declares, with the `position` values the
   same sheet gives its exact selector. */
export function analyze(css) {
  const rules = cssRules(css);
  const boxes = new Set();
  for (const rule of rules) {
    if (scrollsSideways(rule.body)) rule.selectors.forEach((s) => boxes.add(s));
  }
  return [...boxes].sort().map((box) => {
    const positions = rules
      .filter((r) => r.selectors.includes(box))
      .flatMap((r) => declarations(r.body))
      .filter(([prop]) => prop === 'position')
      .map(([, value]) => value);
    const positioned = positions.length > 0 && positions.every((v) => POSITIONED.test(v));
    return { box, positions, positioned };
  });
}

const SHEETS = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.css')).sort();

/* A sheet the parser refuses is recorded, not thrown at load, so the failure
   lands on a named assertion below instead of on the module. */
const PARSE_ERRORS = [];
const READINGS = SHEETS.flatMap((sheet) => {
  try {
    return analyze(fs.readFileSync(path.join(ASSETS, sheet), 'utf8'))
      .map((r) => ({ sheet, ...r }));
  } catch (err) {
    PARSE_ERRORS.push(`${sheet}: ${err.message}`);
    return [];
  }
});

/* Eleven scrollers across ten sheets when this file landed. The floor sits
   below that so a scroller can be removed on purpose, and above zero so a
   parse that stops finding boxes cannot pass by judging nothing. */
const MIN_SCROLLERS = 8;

test('the sheets are parsed and the sweep judges real scrollers', () => {
  assert.ok(SHEETS.length > 0, 'found no stylesheet under ops/assets');
  assert.deepStrictEqual(PARSE_ERRORS, [],
    'a sheet holds CSS this parser cannot read, so its scrollers would go unjudged');
  assert.ok(READINGS.length >= MIN_SCROLLERS,
    `judged ${READINGS.length} sideways scrollers, below the floor of ${MIN_SCROLLERS}: ` +
    'the parse has stopped finding boxes, or scrollers were removed and the floor must follow');
  console.log(`# ${READINGS.length} sideways scrollers in ${new Set(READINGS.map((r) => r.sheet)).size} ` +
    `of ${SHEETS.length} sheets: ${READINGS.map((r) => `${r.sheet} ${r.box}`).join(', ')}`);
});

test('every sideways-scrolling box in an ops sheet is positioned', () => {
  const unpositioned = READINGS.filter((r) => !r.positioned)
    .map((r) => `${r.sheet} ${r.box} (position: ${r.positions.join(', ') || 'none declared'})`);
  assert.deepStrictEqual(unpositioned, [],
    'these boxes scroll sideways but are not positioned, so overflow-x clips no absolutely ' +
    'positioned descendant (Stadiora/Aria#10706). Add `position: relative` beside the overflow');
});

/* The same analyze() the sweep above runs, on sheets whose answers are stated
   here rather than read from the tree, so each branch is shown to fire. */
test('analyze() flags a static scroller and accepts a positioned one', () => {
  const judged = (css) => Object.fromEntries(analyze(css).map((r) => [r.box, r.positioned]));
  assert.deepStrictEqual(judged('.a { overflow-x: auto; } .b { overflow-x: scroll; position: relative; }'),
    { '.a': false, '.b': true });
  assert.deepStrictEqual(judged('.a { overflow: auto hidden; }'), { '.a': false },
    'the shorthand\'s first value is the x axis');
  assert.deepStrictEqual(judged('.a { overflow: hidden auto; }'), {},
    'a y-only scroller is out of scope');
  assert.deepStrictEqual(judged('.a { overflow-x: auto; } .a:focus-visible { position: relative; }'),
    { '.a': false }, 'a position on a different selector does not position the box');
  assert.deepStrictEqual(judged('.a { overflow-x: auto; } .x, .a { position: relative; }'),
    { '.a': true }, 'a position in a later rule for the same selector counts');
  assert.deepStrictEqual(judged('@media (max-width: 600px) { .a { overflow-x: auto; position: sticky; } }'),
    { '.a': true }, 'rules inside @media are read');
  assert.deepStrictEqual(judged('.a { overflow-x: auto; position: relative; } .a { position: static; }'),
    { '.a': false }, 'a later position: static un-positions the box');
  assert.deepStrictEqual(judged('/* .a { overflow-x: auto; } */ .b { color: red; }'), {},
    'prose in a comment is not a rule');
  assert.deepStrictEqual(judged(':is(.a, .b) { overflow-x: auto; position: relative; }'),
    { ':is(.a, .b)': true }, 'a comma inside :is() does not split the selector');
  assert.deepStrictEqual(judged('.a { overflow-x: auto; position: unset; } .b { overflow-x: auto; position: initial; }'),
    { '.a': false, '.b': false }, 'a keyword that computes to static is not a position');
  assert.deepStrictEqual(judged('@container (max-width: 600px) { .a { overflow-x: auto; } }'),
    { '.a': false }, 'rules inside @container are read');
  assert.deepStrictEqual(judged('@layer base; @layer base { .a { overflow-x: auto; } }'),
    { '.a': false }, 'rules inside @layer are read');
  assert.deepStrictEqual(judged('@import url(x.css); .a { overflow-x: auto; }'),
    { '.a': false }, 'a statement at-rule is not glued to the rule after it');
  assert.deepStrictEqual(judged('@keyframes k { from { opacity: 0; } to { opacity: 1; } } .a { overflow-x: auto; }'),
    { '.a': false }, '@keyframes is passed over and the rule after it is still read');
});

test('analyze() refuses CSS it cannot read rather than skipping it', () => {
  assert.throws(() => analyze('.card { .a { overflow-x: auto; } }'), /nested rule/,
    'a nested rule was skipped silently');
  assert.throws(() => analyze('@document url(x) { .a { overflow-x: auto; } }'), /cannot read the at-rule/,
    'an unknown block at-rule was skipped silently');
});
