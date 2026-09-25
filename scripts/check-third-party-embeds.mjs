#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_INLINE_HOSTS = new Set(['api.runwitharia.com']);
const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const failures = [];

function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineFor(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (starts[mid] <= index) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function fail(file, line, message) {
  failures.push(`${file}:${line}: ${message}`);
}

function parseAttributes(tag) {
  const name = /^<\s*\/?\s*[A-Za-z][A-Za-z0-9:-]*/.exec(tag);
  if (!name) return new Map();
  const attrs = tag.slice(name[0].length, tag.endsWith('>') ? -1 : tag.length);
  const parsed = new Map();
  const attrRe = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRe.exec(attrs))) {
    parsed.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return parsed;
}

function findTagEnd(src, start) {
  let quote = null;
  for (let i = start + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i + 1;
  }
  return src.length;
}

function readStringLiterals(src) {
  const literals = [];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i + 2);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    const quote = src[i];
    if (quote !== '"' && quote !== "'" && quote !== '`') continue;
    const start = i;
    let value = '';
    i += 1;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '\\') {
        value += src[i + 1] || '';
        i += 1;
        continue;
      }
      if (ch === quote) break;
      value += ch;
    }
    literals.push({ start, value });
  }
  return literals;
}

function hostFindings(body) {
  const findings = [];
  for (const literal of readStringLiterals(body)) {
    const patterns = [
      /https?:\/\/([A-Za-z0-9.-]+)(?::\d+)?/gi,
      /(^|[^:])\/\/([A-Za-z0-9.-]+)(?::\d+)?/g,
      /(^|[^\w./-])((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?::\d+)?(?=$|[^\w.-])/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(literal.value))) {
        const host = (match[2] || match[1]).toLowerCase().replace(/\.$/, '');
        if (!host || ALLOWED_INLINE_HOSTS.has(host)) continue;
        const prefix = match[2] ? match[1].length : 0;
        findings.push({ host, index: literal.start + match.index + prefix });
      }
    }
  }
  return findings;
}

function scanFile(file) {
  const src = readFileSync(path.join(root, file), 'utf8');
  const starts = lineStarts(src);

  for (let i = 0; i < src.length; i += 1) {
    if (src[i] !== '<') continue;
    if (/^<!--/.test(src.slice(i, i + 4))) {
      const end = src.indexOf('-->', i + 4);
      i = end === -1 ? src.length : end + 2;
      continue;
    }

    const tagStart = i;
    const tagEnd = findTagEnd(src, tagStart);
    const tag = src.slice(tagStart, tagEnd);
    const nameMatch = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(tag);
    if (!nameMatch) continue;
    const isClosing = Boolean(nameMatch[1]);
    const tagName = nameMatch[2].toLowerCase();
    const attrs = parseAttributes(tag);
    const line = lineFor(starts, tagStart);

    if (!isClosing && attrs.has('srcdoc')) {
      fail(file, line, 'srcdoc attributes are forbidden');
    }

    if (!isClosing && tagName === 'base') {
      fail(file, line, '<base> is forbidden');
    }

    if (!isClosing && ['iframe', 'object', 'embed'].includes(tagName)) {
      fail(file, line, `<${tagName}> is forbidden`);
    }

    if (!isClosing && tagName === 'script') {
      if (attrs.has('src')) {
        const srcAttr = attrs.get('src').trim();
        if (/^(?:https?:)?\/\//i.test(srcAttr) || /^data:/i.test(srcAttr)) {
          fail(file, line, 'script src must be a relative first-party path');
        }
      } else {
        const closeRe = /<\s*\/\s*script\s*>/gi;
        closeRe.lastIndex = tagEnd;
        const close = closeRe.exec(src);
        const bodyEnd = close ? close.index : src.length;
        const body = src.slice(tagEnd, bodyEnd);
        for (const finding of hostFindings(body)) {
          fail(file, lineFor(starts, tagEnd + finding.index), `inline script names disallowed host ${finding.host}`);
        }
        if (close) i = closeRe.lastIndex - 1;
        continue;
      }
    }

    i = tagEnd - 1;
  }
}

function htmlFiles() {
  return execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '*.html'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

for (const file of htmlFiles()) {
  scanFile(file);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  console.error(`${failures.length} third-party embed check(s) failed`);
  process.exit(1);
}

console.log('Third-party embed check passed');
