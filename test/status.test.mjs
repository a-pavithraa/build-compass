import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repo, tempDir, write, commit, run, writeMap } from './helpers.mjs';

function project(t) {
  const dir = repo(t);
  write(dir, 'a.txt', 'a\n');
  const head = commit(dir, 'start');
  const file = writeMap(dir, {
    project: 'Slotbook',
    update: { version: 3, readAt: '2026-10-07 21:00 +05:30', readAtShort: '7 Oct 2026, 21:00', commit: head, changed: ['P2'] },
    next: { step: 'Commit the double-booking check', reason: 'It exists only in the working tree.' },
    milestones: [
      { id: 'M1', name: 'A customer can book', tasks: ['T1'] },
      { id: 'M2', name: 'Reminders go out', proposed: true, tasks: ['T2', 'T3'] },
    ],
    parts: [
      { id: 'P1', name: 'Booking', status: 'done', reason: 'r', tasks: ['T1'] },
      { id: 'P2', name: 'Text reminders', status: 'stuck', reason: 'r', waitingShort: 'the provider approving the sender', tasks: ['T2', 'T3'] },
    ],
    tasks: [
      { id: 'T1', name: 'Book a slot', status: 'done' },
      { id: 'T2', name: 'Send a text', status: 'stuck', waitingOn: 'provider' },
      { id: 'T3', name: 'Retry a text', status: 'done' },
    ],
    decisions: [
      { id: 'D1', question: 'When does the reminder go out?', default: 'The day before', answer: null },
      { id: 'D2', question: 'Retry?', readOnly: true, default: 'Once' },
      { id: 'D3', question: 'Answered already?', answer: 'Yes' },
    ],
    findings: [{ title: 'f' }],
  });
  return { dir, file };
}

test('prints the next milestone, next step, what changed, what is stuck and the open decisions', (t) => {
  const { file } = project(t);
  const { code, stdout } = run('status.mjs', [file]);
  assert.equal(code, 0);
  assert.match(stdout, /^Slotbook: map version 3, read 7 Oct 2026, 21:00 at \w+; up to date with git\./);
  assert.match(stdout, /Next milestone: Reminders go out \(proposed\), 1 of 2 items left\./);
  assert.match(stdout, /Next step: Commit the double-booking check \(It exists only in the working tree\.\)/);
  assert.match(stdout, /Changed since the last map: Text reminders\./);
  assert.match(stdout, /Stuck: Text reminders, waiting on the provider approving the sender\./);
  assert.match(stdout, /Open decision D1: When does the reminder go out\? \(if unanswered: The day before\)/);
  assert.match(stdout, /Waiting for you in the plan: Retry\? \(proposed: Once\)/);
  assert.doesNotMatch(stdout, /Answered already/);
  assert.match(stdout, /1 finding on the map/);
});

test('says how far the map is behind git', (t) => {
  const { dir, file } = project(t);
  commit(dir, 'later');
  write(dir, 'b.txt', 'b\n');
  const { stdout } = run('status.mjs', [file]);
  assert.match(stdout, /1 commit behind HEAD \(\w+\), 1 file changed since/);
  assert.match(stdout, /The map is behind the code/);
});

test('as a session-start hook it is silent while the map is current and speaks once it is behind', (t) => {
  const { dir } = project(t);
  const hook = () => run('status.mjs', ['--session-start'], { env: { CLAUDE_PROJECT_DIR: dir } });
  assert.deepEqual(hook(), { code: 0, stdout: '', stderr: '' });
  commit(dir, 'later');
  const out = JSON.parse(hook().stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /1 commit behind HEAD.*mapping-progress/);
});

test('with no map, the summary says so and the hook stays silent', (t) => {
  const dir = tempDir(t);
  assert.match(run('status.mjs', [], { cwd: dir, env: { CLAUDE_PROJECT_DIR: '' } }).stdout, /No map yet/);
  assert.deepEqual(run('status.mjs', ['--session-start'], { env: { CLAUDE_PROJECT_DIR: dir } }), { code: 0, stdout: '', stderr: '' });
});
