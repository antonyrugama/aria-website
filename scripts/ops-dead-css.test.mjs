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

   The same instinct now covers the markup itself. Everything here reads a
   page with patterns rather than with a parser, and review found input shapes
   where those patterns disagree with a browser in the dangerous direction.
   Rather than teach the patterns to parse them, the shapes are DETECTED and
   the run refuses: a page this cannot read stops the judgement for the whole
   run, both arms, because an unreadable page can hide a <link> as easily as a
   body attribute and a hidden <link> orphans a live stylesheet. The detectors
   are the refuses-to-read table in the block below; MARKUP_REFUSALS is where
   they live, and each one has a demonstration driven through analyze().

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
     - a `}` inside a string does not         the structure-free span skip
       close a block, and a `{` inside        deleted from parseStyleRules'
       one does not open the next             loop
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
     - and the script side, because          the literal scan's 'gi' flags
       setAttribute lowercases the name      back to 'g'
     - a hasAttribute read is a read          READ_CALL narrowed to
                                              getAttribute
     - documentElement.innerHTML is a         that entry deleted from
       document replacement, under the        DOCUMENT_REPLACERS / its `?.`
       optional-chain and bracket             and bracket alternatives
       spellings too                          removed
     - an inline script is scanned like a     inlineScripts returning []
       file
     - the body of a <script src> is read     the src skip reinstated in
       too                                   inlineScripts
     - a <script type> that says DATA is     'application/json' deleted from
       not read as code, and any other       DATA_SCRIPT_TYPE / the whole
       type still is                         isExecutedScript gate removed
     - a repeated attribute keeps the        the hasOwnProperty guard in
       FIRST spelling, as HTML does          parseTagAttributes removed
     - markup this cannot read stops the     any one detector's detect()
       judgement rather than being judged    returning false
     - a reflected IDL property write is     className deleted from
       a write                               REFLECTED_MEMBER
     - a member this check does not          the unrecognised-member push
       recognise refuses everything,         deleted / the own-property
       including an Object.prototype key     check on REFLECTED_MEMBER
                                             replaced by a bare index
     - an optional chain and a bracket       the `(?:\?\.)?` removed from
       index are member access too           MEMBER_ON_DOCUMENT, or the
                                             BRACKET_ON_DOCUMENT loop gated
                                             off (they are two constants)
     - a comment that opens and closes       the script-body clause in
       inside one <script> body is a         comment-swallows-markup's
       refusal, though it swallows no tag    detect() deleted

   NOT COVERED, on purpose

     - A selector that is dead for any reason other than a body-attribute
       scope. A rule for a component no page draws any more is invisible here,
       because deciding that needs the runtime class set and this does not have
       it. Narrowing the claim was preferred to guessing at it.
     - CSS nesting. A rule nested inside another rule's block is not judged.
       This repository has none; if it gains some, they are simply not seen.
     - An attribute selector with an operator other than `=`, a case-insensitive
       flag, or a bare [attr] presence test. These are read and then ignored,
       which can only under-report. That "ignored" is enforced in one place:
       parseAttrSelector reports an operator the callers do not act on, rather
       than an `=` with a value it could not resolve. Round 2 of review found
       the flag case reporting `=`, which made every caller record a
       requirement for a value no page can carry.
     - Whether a sheet a page DOES load is the right sheet for it, and whether
       a rule that is alive is also correct.
     - Anything outside ops/. Only ops/*.html and ops/assets/* are read.

   THE DIRECTION IT LEANS, AND WHERE IT LEANS THE WRONG WAY

   Within the analysis it performs, anything it cannot parse, resolve or
   intersect is treated as ALIVE, so it under-reports rather than deleting
   something that is still on screen; the exception is a script that could be
   writing the attribute, which becomes a loud REFUSAL, because there the safe
   answer is not "alive" but "stop".

   At the INPUT boundary it has been wrong the other way, and that is the
   direction that matters: a wrong DEAD here is not a false alarm, it is an
   instruction to delete live CSS, and this guard is what deleted 94 lines of
   ops.css and all of operate.css. Every round of review this file has had
   found the prose list of those shapes short or its count wrong, each time by
   reading past the bullet the round before had named. So the list is no
   longer prose.

   The block below is PARSED BACK OUT OF THIS FILE and deepEqual'd against the
   two tables in the code — MARKUP_REFUSALS and WRONG_DEAD_NOT_COVERED — by
   `the header's counts block is the code's tables, not a typed claim`. Every
   refuses-to-read entry has a demonstration driven through analyze() that
   must produce a refusal under that entry's own id. Every
   wrong-dead-not-covered entry has a demonstration that must still produce
   the WRONG answer — through analyze() where the shape lives inside the
   analysis, and through the listing helper that mis-reads it where it does
   not, which is true of exactly one entry and said so in its own wording. A
   line in the block that is neither a header, an entry nor a continuation is
   reported rather than dropped, so prose cannot be typed into it either. So
   neither count is typed, no entry's wording can drift from the code, a shape
   that gets fixed cannot stay on the list, and a detector cannot be added
   without being demonstrated.

   Round 1 of review on the change that added this block found four more
   wrong-DEAD shapes anyway, three of them in the code that change had just
   written. Round 2 found three more, all three in the two detectors round 1
   had rewritten: a comment wholly inside one <script> body swallowed a write
   while swallowing no tag, and five spellings of a reach onto document.body —
   `?.`, a bracketed string, a computed bracket, setAttributeNode and
   getAttributeNode().value — walked past a check that only knew `.name`.
   Three counts have moved in both directions as a result. Read the block
   below as the current state of an estimate that has never yet been final,
   not as a bound; the file's own history says the next reader finds one more.

   None of the refuses-to-read shapes and none of the wrong-dead-not-covered
   shapes exists in ops/ today.

   ```counts
   refuses-to-read: 4
   - comment-swallows-markup: A comment, as this guard delimits one, that
     swallows something this analysis reads: a <link, a <body, a <script, or
     the text inside a <script>. stripHtmlComments is a single lazy regex
     over the whole page, and every way of opening or closing a comment that
     it reads differently from a browser ends the same way: something the
     analysis depends on is blanked. A `<!--` written inside a script, a
     <style>, RCDATA or a quoted attribute value; a `<!-->`, which is a
     complete comment for a browser and unterminated for the regex; a
     `--!>`, which closes one for a browser and not for the regex; or a
     comment never closed at all. Rather than ask where the comment came
     from, this asks what the blanking ate, so it needs no opinion about the
     parser it is standing in for. The third clause is the case where the
     `<!--` opens inside the attribute value of the very tag it damages: the
     tag name is then before the span, so the first clause cannot see it,
     and the script body is raw, so the second cannot either. The second
     clause looks for an opener only: once the third clause exists, a `-->`
     in a script body can only close a span that one of the other two has
     already refused, so asking about it was a branch nothing could bind.
   - quoted-gt-in-tag: A `>` inside a quoted attribute value of <body>,
     <link> or <script>. Every tag reader here stops at the first `>`, so
     the rest of the tag is read as though it were page text: the body
     attribute map comes back wrong, and an href after the quote disappears,
     which orphans a sheet the page really loads.
   - repeated-body-tag: More than one `<body` in the page as written. A
     browser merges the attributes of a second <body> start tag onto the one
     body element it already has, and a `<body` that is only text — inside a
     <template>, a <noscript>, a bogus comment such as <![CDATA[, a quoted
     attribute value or a string literal — is not a start tag at all. This
     guard takes the first one and cannot tell those apart, so either
     reading makes every body-attribute rule on that page answerable from
     attributes the page may not carry.
   - script-end-tag: A `</script` that the end-tag pattern `</script\s*>`
     does not match, such as `</script/>`. The element never closes for this
     guard and its body is never scanned, while a browser closes the element
     there and runs it.
   wrong-dead-not-covered: 6
   - aliased-body-write: A write that does not go through a member access on
     a textual document.body or document.documentElement is invisible unless
     it also names the attribute in quotes: an alias, a closest("body"), or
     the element itself handed to a function — fn(document.body) or
     Object.assign(document.body, ...). Catching the argument position by
     text would refuse every attribute on every page in this repository,
     because eleven sites across six scripts name one of the two outside a
     member access: three pass it as a function argument, one of those to
     MutationObserver.observe; six are identity or existence tests; and two
     are prose inside comments. So this is disclosed rather than refused:
     refusing it switches the whole arm off.
   - character-reference: An HTML character reference in an attribute value
     is read as the characters it is written with, so `data-page="a&amp;b"`
     is compared against the selector as seven characters rather than the
     three the browser resolves it to. The same holds for an href: a
     character reference, a backslash, and any other spelling the URL parser
     normalises and this resolver does not, resolve to a path that is not
     the one the browser fetches. The href direction is always accompanied
     by a dangling-link naming the mis-resolved path, so the guard discloses
     that failure in the same run; the attribute direction is silent.
   - css-escape: A CSS escape in a selector value is compared as the
     characters it is written with, so `[data-page="lo\67 in"]`, which
     matches login, is not read as login.
   - import-only-sheet: The orphan arm reads <link> tags only, so a sheet
     reachable only through an @import inside a linked sheet reads as
     orphaned.
   - script-injected-link: The orphan arm reads <link> tags only, so a
     stylesheet a script builds and appends at runtime reads as orphaned.
   - subdirectory-page: The page and sheet listings are one level deep, so
     ops/panes/foo.html would not be read and a sheet only it linked would
     be reported orphaned. This is the one entry whose shape lives in how
     the repository run is BUILT rather than inside analyze(), so its
     demonstration has two halves: the listing really is one level deep, and
     a sheet whose only loader is missing from the page set really does come
     back orphaned.
   ```

   Read that block as the least trustworthy part of this file rather than the
   most: it is what three rounds of review have found something in, and the
   only reason to trust it further than the prose that preceded it is that it
   is now checked. */

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
/* The end index of the string or unquoted url() body that starts at `i`, or
   -1 if nothing structure-free starts there. A backslash escapes the next
   character and an unterminated string ends at the newline, as CSS says.
   stripCssComments preserves these spans and parseStyleRules must not read
   structure inside them, so both ask this one function where such a span ends
   and the two cannot drift apart about it. */
export function structureFreeSpanEnd(src, i) {
  const ch = src[i];
  if (ch === '"' || ch === "'") {
    let k = i + 1;
    while (k < src.length) {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === ch) return k + 1;
      if (src[k] === '\n') return k;
      k++;
    }
    return src.length;
  }
  if ((ch === 'u' || ch === 'U') && /^url\(/i.test(src.slice(i, i + 4))) {
    const end = src.indexOf(')', i);
    return end === -1 ? src.length : end + 1;
  }
  return -1;
}

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
    if (ch === '"' || ch === "'" || (ch === 'u' || ch === 'U')) {
      const spanEnd = structureFreeSpanEnd(src, i);
      if (spanEnd !== -1) { out += src.slice(i, spanEnd); i = spanEnd; continue; }
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

    /* A string or an unquoted url() body carries no structure. Without this,
       a `}` inside `content: "}"` closes the block and whatever follows it
       inside the string is accumulated as the next rule's prelude — a
       selector the browser has never seen, reported dead at a line whose
       real rule is live. splitOutside and parseAttrSelector already track
       quotes; this was the corner that did not. */
    if (ch === '"' || ch === "'" || ch === 'u' || ch === 'U') {
      const spanEnd = structureFreeSpanEnd(src, i);
      if (spanEnd !== -1) {
        const span = src.slice(i, spanEnd);
        if (ctx === 'rules') {
          if (!prelude.trim()) preludeLine = line;
          prelude += span;
        }
        line += (span.match(/\n/g) || []).length;
        i = spanEnd - 1;
        continue;
      }
    }

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
    const name = m[1].toLowerCase();
    /* HTML keeps the FIRST spelling of a repeated attribute and drops the
       rest. Keeping the last read <body data-page="login" data-page="users">
       as users, which is a deletion instruction against every rule the page
       really matches. */
    if (!Object.prototype.hasOwnProperty.call(attrs, name)) {
      attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
    }
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
   inline. Every executed script's body is read, including the body of a
   <script src>, which a browser ignores: reading it can only add refusals,
   and a refusal is the loud direction.

   A <script> whose type says it carries DATA is NOT read, because a browser
   does not execute it either. attributeWriteRisks only asks whether the
   attribute name appears in quotes, so a JSON island whose keys happen to be
   attribute names would otherwise be reported as a script that could write
   <body> — a permanently red assertion over a data block.

   The test is a DENYLIST of data types, not an allowlist of JavaScript ones.
   Round 1 of review found the allowlist spelling of this gate skipping eight
   of the sixteen JavaScript MIME types the HTML spec lists — text/jscript,
   text/livescript and text/javascript1.0 … 1.5 — which Chromium runs. Not
   reading them made a script that writes the attribute invisible and turned a
   refusal into a DEAD: this gate had introduced a wrong DEAD of its own. An
   unrecognised type is therefore READ, which can only add refusals, and a
   refusal is the loud direction. An allowlist would have to be kept in sync
   with WHATWG forever; this one is wrong only about types nobody executes. */
const DATA_SCRIPT_TYPE = new Set([
  'application/json',
  'application/ld+json',
  'importmap',
  'speculationrules',
  'text/template',
]);

function isExecutedScript(tagBody) {
  const type = (parseTagAttributes(tagBody).type || '').toLowerCase().split(';')[0].trim();
  return !DATA_SCRIPT_TYPE.has(type);
}

export function inlineScripts(html, pagePath) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  const clean = stripHtmlComments(html);
  while ((m = re.exec(clean)) !== null) {
    if (!isExecutedScript(m[1])) continue;
    if (m[2].trim()) out.push({ name: `${pagePath} (inline script)`, source: m[2] });
  }
  return out;
}

/* ============ markup this guard cannot read, and will not judge =========

   Everything above reads a page with patterns rather than with a parser, and
   review of the commit that added this file found input shapes that make
   those patterns disagree with a browser in the DANGEROUS direction: the
   guard reports DEAD on CSS the page really uses, which here is an
   instruction to delete it. Each shape below was run through analyze() and
   checked against real Chromium served over HTTP, not reasoned about.

   The disposition is the instinct the refusal check already has. A guard that
   says "I cannot tell" is safe; a guard that says DEAD deletes your CSS. So
   none of these teaches the reader to parse the shape correctly. They REFUSE:
   the run fails by name, and the whole judgement stops for that run — both
   arms, every sheet — because a page whose markup cannot be read can hide a
   <link> as easily as a body attribute, and a hidden <link> orphans a live
   stylesheet.

   Every detector reads the page exactly as WRITTEN, before comment stripping,
   because unreliable comment stripping is one of the shapes being detected. */

/* True when a quoted attribute value is still open at the end of a tag body,
   which is how a `>` inside one gets mistaken for the end of the tag. */
export function endsInsideQuote(text) {
  let quote = null;
  for (const ch of text) {
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
  }
  return quote !== null;
}

/* The spans stripHtmlComments blanks, delimited the way it delimits them, with
   an unterminated `<!--` running to the end of the page as its regex does not.
   Reading the spans rather than the openers is what lets one detector cover
   every way this guard's idea of a comment can differ from a browser's. */
export function commentSpans(html) {
  const spans = [];
  const re = /<!--/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const close = html.indexOf('-->', m.index + 4);
    const stop = close === -1 ? html.length : close + 3;
    spans.push(html.slice(m.index, stop));
    re.lastIndex = stop;
  }
  return spans;
}

/* The bodies of <script> elements as WRITTEN, before any blanking. The
   analysis reads script text as well as tags, so a comment span that begins
   and ends inside one script body erases a write while swallowing none of
   the three tag names — round 2 of review demonstrated three ordinary shapes
   that way, including `<script>` `<!--` … `// -->` `</script>`, which is the
   canonical legacy idiom and the reason `<!--` is a JavaScript line comment. */
export function scriptBodiesAsWritten(html) {
  const out = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

export const MARKUP_REFUSALS = [
  {
    id: 'comment-swallows-markup',
    why: 'A comment, as this guard delimits one, that swallows something this analysis '
      + 'reads: a <link, a <body, a <script, or the text inside a <script>. '
      + 'stripHtmlComments is a single lazy regex over the whole page, and every way of '
      + 'opening or closing a comment that it reads differently from a browser ends the '
      + 'same way: something the analysis depends on is blanked. A `<!--` written inside '
      + 'a script, a <style>, RCDATA or a quoted attribute value; a `<!-->`, which is a '
      + 'complete comment for a browser and unterminated for the regex; a `--!>`, which '
      + 'closes one for a browser and not for the regex; or a comment never closed at '
      + 'all. Rather than ask where the comment came from, this asks what the blanking '
      + 'ate, so it needs no opinion about the parser it is standing in for. The third '
      + 'clause is the case where the `<!--` opens inside the attribute value of the very '
      + 'tag it damages: the tag name is then before the span, so the first clause cannot '
      + 'see it, and the script body is raw, so the second cannot either. The second '
      + 'clause looks for an opener only: once the third clause exists, a `-->` in a '
      + 'script body can only close a span that one of the other two has already '
      + 'refused, so asking about it was a branch nothing could bind.',
    detect: (html) => commentSpans(html).some((s) => /<(?:link|body|script)\b/i.test(s))
      || scriptBodiesAsWritten(html).some((b) => /<!--/.test(b))
      || /<(?:link|body|script)\b[^>]*<!--/i.test(html),
  },
  {
    id: 'quoted-gt-in-tag',
    why: 'A `>` inside a quoted attribute value of <body>, <link> or <script>. Every tag '
      + 'reader here stops at the first `>`, so the rest of the tag is read as though it '
      + 'were page text: the body attribute map comes back wrong, and an href after the '
      + 'quote disappears, which orphans a sheet the page really loads.',
    detect(html) {
      const re = /<(?:body|link|script)\b([^>]*)>/gi;
      let m;
      while ((m = re.exec(html)) !== null) if (endsInsideQuote(m[1])) return true;
      return false;
    },
  },
  {
    id: 'repeated-body-tag',
    why: 'More than one `<body` in the page as written. A browser merges the attributes '
      + 'of a second <body> start tag onto the one body element it already has, and a '
      + '`<body` that is only text — inside a <template>, a <noscript>, a bogus comment '
      + 'such as <![CDATA[, a quoted attribute value or a string literal — is not a '
      + 'start tag at all. This guard takes the first one and cannot tell those apart, '
      + 'so either reading makes every body-attribute rule on that page answerable from '
      + 'attributes the page may not carry.',
    detect: (html) => (html.match(/<body\b/gi) || []).length > 1,
  },
  {
    id: 'script-end-tag',
    why: 'A `</script` that the end-tag pattern `</script\\s*>` does not match, such as '
      + '`</script/>`. The element never closes for this guard and its body is never '
      + 'scanned, while a browser closes the element there and runs it.',
    detect(html) {
      const re = /<\/script/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        if (!/^\s*>/.test(html.slice(m.index + m[0].length))) return true;
      }
      return false;
    },
  },
];

export function markupRefusals(html) {
  return MARKUP_REFUSALS.filter((r) => r.detect(html));
}

/* ================= can a script write this attribute? =================== */

const DOCUMENT_REPLACERS = [
  /\bdocument\s*\??\s*\.\s*write(?:ln)?\s*(?:\?\.)?\s*\(/,
  /(?:\.\s*outerHTML|\[\s*(['"`])outerHTML\1\s*\])\s*=[^=]/,
  /\bdocument\s*\??\s*\.\s*documentElement\s*(?:\??\s*\.\s*innerHTML|\s*\[\s*(['"`])innerHTML\1\s*\])\s*=[^=]/,
];

/* The first argument to a set/remove/toggleAttribute call on the document's
   own two elements, as written, up to the first `)`. Anything else —
   node.setAttribute(key, v) on a freshly built child — is not a way to reach
   <body> and is not matched.

   The name is COMPUTED, and so a risk for every attribute, unless that
   argument is ONE CLOSED STRING LITERAL, which is the case the literal scan
   in attributeWriteRisks owns and reports precisely. Round 3 of review found
   the old spelling of this — a trailing [^'"`\s)] that declined any leading
   quote — handing `setAttribute("data-" + "page", v)` and
   `setAttribute(\`data-${k}\`, v)` to a literal scan that never fires on
   either, so setAttribute took the ATTRIBUTE_API_ON_DOCUMENT skip and was
   handled by nobody. A quote that opens a concatenation and a backtick that
   opens a substitution are not literals; they are computed. */
const ATTRIBUTE_CALL_ON_DOCUMENT =
  /\bdocument\s*\??\s*\.\s*(?:body|documentElement)\s*\??\s*\.\s*(?:set|remove|toggle)Attribute\s*\(([^)]*)/g;
const WHOLE_STRING_LITERAL =
  /^\s*(?:(['"])[^'"\\]*\1|`[^`$\\]*`)\s*(?:[,)]|$)/;

function writesAttributeUnderAComputedName(source) {
  ATTRIBUTE_CALL_ON_DOCUMENT.lastIndex = 0;
  let m;
  while ((m = ATTRIBUTE_CALL_ON_DOCUMENT.exec(source)) !== null) {
    if (!WHOLE_STRING_LITERAL.test(m[1])) return true;
  }
  return false;
}

const DATASET_ON_DOCUMENT =
  /\bdocument\s*\??\s*\.\s*(?:body|documentElement)\s*\??\s*\.\s*dataset\b/;

const READ_CALL = /(?:get|has)Attribute\s*\(\s*$/;

/* A write to <body> does not have to name the attribute, and does not have to
   go through setAttribute: document.body.className, .classList.add, .id, .dir
   and .lang all write one through a reflected IDL property, and round 1 of
   review found every one of them read as DEAD while Chromium applied them.
   Two are in this repository today (shell.js and shell-pane-v2.js both do
   document.body.className = ...), so only the selector spelling was missing.

   The default is therefore loud: any member reached on document.body or
   document.documentElement is a risk unless it is on one of the two lists
   below. REFLECTED keeps the precision that matters — a className write is a
   reason to refuse `class`, not a reason to refuse `data-page` — and an
   unrecognised member, including the whole ARIA reflection family and
   whatever the platform adds next, refuses EVERY attribute rather than being
   quietly trusted. That is the inversion the MIME gate above needed too. */
const READ_ONLY_ON_DOCUMENT = new Set([
  'getAttribute', 'hasAttribute', 'getAttributeNames',
  'querySelector', 'querySelectorAll', 'closest', 'matches', 'contains', 'compareDocumentPosition',
  'appendChild', 'removeChild', 'insertBefore', 'replaceChild', 'replaceChildren',
  'append', 'prepend', 'innerHTML', 'innerText', 'textContent',
  'children', 'childNodes', 'firstChild', 'lastChild', 'firstElementChild', 'lastElementChild',
  'parentNode', 'parentElement', 'ownerDocument', 'nodeName', 'tagName', 'localName',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'focus', 'blur', 'click', 'scrollIntoView', 'scrollTo', 'scrollBy',
  'getBoundingClientRect', 'getClientRects', 'animate',
  'clientWidth', 'clientHeight', 'clientTop', 'clientLeft',
  'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent',
  'scrollTop', 'scrollLeft', 'scrollWidth', 'scrollHeight',
]);

/* Handled precisely elsewhere in this function, AND ONLY IN THE DOT SPELLING:
   a quoted name through the literal scan, a computed one through
   ATTRIBUTE_CALL_ON_DOCUMENT, dataset through DATASET_ON_DOCUMENT. All three
   of those readers require a `.`, so the skip below is restricted to the dot
   path; a bracketed `document.body["setAttribute"]` or `["dataset"]` is a
   RISK, because no reader here covers it. Re-reporting the dot spelling here
   would refuse every attribute on every page that loads theme.js, which would
   switch the whole arm off; refusing the bracket spelling costs nothing,
   because no script under ops/assets contains `document.body[` at all.
   Membership is earned by being handled, not by looking like a read:
   setAttributeNode was on this list in round 2 under a comment claiming the
   computed-name regex covered it, which was false — that regex matches
   `setAttribute(`, `removeAttribute(` and `toggleAttribute(` only — and
   getAttributeNode was on the read-only list above although it returns a live
   Attr whose .value is a setter. Both are off both lists, so both are loud.
   Round 3 of review then found the same defect one spelling over, which is
   why the skip now depends on how the member was reached. */
const ATTRIBUTE_API_ON_DOCUMENT = new Set([
  'setAttribute', 'removeAttribute', 'toggleAttribute', 'dataset',
]);

const REFLECTED_MEMBER = {
  className: 'class', classList: 'class', id: 'id', dir: 'dir', lang: 'lang',
  title: 'title', slot: 'slot', hidden: 'hidden', translate: 'translate',
  tabIndex: 'tabindex', accessKey: 'accesskey', spellcheck: 'spellcheck',
  draggable: 'draggable', contentEditable: 'contenteditable', inputMode: 'inputmode',
  autocapitalize: 'autocapitalize', enterKeyHint: 'enterkeyhint', nonce: 'nonce',
  style: 'style', popover: 'popover',
};

/* Two spellings of the same reach. The second exists because `?.` and a
   bracket index are member access too, and round 2 of review demonstrated
   four wrong DEADs that walked straight past a regex that only knew `.name`:
   document.body?.classList.replace(...), document.body?.setAttribute(N, v),
   document.body["className"] = ... and a computed document.body[K] = ....
   A bracket whose key is not a plain quoted string is not resolvable here, so
   it is a risk for EVERY attribute rather than for a guessed one.

   Optional chaining is spelled `?.` before a dot AND before a bracket, so the
   bracket form needs `?\.` rather than `\??` in front of the `[`. Round 3 of
   review found that written as `\s*\??\s*\[`, which cannot match `?.[` at all
   — the `.` has nowhere to go — and instead matched a TERNARY, refusing
   `document.body?[1]:[2]` while passing `document.body?.["setAttribute"]`. */
const MEMBER_ON_DOCUMENT =
  /\bdocument\s*\??\s*\.\s*(body|documentElement)\s*\??\s*\.\s*([A-Za-z_$][\w$]*)/g;
const BRACKET_ON_DOCUMENT =
  /\bdocument\s*\??\s*\.\s*(body|documentElement)\s*(?:\?\.)?\s*\[\s*(?:(['"`])([A-Za-z_$][\w$]*)\2\s*\])?/g;

function camel(attrName) {
  return attrName.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/* null when reaching `member` on document.body cannot write `attrName`;
   otherwise the clause that says why it might. `undefined` means the member
   name is not resolvable from the source — a computed bracket key — which is
   a risk for every attribute rather than for a guessed one. `spelling` is
   'dot' or 'bracket': BOTH skip lists are honoured only on the dot path,
   because every reader that earns a place on either of them requires a
   literal dot — including DOCUMENT_REPLACERS, which is what makes
   documentElement.innerHTML safe to call read-only here.
   REFLECTED_MEMBER is read with an own-property check because a bare index
   resolves constructor, toString, valueOf, hasOwnProperty and __proto__ off
   Object.prototype, and each of those truthy hits took the skip. */
function memberReachRisk(member, attrName, spelling) {
  if (member === undefined) return 'reaches a member this check cannot resolve';
  if (spelling === 'dot' && READ_ONLY_ON_DOCUMENT.has(member)) return null;
  if (spelling === 'dot' && ATTRIBUTE_API_ON_DOCUMENT.has(member)) return null;
  if (ATTRIBUTE_API_ON_DOCUMENT.has(member) || READ_ONLY_ON_DOCUMENT.has(member)) {
    return 'is reached under a spelling no other check here reads';
  }
  const reflects = Object.prototype.hasOwnProperty.call(REFLECTED_MEMBER, member)
    ? REFLECTED_MEMBER[member]
    : undefined;
  if (reflects && reflects !== attrName) return null;
  return reflects
    ? `writes the ${reflects} attribute`
    : 'this check cannot show is not an attribute write';
}

/* Every reason this run must refuse to judge `attrName` rather than call a
   selector using it dead. An empty list means no script in `scripts` can be
   shown to write it, within the limits in NOT COVERED above. */
export function attributeWriteRisks(attrName, scripts) {
  const risks = [];
  const prop = camel(attrName);
  /* Case-insensitive because setAttribute lowercases the qualified name for
     an HTML element in an HTML document, so setAttribute('DATA-PAGE', v)
     writes data-page. The selector side (parseAttrSelector) and the markup
     side (parseTagAttributes) already fold; this was the third corner. */
  const literal = new RegExp(`(['"\`])${attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'gi');
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
    MEMBER_ON_DOCUMENT.lastIndex = 0;
    while ((m = MEMBER_ON_DOCUMENT.exec(source)) !== null) {
      const why = memberReachRisk(m[2], attrName, 'dot');
      if (why === null) continue;
      const line = source.slice(0, m.index).split('\n').length;
      risks.push(`${name}:${line} reaches document.${m[1]}.${m[2]}, which ${why}`);
    }
    BRACKET_ON_DOCUMENT.lastIndex = 0;
    while ((m = BRACKET_ON_DOCUMENT.exec(source)) !== null) {
      const why = memberReachRisk(m[3], attrName, 'bracket');
      if (why === null) continue;
      const line = source.slice(0, m.index).split('\n').length;
      const key = m[3] === undefined ? '\u2026' : m[3];
      risks.push(`${name}:${line} indexes document.${m[1]}[${key}], which ${why}`);
    }
    if (writesAttributeUnderAComputedName(source)) {
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

  /* A page whose markup this guard cannot read stops the whole judgement.
     Not just that page's: an unreadable page can hide a <link>, and a hidden
     <link> is what turns a live stylesheet into an orphan. Both arms below
     therefore still COUNT what they see, so the printed summary stays honest,
     and report nothing. */
  for (const p of input.pages) {
    for (const risk of markupRefusals(p.source)) {
      findings.push({
        kind: 'unreadable-markup',
        where: p.name,
        detail: `${risk.id}: ${risk.why}`,
      });
    }
  }
  const judging = findings.length === 0;

  for (const p of pages) {
    for (const href of p.sheets) {
      if (judging && !onDisk.has(href)) {
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
      if (judging) {
        findings.push({
          kind: 'orphan-sheet',
          where: sheet.name,
          detail: `no page under ops/ has a <link rel="stylesheet"> for ${sheet.name}`,
        });
      }
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
        if (judging) {
          findings.push({
            kind: 'refused',
            where: `${sheet.name}:${rule.line}`,
            detail: `cannot judge this rule: ${refused.refused.join('; ')}`,
          });
        }
        continue;
      }
      if (judging && verdicts.every((v) => v.dead)) {
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

test('every page under ops/ is markup this guard can read', () => {
  /* Not a style rule: a single unreadable page switches BOTH arms above off
     for the whole run, so without this the guard would pass by judging
     nothing at all — the quietest false green available to it. */
  const unreadable = result.findings.filter((f) => f.kind === 'unreadable-markup');
  assert.deepEqual(unreadable.map((f) => f.where), [],
    'this guard judged nothing, because these pages are shapes it refuses to read:\n' +
    unreadable.map((f) => `  ${f.where}: ${f.detail}`).join('\n'));
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
     refuse everything. This one passes in BOTH directions on its own — it is
     here to pin the quiet direction, and the assertion that can fail is the
     one below it. */
  const external = [page('ops/login.html', `<!doctype html><html><head>`
    + `<link rel="stylesheet" href="assets/x.css">`
    + `<script src="assets/w.js"></script>`
    + `</head><body data-page="login">x</body></html>`)];
  assert.deepEqual(analyze({ pages: external, sheets, scripts: [] }).findings.map((f) => f.kind),
    ['dead-body-scope']);

  /* The BODY of a <script src> is read too. A browser ignores it, so reading
     it can only add refusals, and a refusal is the loud direction. Asserted in
     the refusal direction because that is the direction a src skip would
     change: reinstating `if (/\bsrc\s*=/i.test(...)) continue` in
     inlineScripts makes this rule read dead again. */
  const srcWithBody = [page('ops/login.html', `<!doctype html><html><head>`
    + `<link rel="stylesheet" href="assets/x.css">`
    + `<script src="assets/w.js">document.body.dataset.page = "users";</script>`
    + `</head><body data-page="login">x</body></html>`)];
  assert.deepEqual(analyze({ pages: srcWithBody, sheets, scripts: [] }).findings.map((f) => f.kind),
    ['refused'], 'the body of a <script src> was skipped rather than read');
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
  assert.deepEqual(bodyAttributes('<body data-page="login" data-page="users">'),
    { 'data-page': 'login' },
    'HTML keeps the first spelling of a repeated attribute; keeping the last reads this '
    + 'page as users and calls every rule it really matches dead');

  assert.equal(endsInsideQuote(' rel="stylesheet" href="a.css"'), false);
  assert.equal(endsInsideQuote(' data-x="a'), true, 'a quoted value left open by a `>`');
  assert.equal(endsInsideQuote(' title="it\'s fine"'), false,
    'an apostrophe inside a double-quoted value does not open a quote');

  /* inlineScripts, on its own values rather than through a fixture whose
     verdict is the same either way. Each of the three assertions below is red
     under a different one of the three payloads published on
     antonyrugama/aria-website#74 that the <script src> fixture survived. */
  assert.deepEqual(inlineScripts('<script src="a.js"></script>', 'ops/a.html'), [],
    'an empty script body is not script source');
  assert.deepEqual(inlineScripts('<script src="a.js">go();</script>', 'ops/a.html'),
    [{ name: 'ops/a.html (inline script)', source: 'go();' }],
    'the body of a <script src> is read, and what is read is the body, not the tag');
  assert.deepEqual(
    inlineScripts('<script type="application/json">{"data-page":"x"}</script>', 'ops/a.html'), [],
    'a JSON data block is data, not code');
  assert.deepEqual(
    inlineScripts('<script type="text/jscript">go();</script>', 'ops/a.html'),
    [{ name: 'ops/a.html (inline script)', source: 'go();' }],
    'text/jscript is one of the eight JavaScript MIME types an allowlist spelling of the '
    + 'type gate missed; a browser runs it, so not reading it turns a refusal into a DEAD');
  assert.deepEqual(
    inlineScripts('<script type="text/javascript1.5">go();</script>', 'ops/a.html'),
    [{ name: 'ops/a.html (inline script)', source: 'go();' }],
    'an unrecognised type must be READ, which can only add refusals');

  assert.deepEqual(commentSpans('a<!--b-->c<!--d-->e'), ['<!--b-->', '<!--d-->']);
  assert.deepEqual(commentSpans('a<!--b'), ['<!--b'],
    'a comment this guard never closes runs to the end of the page, as its regex does');
  assert.deepEqual(commentSpans('<!--><link rel="stylesheet" href="a.css"><!-- x -->'),
    ['<!--><link rel="stylesheet" href="a.css"><!-- x -->'],
    '<!--> is a complete comment for a browser and unterminated here, so the span this '
    + 'guard blanks swallows the <link> between it and the next `-->`');

  assert.deepEqual(attributeWriteRisks('class',
    [{ name: 'ops/assets/s.js', source: "document.body.className = 'is-' + n;" }]),
  ['ops/assets/s.js:1 reaches document.body.className, which writes the class attribute'],
  'a reflected IDL property writes an attribute without ever naming it');
  assert.deepEqual(attributeWriteRisks('data-page',
    [{ name: 'ops/assets/s.js', source: "document.body.className = 'is-' + n;" }]), [],
  'and it is a reason to refuse the attribute it reflects, not every attribute');
  assert.deepEqual(attributeWriteRisks('data-page',
    [{ name: 'ops/assets/s.js', source: 'document.body.ariaLabel = v;' }]),
  ['ops/assets/s.js:1 reaches document.body.ariaLabel, which this check cannot show is '
    + 'not an attribute write'],
  'a member this check does not recognise refuses every attribute, rather than being trusted');
  assert.deepEqual(attributeWriteRisks('data-page',
    [{ name: 'ops/assets/s.js', source: "var p = document.body.getAttribute('data-pane');" }]), [],
  'a read is not a write, or theme.js would switch the whole arm off');

  /* Five spellings that reached <body> straight past this check in round 2,
     each one verified in Chromium to write the attribute the guard was about
     to call dead, plus the prototype-key skip that let the sixth through. */
  const reach = (src, attr = 'data-page') => attributeWriteRisks(attr,
    [{ name: 's.js', source: src }]).length;
  assert.equal(reach("document.body?.classList.replace('a', 'b');", 'class'), 1,
    'an optional chain is a member access, and classList writes class');
  assert.equal(reach('document.body?.setAttribute(K, v);'), 1,
    'an optional chain in front of a computed setAttribute still sets the attribute');
  assert.equal(reach('document.body["className"] = v;', 'class'), 1,
    'a bracketed string is a member access by another spelling');
  assert.equal(reach('document.body[K] = v;'), 1,
    'a bracket key this check cannot resolve is a risk for every attribute');
  assert.equal(reach('document.body.setAttributeNode(a);'), 1,
    'setAttributeNode is not covered by the computed-name reader, which reads setAttribute(');
  assert.equal(reach('document.body.getAttributeNode(K).value = v;'), 1,
    'getAttributeNode returns a live Attr whose .value is a setter, so it is not a read');
  assert.equal(reach('document.body.constructor;'), 1,
    'an Object.prototype key is not a known reflected member');
  assert.equal(reach('var v = document.body?.dataset;'), 1,
    'an optional chain in front of a bare dataset read still stops the judgement');

  /* Round 3 of review found four more, three of them in round 3's own code.
     An optional chain before a BRACKET is `?.[`, not `? [`, so the bracket
     scan needed `?\.` rather than `\??`; the attribute-API skip was being
     honoured for a bracket spelling none of its three readers can see; and a
     computed name whose first token is a quote or a backtick was in nobody's
     jurisdiction, because the literal scan only fires on a whole token. */
  assert.equal(reach('document.body?.["classList"].add("users");', 'class'), 1,
    'an optional chain before a bracket is ?.[ , which \\?? cannot match');
  assert.equal(reach('var v = document.body?[1]:[2];'), 0,
    'and a ternary is a read, not a member access, so it must not be refused');
  assert.equal(reach('document.body["setAttribute"]("data-" + "page", "users");'), 1,
    'the attribute-API skip is only earned on the dot path its readers require');
  assert.equal(reach('document.body["dataset"].page = "users";'), 1,
    'and the same is true of dataset');
  assert.equal(reach('document.body.setAttribute("data-" + "page", v);'), 1,
    'a quote that opens a concatenation is not a whole literal, so the name is computed');
  assert.equal(reach('document.body.setAttribute(`data-${k}`, v);'), 1,
    'nor is a backtick that opens a substitution');
  assert.equal(reach('document.body.setAttribute("data-".concat("page"), v);'), 1,
    'nor is a literal that is only the receiver of a call');
  assert.equal(reach('document.body.setAttribute("data-pane", "x");'), 0,
    'but a whole literal naming ANOTHER attribute stays precise, or theme.js '
    + 'switches the whole arm off');
  assert.equal(reach('document?.body.className = "users";', 'class'), 1,
    'document itself can be optional-chained too');
  assert.equal(reach('document?.body.setAttribute(K, v);'), 1, 'in the computed-name reader');
  assert.equal(reach('var v = document?.body.dataset;'), 1, 'and in the dataset reader');
  assert.deepEqual(scriptBodiesAsWritten('<script>a<!--b</script >'), ['a<!--b'],
    'an end tag with space before the > closes the element for a browser, so it must here');
  assert.equal(reach('document.body.appendChild(n);'), 0,
    'and the read-only list still keeps the arm alive');

  /* setAttribute lowercases the qualified name, so the script side has to fold
     like the selector and markup sides already do — with the `\1` anchor
     keeping it from spreading to a name it does not own. */
  assert.equal(reach("document.body.setAttribute('DATA-PAGE', 'users');"), 1,
    'setAttribute lowercases the name, so an upper-case literal writes data-page');
  assert.equal(reach("document.body.setAttribute('DATA-PANE', 'x');"), 0,
    'but folding must not make one attribute name match another');
  assert.equal(reach('document.body.setAttribute(`data-theme`, v);'), 0,
    'a whole BACKTICK literal naming another attribute is not a computed name either, '
    + 'or one backtick-spelled call anywhere refuses every attribute in the repository');

  /* The document-replacement family. Every spelling below is one V8 parses:
     document?.documentElement.innerHTML = v and dE?.["innerHTML"] = v are
     SyntaxErrors, an optional chain cannot be an assignment target. */
  assert.equal(reach("document?.write('<body data-page=users>');"), 1,
    'document itself can be optional-chained in front of write too');
  assert.equal(reach("document.write?.('<body data-page=users>');"), 1,
    'and the call can be optional too');
  assert.equal(reach('document.documentElement["innerHTML"] = H;'), 2,
    'a bracketed innerHTML on documentElement replaces the document, and the read-only '
    + 'skip that makes innerHTML safe is a DOT reader, so the bracket must not take it — '
    + 'two risks, one from each of the checks that has to see it');
  assert.equal(reach('document.body["innerHTML"] = H;'), 1,
    'the read-only skip is earned on the dot path only, like the attribute-API one');
  assert.equal(reach('document.body.innerHTML = H;'), 0,
    'while the dot spelling still takes it, or the arm switches off repo-wide');
  assert.equal(reach('el["outerHTML"] = H;'), 1,
    'outerHTML under a bracket replaces the element it is written on');

  /* A string carries no structure. Without that, the `}` below closes the
     block and the browser-invisible selector inside the string is judged. */
  assert.deepEqual(
    parseStyleRules('.a { content: "} body[data-page=\'users\'] {"; color: red; }')
      .map((r) => r.selector),
    ['.a'], 'a `}` inside a string does not close the block');
  assert.deepEqual(
    parseStyleRules('.a { content: "{"; } body[data-page="users"] { color: red; }')
      .map((r) => r.selector),
    ['.a', 'body[data-page="users"]'],
    'and a `{` inside one does not swallow the rest of the sheet');
  assert.deepEqual(
    parseStyleRules('.a { background: url(a}b); } body[data-page="users"] { color: red; }')
      .map((r) => r.selector),
    ['.a', 'body[data-page="users"]'],
    'an unquoted url() body carries no structure either');
  assert.deepEqual(
    parseStyleRules('.a { background: url(a\nb); }\nbody[data-page="users"] { color: red; }')
      .map((r) => `${r.line}:${r.selector}`),
    ['1:.a', '3:body[data-page="users"]'],
    'and the newlines inside a skipped span still count, or every line number after '
    + 'a multi-line string names the wrong rule');
  assert.equal(structureFreeSpanEnd('"a\\"b" x', 0), 6,
    'a backslash escapes the closing quote');
  assert.equal(structureFreeSpanEnd('"a\nb"', 0), 2,
    'and an unterminated string ends at the newline, as CSS says');
  assert.equal(structureFreeSpanEnd('body[x]', 0), -1, 'nothing else is a span');

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

/* ================= what this guard gets wrong, demonstrated =============

   The NOT COVERED list at the head of this file is a coverage claim, and a
   coverage claim written in prose rots. Three rounds of review on the commit
   that added this file each found that list short or its count wrong, every
   time by reading past the bullet the previous round had named. So the half of
   it that matters — the shapes where the wrong answer is DEAD, which is an
   instruction to delete live CSS — is a TABLE, and every entry is a
   demonstration that runs on every run.

   The ratchet works in both directions. An entry that stops reproducing fails
   the run, so a shape that gets fixed cannot stay on the list; and the count
   and the text in the header are parsed back out of this file and deepEqual'd
   against this table, so neither the number nor the wording can be typed. */

const SELF = fileURLToPath(import.meta.url);

/* Every finding, as `kind where`, for one hand-built dashboard. */
const verdicts = (pages, sheets, scripts = []) =>
  analyze({ pages, sheets, scripts }).findings.map((f) => `${f.kind} ${f.where}`);

const LINK = '<link rel="stylesheet" href="assets/x.css">';
const WRITE = 'document.body.dataset.page = "users";';
const wantsUsers = [sheet('ops/assets/x.css', 'body[data-page="users"] { color: red; }')];
const wantsLogin = [sheet('ops/assets/x.css', 'body[data-page="login"] { color: red; }')];

export const WRONG_DEAD_NOT_COVERED = [
  {
    id: 'aliased-body-write',
    why: 'A write that does not go through a member access on a textual document.body or '
      + 'document.documentElement is invisible unless it also names the attribute in '
      + 'quotes: an alias, a closest("body"), or the element itself handed to a function '
      + '— fn(document.body) or Object.assign(document.body, ...). Catching the argument '
      + 'position by text would refuse every attribute on every page in this repository, '
      + 'because eleven sites across six scripts name one of the two outside a member '
      + 'access: three pass it as a function argument, one of those to '
      + 'MutationObserver.observe; six are identity or existence tests; and two are prose '
      + 'inside comments. So this is disclosed rather than refused: refusing it switches '
      + 'the whole arm off.',
    wrongAnswer: () => [
      ...verdicts(
        [page('ops/login.html', `<!doctype html><html><head>${LINK}</head>`
          + '<body data-page="login">x</body></html>')],
        wantsUsers,
        [{ name: 'ops/assets/s.js', source: 'var b = document.body; b.setAttribute(k, val);' }]),
      ...verdicts(
        [page('ops/login.html', `<!doctype html><html><head>${LINK}</head>`
          + '<body data-page="login">x</body></html>')],
        wantsUsers,
        [{
          name: 'ops/assets/t.js',
          source: 'var K = "data-" + "page";\nfunction w(el, k, v) { el.setAttribute(k, v); }\n'
            + 'w(document.body, K, "users");',
        }]),
    ],
    expected: ['dead-body-scope ops/assets/x.css:1', 'dead-body-scope ops/assets/x.css:1'],
  },
  {
    id: 'character-reference',
    why: 'An HTML character reference in an attribute value is read as the characters it '
      + 'is written with, so `data-page="a&amp;b"` is compared against the selector as '
      + 'seven characters rather than the three the browser resolves it to. The same '
      + 'holds for an href: a character reference, a backslash, and any other spelling '
      + 'the URL parser normalises and this resolver does not, resolve to a path that is '
      + 'not the one the browser fetches. The href direction is always accompanied by a '
      + 'dangling-link naming the mis-resolved path, so the guard discloses that failure '
      + 'in the same run; the attribute direction is silent.',
    wrongAnswer: () => [
      ...verdicts(
        [page('ops/login.html', `<!doctype html><html><head>${LINK}</head>`
          + '<body data-page="a&amp;b">x</body></html>')],
        [sheet('ops/assets/x.css', 'body[data-page="a&b"] { color: red; }')]),
      ...verdicts(
        [page('ops/login.html', '<!doctype html><html><head>'
          + '<link rel="stylesheet" href="assets&#47;x.css"></head>'
          + '<body data-page="login">x</body></html>')],
        [sheet('ops/assets/x.css', 'body[data-page="login"] { color: red; }')]),
      ...verdicts(
        [page('ops/login.html', '<!doctype html><html><head>'
          + '<link rel="stylesheet" href="assets\\x.css"></head>'
          + '<body data-page="login">x</body></html>')],
        [sheet('ops/assets/x.css', 'body[data-page="login"] { color: red; }')]),
    ],
    expected: [
      'dead-body-scope ops/assets/x.css:1',
      'dangling-link ops/login.html -> ops/assets&',
      'orphan-sheet ops/assets/x.css',
      'dangling-link ops/login.html -> ops/assets\\x.css',
      'orphan-sheet ops/assets/x.css',
    ],
  },
  {
    id: 'css-escape',
    why: 'A CSS escape in a selector value is compared as the characters it is written '
      + 'with, so `[data-page="lo\\67 in"]`, which matches login, is not read as login.',
    wrongAnswer: () => verdicts(
      [page('ops/login.html', `<!doctype html><html><head>${LINK}</head>`
        + '<body data-page="login">x</body></html>')],
      [sheet('ops/assets/x.css', 'body[data-page="lo\\67 in"] { color: red; }')]),
    expected: ['dead-body-scope ops/assets/x.css:1'],
  },
  {
    id: 'import-only-sheet',
    why: 'The orphan arm reads <link> tags only, so a sheet reachable only through an '
      + '@import inside a linked sheet reads as orphaned.',
    wrongAnswer: () => verdicts(
      [page('ops/login.html', `<!doctype html><html><head>${LINK}</head>`
        + '<body data-page="login">x</body></html>')],
      [sheet('ops/assets/x.css', '@import url(y.css);\n.a { color: red; }'),
        sheet('ops/assets/y.css', '.b { color: red; }')]),
    expected: ['orphan-sheet ops/assets/y.css'],
  },
  {
    id: 'script-injected-link',
    why: 'The orphan arm reads <link> tags only, so a stylesheet a script builds and '
      + 'appends at runtime reads as orphaned.',
    wrongAnswer: () => verdicts(
      [page('ops/login.html', '<!doctype html><html><head></head>'
        + '<body data-page="login">x</body></html>')],
      [sheet('ops/assets/x.css', '.a { color: red; }')],
      [{ name: 'ops/assets/s.js', source: "var l = document.createElement('link');"
        + " l.rel = 'stylesheet'; l.href = 'assets/x.css'; document.head.appendChild(l);" }]),
    expected: ['orphan-sheet ops/assets/x.css'],
  },
  {
    id: 'subdirectory-page',
    why: 'The page and sheet listings are one level deep, so ops/panes/foo.html would not '
      + 'be read and a sheet only it linked would be reported orphaned. This is the one '
      + 'entry whose shape lives in how the repository run is BUILT rather than inside '
      + 'analyze(), so its demonstration has two halves: the listing really is one level '
      + 'deep, and a sheet whose only loader is missing from the page set really does '
      + 'come back orphaned.',
    wrongAnswer: () => [
      ...listing('ops', '.css').map((s) => s.name),
      ...verdicts([], [sheet('ops/assets/x.css', '.a { color: red; }')]),
    ],
    expected: ['orphan-sheet ops/assets/x.css'],
  },
];

test('every shape this guard is documented to get wrong still gets it wrong', () => {
  for (const entry of WRONG_DEAD_NOT_COVERED) {
    assert.deepEqual(entry.wrongAnswer(), entry.expected,
      `${entry.id} no longer reproduces. A shape that has been fixed must leave this ` +
      `table, or the list stops describing the guard: ${entry.why}`);
  }
  const ids = WRONG_DEAD_NOT_COVERED.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort(), 'keep the table in id order');
  assert.equal(new Set(ids).size, ids.length, 'duplicate id');
});

/* The markup shapes the guard refuses to read, one demonstration per detector
   id, driven through analyze() rather than through detect(). A detector that
   fires but does not stop the judgement would be a refusal in name only. */
const REFUSAL_DEMOS = {
  'comment-swallows-markup': [
    /* the `<!--` is inside a script, and what it swallows is the next script */
    '<!doctype html><html><head><script>var s = "<!--";</script>'
    + `<script>${WRITE}</script>${LINK}<!-- ordinary comment -->`
    + '</head><body data-page="login">x</body></html>',
    /* the span swallows a <script> and NOTHING else: the <link> is before it,
       so a detector that looked only for <link and <body would judge this page
       while blind to the script that writes the attribute it judges on */
    `<!doctype html><html><head>${LINK}</head><body data-page="login">x`
    + `<script>var s = "<!--";</script><script>${WRITE}</script>`
    + '<!-- ordinary comment --></body></html>',
    /* the same, with an EXTERNAL script inside the span: its body is empty, so
       the script-text clause below cannot see this one and the <script tag
       name in the span clause is the only thing refusing it */
    `<!doctype html><html><head>${LINK}<title>a <!-- b</title>`
    + '<script src="s.js"></script><!-- ordinary comment --></head>'
    + '<body data-page="login">x</body></html>',
    /* the `<!--` is inside a <style>, where a browser sees no comment at all */
    '<!doctype html><html><head><style>/* <!-- */ .q { color: red; }</style>'
    + `${LINK}<!-- ordinary comment --></head><body data-page="login">x</body></html>`,
    /* the `<!--` is inside a quoted attribute value of another tag */
    '<!doctype html><html><head><meta name="note" content="use <!-- with care">'
    + `${LINK}<!-- ordinary comment --></head><body data-page="login">x</body></html>`,
    /* the span swallows a <body> start tag and NOTHING else: the <link> is
       before it, so a detector that looked only for <link and <script would
       judge these pages on a body attribute map read from a blanked tag —
       and both really do carry the value the sheet asks for, so the refusal
       is the only thing between them and a wrong DEAD. Two natural
       spellings, RCDATA and a quoted attribute value. */
    `<!doctype html><html><head>${LINK}<title>a <!-- b</title></head>`
    + '<body data-page="users">x</body><!-- ordinary comment --></html>',
    `<!doctype html><html><head>${LINK}<meta name="n" content="use <!-- care"></head>`
    + '<body data-page="users">x</body><!-- ordinary comment --></html>',
    /* a comment opened and closed inside ONE <script> body swallows no tag at
       all, so a detector that only enumerates tag names is blind to it — and
       this is the canonical legacy idiom, which is why `<!--` is a JavaScript
       line comment. The write below is blanked; every tag survives. */
    `<!doctype html><html><head>${LINK}</head><body data-page="login">x`
    + `<script>\n<!--\n${WRITE}\n// -->\n</script></body></html>`,
    /* the two halves of that clause, each on its own. Here only the `<!--` is
       in a script body and the span ends at an ORDINARY comment's `-->`, so
       the span contains no tag (`</script>` is not `<script`) and neither of
       the other two clauses fires. */
    `<!doctype html><html><head>${LINK}</head><body data-page="login">x`
    + `<script>var s = "<!--"; ${WRITE}</script>`
    + '<!-- ordinary comment --></body></html>',
    /* and here the `<!--` is inside the <script> tag's own attribute value,
       which starts BEFORE the span, so again no tag name is swallowed — but
       the write is. This is the third clause's shape, and it is what made
       asking about a `-->` in a script body redundant. */
    `<!doctype html><html><head>${LINK}</head><body data-page="login">x`
    + `<script data-x="<!--">${WRITE} // -->\n</script></body></html>`,
    /* the `<!--` opens inside the attribute value of the very tag it damages,
       so the tag name is BEFORE the span and the first clause cannot see it,
       and the script body is raw so the second cannot either. Three tags,
       three different things destroyed: the script that writes the attribute,
       the href that links the sheet, and the body attribute map itself —
       which came back carrying the literal string `body` as an attribute
       name. All three were judged, not refused, until this clause. */
    `<!doctype html><html><head>${LINK}</head><body data-page="login">x`
    + `<script data-x="<!--">${WRITE}</script><!-- ordinary comment --></body></html>`,
    '<!doctype html><html><head><link rel="stylesheet" data-note="<!--" href="assets/x.css">'
    + '<!-- ordinary comment --></head><body data-page="login">x</body></html>',
    `<!doctype html><html><head>${LINK}</head>`
    + '<body data-note="<!--" data-page="login">x<!-- ordinary comment --></body></html>',
    /* <!--> is a complete empty comment for a browser, unterminated for the regex */
    `<!doctype html><html><head><!-->${LINK}<!-- ordinary comment -->`
    + '</head><body data-page="login">x</body></html>',
    /* --!> closes a comment for a browser, and does not for the regex */
    `<!doctype html><html><head><!-- a --!>${LINK}<!-- ordinary comment -->`
    + '</head><body data-page="login">x</body></html>',
    /* never closed at all: the regex blanks nothing, a browser blanks the rest */
    `<!doctype html><html><head><!-- a ${LINK}</head>`
    + '<body data-page="login">x</body></html>',
  ],
  'quoted-gt-in-tag': [
    `<!doctype html><html><head>${LINK}</head>`
    + '<body data-x="a>b" data-page="login">x</body></html>',
    '<!doctype html><html><head><link rel="stylesheet" title="a>b" href="assets/x.css">'
    + '</head><body data-page="login">x</body></html>',
    /* the third tag name in that detector's list, so none of the three is
       carried by prose alone: the truncated <script> tag hides its src, and
       parseTagAttributes reads a type out of what a browser reads as one
       quoted value, which is how a script that writes the attribute vanishes */
    '<!doctype html><html><head><script src="a.js" data-x="a>b"></script>'
    + `${LINK}</head><body data-page="login">x</body></html>`,
  ],
  'repeated-body-tag': [
    /* a browser merges the second start tag's attributes onto the first body */
    `<!doctype html><html><head>${LINK}</head><body>x<body data-page="login"></body></html>`,
    /* a <body that is only text: this guard reads it as the page's own */
    `<!doctype html><html><head>${LINK}</head>`
    + '<template><body data-page="users"></template><body data-page="login">x</body></html>',
    `<!doctype html><html><head>${LINK}<noscript><body data-page="users"></noscript></head>`
    + '<body data-page="login">x</body></html>',
    `<!doctype html><html><head>${LINK}</head>`
    + '<div title="<body data-page=\'users\'>"></div><body data-page="login">x</body></html>',
  ],
  'script-end-tag': [
    `<!doctype html><html><head>${LINK}</head>`
    + `<body data-page="login">x<script>${WRITE}</script/></body></html>`,
  ],
};

test('markup this guard cannot read is refused, and stops the judgement', () => {
  assert.deepEqual(Object.keys(REFUSAL_DEMOS).sort(), MARKUP_REFUSALS.map((r) => r.id).sort(),
    'every detector needs a demonstration and every demonstration needs a detector');

  for (const [id, markups] of Object.entries(REFUSAL_DEMOS)) {
    for (const markup of markups) {
      /* The sheet asks for a value the page does not carry AND the page is the
         sheet's only loader, so a judged run produces a dead-body-scope or an
         orphan-sheet. For most of these markups that verdict is WRONG in a
         browser, which is why they are refused; for a few — an unterminated
         comment, or a quoted `>` on a page that really does carry the other
         value — it would have come out right by luck. What this asserts is
         the refusal and the stop, not that every one of them was a near miss. */
      const out = analyze({ pages: [page('ops/login.html', markup)], sheets: wantsUsers, scripts: [] });
      assert.deepEqual(out.findings.map((f) => `${f.kind} ${f.where}`),
        [`unreadable-markup ops/login.html`],
        `${id}: this markup was judged rather than refused, or refused under another id`);
      assert.ok(out.findings[0].detail.startsWith(`${id}:`),
        `${id}: refused under ${out.findings[0].detail.split(':')[0]} instead`);
    }
  }
});

/* The header's machine-checked block, parsed back out of this file. This is
   not a source grep: nothing here asserts that the file contains a string. It
   reads the documented table out of the prose and deepEquals it against the
   table the code actually carries, so the count and the wording of every
   entry are derived rather than typed. */
const FENCE = '```' + 'counts';

export function parseCountsBlock(fileText) {
  const start = fileText.indexOf(FENCE);
  if (start === -1) return null;
  const end = fileText.indexOf('```', start + FENCE.length);
  if (end === -1) return null;
  const lines = fileText.slice(start + FENCE.length, end).split('\n')
    .map((l) => l.replace(/^\s{0,5}/, '').trimEnd()).filter((l) => l.trim());
  const sections = {};
  const strays = [];
  let section = null;
  let entry = null;
  for (const line of lines) {
    const head = line.match(/^([a-z-]+): (\d+)$/);
    if (head) {
      section = { count: Number(head[2]), entries: [] };
      sections[head[1]] = section;
      entry = null;
      continue;
    }
    const item = line.match(/^- ([a-z-]+): (.*)$/);
    if (item && section) { entry = { id: item[1], why: item[2] }; section.entries.push(entry); continue; }
    /* A continuation line belongs to the entry above it. Anywhere else — before
       the first section, or between a section header and its first entry — it
       is prose typed into the one block whose whole purpose is that nothing in
       it is typed, and round 1 of review proved it vanished silently. */
    if (entry) { entry.why += ` ${line.trim()}`; continue; }
    strays.push(line.trim());
  }
  return { sections, strays };
}

const flat = (s) => s.replace(/\s+/g, ' ').trim();

test('the header\'s counts block is the code\'s tables, not a typed claim', () => {
  const parsed = parseCountsBlock(readFileSync(SELF, 'utf8'));
  const tables = {
    'refuses-to-read': MARKUP_REFUSALS,
    'wrong-dead-not-covered': WRONG_DEAD_NOT_COVERED,
  };
  assert.ok(parsed, 'the header carries no machine-checked ' + FENCE + ' block, so its ' +
    'lists are typed prose. The code carries ' +
    Object.entries(tables).map(([k, t]) => `${k}: ${t.map((e) => e.id).join(', ')}`).join('; '));
  assert.deepEqual(parsed.strays, [],
    'a line in the block that is neither a section header, an entry, nor a continuation '
    + 'of the entry above it is prose nothing checks — which is what this block exists '
    + 'to make impossible');
  /* and that the stray report is not vacuous. The position below — between a
     section header and its first entry — is the one round 1 of review proved
     vanished silently, and an exhaustiveness claim is exactly what a later
     round would type there. */
  assert.deepEqual(
    parseCountsBlock([FENCE, '   demo: 1', '   and that is all of them.', '   - a: b', '```']
      .join('\n')).strays,
    ['and that is all of them.'],
    'a line between a section header and its first entry must be reported, not dropped');
  assert.deepEqual(Object.keys(parsed.sections).sort(), Object.keys(tables).sort(),
    'the block and the code do not carry the same sections');
  for (const [name, table] of Object.entries(tables)) {
    const codeSays = table.map((e) => ({ id: e.id, why: flat(e.why) }));
    assert.deepEqual(parsed.sections[name].entries.map((e) => ({ id: e.id, why: flat(e.why) })),
      codeSays, `the header and the code disagree about ${name}`);
    assert.equal(parsed.sections[name].count, codeSays.length,
      `the ${name} count in the header is not the number of entries below it`);
  }
});
