import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { repo, tempDir, git, write, commit, run, writeMap } from './helpers.mjs';

function project(t) {
  const dir = repo(t);
  write(dir, 'src/a.js', 'a\n');
  const hash = commit(dir, 'T1: add a');
  git(dir, 'mv', 'src/a.js', 'src/renamed.js');
  const head = commit(dir, 'rename a');
  write(dir, 'src/wip.js', 'w\n');
  return { dir, hash, head };
}

function map({ hash, head }, change = (d) => d) {
  return change({
    project: 'Test', update: { readAt: '2026-10-07 21:00 +05:30', commit: head }, next: { step: 'Do the next thing' },
    parts: [{ id: 'P1', name: 'Part', status: 'in-progress', reason: 'Some of it is built.', tasks: ['T1', 'T2'] }],
    tasks: [
      { id: 'T1', name: 'Add a', status: 'done', part: 'P1',
        work: [{ state: 'committed', description: 'Adds a.', commits: [{ hash }], files: [{ path: 'src/a.js', kind: 'new', added: 1, removed: 0 }] }] },
      { id: 'T2', name: 'Work in progress', status: 'in-progress', part: 'P1',
        work: [{ state: 'uncommitted', description: 'Starts wip.', commits: [], files: [{ path: 'src/wip.js', kind: 'new', added: 1, removed: 0 }] }] },
    ],
    decisions: [], commits: [{ hash: head, subject: 'rename a' }, { hash, subject: 'T1: add a', task: 'T1' }],
  });
}

const check = (file) => run('check.mjs', [file]);

test('a map whose hashes and paths are real passes, including a file renamed since its commit', (t) => {
  const p = project(t);
  const result = check(writeMap(p.dir, map(p)));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ok: 1 parts, 2 tasks/);
});

test('an invented commit hash or file path is refused', (t) => {
  const p = project(t);
  const result = check(writeMap(p.dir, map(p, (d) => {
    d.tasks[0].work[0].commits[0].hash = 'abc1234';
    d.tasks[1].work[0].files.push({ path: 'src/ghost.js', kind: 'new' });
    d.commits.push({ hash: 'fffffff', subject: 'never happened' });
    d.update.commit = '1234567';
    return d;
  })));
  assert.equal(result.code, 1);
  for (const problem of ['commit "abc1234" is not in this repository', 'file "src/ghost.js"', '"fffffff" is not in this repository', 'update.commit "1234567"']) {
    assert.ok(result.stderr.includes(problem), `expected: ${problem}\n${result.stderr}`);
  }
});

test('uncommitted work in another worktree is looked for in that worktree', (t) => {
  const p = project(t);
  const other = join(tempDir(t), 'wt');
  git(p.dir, 'worktree', 'add', '-q', '-b', 'side', other);
  write(other, 'side.js', 's\n');
  const data = map(p, (d) => {
    d.tasks[1].work.push({ state: 'uncommitted', worktree: other, description: 'Side work.', commits: [], files: [{ path: 'side.js', kind: 'new' }] });
    return d;
  });
  assert.equal(check(writeMap(p.dir, data)).code, 0);
  delete data.tasks[1].work[1].worktree;
  assert.match(check(writeMap(p.dir, data)).stderr, /file "side.js" is neither on disk/);
});

test('structure: ids, statuses, stuck parts, plan decisions and approval', (t) => {
  const p = project(t);
  const result = check(writeMap(p.dir, map(p, (d) => {
    d.parts.push({ id: 'T1', name: 'Clash', status: 'stuck', reason: 'r' });
    d.tasks[0].status = 'finished';
    d.decisions.push({ id: 'D1', question: 'From the plan?', readOnly: true });
    d.plan = { file: '../plan.html', approval: 'maybe' };
    return d;
  })));
  assert.equal(result.code, 1);
  for (const problem of ['id "T1" is used by a task and a part', 'status must be one of', 'a stuck part must say what it is waitingOn', 'readOnly decision must say where it is answered', 'plan.approval must be']) {
    assert.ok(result.stderr.includes(problem), `expected: ${problem}\n${result.stderr}`);
  }
});

test('checks recorded on a task: a failed one keeps the task from being done', (t) => {
  const p = project(t);
  const passing = check(writeMap(p.dir, map(p, (d) => {
    d.tasks[0].verified = [{ check: 'npm test: 3 passed', result: 'passed', at: p.hash }];
    d.tasks[0].outcome = { before: 'There was no a.', now: 'There is an a.', tryIt: 'Open src/a.js.' };
    return d;
  })));
  assert.equal(passing.code, 0, passing.stderr);
  const failing = check(writeMap(p.dir, map(p, (d) => {
    d.tasks[0].verified = [{ check: 'npm test: 1 failed', result: 'failed' }, { result: 'unknown' }];
    return d;
  })));
  assert.equal(failing.code, 1);
  for (const problem of ['task T1 is done but a check on it failed', 'a verified entry has no check', 'verified.result must be']) {
    assert.ok(failing.stderr.includes(problem), `expected: ${problem}\n${failing.stderr}`);
  }
});

test('outside git the structure is still checked and the git checks are skipped with a note', (t) => {
  const dir = tempDir(t);
  const file = writeMap(dir, map({ hash: 'abc1234', head: 'abc1234' }));
  const result = check(file);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /not inside a git repository/);
});
