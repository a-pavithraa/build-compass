#!/usr/bin/env node
// Reads an html-plan plan and prints its claims and decisions as JSON, with stable ids.
//   node plan-extract.mjs path/to/plan.html [--index .project-map/plan-index.json] [--write]
// Claims are matched to the ids stored in the index, so a reworded or renumbered claim keeps its id.
// With --write, the index is updated to this version of the plan.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--index');
if (!file) {
  console.error('usage: node plan-extract.mjs path/to/plan.html [--index path/to/plan-index.json] [--write]');
  process.exit(2);
}
const indexPath = opt('--index');
const write = argv.includes('--write');

let raw;
try {
  raw = readFileSync(file, 'utf8');
} catch (err) {
  console.error(`Cannot read the plan: ${err.message}`);
  process.exit(1);
}
if (!/<doc-plan\b/.test(raw)) {
  console.error(`${file} has no <doc-plan>; it is not an html-plan plan`);
  process.exit(1);
}

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&', nbsp: ' ', middot: '·', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };
const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
  return ENTITIES[e.toLowerCase()] ?? m;
});
const text = (html) => unent(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attrs = (s) => {
  const o = {};
  s.replace(/([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, (m, k, a, b, c) => { o[k.toLowerCase()] = unent(a ?? b ?? c ?? ''); return ''; });
  return o;
};
const firstP = (html) => { const m = html.match(/^\s*<p\b[^>]*>([\s\S]*?)<\/p>/i); return m ? text(m[1]) : ''; };
const words = (s) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
const overlap = (a, b) => {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let same = 0;
  for (const w of x) if (y.has(w)) same++;
  return same / (x.size + y.size - same);
};
const safeKey = (s) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

const html = raw
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<script\b[^>]*data-htmlplan[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

const title = text((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
const claims = [];
const asks = [];
const stack = [];
const TOKEN = /<doc-claim\b([^>]*)>|<\/doc-claim>|<doc-ask\b([^>]*)>([\s\S]*?)<\/doc-ask>|<doc-calls\b[^>]*>([\s\S]*?)<\/doc-calls>|<script\b[^>]*>[\s\S]*?<\/script>|<template\b[^>]*>[\s\S]*?<\/template>/gi;

for (const m of html.matchAll(TOKEN)) {
  const [whole, claimAttrs, askAttrs, askInner, callsInner] = m;
  const current = stack[stack.length - 1];
  if (claimAttrs !== undefined) {
    const a = attrs(claimAttrs);
    const parent = current || null;
    const siblings = claims.filter((c) => c.parent === parent);
    const aux = a.aux || (parent && parent.aux) || null;
    const numbered = siblings.filter((c) => !c.ownAux).length + 1;
    const claim = {
      parent, ownAux: a.aux || null, aux, start: m.index,
      position: siblings.length,
      number: aux ? null : (parent ? `${parent.number}.${numbered}` : String(numbered)),
      depth: stack.length + 1,
      htmlId: a.id || null,
      at: a.at || null,
      text: firstP(html.slice(m.index + whole.length)),
      files: [],
      items: [],
      asks: [],
    };
    if (!claim.text && claim.at) claim.text = basename(claim.at.replace(/:\d.*$/, ''));
    claims.push(claim);
    stack.push(claim);
  } else if (/^<\/doc-claim>/i.test(whole)) {
    const done = stack.pop();
    if (done && done.aux) {
      const body = html.slice(done.start, m.index);
      done.items = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => text(li[1]));
    }
  } else if (askAttrs !== undefined) {
    const a = attrs(askAttrs);
    const options = [...askInner.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)].map((l) => {
      const input = attrs((l[1].match(/<input\b([^>]*)>/i) || [])[1] || '');
      const detail = text((l[1].match(/<small\b[^>]*>([\s\S]*?)<\/small>/i) || [])[1] || '');
      return {
        value: input.value ?? null,
        label: text(l[1].replace(/<small\b[^>]*>[\s\S]*?<\/small>/gi, '')),
        ...(detail ? { detail } : {}),
        checked: 'checked' in input,
        kind: input.type || 'text',
      };
    });
    const ask = {
      id: a.id || null,
      question: firstP(askInner),
      options: options.map(({ checked, ...o }) => o),
      default: options.filter((o) => o.checked).map((o) => o.label),
      claim: current || null,
    };
    if (current) current.asks.push(ask);
    asks.push(ask);
  } else if (callsInner !== undefined && current) {
    const src = (callsInner.match(/<script\b[^>]*type=["']?text\/(?:plain|source)["']?[^>]*>([\s\S]*?)<\/script>/i) || [])[1] || '';
    for (const line of src.split('\n')) {
      const loc = line.match(/@\s*([^\s:]+):(\d+)/);
      if (loc) current.files.push({ path: loc[1], line: +loc[2], mark: line[0] === ' ' ? 'context' : ({ '+': 'new', '-': 'removed', '~': 'changed', '?': 'proposed' }[line[0]] || 'context') });
    }
  }
}

const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);

let index = { claims: [] };
if (indexPath && existsSync(indexPath)) {
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (err) {
    console.error(`Cannot read the index ${indexPath}: ${err.message}`);
    process.exit(1);
  }
}
const planKey = index.plan || safeKey(basename(file).replace(/(\.packed|\.artifact)?\.html?$/i, '')).toLowerCase() || 'plan';
const stored = index.claims || [];
const taken = new Set();
const assign = (claim, entry, how) => { claim.id = entry.id; claim.matched = how; claim.was = entry.number; taken.add(entry); };
const free = () => stored.filter((e) => !taken.has(e));
const unique = (list) => (list.length === 1 ? list[0] : null);

for (const claim of claims) {
  const byHtmlId = claim.htmlId && free().find((e) => e.htmlId === claim.htmlId);
  if (byHtmlId) assign(claim, byHtmlId, 'html-id');
}
for (const claim of claims.filter((c) => !c.id)) {
  const same = unique(free().filter((e) => e.text === claim.text));
  if (same) assign(claim, same, 'text');
}
for (const claim of claims.filter((c) => !c.id && c.at)) {
  const same = unique(free().filter((e) => e.at === claim.at));
  if (same) assign(claim, same, 'at');
}
for (const claim of claims) {
  if (claim.id) continue;
  const parentId = claim.parent ? claim.parent.id || null : null;
  const near = free()
    .filter((e) => e.depth === undefined || e.depth === claim.depth)
    .map((e) => ({ e, words: overlap(e.text, claim.text) }))
    .filter((x) => x.words >= 0.5)
    .map((x) => ({ e: x.e, score: x.words + (x.e.parent === parentId ? 0.2 : 0) + (x.e.position === claim.position ? 0.15 : 0) }))
    .sort((x, y) => y.score - x.score);
  if (near.length && (near.length === 1 || near[0].score > near[1].score)) assign(claim, near[0].e, 'similar');
}
let counter = Math.max(0, ...stored.map((e) => +(String(e.id).match(/-c(\d+)$/) || [])[1] || 0));
const usedIds = new Set(stored.map((e) => e.id));
for (const claim of claims) {
  if (claim.id) continue;
  const fromHtml = claim.htmlId && `${planKey}-${safeKey(claim.htmlId)}`;
  claim.id = fromHtml && !usedIds.has(fromHtml) ? fromHtml : `${planKey}-c${++counter}`;
  usedIds.add(claim.id);
  claim.matched = 'new';
}
const gone = free().map((e) => ({ id: e.id, number: e.number, text: e.text }));

const out = {
  file, title, hash,
  claims: claims.map((c) => ({
    id: c.id,
    matched: c.matched,
    ...(c.was && c.was !== c.number ? { was: c.was } : {}),
    number: c.number,
    aux: c.aux,
    depth: c.depth,
    parent: c.parent ? c.parent.id : null,
    text: c.text,
    at: c.at,
    files: c.files,
    ...(c.items.length ? { items: c.items } : {}),
    asks: c.asks.map((a) => a.id),
  })),
  asks: asks.map((a) => ({
    id: a.id,
    decisionId: a.id ? `${planKey}-ask-${safeKey(a.id)}` : null,
    claim: a.claim ? a.claim.id : null,
    claimNumber: a.claim ? a.claim.number : null,
    question: a.question,
    options: a.options,
    default: a.default,
  })),
  gone,
};

if (write && indexPath) {
  index = {
    plan: planKey,
    file, hash,
    claims: claims.map((c) => ({ id: c.id, htmlId: c.htmlId, number: c.number, parent: c.parent ? c.parent.id : null, depth: c.depth, position: c.position, at: c.at, text: c.text })),
  };
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
}
console.log(JSON.stringify(out, null, 2));
