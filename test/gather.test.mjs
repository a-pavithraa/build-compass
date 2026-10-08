import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repo, tempDir, git, write, commit, run, writeMap } from './helpers.mjs';

const gather = (cwd, ...args) => {
  const result = run('gather.mjs', args, { cwd });
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const byPath = (files) => Object.fromEntries(files.map((f) => [f.path, f]));

test('outside a git repository it says so', (t) => {
  assert.deepEqual(gather(tempDir(t)), { git: false, note: 'Not a git repository.' });
});

test('an empty repository has no commits and lists untracked files', (t) => {
  const dir = repo(t);
  write(dir, 'a.txt', 'one\ntwo\n');
  const out = gather(dir);
  assert.equal(out.head, null);
  assert.equal(out.pushNote, 'No commits yet.');
  assert.deepEqual(out.uncommitted, [{ path: 'a.txt', kind: 'new', removed: 0, added: 2, note: 'Untracked; lines counted from the file.' }]);
});

test('commits list new, edited, renamed and deleted files with line counts', (t) => {
  const dir = repo(t);
  write(dir, 'src/a.js', 'a\nb\nc\n');
  write(dir, 'old.txt', 'x\n');
  const first = commit(dir, 'T1: first');
  git(dir, 'mv', 'src/a.js', 'src/b.js');
  git(dir, 'rm', '-q', 'old.txt');
  write(dir, 'src/new.js', 'n\n');
  write(dir, 'src/b.js', 'a\nb\nc\nd\n');
  commit(dir, 'T2: move things');

  const out = gather(dir, '--since', first);
  assert.equal(out.commits.length, 1);
  assert.equal(out.commits[0].subject, 'T2: move things');
  const files = byPath(out.commits[0].files);
  assert.deepEqual(files['src/b.js'], { path: 'src/b.js', kind: 'renamed', from: 'src/a.js', added: 1, removed: 0 });
  assert.equal(files['old.txt'].kind, 'deleted');
  assert.equal(files['src/new.js'].kind, 'new');
  assert.equal(out.pushNote, 'Not pushed: the repo has no remote.');
  assert.equal(out.commits[0].pushed, false);
});

test('uncommitted work counts tracked edits and untracked text and binary files, skipping the map folder', (t) => {
  const dir = repo(t);
  write(dir, 'a.txt', 'one\n');
  commit(dir, 'start');
  write(dir, 'a.txt', 'one\ntwo\n');
  write(dir, 'notes.md', 'x\ny');
  writeFileSync(join(dir, 'logo.bin'), Buffer.from([0, 1, 2]));
  write(dir, '.project-map/map-data.js', 'window.PROJECT_MAP = {};');
  const files = byPath(gather(dir).uncommitted);
  assert.deepEqual(Object.keys(files).sort(), ['a.txt', 'logo.bin', 'notes.md']);
  assert.equal(files['a.txt'].kind, 'edited');
  assert.equal(files['notes.md'].added, 2);
  assert.equal(files['logo.bin'].added, null);
});

test('an unknown --since falls back to the latest commits and says why', (t) => {
  const dir = repo(t);
  commit(dir, 'only');
  const out = gather(dir, '--since', 'deadbee');
  assert.match(out.sinceNote, /deadbee was not found/);
  assert.equal(out.commits.length, 1);
});

test('with no --since, an update starts from the commit the map was read at', (t) => {
  const dir = repo(t);
  const mapped = commit(dir, 'mapped');
  commit(dir, 'after the map');
  assert.equal(gather(dir).commits.length, 2, 'with no map, the latest commits');
  writeMap(dir, { update: { commit: mapped } });
  const out = gather(dir);
  assert.equal(out.since, mapped);
  assert.deepEqual(out.commits.map((c) => c.subject), ['after the map']);
});

test('a commit pushed to a remote counts as pushed even when the branch has no upstream', (t) => {
  const bare = tempDir(t);
  git(bare, 'init', '-q', '--bare');
  const dir = repo(t);
  commit(dir, 'shared');
  git(dir, 'remote', 'add', 'backup', bare);
  git(dir, 'push', '-q', 'backup', 'HEAD:refs/heads/main');
  commit(dir, 'local only');
  const out = gather(dir);
  assert.deepEqual(out.commits.map((c) => [c.subject, c.pushed]), [['local only', false], ['shared', true]]);
  assert.match(out.pushNote, /1 commit on \S+ is on no remote/);
  git(dir, 'push', '-q', 'backup', 'HEAD:refs/heads/main');
  assert.match(gather(dir).pushNote, /Every commit is on a remote \(backup\/main\)/);
});

test('work in another worktree shows its commits ahead and its uncommitted files', (t) => {
  const dir = repo(t);
  write(dir, 'a.txt', 'a\n');
  commit(dir, 'start');
  const other = join(tempDir(t), 'wt');
  git(dir, 'worktree', 'add', '-q', '-b', 'ticket-2', other);
  write(other, 'list.js', 'l\n');
  commit(other, '2.1: list');
  write(other, 'list.js', 'l\nm\n');
  const [wt] = gather(dir).worktrees;
  assert.equal(wt.branch, 'ticket-2');
  assert.equal(wt.mergedIntoHead, false);
  assert.deepEqual(wt.commitsAhead.map((c) => c.subject), ['2.1: list']);
  assert.deepEqual(wt.uncommitted.map((f) => [f.path, f.kind]), [['list.js', 'edited']]);
});

test('the fingerprint is stable, changes with any edit, and ignores the map folders', (t) => {
  const dir = repo(t);
  write(dir, 'a.txt', 'a\n');
  commit(dir, 'start');
  write(dir, 'wip.txt', 'w\n');
  const first = gather(dir).fingerprint;
  assert.match(first, /^[0-9a-f]{16}$/);
  assert.equal(gather(dir).fingerprint, first, 'the same tree gives the same fingerprint');
  write(dir, '.project-map/map-data.js', 'window.PROJECT_MAP = {};');
  write(dir, '.grill/grill-data.js', 'window.GRILL = {};');
  assert.equal(gather(dir).fingerprint, first, 'the map folders are left out');
  write(dir, 'wip.txt', 'w2\n');
  const edited = gather(dir).fingerprint;
  assert.notEqual(edited, first, 'editing an untracked file changes it');
  write(dir, 'a.txt', 'b\n');
  assert.notEqual(gather(dir).fingerprint, edited, 'editing a tracked file changes it');
});
