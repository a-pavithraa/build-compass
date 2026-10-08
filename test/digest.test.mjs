import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDir, run, writeMap } from './helpers.mjs';

const CALLS = [{ fn: 'POST /bookings', at: 'src/routes.js:14', depth: 0 }];
const digestOf = (t, data) => {
  const result = run('digest.mjs', [writeMap(tempDir(t), data)]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test('the digest names the tasks still waiting for a call stack, most recently worked on first', (t) => {
  const digest = digestOf(t, {
    project: 'Test',
    tasks: [
      { id: 'T1', name: 'Oldest', status: 'done' },
      { id: 'T2', name: 'Has calls', status: 'done', calls: CALLS },
      { id: 'T3', name: 'Checked by hand', status: 'done', verified: [{ check: 'Seen in the browser', result: 'passed' }] },
      { id: 'T4', name: 'Checked by a command only', status: 'done', verified: [{ check: 'Server tests', result: 'passed', by: 'script' }] },
      { id: 'T5', name: 'Newest', status: 'in-progress' },
      { id: 'T6', name: 'Not begun', status: 'not-started' },
      { id: 'T7', name: 'No commit', status: 'done' },
    ],
    commits: [{ hash: null, task: 'T5' }, { hash: 'ccc3333', task: 'T4' }, { hash: 'bbb2222', task: 'T1' }, { hash: 'aaa1111', task: 'T4' }],
  });
  assert.deepEqual(digest.callsMissing, ['T5', 'T4', 'T1', 'T7']);
});

test('the digest leaves the list out when every task has its call stack', (t) => {
  const digest = digestOf(t, { project: 'Test', tasks: [{ id: 'T1', name: 'Done', status: 'done', calls: CALLS }] });
  assert.equal('callsMissing' in digest, false);
});
