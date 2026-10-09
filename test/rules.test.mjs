// Rules: what merge.mjs stamps on them, what check.mjs refuses, what the digest and the status
// summary say about them, and the callers read from a graphify graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repo, write, commit, run, writeMap } from './helpers.mjs';

const BOOKINGS = [
  'const bookings = new Map();',
  '',
  'export function confirmBooking(slot) {',
  "  if (bookings.has(slot)) return { ok: false, error: 'already-booked' };",
  '  bookings.set(slot, true);',
  '  return { ok: true };',
  '}',
  '',
].join('\n');

function project(t) {
  const dir = repo(t);
  write(dir, 'src/bookings.js', BOOKINGS);
  write(dir, 'test/bookings.test.js', "import { confirmBooking } from '../src/bookings.js';\n");
  write(dir, 'src/routes.js', 'export function route() {\n  return 1;\n}\n');
  const head = commit(dir, 'T1: confirm a booking');
  const file = writeMap(dir, {
    project: 'Slotbook', update: { version: 2, readAt: '2026-10-08 18:04 +05:30', commit: head }, next: { step: 'Send the email' },
    parts: [{ id: 'P1', name: 'Confirming a booking', status: 'done', reason: 'Committed with a test.', tasks: ['T1'] }],
    tasks: [{ id: 'T1', name: 'Confirm a booking', status: 'done', part: 'P1',
      work: [{ state: 'committed', description: 'Confirms a booking.', commits: [{ hash: head }],
        files: [{ path: 'src/bookings.js', kind: 'new' }, { path: 'test/bookings.test.js', kind: 'new' }] }] }],
    decisions: [],
  });
  return { dir, head, file, mapDir: join(dir, '.project-map') };
}

const read = (file) => {
  const text = readFileSync(file, 'utf8');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
};
const merge = (p, patch) => {
  write(p.dir, '.project-map/map-patch.json', JSON.stringify(patch));
  return run('merge.mjs', [p.mapDir]);
};
const rule = (fields = {}) => ({
  id: 'R1', in: 'rules', rule: 'A slot that is already booked cannot be booked again.',
  part: 'P1', task: 'T1', fn: 'confirmBooking()', at: 'src/bookings.js:4', ...fields,
});

test('merge.mjs says whether a rule is new or changed, what it was, its test and its version', (t) => {
  const p = project(t);
  const first = merge(p, { items: [rule(), rule({ id: 'R2', rule: 'A booking is kept until the shop closes.', fn: 'bookings.set', at: 'src/bookings.js:5', task: undefined })] });
  assert.equal(first.code, 0, first.stderr);
  let [r1, r2] = read(p.file).rules;
  assert.deepEqual([r1.change, r1.version, r1.test, r1.was], ['new', 3, 'test/bookings.test.js', undefined]);
  assert.equal(r2.test, null, 'a rule with no task has no test file to look in');

  assert.equal(merge(p, { items: [{ id: 'R1', rule: 'A booked slot is refused with already-booked.' }] }).code, 0);
  [r1, r2] = read(p.file).rules;
  assert.deepEqual([r1.change, r1.version, r1.was], ['changed', 4, 'A slot that is already booked cannot be booked again.']);
  assert.deepEqual([r2.change, r2.version], ['new', 3], 'a rule the patch leaves alone keeps its version');

  assert.equal(merge(p, { items: [{ id: 'R1', at: 'src/bookings.js:3' }] }).code, 0);
  assert.equal(read(p.file).rules[0].version, 4, 'a corrected line is not a changed rule');

  assert.equal(merge(p, { items: [{ id: 'R2', change: 'removed', commit: p.head, file: 'src/bookings.js', fn: null, at: null }] }).code, 0);
  r2 = read(p.file).rules[1];
  assert.deepEqual([r2.change, r2.version, 'test' in r2], ['removed', 6, false]);
});

test('check.mjs refuses a rule that is not where it says, an invented commit, and a sixth rule for one task', (t) => {
  const p = project(t);
  const before = readFileSync(p.file, 'utf8');
  for (const [items, problem] of [
    [[rule({ at: 'src/routes.js:1' })], /rule R1: "confirmBooking\(\)" is not within 5 lines of src\/routes\.js:1/],
    [[rule({ at: 'src/gone.js:1' })], /rule R1: "confirmBooking\(\)" is at src\/gone\.js:1, and that file is not on disk/],
    [[rule({ usedBy: [{ fn: 'cancel()', at: 'src/routes.js:1' }] })], /rule R1: caller "cancel\(\)" is not within 5 lines of src\/routes\.js:1/],
    [[rule({ fn: undefined })], /rule R1: fn \(the function that enforces it\) is missing/],
    [[rule({ task: 'T9' })], /rule R1: task names "T9", which does not exist/],
    [[rule({ fn: undefined, at: undefined, change: 'removed', commit: 'abc1234' })], /rule R1: commit "abc1234" is not in this repository/],
    [[rule({ fn: undefined, at: undefined, change: 'removed' })], /rule R1: a removed rule must name the commit that removed it/],
    [[1, 2, 3, 4, 5, 6].map((n) => rule({ id: `R${n}` })), /task T1 in map version 3 has 6 rules; a task gets 5 at most in one update/],
  ]) {
    const refused = merge(p, { items });
    assert.equal(refused.code, 1, `expected a refusal matching ${problem}`);
    assert.match(refused.stderr, problem);
    assert.equal(readFileSync(p.file, 'utf8'), before);
  }
  const callers = merge(p, { items: [rule({ usedBy: [{ fn: 'route()', at: 'src/routes.js:1' }] })] });
  assert.equal(callers.code, 0, callers.stderr);
});

test('the digest lists the rules so an update can use their ids, and the status summary names what changed', (t) => {
  const p = project(t);
  assert.equal(merge(p, { items: [rule(), rule({ id: 'R2', rule: 'A booking is kept.', at: 'src/bookings.js:3' }), rule({ id: 'R3', rule: 'Third.', at: 'src/bookings.js:3' })] }).code, 0);
  const digest = JSON.parse(run('digest.mjs', [p.file]).stdout);
  assert.deepEqual(digest.rules[0], { id: 'R1', fn: 'confirmBooking()', at: 'src/bookings.js:4', part: 'P1', task: 'T1', rule: 'A slot that is already booked cannot be booked again.' });
  assert.equal(JSON.parse(run('digest.mjs', [p.file, '--item', 'R1']).stdout).change, 'new');

  const status = run('status.mjs', [p.file]).stdout;
  assert.match(status, /Rules changed in this update: 3\. A slot that is already booked cannot be booked again; A booking is kept\./);

  assert.equal(merge(p, { items: [{ id: 'T1', reason: 'Still done.' }] }).code, 0);
  assert.doesNotMatch(run('status.mjs', [p.file]).stdout, /Rules changed/, 'an update that touches no rule says nothing about rules');
});

test('rules turned off in settings.json stay in the data, and the summary leaves them out', (t) => {
  const p = project(t);
  write(p.dir, '.project-map/settings.json', '{ "rules": false }');
  assert.equal(merge(p, { items: [rule()] }).code, 0);
  const data = read(p.file);
  assert.deepEqual(data.settings, { rules: false });
  assert.equal(data.rules.length, 1);
  assert.deepEqual(JSON.parse(run('digest.mjs', [p.file]).stdout).settings, { rules: false });
  assert.doesNotMatch(run('status.mjs', [p.file]).stdout, /Rules changed/);
});

test('callers.mjs reads the callers of a function from a graphify graph, and prints none without one', (t) => {
  const dir = repo(t);
  assert.equal(run('callers.mjs', ['isHeld', '--root', dir]).stdout.trim(), '[]');

  const node = (id, label, file, at) => ({ id, label, source_file: file, source_location: `L${at}` });
  write(dir, 'graphify-out/.graphify_root', join(dir, 'src'));
  write(dir, 'graphify-out/graph.json', JSON.stringify({
    nodes: [node('holds_isheld', 'isHeld()', 'holds.js', 11), node('holds_hold', 'hold()', 'holds.js', 4),
      node('bookings_confirm', 'confirmBooking()', 'bookings.js', 5), node('other_isheld', 'isHeld()', 'other.js', 2), node('other_user', 'user()', 'other.js', 9)],
    links: [
      { source: 'holds_hold', target: 'holds_isheld', relation: 'calls' },
      { source: 'bookings_confirm', target: 'holds_isheld', relation: 'calls' },
      { source: 'bookings_confirm', target: 'holds_isheld', relation: 'imports' },
      { source: 'other_user', target: 'other_isheld', relation: 'calls' },
    ],
  }));
  assert.deepEqual(JSON.parse(run('callers.mjs', ['isHeld()', 'src/holds.js', '--root', dir]).stdout),
    [{ fn: 'hold()', at: 'src/holds.js:4' }, { fn: 'confirmBooking()', at: 'src/bookings.js:5' }]);
  assert.equal(JSON.parse(run('callers.mjs', ['isHeld', '--root', dir]).stdout).length, 3, 'with no file, every function of that name counts');
  assert.equal(run('callers.mjs', [], { cwd: dir }).code, 2);
});
