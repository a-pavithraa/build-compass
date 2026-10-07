#!/usr/bin/env node
// Checks a map-data.js file before the page tries to draw it.
//   node check.mjs path/to/map-data.js
// Exits 0 when the page can draw it, 1 with a list of problems when it cannot.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node check.mjs path/to/map-data.js');
  process.exit(2);
}

const problems = [];
const notes = [];
let data;
try {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (!/^\s*window\.PROJECT_MAP\s*=/.test(text) || start < 0) throw new Error('the file must start with "window.PROJECT_MAP = {"');
  data = JSON.parse(text.slice(start, end + 1));
} catch (err) {
  console.error(`Cannot read the data: ${err.message}`);
  process.exit(1);
}

const STATUSES = ['done', 'in-progress', 'not-started', 'stuck'];
const list = (v) => (Array.isArray(v) ? v : []);
const ids = new Map();

function register(kind, items) {
  for (const item of list(items)) {
    if (!item.id) problems.push(`a ${kind} has no id`);
    else if (ids.has(item.id)) problems.push(`id "${item.id}" is used by a ${ids.get(item.id)} and a ${kind}; ids must be unique across the whole file`);
    else ids.set(item.id, kind);
  }
}
register('task', data.tasks);
register('part', data.parts);
register('milestone', data.milestones);
register('decision', data.decisions);

function refs(owner, field, values, kind) {
  for (const id of list(values)) {
    if (!ids.has(id)) problems.push(`${owner}: ${field} names "${id}", which does not exist`);
    else if (kind && ids.get(id) !== kind) problems.push(`${owner}: ${field} names "${id}", which is a ${ids.get(id)}, not a ${kind}`);
  }
}

if (!data.project) problems.push('project (the name) is missing');
if (!Array.isArray(data.parts) || !data.parts.length) problems.push('parts is missing or empty');
if (!data.update || !data.update.readAt) problems.push('update.readAt is missing');
if (!data.next || !data.next.step) problems.push('next.step is missing');
if (data.next && data.next.open && !ids.has(data.next.open)) problems.push(`next.open names "${data.next.open}", which does not exist`);
if (data.style && data.style.accent && !/^#[0-9a-f]{3,8}$/i.test(data.style.accent)) problems.push('style.accent must be a hex colour such as #3B82F6');
if (data.style && data.style.theme && !['dark', 'light'].includes(data.style.theme)) problems.push('style.theme must be "dark" or "light"');

for (const part of list(data.parts)) {
  const who = `part ${part.id}`;
  if (!part.name) problems.push(`${who}: name is missing`);
  if (!STATUSES.includes(part.status)) problems.push(`${who}: status must be one of ${STATUSES.join(', ')}`);
  if (!part.reason) problems.push(`${who}: reason is missing`);
  if (part.status === 'stuck' && !part.waitingOn) problems.push(`${who}: a stuck part must say what it is waitingOn`);
  refs(who, 'tasks', part.tasks, 'task');
}
for (const task of list(data.tasks)) {
  const who = `task ${task.id}`;
  if (!task.name) problems.push(`${who}: name is missing`);
  if (!STATUSES.includes(task.status)) problems.push(`${who}: status must be one of ${STATUSES.join(', ')}`);
  if (task.status === 'stuck' && !task.waitingOn) problems.push(`${who}: a stuck task must say what it is waitingOn`);
  if (task.part) refs(who, 'part', [task.part], 'part');
  if (task.milestone) refs(who, 'milestone', [task.milestone], 'milestone');
  refs(who, 'needs', task.needs, 'task');
  refs(who, 'unlocks', task.unlocks, 'task');
  refs(who, 'decisions', task.decisions, 'decision');
  if ((task.status === 'done' || task.status === 'in-progress') && !list(task.work).length) notes.push(`${who} is ${task.status} but has no work record`);
  for (const work of list(task.work)) {
    if (!['committed', 'uncommitted'].includes(work.state)) problems.push(`${who}: work.state must be "committed" or "uncommitted"`);
    if (work.state === 'committed' && !list(work.commits).length) problems.push(`${who}: a committed work record needs at least one commit`);
    if (!work.description) problems.push(`${who}: a work record has no description`);
  }
  if (!list(data.parts).some((part) => list(part.tasks).includes(task.id))) notes.push(`${who} is not listed under any part`);
}
for (const milestone of list(data.milestones)) {
  if (!milestone.name) problems.push(`milestone ${milestone.id}: name is missing`);
  refs(`milestone ${milestone.id}`, 'tasks', milestone.tasks, 'task');
}
for (const decision of list(data.decisions)) {
  const who = `decision ${decision.id}`;
  if (!decision.question) problems.push(`${who}: question is missing`);
  refs(who, 'waiting', decision.waiting, 'task');
  if (!decision.answer && !decision.readOnly && !decision.default) notes.push(`${who} is open and has no default`);
}
for (const finding of list(data.findings)) refs(`finding "${finding.title}"`, 'refs', finding.refs);
for (const commit of list(data.commits)) if (commit.task) refs(`commit ${commit.hash || '(uncommitted)'}`, 'task', [commit.task], 'task');
refs('update', 'changed', data.update && data.update.changed);

for (const note of notes) console.log(`note: ${note}`);
if (problems.length) {
  for (const problem of problems) console.error(`problem: ${problem}`);
  process.exit(1);
}
console.log(`ok: ${list(data.parts).length} parts, ${list(data.tasks).length} tasks, ${list(data.milestones).length} milestones, ${list(data.decisions).length} decisions`);
