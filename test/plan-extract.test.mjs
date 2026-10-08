import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, run } from './helpers.mjs';

const FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plan.html'), 'utf8');

function extract(t, html, name = 'plan.html', index) {
  const dir = index ? dirname(index) : tempDir(t);
  const file = join(dir, name);
  writeFileSync(file, html);
  const args = [file];
  if (index) args.push('--index', index, '--write');
  const result = run('plan-extract.mjs', args);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('numbers claims, skips aux claims, and ignores tags in comments, code and templates', (t) => {
  const out = extract(t, FIXTURE);
  assert.equal(out.title, 'Text Reminders in Slotbook');
  assert.deepEqual(out.claims.map((c) => [c.number, c.aux, c.depth]), [
    ['1', null, 1], ['1.1', null, 2], ['1.1.1', null, 3], ['1.2', null, 2], ['2', null, 1], [null, 'shared', 1], [null, 'scope', 1],
  ]);
  assert.equal(out.claims[1].text, 'A nightly job sends the reminders & marks them sent.');
  assert.equal(out.claims[2].at, 'src/jobs/reminders.js:4');
});

test('collects call-tree files, decisions with their default, and scope items', (t) => {
  const out = extract(t, FIXTURE);
  const job = out.claims.find((c) => c.number === '1.1');
  assert.deepEqual(job.files, [
    { path: 'src/jobs/reminders.js', line: 4, mark: 'new' },
    { path: 'src/sms.js', line: 12, mark: 'context' },
  ]);
  assert.equal(out.asks.length, 1);
  const ask = out.asks[0];
  assert.equal(ask.question, 'Should a failed text retry?');
  assert.deepEqual(ask.default, ['Once, after an hour']);
  assert.deepEqual(ask.options[1], { value: 'no', label: 'No', detail: 'claim 1.2 goes', kind: 'radio' });
  assert.equal(ask.claimNumber, '1.2');
  assert.equal(ask.decisionId, 'plan-ask-retry');
  assert.deepEqual(out.claims.find((c) => c.aux === 'scope').items, ['Booking keeps its flow.', 'No payment reminders.']);
});

test('a packed plan gives the same claims as the plain one', (t) => {
  const packed = FIXTURE
    .replace('<link rel="stylesheet" href="htmlplan.css">', '<style data-htmlplan>doc-claim{display:block}</style>')
    .replace('<script src="htmlplan.js" defer></script>', '<script data-htmlplan>const s = "<doc-claim><p>Not a claim</p></doc-claim>";</script>');
  const plain = extract(t, FIXTURE);
  const fromPacked = extract(t, packed, 'plan.packed.html');
  assert.deepEqual(fromPacked.claims, plain.claims);
  assert.deepEqual(fromPacked.asks, plain.asks);
});

test('claims keep their ids when reworded or renumbered; rewritten ones are new and gone', (t) => {
  const dir = tempDir(t);
  const index = join(dir, 'plan-index.json');
  const first = extract(t, FIXTURE, 'plan.html', index);
  const ids = Object.fromEntries(first.claims.map((c) => [c.text, c.id]));

  const edited = FIXTURE
    .replace('A failed text is tried once more.', 'A failed text is tried one more time.')
    .replace('<doc-claim id="optout">', '<doc-claim><p>A brand new behaviour comes first.</p></doc-claim>\n  <doc-claim id="optout">')
    .replace('A customer can stop the texts.', 'Customers opt out by replying STOP to any text.')
    .replace('A customer gets a text the day before the booking.', 'Something entirely unrelated is written here now.');
  const second = extract(t, edited, 'plan.html', index);
  const byText = (text) => second.claims.find((c) => c.text === text);

  assert.equal(byText('A failed text is tried one more time.').id, ids['A failed text is tried once more.']);
  assert.equal(byText('A failed text is tried one more time.').matched, 'similar');
  assert.equal(byText('Customers opt out by replying STOP to any text.').id, ids['A customer can stop the texts.'], 'the html id keeps it');
  assert.equal(byText('Customers opt out by replying STOP to any text.').number, '3');
  assert.equal(byText('Customers opt out by replying STOP to any text.').was, '2');
  assert.equal(byText('A brand new behaviour comes first.').matched, 'new');
  assert.equal(byText('Something entirely unrelated is written here now.').matched, 'new');
  assert.deepEqual(second.gone.map((g) => g.text), ['A customer gets a text the day before the booking.']);
  assert.equal(new Set(second.claims.map((c) => c.id)).size, second.claims.length, 'ids are unique');
});

test('refuses a file that is not an html-plan plan', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'notes.html');
  writeFileSync(file, '<html><body><h1>Notes</h1></body></html>');
  const result = run('plan-extract.mjs', [file]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no <doc-plan>/);
});
