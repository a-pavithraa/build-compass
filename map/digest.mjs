#!/usr/bin/env node
// Prints a short digest of a map's data, so an update starts from what the map already says
// without reading the whole file, which grows with every task.
//   node digest.mjs [path/to/map-data.js]              every item with its id, name and status
//   node digest.mjs [path/to/map-data.js] --item T3    one item, or one top-level field, in full
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const argv = process.argv.slice(2);
const itemAt = argv.indexOf('--item');
const wanted = itemAt < 0 ? null : argv[itemAt + 1];
const file = resolve(argv.find((a, i) => !a.startsWith('--') && (itemAt < 0 || i !== itemAt + 1)) || join(process.cwd(), '.project-map', 'map-data.js'));
const list = (v) => (Array.isArray(v) ? v : []);

let data;
try {
  const text = readFileSync(file, 'utf8');
  data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
} catch (err) {
  console.error(`Cannot read the data: ${err.message}`);
  process.exit(1);
}

if (itemAt >= 0) {
  const item = ['tasks', 'parts', 'milestones', 'decisions', 'rules'].flatMap((kind) => list(data[kind])).find((x) => x.id === wanted);
  const found = item || data[wanted];
  if (found === undefined) {
    console.error(`No item or field named "${wanted}" in ${file}`);
    process.exit(1);
  }
  console.log(JSON.stringify(found, null, 1));
  process.exit(0);
}

// Leaves out what is empty, so a line carries only what the item has.
const lean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== false && v !== 0 && !(Array.isArray(v) && !v.length)));

// A task someone can check by hand that has no call stack yet, most recently worked on first. A result of
// the owner's check commands covers a folder, so it does not stand in for a check of the task itself.
const worked = list(data.commits).map((c) => c.task);
const lastWorked = (t) => (worked.includes(t.id) ? worked.indexOf(t.id) : worked.length);
const callsMissing = list(data.tasks)
  .filter((t) => (t.status === 'done' || t.status === 'in-progress') && !list(t.calls).length && !list(t.verified).some((v) => v.by !== 'script'))
  .sort((a, b) => lastWorked(a) - lastWorked(b))
  .map((t) => t.id);

const digest = {
  project: data.project,
  update: data.update,
  plan: data.plan,
  next: data.next,
  milestones: list(data.milestones).map((m) => lean({ id: m.id, name: m.name, proposed: m.proposed, tasks: m.tasks })),
  parts: list(data.parts).map((p) => lean({ id: p.id, name: p.name, status: p.status, waitingShort: p.waitingShort, tasks: p.tasks })),
  tasks: list(data.tasks).map((t) => lean({
    id: t.id, label: t.label === t.id ? undefined : t.label, name: t.name, status: t.status, part: t.part, milestone: t.milestone,
    needs: t.needs, unlocks: t.unlocks, decisions: t.decisions, waitingOn: t.waitingOn,
    work: list(t.work).map((w) => lean({ state: w.state, commits: list(w.commits).map((c) => c.hash), pushed: w.pushed, worktree: w.worktree, files: list(w.files).length })),
    outcome: Boolean(t.outcome), calls: list(t.calls).length, verified: list(t.verified).map((v) => (v.by === 'script' ? `${v.result} (script)` : v.result)),
  })),
  decisions: list(data.decisions).map((d) => lean({ id: d.id, question: d.question, options: d.options, default: d.default, answer: d.answer, readOnly: d.readOnly, waiting: d.waiting })),
  rules: list(data.rules).map((r) => lean({ id: r.id, fn: r.fn, at: r.at, part: r.part, task: r.task, rule: r.rule, kept: r.kept, removed: r.change === 'removed' })),
  settings: data.settings,
  findings: list(data.findings),
  checks: list(data.checks).map((c) => `${c.name}: ${c.result} at ${c.at}`),
  callsMissing,
  commits: list(data.commits).map((c) => [c.hash || 'uncommitted', c.task].filter(Boolean).join(' ')),
  alsoHolds: lean({
    decided: list(data.decided).length, panels: list(data.panels).map((p) => p.title),
    scope: data.scope && data.scope.title, unassigned: list(data.unassigned && data.unassigned.files).map((f) => f.path),
  }),
};

// One item to a line: short enough to scan, and nothing is spent on indentation.
const rows = Object.entries(lean(digest)).map(([key, value]) => (Array.isArray(value) && value.length && typeof value[0] === 'object'
  ? `"${key}": [\n${value.map((v) => ` ${JSON.stringify(v)}`).join(',\n')}\n]`
  : `"${key}": ${JSON.stringify(value)}`));
console.log(`{\n${rows.join(',\n')}\n}`);
