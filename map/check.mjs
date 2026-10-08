#!/usr/bin/env node
// Checks a map-data.js file before the page tries to draw it.
//   node check.mjs path/to/map-data.js
// Exits 0 when the page can draw it, 1 with a list of problems when it cannot.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';

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
  for (const v of list(task.verified)) {
    if (!v.check) problems.push(`${who}: a verified entry has no check`);
    if (!['passed', 'failed'].includes(v.result)) problems.push(`${who}: verified.result must be "passed" or "failed"`);
  }
  if (task.status === 'done' && list(task.verified).some((v) => v.result === 'failed')) problems.push(`${who} is done but a check on it failed`);
  if (task.outcome && ['before', 'now', 'tryIt'].some((k) => task.outcome[k] !== undefined && typeof task.outcome[k] !== 'string')) problems.push(`${who}: outcome.before, now and tryIt must be text`);
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
  if (decision.readOnly && !(decision.answerIn && decision.answerIn.file)) problems.push(`${who}: a readOnly decision must say where it is answered (answerIn.file)`);
}
if (data.plan) {
  if (!data.plan.file) problems.push('plan.file is missing');
  if (data.plan.approval && !['approved', 'awaiting'].includes(data.plan.approval)) problems.push('plan.approval must be "approved" or "awaiting"');
}
for (const finding of list(data.findings)) refs(`finding "${finding.title}"`, 'refs', finding.refs);
for (const commit of list(data.commits)) if (commit.task) refs(`commit ${commit.hash || '(uncommitted)'}`, 'task', [commit.task], 'task');
refs('update', 'changed', data.update && data.update.changed);

const mapDir = dirname(resolve(file));
const HISTORY_KEEP = 20;
const historyDir = join(mapDir, 'history');
if (existsSync(historyDir)) {
  const kept = readdirSync(historyDir).filter((name) => name.endsWith('.js')).length;
  if (kept > HISTORY_KEEP) notes.push(`history holds ${kept} files; keep the newest ${HISTORY_KEEP}`);
}

// Every hash and path must exist in git or on disk: the agent may not invent them.
// Only `rev-parse` and `cat-file` run, as neither starts a filter, hook or pager from the repo's config.
const git = (args, input) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', mapDir, ...args], {
  encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], maxBuffer: 64e6,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
});
let repoRoot = null;
try { repoRoot = git(['rev-parse', '--show-toplevel']).trim(); } catch { notes.push('not inside a git repository, so commits and files were not checked against git'); }
if (repoRoot) {
  const objects = new Set();
  const ask = (obj) => objects.add(obj);
  const workRecords = list(data.tasks).flatMap((task) => list(task.work).map((work) => ({ task, work })));
  if (data.update && data.update.commit) ask(`${data.update.commit}^{commit}`);
  for (const { work } of workRecords) for (const commit of list(work.commits)) if (commit.hash) ask(`${commit.hash}^{commit}`);
  for (const commit of list(data.commits)) if (commit.hash) ask(`${commit.hash}^{commit}`);
  const onDisk = (path, work) => existsSync(join((work && work.worktree) || repoRoot, path));
  for (const { work } of workRecords) {
    for (const f of list(work.files)) {
      if (!f.path || f.kind === 'deleted' || onDisk(f.path, work)) continue;
      for (const commit of list(work.commits)) if (commit.hash) ask(`${commit.hash}:${f.path}`);
    }
  }
  const missing = new Set();
  if (objects.size) {
    const asked = [...objects];
    const answers = git(['cat-file', '--batch-check'], asked.join('\n') + '\n').trim().split('\n');
    asked.forEach((obj, i) => { if (/ missing$/.test(answers[i] || ' missing')) missing.add(obj); });
  }
  const exists = (obj) => objects.has(obj) && !missing.has(obj);
  if (data.update && data.update.commit && !exists(`${data.update.commit}^{commit}`)) problems.push(`update.commit "${data.update.commit}" is not a commit in this repository`);
  for (const { task, work } of workRecords) {
    for (const commit of list(work.commits)) if (commit.hash && !exists(`${commit.hash}^{commit}`)) problems.push(`task ${task.id}: commit "${commit.hash}" is not in this repository`);
    for (const f of list(work.files)) {
      if (!f.path || f.kind === 'deleted' || onDisk(f.path, work)) continue;
      if (!list(work.commits).some((commit) => commit.hash && exists(`${commit.hash}:${f.path}`))) problems.push(`task ${task.id}: file "${f.path}" is neither on disk${work.worktree ? ` in ${work.worktree}` : ''} nor in the work record's commits`);
    }
  }
  for (const commit of list(data.commits)) if (commit.hash && !exists(`${commit.hash}^{commit}`)) problems.push(`commits: "${commit.hash}" is not in this repository`);
  for (const f of list(data.unassigned && data.unassigned.files)) if (f.path && f.kind !== 'deleted' && !onDisk(f.path)) problems.push(`unassigned: file "${f.path}" is not on disk`);
}

for (const note of notes) console.log(`note: ${note}`);
if (problems.length) {
  for (const problem of problems) console.error(`problem: ${problem}`);
  process.exit(1);
}
console.log(`ok: ${list(data.parts).length} parts, ${list(data.tasks).length} tasks, ${list(data.milestones).length} milestones, ${list(data.decisions).length} decisions`);
