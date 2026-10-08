import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repo, git, write, commit, run, writeMap } from './helpers.mjs';

const PASSES = `node -e "console.log('3 passed')"`;
const FAILS = `node -e "console.log('1 failed');process.exit(1)"`;

function project(t, checks) {
  const dir = repo(t);
  write(dir, '.gitignore', '.project-map/\n');
  write(dir, 'server/a.js', 'a\n');
  write(dir, 'web/b.js', 'b\n');
  const head = commit(dir, 'T1 and T2');
  if (checks) write(dir, '.project-map/checks.json', JSON.stringify({ checks }));
  return { dir, head, mapDir: join(dir, '.project-map') };
}
const runChecks = (p, ...args) => {
  const result = run('run-checks.mjs', args, { cwd: p.dir });
  return { ...result, out: result.stdout ? JSON.parse(result.stdout) : null };
};
const read = (file) => {
  const text = readFileSync(file, 'utf8');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
};
const mapOf = (p) => ({
  project: 'Test', update: { version: 1, readAt: '2026-10-08 09:00 +05:30', commit: p.head }, next: { step: 'Go on' },
  parts: [{ id: 'P1', name: 'Part', status: 'done', reason: 'Built.', tasks: ['T1', 'T2'] }],
  tasks: [
    { id: 'T1', name: 'Server', status: 'done', part: 'P1',
      work: [{ state: 'committed', description: 'Adds a.', commits: [{ hash: p.head }], files: [{ path: 'server/a.js', kind: 'new' }] }] },
    { id: 'T2', name: 'Web', status: 'done', part: 'P1', verified: [{ check: 'Seen in the browser', result: 'passed', at: p.head }],
      work: [{ state: 'committed', description: 'Adds b.', commits: [{ hash: p.head }], files: [{ path: 'web/b.js', kind: 'new' }] }] },
  ],
});

test('with no list of checks, nothing runs', (t) => {
  const { out, code } = runChecks(project(t));
  assert.equal(code, 0);
  assert.equal(out.checks, false);
});

test('each listed command runs once per state of the code, and its last line is kept', (t) => {
  const p = project(t, [{ name: 'Server tests', run: PASSES, in: 'server' }, { name: 'Web tests', run: FAILS, in: 'web' }]);
  const first = runChecks(p);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(first.out.results.map((r) => [r.name, r.result, r.summary, r.reused, r.covers]),
    [['Server tests', 'passed', '3 passed', false, ['server/']], ['Web tests', 'failed', '1 failed', false, ['web/']]]);
  assert.equal(first.out.at, p.head);
  assert.match(first.stderr, /^Server tests: running, up to 300 s\nServer tests: passed in \d+ s\nWeb tests: running, up to 300 s\nWeb tests: failed in \d+ s\n$/, 'each check is announced as it starts and ends');

  const again = runChecks(p);
  assert.deepEqual(again.out.results.map((r) => r.reused), [true, true], 'nothing changed, so nothing runs again');
  assert.equal(again.stderr, 'Server tests: passed, reused from the last run\nWeb tests: failed, reused from the last run\n');
  assert.deepEqual(runChecks(p, '--force').out.results.map((r) => r.reused), [false, false]);

  write(p.dir, 'server/a.js', 'a changed\n');
  const edited = runChecks(p);
  assert.deepEqual(edited.out.results.map((r) => r.reused), [false, false], 'an edit makes the saved results stale');
  assert.equal(edited.out.at, `${p.head} plus uncommitted work`);
});

test('a list that git tracks is refused, and a command that overruns its time fails', (t) => {
  const slow = project(t, [{ name: 'Slow', run: `node -e "setTimeout(()=>{},20000)"`, timeoutSeconds: 1 }]);
  const overran = runChecks(slow);
  assert.deepEqual([overran.out.results[0].result, overran.out.results[0].summary, overran.out.results[0].covers], ['failed', 'timed out after 1 s', ['']]);

  const p = project(t, [{ name: 'Server tests', run: PASSES }]);
  git(p.dir, 'add', '-f', '.project-map/checks.json');
  const refused = runChecks(p);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /tracked by git/);
});

test('a passed check goes on the tasks it covers; a failed one is shown for the project only', (t) => {
  const p = project(t, [{ name: 'Server tests', run: PASSES, in: 'server' }, { name: 'Web tests', run: FAILS, in: 'web' }]);
  const file = writeMap(p.dir, mapOf(p));
  const attached = runChecks(p, '--attach');
  assert.equal(attached.code, 0, attached.stderr);
  assert.equal(attached.out.attached, true);
  assert.match(attached.out.check, /^ok: 1 parts, 2 tasks/m);

  let data = read(file);
  assert.deepEqual(data.checks.map((c) => [c.name, c.result, c.at]), [['Server tests', 'passed', p.head], ['Web tests', 'failed', p.head]]);
  assert.deepEqual(data.tasks[0].verified, [{ check: 'Server tests: 3 passed', result: 'passed', at: p.head, by: 'script' }]);
  assert.deepEqual(data.tasks[1].verified, [{ check: 'Seen in the browser', result: 'passed', at: p.head }], 'a failed suite touches no task, and other checks are kept');
  const status = run('status.mjs', [file]).stdout;
  assert.match(status, /Failing check: Web tests: 1 failed \(at /);

  write(p.dir, '.project-map/map-patch.json', JSON.stringify({ items: [{ id: 'T1', reason: 'Still built.' }] }));
  const merged = run('merge.mjs', [p.mapDir]);
  assert.equal(merged.code, 0, merged.stderr);
  data = read(file);
  assert.equal(data.tasks[0].verified.length, 1, 'an update attaches the same result once, not twice');

  write(p.dir, 'server/c.js', 'c\n');
  const later = commit(p.dir, 'more');
  write(p.dir, '.project-map/map-patch.json', JSON.stringify({ set: { update: { commit: later } } }));
  assert.equal(run('merge.mjs', [p.mapDir]).code, 0);
  assert.equal(read(file).tasks[0].verified[0].at, p.head, 'results from an older commit stay as they were, with the commit they ran at');
});
