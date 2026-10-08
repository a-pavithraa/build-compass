import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repo, tempDir, write, commit, run, writeMap, git } from './helpers.mjs';

// A project whose map was read at HEAD, with one uncommitted file the map already knows about.
function project(t) {
  const dir = repo(t);
  write(dir, 'a.txt', 'a\n');
  const head = commit(dir, 'start');
  write(dir, 'wip.txt', 'known uncommitted work\n');
  const { fingerprint } = JSON.parse(run('gather.mjs', [], { cwd: dir }).stdout);
  const file = writeMap(dir, {
    project: 'Slotbook',
    update: { version: 3, readAt: '2026-10-07 21:00 +05:30', readAtShort: '7 Oct 2026, 21:00', commit: head, fingerprint, changed: ['P2'] },
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

test('uncommitted work the map already recorded does not make it stale', (t) => {
  const { file } = project(t);
  const { stdout } = run('status.mjs', [file]);
  assert.match(stdout, /up to date with git/);
  assert.doesNotMatch(stdout, /out of date/);
});

test('a later commit makes the map stale', (t) => {
  const { dir, file } = project(t);
  commit(dir, 'later');
  assert.match(run('status.mjs', [file]).stdout, /1 commit behind HEAD \(\w+\)[\s\S]*out of date with the code/);
});

test('checking out an older commit makes the map stale', (t) => {
  const dir = repo(t);
  write(dir, 'a.txt', 'a\n');
  commit(dir, 'one');
  write(dir, 'a.txt', 'b\n');
  const newer = commit(dir, 'two');
  const file = writeMap(dir, { project: 'X', update: { readAt: 'now', commit: newer }, next: { step: 's' }, parts: [{ id: 'P1', name: 'p', status: 'done', reason: 'r' }] });
  assert.match(run('status.mjs', [file]).stdout, /up to date with git/);
  git(dir, 'checkout', '-q', 'HEAD~1');
  assert.match(run('status.mjs', [file]).stdout, new RegExp(`drawn at ${newer}, 1 commit newer than the checked-out \\w+`));
});

test('editing after the map was read makes it stale', (t) => {
  const { dir, file } = project(t);
  write(dir, 'wip.txt', 'edited after the map was read\n');
  assert.match(run('status.mjs', [file]).stdout, /the uncommitted work has changed since it was read/);
});

test('as a session-start hook it is silent while the map is current and speaks once it is stale', (t) => {
  const { dir } = project(t);
  const hook = () => run('status.mjs', ['--session-start'], { env: { CLAUDE_PROJECT_DIR: dir } });
  assert.deepEqual(hook(), { code: 0, stdout: '', stderr: '' });
  write(dir, 'new.txt', 'a new file\n');
  const out = JSON.parse(hook().stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /uncommitted work has changed.*mapping-progress/);
});

test('with no map, the summary says so and the hook stays silent', (t) => {
  const dir = tempDir(t);
  assert.match(run('status.mjs', [], { cwd: dir, env: { CLAUDE_PROJECT_DIR: '' } }).stdout, /No map yet/);
  assert.deepEqual(run('status.mjs', ['--session-start'], { env: { CLAUDE_PROJECT_DIR: dir } }), { code: 0, stdout: '', stderr: '' });
});
