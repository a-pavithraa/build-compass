#!/usr/bin/env node
// Applies an update's patch to the map's data, so the agent writes only what changed.
//   node merge.mjs [path/to/.project-map]
// Reads map-data.js and map-patch.json from that folder. The result goes through check.mjs first:
// when it passes, the old data is filed under history/, the new data takes its place and the patch
// is removed. When it does not, nothing changes and the problems are printed.
//
// The patch, every key optional:
//   "set":    { "update": {...}, "next": {...} }     top-level fields, replaced whole; null removes one.
//                                                    "update" is laid over the previous one instead, and
//                                                    ends what refresh.mjs said was unread
//   "items":  [ { "id": "T3", "status": "done" } ]   fields laid over the item with that id; null removes a field.
//                                                    A new id also says where it goes: "in": "tasks".
//                                                    A rule is an item too: "in": "rules"
//   "remove": [ "T5" ]                               items to delete, with every mention of their ids
//   "add":    { "findings": [...], "commits": [...] } entries added to a list that has no ids
//   "drop":   { "findings": ["A finding's title"] }  entries taken out of such a list, by title or question
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSaved, attach } from './checks.mjs';
import { readSettings, stampRules } from './rules.mjs';

const mapDir = resolve(process.argv[2] || join(process.cwd(), '.project-map'));
const dataFile = join(mapDir, 'map-data.js');
const patchFile = join(mapDir, 'map-patch.json');
const nextFile = join(mapDir, 'map-data.next.js');
const KINDS = ['tasks', 'parts', 'milestones', 'decisions', 'rules'];
const ID_LISTS = ['tasks', 'needs', 'unlocks', 'decisions', 'waiting', 'changed', 'refs'];
const ID_FIELDS = ['part', 'milestone', 'open', 'task'];
const COMMITS_KEEP = 20;
const HISTORY_KEEP = 20;
const list = (v) => (Array.isArray(v) ? v : []);

function stop(message) {
  console.error(`problem: ${message}`);
  process.exit(1);
}

let data;
let patch;
try {
  const text = readFileSync(dataFile, 'utf8');
  data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
} catch (err) {
  stop(`cannot read ${dataFile}: ${err.message}. A first map is written whole, not merged.`);
}
try {
  patch = JSON.parse(readFileSync(patchFile, 'utf8'));
} catch (err) {
  stop(`cannot read ${patchFile}: ${err.message}`);
}
const previousVersion = (data.update && data.update.version) || 1;
const rulesBefore = structuredClone(list(data.rules));
const unknown = Object.keys(patch).filter((key) => !['set', 'items', 'remove', 'add', 'drop'].includes(key));
if (unknown.length) stop(`the patch has keys merge.mjs does not know: ${unknown.join(', ')}`);

const find = (id) => {
  for (const kind of KINDS) {
    const item = list(data[kind]).find((x) => x.id === id);
    if (item) return { kind, item };
  }
  return null;
};

// A task belongs to the one part and the one milestone it names.
function place(taskId, kind, ownerId) {
  if (ownerId === undefined) return;
  for (const owner of list(data[kind])) owner.tasks = list(owner.tasks).filter((id) => id !== taskId);
  const owner = list(data[kind]).find((x) => x.id === ownerId);
  if (owner) owner.tasks.push(taskId);
}

for (const [key, value] of Object.entries(patch.set || {})) {
  if (value === null) delete data[key];
  else if (key === 'update') data.update = { ...data.update, ...value, unread: undefined, refreshed: undefined };
  else data[key] = value;
}

for (const change of list(patch.items)) {
  const { id, in: kind, ...fields } = change;
  if (!id) stop('an entry in items has no id');
  let found = find(id);
  if (!found) {
    if (!KINDS.includes(kind)) stop(`item "${id}" is new, so it must say where it goes: "in" is one of ${KINDS.join(', ')}`);
    const item = { id };
    data[kind] = [...list(data[kind]), item];
    found = { kind, item };
  }
  for (const [field, value] of Object.entries(fields)) {
    if (value === null) delete found.item[field];
    else found.item[field] = value;
  }
}
// Placed after every item is in, so a new task can name a part that the same patch adds.
for (const change of list(patch.items)) {
  if (find(change.id).kind !== 'tasks') continue;
  place(change.id, 'parts', change.part);
  place(change.id, 'milestones', change.milestone);
}

const removed = new Set(list(patch.remove));
for (const id of removed) {
  const found = find(id);
  if (!found) stop(`remove names "${id}", which does not exist`);
  data[found.kind] = data[found.kind].filter((x) => x.id !== id);
}
function forget(value) {
  if (Array.isArray(value)) return value.forEach(forget);
  if (!value || typeof value !== 'object') return;
  for (const [key, inner] of Object.entries(value)) {
    if (ID_LISTS.includes(key) && Array.isArray(inner) && inner.every((x) => typeof x === 'string')) value[key] = inner.filter((id) => !removed.has(id));
    else if (ID_FIELDS.includes(key) && removed.has(inner)) delete value[key];
    else forget(inner);
  }
}
if (removed.size) forget(data);

const titleOf = (entry) => entry.title || entry.question;
for (const [key, titles] of Object.entries(patch.drop || {})) {
  for (const title of list(titles)) if (!list(data[key]).some((entry) => titleOf(entry) === title)) stop(`drop: ${key} has no entry titled "${title}"`);
  data[key] = list(data[key]).filter((entry) => !list(titles).includes(titleOf(entry)));
}
for (const [key, entries] of Object.entries(patch.add || {})) {
  if (key === 'commits') {
    // Newest first. An uncommitted entry describes one moment, so the old ones go and the patch adds today's.
    const added = new Set(list(entries).map((c) => c.hash));
    data.commits = [...list(entries), ...list(data.commits).filter((c) => c.hash && !added.has(c.hash))].slice(0, COMMITS_KEEP);
  } else {
    data[key] = [...list(data[key]), ...list(entries)];
  }
}

const now = new Date();
const two = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
const historyDir = join(mapDir, 'history');
let historyName = `map-data-${stamp}.js`;
for (let n = 2; existsSync(join(historyDir, historyName)); n++) historyName = `map-data-${stamp}-${n}.js`;

const version = previousVersion + 1;
data.update = { ...data.update, version, first: false, previous: `history/${historyName}` };

// The results of the owner's check commands, when they ran on what this update read.
attach(data, readSaved(mapDir));

// What the owner set for this project reaches the page and the next update's digest through the data.
const settings = readSettings(mapDir);
if (settings) data.settings = settings;
else delete data.settings;

let repoRoot = dirname(mapDir);
try {
  repoRoot = execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', mapDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || repoRoot;
} catch { /* not a git repository: a rule's test file is looked for beside the map's folder */ }
stampRules(data, rulesBefore, new Set(list(patch.items).map((change) => change.id)), version, repoRoot);

writeFileSync(nextFile, `window.PROJECT_MAP = ${JSON.stringify(data, null, 2)};\n`);
let checked;
try {
  checked = execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'check.mjs'), nextFile], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  rmSync(nextFile, { force: true });
  process.stdout.write(err.stdout || '');
  process.stderr.write(err.stderr || `problem: check.mjs could not run: ${err.message}\n`);
  console.error('The map is unchanged. Fix map-patch.json and run merge.mjs again.');
  process.exit(1);
}

mkdirSync(historyDir, { recursive: true });
copyFileSync(dataFile, join(historyDir, historyName));
renameSync(nextFile, dataFile);
rmSync(patchFile, { force: true });
const kept = readdirSync(historyDir).filter((name) => name.endsWith('.js')).sort();
for (const name of kept.slice(0, Math.max(0, kept.length - HISTORY_KEEP))) rmSync(join(historyDir, name), { force: true });

process.stdout.write(checked);
console.log(`merged: map version ${version}; the previous data is history/${historyName}`);
