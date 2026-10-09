import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { repo, tempDir, write, commit, run, writeMap, git, MAP } from './helpers.mjs';

const read = (file) => {
  const text = readFileSync(file, 'utf8');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
};

// A project whose map was read at HEAD with one task's work still uncommitted in check.js.
function project(t) {
  const dir = repo(t);
  write(dir, 'a.js', 'export const a = 1;\n');
  const head = commit(dir, 'start');
  write(dir, 'check.js', 'export const check = () => true;\n');
  const facts = JSON.parse(run('gather.mjs', [], { cwd: dir }).stdout);
  const file = writeMap(dir, {
    project: 'Slotbook',
    update: { version: 3, readAt: facts.readAt, readAtShort: facts.readAtShort, commit: head, fingerprint: facts.fingerprint, uncommittedWork: true },
    next: { step: 'Commit the check' },
    parts: [{ id: 'P1', name: 'Booking', status: 'in-progress', reason: 'r', tasks: ['T3'] }],
    tasks: [{
      id: 'T3', label: 'T3', name: 'Refuse a booked slot', part: 'P1', status: 'in-progress',
      work: [{ state: 'uncommitted', description: 'The check exists in the working tree.', commits: [], files: [{ path: 'check.js', kind: 'new', added: 1, removed: 0, note: 'Untracked; lines counted from the file.' }] }],
    }],
    commits: [{ hash: null, date: 'read today', subject: 'Uncommitted: the check', task: 'T3' }, { hash: head, date: '2026-10-07 21:00', subject: 'start' }],
  });
  return { dir, file, head };
}

test('uncommitted work that is committed becomes committed work, and the map stands at HEAD', (t) => {
  const { dir, file, head: start } = project(t);
  const head = commit(dir, 'add the check');
  const out = run('refresh.mjs', [], { cwd: dir });
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /T3: its uncommitted work is now committed/);

  const data = read(file);
  const [work] = data.tasks[0].work;
  assert.equal(work.state, 'committed');
  assert.deepEqual(work.commits.map((c) => c.hash), [head]);
  assert.equal(work.files[0].note, undefined);
  assert.equal(data.tasks[0].status, 'in-progress', 'a status is the agent\'s to change');
  assert.deepEqual(data.commits.map((c) => [c.hash, c.task]), [[head, 'T3'], [start, undefined]]);
  assert.equal(data.update.commit, head);
  assert.equal(data.update.uncommittedWork, false);
  assert.equal(data.update.unread, undefined);
  assert.equal(data.update.version, 3);
  assert.match(run('status.mjs', [file]).stdout, /up to date with git/);
});

test('a commit and a file no task holds are counted as unread, and the map stays where it was read', (t) => {
  const { dir, file, head } = project(t);
  write(dir, 'b.js', 'export const b = 2;\n');
  git(dir, 'add', 'b.js');
  git(dir, 'commit', '-q', '-m', 'T3: something the map has not read');
  write(dir, 'c.js', 'export const c = 3;\n');
  assert.equal(run('refresh.mjs', [], { cwd: dir }).code, 0);

  const data = read(file);
  assert.equal(data.update.commit, head);
  assert.deepEqual({ commits: data.update.unread.commits, files: data.update.unread.files }, { commits: 1, files: 1 });
  assert.equal(data.tasks[0].work[0].state, 'uncommitted');
  assert.equal(data.commits[1].task, 'T3', 'a message that starts with a task\'s label places the commit');
  assert.match(run('status.mjs', [file]).stdout, /out of date with the code/);
});

test('a second run with nothing new leaves the file alone', (t) => {
  const { dir, file } = project(t);
  commit(dir, 'add the check');
  run('refresh.mjs', [], { cwd: dir });
  const written = statSync(file).mtimeMs;
  const out = run('refresh.mjs', [], { cwd: dir });
  assert.match(out.stdout, /Nothing to refresh: the map is up to date with git/);
  assert.equal(statSync(file).mtimeMs, written);
});

test('a pushed commit is marked pushed', (t) => {
  const { dir, file } = project(t);
  const head = commit(dir, 'add the check');
  run('refresh.mjs', [], { cwd: dir });
  assert.equal(read(file).tasks[0].work[0].pushed, false);

  const remote = tempDir(t);
  git(remote, 'init', '-q', '--bare');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', 'origin', 'HEAD:main');
  const out = run('refresh.mjs', [], { cwd: dir });
  assert.match(out.stdout, /now pushed/);
  const data = read(file);
  assert.equal(data.tasks[0].work[0].pushed, true);
  assert.equal(data.commits.find((c) => c.hash === head).pushed, true);
});

test('an update by the agent ends what the refresh said was unread', (t) => {
  const { dir, file } = project(t);
  write(dir, 'b.js', 'export const b = 2;\n');
  const head = commit(dir, 'two things at once');
  run('refresh.mjs', [], { cwd: dir });
  assert.ok(read(file).update.unread);
  write(dir, '.project-map/map-patch.json', JSON.stringify({ set: { update: { commit: head, readAt: '2026-10-08 09:40 +05:30' } } }));
  assert.match(run('refresh.mjs', [], { cwd: dir }).stdout, /update of the map is in progress/);
  const merged = run('merge.mjs', [join(dir, '.project-map')]);
  assert.equal(merged.code, 0, merged.stderr);
  assert.equal(read(file).update.unread, undefined);
  assert.equal(read(file).update.refreshed, undefined);
});

test('as a hook it acts only after a git command, and never fails', (t) => {
  const { dir, file } = project(t);
  commit(dir, 'add the check');
  const hook = (command) => spawnSync(process.execPath, [join(MAP, 'refresh.mjs'), '--hook'], {
    cwd: dir, encoding: 'utf8', input: JSON.stringify({ tool_input: { command } }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  const idle = hook('npm test');
  assert.equal(idle.status, 0);
  assert.equal(read(file).tasks[0].work[0].state, 'uncommitted');
  const after = hook('git add -A && git commit -m "add the check"');
  assert.deepEqual([after.status, after.stdout], [0, '']);
  assert.equal(read(file).tasks[0].work[0].state, 'committed');
});
