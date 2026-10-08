import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repo, write, commit, run, writeMap } from './helpers.mjs';

function project(t) {
  const dir = repo(t);
  write(dir, 'src/a.js', 'a\n');
  const first = commit(dir, 'T1: add a');
  write(dir, 'src/b.js', 'b\n');
  const head = commit(dir, 'T2: add b');
  const file = writeMap(dir, {
    project: 'Test', update: { version: 4, readAt: '2026-10-07 21:00 +05:30', commit: first, changed: ['P1'], testsRun: true },
    next: { step: 'Build b', open: 'T2' },
    milestones: [{ id: 'M1', name: 'First release', tasks: ['T1', 'T2', 'T3'] }],
    parts: [{ id: 'P1', name: 'Part', status: 'in-progress', reason: 'Some of it is built.', tasks: ['T1', 'T2', 'T3'] }],
    tasks: [
      { id: 'T1', name: 'Add a', status: 'done', part: 'P1', milestone: 'M1', reason: 'Committed.',
        work: [{ state: 'committed', description: 'Adds a.', commits: [{ hash: first }], files: [{ path: 'src/a.js', kind: 'new' }] }] },
      { id: 'T2', name: 'Add b', status: 'not-started', part: 'P1', milestone: 'M1', needs: ['T1'], unlocks: ['T3'] },
      { id: 'T3', name: 'Add c', status: 'not-started', part: 'P1', milestone: 'M1', needs: ['T2'] },
    ],
    decisions: [{ id: 'D1', question: 'Ship c?', default: 'No', waiting: ['T3'] }],
    findings: [{ title: 'No tests', text: 'Nothing is tested.', refs: ['T3'] }, { title: 'Kept', text: 'Still true.' }],
    commits: [{ hash: null, subject: 'Uncommitted: b' }, { hash: first, subject: 'T1: add a', task: 'T1' }],
  });
  return { dir, first, head, file, mapDir: join(dir, '.project-map') };
}

const read = (file) => {
  const text = readFileSync(file, 'utf8');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
};
const merge = (p, patch) => {
  write(p.dir, '.project-map/map-patch.json', JSON.stringify(patch));
  return run('merge.mjs', [p.mapDir]);
};

test('the digest lists every item on one line and prints one item in full on request', (t) => {
  const p = project(t);
  const { stdout, code } = run('digest.mjs', [p.file]);
  assert.equal(code, 0);
  const digest = JSON.parse(stdout);
  assert.deepEqual(digest.tasks[0], { id: 'T1', name: 'Add a', status: 'done', part: 'P1', milestone: 'M1', work: [{ state: 'committed', commits: [p.first], files: 1 }] });
  assert.equal(digest.tasks[0].reason, undefined, 'the digest leaves the long fields out');
  assert.deepEqual(digest.commits, ['uncommitted', `${p.first} T1`]);
  assert.equal(digest.update.testsRun, true);
  assert.equal(digest.findings.length, 2);
  assert.ok(stdout.split('\n').some((line) => line.startsWith(' {"id":"T2"')), 'one item to a line');

  assert.equal(JSON.parse(run('digest.mjs', [p.file, '--item', 'T1']).stdout).reason, 'Committed.');
  assert.deepEqual(JSON.parse(run('digest.mjs', [p.file, '--item', 'next']).stdout), { step: 'Build b', open: 'T2' });
  assert.equal(run('digest.mjs', [p.file, '--item', 'T9']).code, 1);
});

test('a patch changes, adds and removes items, and the old data is filed under history', (t) => {
  const p = project(t);
  const result = merge(p, {
    set: { update: { readAt: '2026-10-08 09:00 +05:30', commit: p.head, changed: ['P1', 'T3'] }, next: { step: 'Start d', open: 'T4' } },
    items: [
      { id: 'T2', status: 'done', needs: null, reason: 'Committed.',
        work: [{ state: 'committed', description: 'Adds b.', commits: [{ hash: p.head }], files: [{ path: 'src/b.js', kind: 'new' }] }] },
      { id: 'T4', in: 'tasks', name: 'Add d', status: 'not-started', part: 'P2', milestone: 'M1' },
      { id: 'P2', in: 'parts', name: 'Second part', status: 'not-started', reason: 'Nothing yet.' },
    ],
    remove: ['T3'],
    add: { findings: [{ title: 'New', text: 'Found today.', refs: ['T4'] }], commits: [{ hash: p.head, subject: 'T2: add b', task: 'T2' }] },
    drop: { findings: ['No tests'] },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ok: 2 parts, 3 tasks/);
  assert.match(result.stdout, /merged: map version 5/);

  const data = read(p.file);
  const task = (id) => data.tasks.find((x) => x.id === id);
  assert.equal(task('T2').status, 'done');
  assert.equal(task('T2').name, 'Add b', 'fields the patch does not name are kept');
  assert.ok(!('needs' in task('T2')), 'null removes a field');
  assert.deepEqual(task('T2').unlocks, [], 'a removed id leaves every list that named it');
  assert.equal(task('T3'), undefined);
  assert.deepEqual(data.parts.map((x) => [x.id, x.tasks]), [['P1', ['T1', 'T2']], ['P2', ['T4']]], 'a new task joins the part it names');
  assert.deepEqual(data.milestones[0].tasks, ['T1', 'T2', 'T4']);
  assert.deepEqual(data.decisions[0].waiting, []);
  assert.deepEqual(data.findings.map((f) => f.title), ['Kept', 'New']);
  assert.deepEqual(data.commits.map((c) => c.hash), [p.head, p.first], 'new commits lead and the old uncommitted entry goes');
  assert.deepEqual(data.update.changed, ['P1'], 'update.changed drops the removed id too');
  assert.equal(data.update.first, false);
  assert.equal(data.update.testsRun, true, 'update is laid over the previous one, so a field the patch leaves out is kept');
  assert.equal(data.update.commit, p.head);

  const history = readdirSync(join(p.mapDir, 'history'));
  assert.equal(history.length, 1);
  assert.equal(data.update.previous, `history/${history[0]}`);
  assert.equal(read(join(p.mapDir, 'history', history[0])).update.version, 4);
  assert.ok(!existsSync(join(p.mapDir, 'map-patch.json')), 'a merged patch is removed');
});

test('a patch the checker refuses changes nothing', (t) => {
  const p = project(t);
  const before = readFileSync(p.file, 'utf8');
  const invented = merge(p, { items: [{ id: 'T2', status: 'done', work: [{ state: 'committed', description: 'Adds b.', commits: [{ hash: 'abc1234' }] }] }] });
  assert.equal(invented.code, 1);
  assert.match(invented.stderr, /commit "abc1234" is not in this repository/);
  assert.match(invented.stderr, /The map is unchanged/);
  assert.equal(readFileSync(p.file, 'utf8'), before);
  assert.ok(existsSync(join(p.mapDir, 'map-patch.json')), 'the patch stays, to be fixed');
  assert.ok(!existsSync(join(p.mapDir, 'map-data.next.js')) && !existsSync(join(p.mapDir, 'history')));

  for (const [patch, problem] of [
    [{ items: [{ id: 'T9', name: 'Nowhere' }] }, /item "T9" is new, so it must say where it goes/],
    [{ remove: ['T9'] }, /remove names "T9", which does not exist/],
    [{ drop: { findings: ['Never written'] } }, /findings has no entry titled "Never written"/],
    [{ tasks: [] }, /keys merge\.mjs does not know: tasks/],
  ]) {
    const refused = merge(p, patch);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, problem);
    assert.equal(readFileSync(p.file, 'utf8'), before);
  }
});
