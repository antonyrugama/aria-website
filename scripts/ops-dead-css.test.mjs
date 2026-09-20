/* Dead CSS in the operations dashboard, decided from the pages rather than
   asserted in prose.

   WHY THIS EXISTS

   The dashboard is being remodelled one pane at a time from a v1 layout onto
   the v2 pane bootstrap. A v1 page loads assets/ops.css; a v2 page loads
   assets/aria.css, assets/shell-pane-v2.css and its own pane sheet, and loads
   ops.css not at all. So every conversion silently strands whatever in the v1
   sheets was written for the page that moved, and the stranded rule keeps
   reading as live styling: Stadiora/Aria#10438 is exactly that, a light-theme
   badge block at the end of ops.css scoped to two pages that had both become
   v2 panes. The next person to change a badge colour on either pane would have
   edited it and seen nothing happen.

   One conversion is still open at the time of writing (Cloud costs). A prose
   rule would cost one issue per conversion forever. This decides it instead.

   WHAT IT DECIDES

   Two kinds of death, both read out of the files rather than named here:

     1. ORPHAN SHEET. A stylesheet under ops/assets that no page under ops/
        links. Decided from the <link rel="stylesheet"> tags in the HTML, after
        HTML comments have been removed, because five v2 pages carry a comment
        that NAMES ops.css and operate.css to say they are deliberately absent
        and a grep reads that as the opposite of the truth. Its inverse, a
        <link> to a stylesheet that is not on disk, is reported too: without
        that a mistyped href would present as an orphan and read as dead code.

     2. DEAD BODY SCOPE. A style rule in a sheet whose every selector requires
        <body> to carry an attribute VALUE that no page loading that sheet
        carries. `body:is([data-page="releases"], [data-page="users"])` in a
        sheet that only login, setup and spend load is the case in #10438.

   HOW MUCH OF THAT IS LOAD BEARING TODAY, counted rather than claimed

   The counts are printed by the first test on every run, so this paragraph
   cannot drift from them. At the time of writing arm 1 judges every stylesheet
   in ops/assets against the link sets of every page in ops/, and arm 2 judges
   NOTHING: once the backfill in this change landed, no selector in the
   dashboard constrains a body attribute at all, so bodyAttributeScopedRules is
   0 and that assertion passes vacuously. Arm 2 is a ratchet for the conversion
   still open and the ones after it, not a check that is currently finding
   anything. What is NOT vacuous about it on every run is that its selector
   reader really runs over the real sheets: bodyAnchoredRules counts the rules
   whose selector reaches <body> at all, the first test requires that to be
   non-zero, and the fixture tests at the foot of this file drive the same
   analyze() the repository run drives. The proof that arm 2 fires on a real
   violation is the red commit that added this file.

   Both are computed by parsing. Nothing here asserts that a file contains or
   does not contain a string: pinning a string pins the string, not the
   behaviour it appears in, and a stylesheet is full of prose that mentions its
   own selectors.

   HOW IT AVOIDS THE OBVIOUS WAY TO BE WRONG

   A selector is not dead just because no page's MARKUP carries the attribute:
   classes and attributes are written by JavaScript at runtime. So before this
   will call any body-attribute scope dead it demands that the attribute be
   one no script can write. That check is textual and deliberately paranoid: it
   REFUSES — fails the run by name — rather than judging, whenever a script
   mentions the attribute outside a read, touches document.body.dataset, sets
   an attribute on document.body or document.documentElement under a computed
   name, or replaces the document wholesale. Inline <script> blocks in the
   pages are read alongside ops/assets/*.js, because a net that covered only
   the files would have a hole the width of a script tag. A refusal is loud. A
   wrong judgement would be silent, and silence is the failure this guard
   cannot afford.

   COVERED, each with the mutation that proves it

   Every claim below is proved by a mutation run against the real repository
   and published in the pull request that added this file; the fixture tests
   further down re-prove each one in miniature on every run.

     - an orphan sheet is found               restore ops/assets/operate.css
     - an HTML comment naming a sheet is not  the same mutation: five v2 pages
       a link                                 already name it in a comment
     - a dead body-attribute scope is found   restore the deleted block at the
                                              end of ops/assets/ops.css
     - the value is read, not the attribute   the same block with "releases"
       name                                   changed to "login", a page that
                                              does load ops.css: no finding
     - a CSS comment is not a rule            the same block commented out:
                                              no finding
     - rules inside @media are judged         the same block wrapped in
                                              @media (min-width: 1px)
     - a script that writes the attribute     document.body.setAttribute(
       stops the judgement                    'data-page', 'releases') added
                                              to assets/shell.js: REFUSED
     - a computed attribute name on body      document.body.setAttribute(k, v)
       stops the judgement                    added to assets/shell.js: REFUSED

   The analysis underneath those is proved the same way, by mutating the guard
   itself and watching one named fixture test go red. Each of these survived
   the suite until the fixture beside it was written, so each is a branch that
   was load bearing and unproven:

     - a @keyframes child is not a selector   ctx = 'rules' unconditionally in
                                              the at-rule branch
     - an unquoted url() is not a comment     the url( passthrough removed
     - :where() is read as :is() is           the where arm of the pseudo gate
                                              removed
     - the attribute name is case-folded      m[1].toLowerCase() -> m[1]
     - the type selector is case-folded       the type push's toLowerCase()
                                              removed
     - two values on one attribute is a       narrow()'s intersection replaced
       contradiction, not a union             by a union
     - >, + and ~ end a compound even         the compound boundary predicate
       unspaced                               narrowed to whitespace
     - a bare read of document.body.dataset   the DATASET_ON_DOCUMENT risk
       stops the judgement                    push deleted
     - documentElement counts as well as      the receiver alternation narrowed
       body                                   to body
     - removeAttribute and toggleAttribute    the method alternation narrowed
       count as well as setAttribute          to setAttribute
     - a case-insensitivity flag leaves the   parseAttrSelector reporting op
       rule ALIVE, not dead                   '=' for the flagged shape
     - the markup side is case-folded too     the body attribute map's
                                              toLowerCase() removed
     - a hasAttribute read is a read          READ_CALL narrowed to
                                              getAttribute
     - documentElement.innerHTML is a         that entry deleted from
       document replacement                   DOCUMENT_REPLACERS
     - an inline script is scanned like a     inlineScripts returning []
       file

   NOT COVERED, on purpose

     - A selector that is dead for any reason other than a body-attribute
       scope. A rule for a component no page draws any more is invisible here,
       because deciding that needs the runtime class set and this does not have
       it. Narrowing the claim was preferred to guessing at it.
     - CSS nesting. A rule nested inside another rule's block is not judged.
       This repository has none; if it gains some, they are simply not seen.
     - A body-attribute write through a reference to <body> that is not
       textually document.body or document.documentElement — an alias, a
       closest('body'), an element handed in as an argument. The refusal check
       reads text and cannot resolve those.
     - An attribute selector with an operator other than `=`, a case-insensitive
       flag, or a bare [attr] presence test. These are read and then ignored,
       which can only under-report. That "ignored" is enforced in one place:
       parseAttrSelector reports an operator the callers do not act on, rather
       than an `=` with a value it could not resolve. Round 2 of review found
       the flag case reporting `=`, which made every caller record a
       requirement for a value no page can carry.
     - Whether a sheet a page DOES load is the right sheet for it, and whether
       a rule that is alive is also correct.
     - Anything outside ops/, and anything in a SUBDIRECTORY of it: the page
       and sheet listings are one level deep, so ops/panes/foo.html would not
       be read and a sheet only it linked would be reported orphaned.
     - @import. The orphan arm reads <link> tags only, so a sheet reachable
       only through an @import inside a linked sheet reads as orphaned. The
       dashboard has no @import and its own comment says it deliberately has
       none, which is why this is recorded rather than implemented.
     - HTML character references in an attribute value. `data-page="a&amp;b"`
       is read as the seven characters it is written with, so a selector
       asking for `a&b` would be judged against the wrong string.
     - CSS escapes in a selector's value, which is the same shape on the other
       side: `[data-page="lo\67 in"]` matches `login` and is compared as the
       characters it is written with.
     - Which <body> is the page's <body>. The first match for `<body` outside
       an HTML comment wins, so one inside a <template> or a string literal
       would be read as the page's own.

   Five of those — the subdirectory, the @import, the character reference, the
   CSS escape and the wrong <body> — are shapes where the wrong answer would be
   DEAD rather than alive, so it is worth being exact about the direction the
   rest of this leans. Within the analysis it does perform, anything it cannot
   parse, resolve or intersect is treated as ALIVE, so it under-reports rather
   than deleting something that is still on screen; the exception is a script
   that could be writing the attribute, which becomes a loud REFUSAL, because
   there the safe answer is not "alive" but "stop". Outside that analysis, in
   the five input shapes above, it would be wrong in the dangerous direction,
   and each is named here rather than defended against because none of the five
   exists in this repository and all five fail loudly rather than silently.

   That list is where two rounds of review put their findings, and both rounds
   found it overclaiming. It is worth reading as the least trustworthy part of
   this file rather than the most. */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ====================== CSS: comments, then rules ======================= */

/* Blank out CSS comments, preserving every newline so a rule's line number
   survives. Strings and unquoted url() bodies are copied through untouched: a
   comment opener inside a `content` string is content, not a comment. */
export function stripCssComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      let end = src.indexOf('*/', i + 2);
      end = end === -1 ? src.length : end + 2;
      for (let k = i; k < end; k++) out += src[k] === '\n' ? '\n' : ' ';
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        i++;
        if (src[i - 1] === quote || src[i - 1] === '\n') break;
      }
      continue;
    }
    if ((ch === 'u' || ch === 'U') && /^url\(/i.test(src.slice(i, i + 4))) {
      const end = src.indexOf(')', i);
      const stop = end === -1 ? src.length : end + 1;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/* Every style rule in a sheet, as { selector, line }. Descends into the
   conditional group rules whose children are style rules and steps over
   everything else: a @keyframes selector is not a selector, a @font-face body
   is declarations, and a block nested inside a style rule is CSS nesting,
   which is in NOT COVERED above. */
export function parseStyleRules(source) {
  const src = stripCssComments(source);
  const CONDITIONAL = new Set(['media', 'supports', 'layer', 'container', 'scope']);
  const rules = [];
  const stack = [];
  let ctx = 'rules';
  let prelude = '';
  let preludeLine = 0;
  let line = 1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') line++;

    if (ch === '{') {
      const text = prelude.replace(/\s+/g, ' ').trim();
      stack.push(ctx);
      if (ctx !== 'rules') ctx = 'opaque';
      else if (text.startsWith('@')) {
        const name = (text.match(/^@-?[\w-]*?-?([\w-]+)/) || [])[1] || '';
        ctx = CONDITIONAL.has(name.toLowerCase()) ? 'rules' : 'opaque';
      } else if (text) {
        rules.push({ selector: prelude.trim(), line: preludeLine || line });
        ctx = 'declarations';
      } else ctx = 'opaque';
      prelude = '';
      preludeLine = 0;
      continue;
    }

    if (ch === '}') {
      ctx = stack.pop() ?? 'rules';
      prelude = '';
      preludeLine = 0;
      continue;
    }

    if (ctx !== 'rules') continue;

    if (ch === ';') { prelude = ''; preludeLine = 0; continue; }
    if (!prelude.trim() && ch.trim()) preludeLine = line;
    prelude += ch;
  }
  return rules;
}

/* ========================= selector analysis ============================ */

/* Split on a separator that is outside (), [] and quotes. */
function splitTop(text, isSep) {
  const parts = [];
  let cur = '';
  let paren = 0;
  let bracket = 0;
  let quote = null;
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    if (!paren && !bracket && isSep(ch)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export const splitSelectorList = (text) => splitTop(text, (c) => c === ',');
const splitCompounds = (text) => splitTop(text, (c) => /[\s>+~]/.test(c));

/* One compound selector as a list of simple selectors. */
export function simpleSelectors(compound) {
  const out = [];
  let i = 0;
  const balanced = (start, open, close) => {
    let depth = 0;
    let quote = null;
    for (let j = start; j < compound.length; j++) {
      const c = compound[j];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (!depth) return j + 1; }
    }
    return compound.length;
  };

  while (i < compound.length) {
    const ch = compound[i];
    if (ch === '[') {
      const end = balanced(i, '[', ']');
      out.push({ kind: 'attr', text: compound.slice(i, end) });
      i = end;
    } else if (ch === ':') {
      let j = i + 1;
      if (compound[j] === ':') j++;
      while (j < compound.length && /[\w-]/.test(compound[j])) j++;
      const name = compound.slice(i, j).replace(/^::?/, '').toLowerCase();
      let args = null;
      if (compound[j] === '(') {
        const end = balanced(j, '(', ')');
        args = compound.slice(j + 1, end - 1);
        j = end;
      }
      out.push({ kind: 'pseudo', name, args });
      i = j;
    } else if (ch === '.' || ch === '#') {
      let j = i + 1;
      while (j < compound.length && /[\w-]/.test(compound[j])) j++;
      out.push({ kind: ch === '.' ? 'class' : 'id', text: compound.slice(i, j) });
      i = j;
    } else if (/[\w*|-]/.test(ch)) {
      let j = i;
      while (j < compound.length && /[\w*|-]/.test(compound[j])) j++;
      out.push({ kind: 'type', text: compound.slice(i, j).toLowerCase() });
      i = j;
    } else {
      out.push({ kind: 'other', text: ch });
      i++;
    }
  }
  return out;
}

/* [data-page="users"] -> { name, op, value }. Only a flagless `=` resolves to
   a value. Every other shape comes back with a null value AND an operator the
   callers do not act on, which is load bearing: both callers key on `=` alone,
   so reporting `=` for a value this did not resolve would record a requirement
   for the value null, which no page can carry — a deletion instruction against
   a rule that matches. A case-insensitivity flag is the shape that makes that
   concrete, since matching it needs a case fold this does not perform. */
export function parseAttrSelector(text) {
  const inner = text.slice(1, -1).trim();
  const m = inner.match(
    /^([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*([isIS])?)?$/,
  );
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (!m[2]) return { name, op: 'exists', value: null };
  if (m[6]) return { name, op: 'unresolved', value: null };
  if (m[2] !== '=') return { name, op: m[2], value: null };
  return { name, op: '=', value: m[3] ?? m[4] ?? m[5] ?? '' };
}

/* Does this complex selector name <body> at all? Not a deadness question: it
   is how the first test proves the selector reader ran over the real sheets
   on a repository where nothing constrains a body ATTRIBUTE any more. */
export function reachesBody(complexSelector) {
  return splitCompounds(complexSelector).some((c) =>
    simpleSelectors(c).some((s) => s.kind === 'type' && s.text === 'body'));
}

/* The attribute values one complex selector REQUIRES of <body>.

   Returns a Map of attribute name -> Set of permitted values, or null when the
   selector could not be read confidently. Only two shapes contribute, because
   only two can be intersected without guessing:

     body[a="v"]                     -> a in {v}
     body:is([a="v"], [a="w"])       -> a in {v, w}      (also :where)

   Every other simple selector on the body compound — a class, an id, another
   pseudo, :not(), :has() — can only make the selector match FEWER elements,
   never more, so ignoring it can only under-report and is safe. The exception
   is an :is()/:where() whose arms are not all a single `=` attribute test on
   one attribute: `body:is([a="v"], .x)` matches through .x with no attribute
   at all, so reading {v} off it would be a wrong requirement. That returns
   null and the rule is left alive. */
export function bodyAttributeRequirements(complexSelector) {
  const bodyCompounds = splitCompounds(complexSelector).filter((c) =>
    simpleSelectors(c).some((s) => s.kind === 'type' && s.text === 'body'));
  if (bodyCompounds.length === 0) return new Map();
  if (bodyCompounds.length > 1) return null;

  const reqs = new Map();
  const narrow = (name, values) => {
    const prev = reqs.get(name);
    if (!prev) { reqs.set(name, new Set(values)); return; }
    reqs.set(name, new Set([...prev].filter((v) => values.has(v))));
  };

  for (const simple of simpleSelectors(bodyCompounds[0])) {
    if (simple.kind === 'attr') {
      const attr = parseAttrSelector(simple.text);
      if (!attr) return null;
      if (attr.op === '=') narrow(attr.name, new Set([attr.value]));
      continue;
    }
    if (simple.kind !== 'pseudo' || !simple.args) continue;
    if (simple.name !== 'is' && simple.name !== 'where') {
      /* :not(), :has() and friends only narrow. Ignored on purpose. */
      continue;
    }
    const arms = splitSelectorList(simple.args);
    const parsed = arms.map((arm) => {
      const simples = simpleSelectors(arm);
      if (simples.length !== 1 || simples[0].kind !== 'attr') return null;
      const attr = parseAttrSelector(simples[0].text);
      return attr && attr.op === '=' ? attr : null;
    });
    if (parsed.some((p) => p === null)) {
      /* Not every arm is one `=` attribute test. If NONE of the arms mentions
         an attribute the union cannot relax an attribute requirement, so the
         :is() only narrows and is ignored; otherwise the selector is not
         readable and the whole rule stays alive. */
      const mentionsAttr = arms.some((arm) =>
        simpleSelectors(arm).some((s) => s.kind === 'attr'));
      if (mentionsAttr) return null;
      continue;
    }
    const names = new Set(parsed.map((p) => p.name));
    if (names.size !== 1) return null;
    narrow(parsed[0].name, new Set(parsed.map((p) => p.value)));
  }
  return reqs;
}

/* ============================ HTML: links, body ========================= */

export function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

function parseTagAttributes(tagBody) {
  const attrs = {};
  const re = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(tagBody)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/* The hrefs of every <link rel="stylesheet">, resolved against the page. */
export function linkedStylesheets(html, pagePath) {
  const src = stripHtmlComments(html);
  const out = [];
  const re = /<link\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const attrs = parseTagAttributes(m[1]);
    const rel = (attrs.rel || '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet') || !attrs.href) continue;
    out.push(resolveHref(attrs.href, pagePath));
  }
  return out;
}

export function resolveHref(href, pagePath) {
  const clean = href.split(/[?#]/)[0];
  if (/^[a-z]+:/i.test(clean) || clean.startsWith('//')) return null;
  const base = clean.startsWith('/') ? '.' : path.posix.dirname(pagePath);
  return path.posix.normalize(path.posix.join(base, clean.replace(/^\//, '')));
}

export function bodyAttributes(html) {
  const m = stripHtmlComments(html).match(/<body\b([^>]*)>/i);
  return m ? parseTagAttributes(m[1]) : null;
}

/* Script text written INTO a page. The refusal check is the guard's safety
   net, and a net that only covers ops/assets/*.js has a hole the width of a
   <script> tag: the same source that is refused in a file would be invisible
   inline. Every script body is read, including the body of a <script src>,
   which a browser ignores: reading it can only add refusals, and a refusal is
   the loud direction. */
export function inlineScripts(html, pagePath) {
  const out = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  const clean = stripHtmlComments(html);
  while ((m = re.exec(clean)) !== null) {
    if (m[1].trim()) out.push({ name: `${pagePath} (inline script)`, source: m[1] });
  }
  return out;
}

/* ================= can a script write this attribute? =================== */

const DOCUMENT_REPLACERS = [
  /\bdocument\s*\.\s*write(?:ln)?\s*\(/,
  /\.\s*outerHTML\s*=[^=]/,
  /\bdocument\s*\.\s*documentElement\s*\.\s*innerHTML\s*=[^=]/,
];

/* A computed attribute name written onto the document's own two elements.
   Anything else — node.setAttribute(key, v) on a freshly built child — is not
   a way to reach <body> and is not matched. */
const COMPUTED_ON_DOCUMENT =
  /\bdocument\s*\.\s*(?:body|documentElement)\s*\.\s*(?:set|remove|toggle)Attribute\s*\(\s*[^'"`\s)]/;

const DATASET_ON_DOCUMENT =
  /\bdocument\s*\.\s*(?:body|documentElement)\s*\.\s*dataset\b/;

const READ_CALL = /(?:get|has)Attribute\s*\(\s*$/;

function camel(attrName) {
  return attrName.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/* Every reason this run must refuse to judge `attrName` rather than call a
   selector using it dead. An empty list means no script in `scripts` can be
   shown to write it, within the limits in NOT COVERED above. */
export function attributeWriteRisks(attrName, scripts) {
  const risks = [];
  const prop = camel(attrName);
  const literal = new RegExp(`(['"\`])${attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g');
  const datasetWrite = new RegExp(
    `\\.\\s*dataset\\s*(?:\\.\\s*${prop}\\b|\\[\\s*['"\`]${prop}['"\`]\\s*\\])\\s*=[^=]`,
  );

  for (const { name, source } of scripts) {
    let m;
    literal.lastIndex = 0;
    while ((m = literal.exec(source)) !== null) {
      if (READ_CALL.test(source.slice(Math.max(0, m.index - 40), m.index))) continue;
      const line = source.slice(0, m.index).split('\n').length;
      risks.push(`${name}:${line} names ${attrName} outside a getAttribute/hasAttribute read`);
    }
    if (datasetWrite.test(source)) risks.push(`${name} assigns to dataset.${prop}`);
    if (DATASET_ON_DOCUMENT.test(source)) risks.push(`${name} touches document.body.dataset`);
    if (COMPUTED_ON_DOCUMENT.test(source)) {
      risks.push(`${name} sets an attribute on document.body under a computed name`);
    }
    for (const re of DOCUMENT_REPLACERS) {
      if (re.test(source)) risks.push(`${name} can replace the document's markup (${re.source})`);
    }
  }
  return risks;
}

/* ============================== the analysis ============================ */

/* `input` is { pages, sheets, scripts }, each an array of { name, source }.
   `name` is a repo-relative posix path for pages and sheets. Taking the files
   as data rather than reading them here is what lets the fixture tests below
   drive the same code the repository run drives. */
export function analyze(input) {
  const pages = input.pages.map((p) => {
    const body = bodyAttributes(p.source);
    return {
      name: p.name,
      sheets: linkedStylesheets(p.source, p.name).filter(Boolean),
      bodyFound: body !== null,
      body: body || {},
    };
  });
  const scripts = input.scripts.concat(
    ...input.pages.map((p) => inlineScripts(p.source, p.name)));

  const findings = [];
  const counts = {
    pages: pages.length,
    sheets: input.sheets.length,
    rules: 0,
    bodyAnchoredRules: 0,
    bodyAttributeScopedRules: 0,
    attributesJudged: new Set(),
  };

  const onDisk = new Set(input.sheets.map((s) => s.name));
  for (const p of pages) {
    for (const href of p.sheets) {
      if (!onDisk.has(href)) {
        findings.push({
          kind: 'dangling-link',
          where: `${p.name} -> ${href}`,
          detail: `${p.name} links a stylesheet that is not on disk`,
        });
      }
    }
  }

  for (const sheet of input.sheets) {
    const loaders = pages.filter((p) => p.sheets.includes(sheet.name));
    const rules = parseStyleRules(sheet.source);
    counts.rules += rules.length;

    if (loaders.length === 0) {
      findings.push({
        kind: 'orphan-sheet',
        where: sheet.name,
        detail: `no page under ops/ has a <link rel="stylesheet"> for ${sheet.name}`,
      });
      continue;
    }

    for (const rule of rules) {
      const selectors = splitSelectorList(rule.selector);
      if (selectors.some((s) => reachesBody(s))) counts.bodyAnchoredRules++;
      const perSelector = selectors.map((s) => bodyAttributeRequirements(s));
      if (perSelector.some((r) => r === null || r.size === 0)) continue;
      counts.bodyAttributeScopedRules++;

      const verdicts = perSelector.map((reqs) => {
        for (const [attrName, values] of reqs) {
          counts.attributesJudged.add(attrName);
          const risks = attributeWriteRisks(attrName, scripts);
          if (risks.length) return { refused: risks };
          const reached = loaders.some((p) => values.has(p.body[attrName]));
          if (!reached) {
            return {
              dead: `${attrName} must be one of {${[...values].sort().join(', ')}}, and of the ` +
                `${loaders.length} page(s) loading this sheet none carries that ` +
                `(${loaders.map((p) => `${p.name} ${attrName}=${p.body[attrName] ?? 'absent'}`).join('; ')})`,
            };
          }
        }
        return { alive: true };
      });

      const refused = verdicts.find((v) => v.refused);
      if (refused) {
        findings.push({
          kind: 'refused',
          where: `${sheet.name}:${rule.line}`,
          detail: `cannot judge this rule: ${refused.refused.join('; ')}`,
        });
        continue;
      }
      if (verdicts.every((v) => v.dead)) {
        findings.push({
          kind: 'dead-body-scope',
          where: `${sheet.name}:${rule.line}`,
          detail: `${rule.selector.replace(/\s+/g, ' ')} — ${verdicts[0].dead}`,
        });
      }
    }
  }
  return { findings, counts, pages };
}

/* =========================== the repository ============================= */

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const listing = (dir, ext) =>
  readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).sort()
    .map((f) => ({ name: `${dir}/${f}`, source: read(`${dir}/${f}`) }));

const repo = {
  pages: listing('ops', '.html'),
  sheets: listing('ops/assets', '.css'),
  scripts: listing('ops/assets', '.js'),
};
const result = analyze(repo);

test('the guard judged the real dashboard, and judged something', () => {
  /* A guard that silently found nothing to look at is the quietest false green
     there is, and this one runs on ubuntu-latest where a path that works on a
     developer's macOS may not. Every number here is counted from the files.

     bodyAttributeScopedRules is expected to be 0 on this repository and is
     printed rather than asserted: see the paragraph on vacuity at the head of
     this file. bodyAnchoredRules is the one that must not be 0, because it is
     what shows the selector reader ran over the real sheets. */
  const summary =
    `pages ${result.counts.pages}, stylesheets ${result.counts.sheets}, ` +
    `style rules ${result.counts.rules}, rules reaching <body> ` +
    `${result.counts.bodyAnchoredRules}, rules constraining a body attribute ` +
    `${result.counts.bodyAttributeScopedRules}, attributes judged ` +
    `[${[...result.counts.attributesJudged].sort().join(', ')}]`;
  console.log(`  ops-dead-css: ${summary}`);

  assert.ok(result.counts.pages >= 10, `too few pages read: ${summary}`);
  assert.ok(result.counts.sheets >= 10, `too few stylesheets read: ${summary}`);
  assert.ok(result.counts.rules >= 400, `too few style rules parsed: ${summary}`);
  assert.ok(result.counts.bodyAnchoredRules >= 1,
    `the selector reader found no rule reaching <body> in the whole dashboard, ` +
    `which means it is not reading selectors: ${summary}`);
  assert.ok(repo.scripts.length >= 10, `too few scripts read: ${repo.scripts.length}`);

  /* Every page names a sheet, and every page's <body> was read. Without this a
     silently broken HTML parser would report every sheet orphaned, which is a
     loud failure, or — if it broke the other way and matched nothing — would
     report nothing at all. */
  for (const page of result.pages) {
    assert.ok(page.sheets.length > 0, `${page.name} was read as loading no stylesheet`);
    assert.ok(page.bodyFound, `${page.name}'s <body> tag was not found at all`);
  }
});

test('every stylesheet a page links is on disk', () => {
  const dangling = result.findings.filter((f) => f.kind === 'dangling-link');
  assert.deepEqual(dangling.map((f) => f.where), [],
    'a <link> to a stylesheet that does not exist:\n' +
    dangling.map((f) => `  ${f.where}: ${f.detail}`).join('\n'));
});

test('no stylesheet under ops/assets is loaded by no page', () => {
  const orphans = result.findings.filter((f) => f.kind === 'orphan-sheet');
  assert.deepEqual(orphans.map((f) => f.where), [],
    'a stylesheet nothing links is dead weight; delete it or link it:\n' +
    orphans.map((f) => `  ${f.where}: ${f.detail}`).join('\n'));
});

test('no rule is scoped to a body attribute value no page loading its sheet carries', () => {
  const dead = result.findings.filter((f) => f.kind === 'dead-body-scope');
  assert.deepEqual(dead.map((f) => f.where), [],
    'these rules cannot match on any page that loads them:\n' +
    dead.map((f) => `  ${f.where}: ${f.detail}`).join('\n'));
});

test('no body attribute this guard judged can be written by a script', () => {
  const refused = result.findings.filter((f) => f.kind === 'refused');
  assert.deepEqual(refused.map((f) => f.where), [],
    'the guard refused to judge these rules rather than risk a wrong answer:\n' +
    refused.map((f) => `  ${f.where}: ${f.detail}`).join('\n'));
});

/* ============================== the guard ===============================

   Guard code is code. Everything below drives the same analyze() the repository
   run drives, on files built here, so each claim in COVERED has an assertion
   that fails when the mechanism behind it is removed. */

const page = (name, html) => ({ name, source: html });
const sheet = (name, css) => ({ name, source: css });
const html = (body, links) =>
  `<!doctype html><html><head>${links}</head><body ${body}>x</body></html>`;

test('a stylesheet no page links is reported, and a comment naming it is not a link', () => {
  const linked = analyze({
    pages: [page('ops/a.html', html('data-page="a"', '<link rel="stylesheet" href="assets/x.css">'))],
    sheets: [sheet('ops/assets/x.css', '.a { color: red; }')],
    scripts: [],
  });
  assert.deepEqual(linked.findings, []);

  const commentedOut = analyze({
    pages: [page('ops/a.html',
      html('data-page="a"', '<!-- assets/x.css is deliberately absent --><link rel="stylesheet" href="assets/y.css">'))],
    sheets: [sheet('ops/assets/x.css', '.a { color: red; }'), sheet('ops/assets/y.css', '.b { color: red; }')],
    scripts: [],
  });
  assert.deepEqual(commentedOut.findings.map((f) => [f.kind, f.where]),
    [['orphan-sheet', 'ops/assets/x.css']]);
});

test('a link to a stylesheet that is not on disk is reported as that, not as an orphan', () => {
  const out = analyze({
    pages: [page('ops/a.html', html('data-page="a"',
      '<link rel="stylesheet" href="assets/typo.css">'))],
    sheets: [sheet('ops/assets/x.css', '.a { color: red; }')],
    scripts: [],
  });
  assert.deepEqual(out.findings.map((f) => [f.kind, f.where]), [
    ['dangling-link', 'ops/a.html -> ops/assets/typo.css'],
    ['orphan-sheet', 'ops/assets/x.css'],
  ]);
});

test('reachesBody sees the rules the deadness test cannot judge', () => {
  assert.equal(reachesBody('body.is-booting .skip-link'), true);
  assert.equal(reachesBody('[data-theme="light"] body::before'), true);
  assert.equal(reachesBody('.card .body'), false, '.body is a class, not <body>');
  assert.deepEqual(bodyAttributeRequirements('body.is-booting .skip-link'), new Map(),
    'a class on <body> is not an attribute requirement');
});

test('a body-attribute scope no loading page carries is reported, by value not by name', () => {
  const sheets = (selector) => [sheet('ops/assets/x.css', `${selector} { color: red; }`)];
  const pages = [page('ops/login.html', html('data-page="login"', '<link rel="stylesheet" href="assets/x.css">'))];

  const dead = analyze({ pages, sheets: sheets('body[data-page="users"]'), scripts: [] });
  assert.deepEqual(dead.findings.map((f) => f.kind), ['dead-body-scope']);

  /* Same attribute name, a value the page does carry. A check that pinned the
     string `data-page` would report this one too. */
  const alive = analyze({ pages, sheets: sheets('body[data-page="login"]'), scripts: [] });
  assert.deepEqual(alive.findings, []);

  /* The :is() union is read as a union: one reachable arm keeps it alive. */
  const union = 'body:is([data-page="users"], [data-page="login"])';
  assert.deepEqual(analyze({ pages, sheets: sheets(union), scripts: [] }).findings, []);
  const deadUnion = 'body:is([data-page="users"], [data-page="releases"])';
  assert.deepEqual(
    analyze({ pages, sheets: sheets(deadUnion), scripts: [] }).findings.map((f) => f.kind),
    ['dead-body-scope']);

  /* An :is() arm that is not an attribute test can match with no attribute at
     all, so the rule is left alive rather than read as a union. */
  const mixed = 'body:is([data-page="users"], .special)';
  assert.deepEqual(analyze({ pages, sheets: sheets(mixed), scripts: [] }).findings, []);

  /* :where() is read as :is() is. Asserted on a DEAD union, because an alive
     one stays alive whether the pseudo is understood or ignored. */
  const deadWhere = 'body:where([data-page="users"], [data-page="releases"])';
  assert.deepEqual(
    analyze({ pages, sheets: sheets(deadWhere), scripts: [] }).findings.map((f) => f.kind),
    ['dead-body-scope']);

  /* The attribute NAME is matched case-insensitively, as HTML matches it. A
     page carrying the value must keep the rule alive however it is spelled. */
  const usersPage = [page('ops/users.html', html('data-page="users"', '<link rel="stylesheet" href="assets/x.css">'))];
  assert.deepEqual(analyze({ pages: usersPage, sheets: sheets('body[DATA-PAGE="users"]'), scripts: [] }).findings, []);

  /* The TYPE selector is matched case-insensitively too, asserted in the dead
     direction: an uppercase BODY that went unrecognised would simply stop
     reaching <body>, and the rule would read alive either way. */
  assert.deepEqual(
    analyze({ pages, sheets: sheets('BODY[data-page="users"]'), scripts: [] }).findings.map((f) => f.kind),
    ['dead-body-scope']);

  /* Two values demanded of one attribute is a contradiction, not a union. */
  const contradiction = 'body[data-page="login"][data-page="users"]';
  assert.deepEqual(
    analyze({ pages, sheets: sheets(contradiction), scripts: [] }).findings.map((f) => f.kind),
    ['dead-body-scope']);

  /* A combinator with no space around it still ends the compound. Without
     that, `body>[data-page="users"]` reads as ONE compound and the attribute
     is credited to <body> — a wrong DEAD verdict on a rule that matches a
     child of <body>. */
  for (const combinator of ['>', '+', '~']) {
    assert.deepEqual(analyze({
      pages, sheets: sheets(`body${combinator}[data-page="users"]`), scripts: [],
    }).findings, [], `an unspaced ${combinator} was read as part of the body compound`);
  }

  /* A case-insensitivity flag leaves the value unresolved. The rule must stay
     ALIVE: recording a requirement for the value the parse did not produce is
     a deletion instruction against a rule that matches. Every shape here is
     live on the login page. */
  for (const flagged of [
    'body[data-page="login" i]',
    'body[data-page="login" I]',
    'body[data-page="login" s]',
    "body[data-page='login' i]",
    'body[data-page=login i]',
    'body[data-page="login"][data-page="login" i]',
    'body:is([data-page="login" i], [data-page="users"])',
  ]) {
    assert.deepEqual(analyze({ pages, sheets: sheets(flagged), scripts: [] }).findings, [],
      `a case-insensitivity flag was read as a value requirement: ${flagged}`);
  }

  /* The MARKUP side is case-folded too, asserted in the dead direction: an
     unfolded attribute name would simply go missing from the body map, and a
     rule asking for a value the page carries would be reported dead. */
  const shouty = [page('ops/users.html',
    '<!doctype html><html><head><link rel="stylesheet" href="assets/x.css"></head>'
    + '<BODY DATA-PAGE="users">x</BODY></html>')];
  assert.deepEqual(analyze({ pages: shouty, sheets: sheets('body[data-page="users"]'), scripts: [] }).findings, [],
    'the body attribute name was not case-folded on the markup side');

  /* Only a rule whose EVERY selector is dead is dead. */
  const oneAlive = 'body[data-page="users"] .a, body[data-page="login"] .b';
  assert.deepEqual(analyze({ pages, sheets: sheets(oneAlive), scripts: [] }).findings, []);
});

test('a script that could write the attribute turns the judgement into a refusal', () => {
  const pages = [page('ops/login.html', html('data-page="login"', '<link rel="stylesheet" href="assets/x.css">'))];
  const sheets = [sheet('ops/assets/x.css', 'body[data-page="users"] { color: red; }')];

  const reading = [{ name: 'r.js', source: "var p = document.body.getAttribute('data-page');" }];
  assert.deepEqual(analyze({ pages, sheets, scripts: reading }).findings.map((f) => f.kind),
    ['dead-body-scope']);

  /* hasAttribute is a read too. Asserted because narrowing READ_CALL to
     getAttribute alone would turn this into a refusal, which fails safe and so
     would never be noticed by an assertion in the refusal direction. */
  const testing = [{ name: 'r.js', source: "if (document.body.hasAttribute('data-page')) go();" }];
  assert.deepEqual(analyze({ pages, sheets, scripts: testing }).findings.map((f) => f.kind),
    ['dead-body-scope'], 'a hasAttribute read was mistaken for a write');

  const cases = [
    ["document.body.setAttribute('data-page', 'users');", 'a literal write'],
    ['document.body.setAttribute(key, value);', 'a computed name on body'],
    ['document.body.removeAttribute(key);', 'a computed removal on body'],
    ['document.body.toggleAttribute(key);', 'a computed toggle on body'],
    ['document.documentElement.setAttribute(key, value);', 'a computed name on <html>'],
    ['document.body.dataset.page = "users";', 'a dataset write'],
    ['var p = document.body.dataset.page;', 'any reach into document.body.dataset'],
    ['el.dataset.page = "users";', 'a dataset write on anything'],
    ['document.write("<body data-page=users>");', 'a document rewrite'],
    ['document.body.outerHTML = markup;', 'an outerHTML replacement'],
    ['document.documentElement.innerHTML = markup;', 'an innerHTML replacement of <html>'],
  ];
  for (const [source, why] of cases) {
    const out = analyze({ pages, sheets, scripts: [{ name: 'w.js', source }] });
    assert.deepEqual(out.findings.map((f) => f.kind), ['refused'], `${why} was not refused`);
  }

  /* The same source INLINE in the page. A refusal check that only reads
     ops/assets/*.js has a hole the width of a <script> tag. */
  const inline = [page('ops/login.html', `<!doctype html><html><head>`
    + `<link rel="stylesheet" href="assets/x.css">`
    + `<script>document.body.dataset.page = "users";</script>`
    + `</head><body data-page="login">x</body></html>`)];
  assert.deepEqual(analyze({ pages: inline, sheets, scripts: [] }).findings.map((f) => f.kind),
    ['refused'], 'an inline script was never scanned');

  /* A <script src> with an empty body contributes nothing. Asserted because
     the real pages are full of them and a scan that tripped over one would
     refuse everything. */
  const external = [page('ops/login.html', `<!doctype html><html><head>`
    + `<link rel="stylesheet" href="assets/x.css">`
    + `<script src="assets/w.js"></script>`
    + `</head><body data-page="login">x</body></html>`)];
  assert.deepEqual(analyze({ pages: external, sheets, scripts: [] }).findings.map((f) => f.kind),
    ['dead-body-scope']);
});

test('the CSS is parsed, not grepped', () => {
  const pages = [page('ops/login.html', html('data-page="login"', '<link rel="stylesheet" href="assets/x.css">'))];
  const only = (css) => analyze({ pages, sheets: [sheet('ops/assets/x.css', css)], scripts: [] })
    .findings.map((f) => f.kind);

  assert.deepEqual(only('/* body[data-page="users"] { color: red; } */ .a { color: red; }'), [],
    'a commented-out rule was read as a rule');
  assert.deepEqual(only('@media (min-width: 1px) { body[data-page="users"] { color: red; } }'),
    ['dead-body-scope'], 'a rule inside @media was not judged');
  assert.deepEqual(only('@keyframes anim { body[data-page="users"] { opacity: 0; } }'), [],
    'a keyframe selector was read as a selector');
  assert.deepEqual(only('.a { content: "/*"; color: red; }\nbody[data-page="users"] { color: red; }'),
    ['dead-body-scope'], 'a comment opener inside a string swallowed the sheet');
  assert.deepEqual(only('.a { background: url(x/*y.png); }\nbody[data-page="users"] { color: red; }'),
    ['dead-body-scope'], 'a comment opener inside an unquoted url() swallowed the sheet');
  assert.deepEqual(only('@import url(other.css);\nbody[data-page="users"] { color: red; }'),
    ['dead-body-scope'], 'a semicolon at-rule confused the rule scanner');
});

test('the reported line is the line the selector starts on', () => {
  const pages = [page('ops/login.html', html('data-page="login"', '<link rel="stylesheet" href="assets/x.css">'))];
  const css = '.a { color: red; }\n\n/* note\n   note */\nbody[data-page="users"]\n  .b { color: red; }\n';
  const out = analyze({ pages, sheets: [sheet('ops/assets/x.css', css)], scripts: [] });
  assert.deepEqual(out.findings.map((f) => f.where), ['ops/assets/x.css:5']);
});

test('the pieces the analysis is built from behave', () => {
  assert.equal(stripCssComments('a/*x*/b'), 'a     b');
  assert.equal(stripCssComments('a/*x\ny*/b'), 'a   \n   b', 'newlines must survive a comment');
  assert.equal(stripHtmlComments('a<!--x-->b'), 'a        b');

  assert.deepEqual(parseStyleRules('a, b { c: d; } @media x { e { f: g; } }')
    .map((r) => r.selector), ['a, b', 'e']);

  assert.deepEqual(linkedStylesheets(
    '<link rel="stylesheet" href="assets/a.css"><link rel="preload" href="assets/b.css">' +
    '<link rel="stylesheet" href="/top.css">', 'ops/x.html'),
  ['ops/assets/a.css', 'top.css']);

  assert.deepEqual(bodyAttributes('<body data-page="x" class="y">'), { 'data-page': 'x', class: 'y' });
  assert.equal(bodyAttributes('<!-- <body data-page="x"> -->'), null);

  assert.deepEqual(parseAttrSelector('[data-page="x"]'), { name: 'data-page', op: '=', value: 'x' });
  assert.deepEqual(parseAttrSelector('[data-page]'), { name: 'data-page', op: 'exists', value: null });
  assert.deepEqual(parseAttrSelector('[data-page~="x"]'), { name: 'data-page', op: '~=', value: null });
  assert.deepEqual(parseAttrSelector('[data-page="x" i]'),
    { name: 'data-page', op: 'unresolved', value: null },
    'a flagged value must not come back as an `=` the callers will act on');

  const reqs = (sel) => {
    const r = bodyAttributeRequirements(sel);
    return r === null ? null : [...r].map(([k, v]) => [k, [...v].sort()]);
  };
  assert.deepEqual(reqs('[data-theme="light"] body[data-page="x"] .c'), [['data-page', ['x']]]);
  assert.deepEqual(reqs('[data-theme="light"] .c'), [], 'no body compound means no requirement');
  assert.deepEqual(reqs('body[data-page="x"]:not([data-page="y"])'), [['data-page', ['x']]]);
  assert.deepEqual(reqs('body:is([data-page="x"], .c)'), null);
  assert.deepEqual(reqs('body:is(.c, .d)[data-page="x"]'), [['data-page', ['x']]]);
  assert.deepEqual(reqs('body:is([data-page="x"], [data-pane="y"])'), null,
    'two attributes in one :is() are not one requirement');
  assert.deepEqual(reqs('body[data-page="x"] body[data-page="y"]'), null,
    'two body compounds are not analysed');
  assert.deepEqual(reqs('body[data-page]'), [], 'a presence test carries no value');
});
