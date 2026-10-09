#!/usr/bin/env node
// Brings a map's facts up to date with git without the agent: the facts that need no judgment.
// Run it from the project root.
//   node refresh.mjs             refresh, and say in one line what changed
//   node refresh.mjs --checks    run the owner's check commands first, and attach what they said
//   node refresh.mjs --quiet     say nothing (a session's start)
//   node refresh.mjs --hook      as a hook after a shell command: acts only when the command was a git one
//
// It does four things, and writes nothing a model would have to decide:
//   - a task's uncommitted work whose files are now all committed becomes committed work, with its commits;
//   - new commits join the list of commits, under a task when its work or its label names one;
//   - every commit on the map says whether it is pushed, as of the last fetch;
//   - the map says how far it is behind: the commits and changed files no update has read.
// When nothing is left unread, the map counts as read at HEAD. Statuses, reasons, rules and the next
// step are never touched: those wait for the agent.
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSaved, attach } from './checks.mjs';

const argv = process.argv.slice(2);
const hook = argv.includes('--hook');
const quiet = hook || argv.includes('--quiet');
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const mapDir = join(root, '.project-map');
const dataFile = join(mapDir, 'map-data.js');
const nextFile = join(mapDir, 'map-data.next.js');
const here = dirname(fileURLToPath(import.meta.url));
const COMMITS_KEEP = 20;
const PUSH_LOOKUPS = 60;
// A hook has ten seconds for everything, so reading git gets half of that there.
const QUIET_MS = 5000;
const list = (v) => (Array.isArray(v) ? v : []);
const say = (line) => { if (!quiet) console.log(line); };
// A hook must never fail the command it follows, so there every way out is a quiet success.
const stop = (line) => { if (!quiet) console.error(`problem: ${line}`); process.exit(quiet ? 0 : 1); };

const MOVES_COMMITS = /\bgit\b[^|;&]*\b(commit|merge|pull|push|fetch|rebase|reset|cherry-pick|revert|am|switch|checkout|stash)\b/;
if (hook) {
  let command = '';
  try { command = String(JSON.parse(readFileSync(0, 'utf8')).tool_input.command || ''); } catch { /* no command to read: nothing to do */ }
  if (!MOVES_COMMITS.test(command)) process.exit(0);
}

if (!existsSync(dataFile)) {
  say('No map yet, so there is nothing to refresh.');
  process.exit(0);
}
if (existsSync(join(mapDir, 'map-patch.json'))) {
  say('An update of the map is in progress, so nothing was refreshed.');
  process.exit(0);
}

let data;
try {
  const text = readFileSync(dataFile, 'utf8');
  data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
} catch (err) {
  stop(`cannot read ${dataFile}: ${err.message}`);
}
const before = JSON.stringify({ ...data, update: { ...data.update, refreshed: undefined } });

const node = (script, args) => spawnSync(process.execPath, [join(here, script), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'], maxBuffer: 256e6, timeout: quiet ? QUIET_MS : undefined });
if (argv.includes('--checks')) {
  const ran = node('run-checks.mjs', []);
  if (ran.status !== 0) stop('the check commands could not be run');
}
let facts;
try {
  facts = JSON.parse(node('gather.mjs', []).stdout);
} catch (err) {
  stop(`gather.mjs gave nothing to read: ${err.message}`);
}
if (!facts.git) {
  say('Not a git repository, so there is nothing to refresh.');
  process.exit(0);
}

const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch {
    return null;
  }
};

const update = data.update || (data.update = {});
const records = list(data.tasks).flatMap((task) => list(task.work).map((work) => ({ task, work })));
const dirty = new Set(list(facts.uncommitted).map((f) => f.path));
// With a sinceNote the commit the map was read at is gone, and the commits listed are only the latest.
const fresh = facts.sinceNote ? [] : list(facts.commits);
const asCommit = ({ hash, date, subject, pushed, url }) => ({ hash, date, subject, pushed, ...(url ? { url } : {}) });
const did = [];

// Uncommitted work is settled when every one of its files is clean and in a commit made since the map was read.
const settled = new Set();
for (const { task, work } of records) {
  if (work.state !== 'uncommitted' || work.worktree) continue;
  const paths = list(work.files).map((f) => f.path).filter(Boolean);
  if (!paths.length || paths.some((path) => dirty.has(path))) continue;
  const mine = fresh.filter((c) => list(c.files).some((f) => paths.includes(f.path)));
  const committed = new Set(mine.flatMap((c) => list(c.files).map((f) => f.path)));
  if (!mine.length || paths.some((path) => !committed.has(path))) continue;
  work.state = 'committed';
  work.commits = mine.map(asCommit);
  work.pushed = mine.every((c) => c.pushed);
  work.link = `${work.link ? `${work.link.replace(/\.?$/, '.')} ` : ''}Committed since; matched to ${mine.map((c) => c.hash).join(', ')} by its files, with no agent.`;
  delete work.pushedNote;
  for (const f of list(work.files)) if (/^Untracked/.test(f.note || '')) delete f.note;
  settled.add(task.id);
  did.push(`${task.label || task.name}: its uncommitted work is now committed (${mine.map((c) => c.hash).join(', ')})`);
}

// A commit goes under the task whose work holds it, or the one its message starts with.
const owner = new Map();
for (const { task, work } of records) for (const c of list(work.commits)) if (c.hash && !owner.has(c.hash)) owner.set(c.hash, task.id);
const byLabel = new Map(list(data.tasks).flatMap((task) => [[task.id, task.id], ...(task.label ? [[task.label, task.id]] : [])]));
const named = (subject) => byLabel.get((/^[[(]?([\w.-]+)[\])]?[:\s]/.exec(subject || '') || [])[1]);
const listed = new Set(list(data.commits).map((c) => c.hash).filter(Boolean));
const added = fresh.filter((c) => !listed.has(c.hash)).map((c) => {
  const task = owner.get(c.hash) || named(c.subject);
  return { ...asCommit(c), ...(task ? { task } : {}) };
});
const stillOpen = new Set(records.filter(({ work }) => work.state === 'uncommitted').map(({ task }) => task.id));
const waiting = list(data.commits).filter((c) => !c.hash && !(settled.has(c.task) && !stillOpen.has(c.task)));
if (added.length || waiting.length !== list(data.commits).filter((c) => !c.hash).length) {
  data.commits = [...waiting, ...added, ...list(data.commits).filter((c) => c.hash)].slice(0, COMMITS_KEEP);
}

// Push state, as of the last fetch. Only a commit the map calls unpushed is asked about, and it counts
// as pushed when some remote branch holds it.
const everywhere = [...records.flatMap(({ work }) => (work.worktree ? [] : list(work.commits))), ...list(data.commits)].filter((c) => c.hash);
const unpushed = [...new Set(everywhere.filter((c) => !c.pushed).map((c) => c.hash))].slice(0, PUSH_LOOKUPS);
const nowPushed = new Map();
if (unpushed.length && git('remote')) {
  for (const hash of unpushed) {
    if (git('rev-list', '-n', '1', hash, '--not', '--remotes') === '') nowPushed.set(hash, git('rev-parse', hash));
  }
}
if (nowPushed.size) {
  for (const c of everywhere) {
    if (!nowPushed.has(c.hash) || c.pushed) continue;
    c.pushed = true;
    if (facts.github && nowPushed.get(c.hash)) c.url = `${facts.github}/commit/${nowPushed.get(c.hash)}`;
  }
  for (const { work } of records) {
    if (work.state !== 'committed' || work.worktree || work.pushed || !list(work.commits).every((c) => c.pushed)) continue;
    work.pushed = true;
    delete work.pushedNote;
  }
  did.push(`${nowPushed.size} commit${nowPushed.size === 1 ? ' is' : 's are'} now pushed`);
}
if (facts.pushNote) update.pushNote = facts.pushNote;

// What no update has read: commits with files in no task's work, and changed files the map does not hold.
// A commit is read only when every file in it belongs to a work record that names the commit.
const heldIn = new Map();
for (const { work } of records) {
  for (const c of list(work.commits)) {
    if (!heldIn.has(c.hash)) heldIn.set(c.hash, new Set());
    for (const f of list(work.files)) heldIn.get(c.hash).add(f.path);
  }
}
const unreadCommits = fresh.filter((c) => !heldIn.has(c.hash) || list(c.files).some((f) => !heldIn.get(c.hash).has(f.path)));
const held = new Set([
  ...records.filter(({ work }) => work.state === 'uncommitted').flatMap(({ work }) => list(work.files).map((f) => f.path)),
  ...list(data.unassigned && data.unassigned.files).map((f) => f.path),
]);
const unreadFiles = [...dirty].filter((path) => !held.has(path));
const sameCommit = Boolean(update.commit && facts.head) && (facts.head.startsWith(update.commit) || update.commit.startsWith(facts.head));
const asRead = sameCommit && (!update.fingerprint || update.fingerprint === facts.fingerprint);
const caughtUp = !facts.sinceNote && !unreadCommits.length && dirty.size === 0;

if (asRead || caughtUp) {
  delete update.unread;
  if (!asRead) {
    Object.assign(update, { commit: facts.head, fingerprint: facts.fingerprint, branch: facts.branch, uncommittedWork: false });
    did.push(`the map now stands at ${facts.head}`);
  }
} else if (facts.sinceNote) {
  update.unread = { note: facts.sinceNote, head: facts.head };
} else {
  update.unread = {
    commits: unreadCommits.length, files: unreadFiles.length, head: facts.head,
    ...(!unreadCommits.length && !unreadFiles.length ? { edited: true } : {}),
  };
}

if (argv.includes('--checks') && attach(data, readSaved(mapDir))) did.push('the check results are attached');

const behind = (() => {
  const u = update.unread;
  if (!u) return '';
  if (u.note) return 'the commit it was read at is gone';
  const parts = [];
  if (u.commits) parts.push(`${u.commits} commit${u.commits === 1 ? '' : 's'}`);
  if (u.files) parts.push(`${u.files} changed file${u.files === 1 ? '' : 's'}`);
  return parts.length ? `${parts.join(' and ')} not yet read by the agent` : 'the uncommitted work has changed since it was read';
})();

if (JSON.stringify({ ...data, update: { ...update, refreshed: undefined } }) === before) {
  say(`Nothing to refresh${behind ? `; ${behind}` : ': the map is up to date with git'}.`);
  process.exit(0);
}
update.refreshed = { at: facts.readAt, atShort: facts.readAtShort };

// Code moves under a map between updates, so the data as it stood may already fail a check, such as a
// call that is no longer near its line. Only a problem this refresh brought in stops it.
const problemsIn = (file) => {
  const checked = spawnSync(process.execPath, [join(here, 'check.mjs'), file], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  return checked.status === 0 ? [] : String(checked.stderr || 'problem: check.mjs could not run').split('\n').filter(Boolean);
};
const stood = new Set(problemsIn(dataFile));
writeFileSync(nextFile, `window.PROJECT_MAP = ${JSON.stringify(data, null, 2)};\n`);
const brought = problemsIn(nextFile).filter((problem) => !stood.has(problem));
if (brought.length) {
  rmSync(nextFile, { force: true });
  if (!quiet) console.error(brought.join('\n'));
  stop('the refreshed data did not pass check.mjs, so the map is unchanged');
}
renameSync(nextFile, dataFile);
say(`Refreshed: ${[...did, ...(behind ? [behind] : [])].join('; ') || 'the push state'}.`);
