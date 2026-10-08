// Drives map.html in a headless browser: picking answers, the one block to copy, and picks that
// outlive the page's reloads. Skipped when Playwright or a browser is not installed (`npm install`,
// then `npx playwright install chromium`, or an installed Chrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tempDir, MAP } from './helpers.mjs';

async function launch() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { skip: 'Playwright is not installed; run npm install' };
  }
  for (const options of [{}, { channel: 'chrome' }]) {
    try {
      return { browser: await chromium.launch(options) };
    } catch { /* try the next browser */ }
  }
  return { skip: 'no browser for Playwright; run npx playwright install chromium' };
}

function mapData(version, answered = {}) {
  const decision = (id, question, options) => ({ id, question, options, default: options[0], waiting: [], answer: answered[id] || null });
  return {
    project: 'Slotbook',
    update: { version, readAt: '2026-10-07 21:00 +05:30', readAtShort: '7 Oct 2026, 21:00', commit: 'abc1234' },
    next: { step: 'Commit the double-booking check' },
    parts: [{ id: 'P1', name: 'Booking', status: 'in-progress', reason: 'Half built.', tasks: [] }],
    tasks: [],
    decisions: [
      decision('D1', 'When does the reminder go out?', ['The day before at 6 pm', 'Two hours before']),
      decision('D2', 'Show times in the customer time zone?', ['Yes', 'No']),
      decision('D3', 'Sort the bookings by?', ['Soonest first', 'Newest first']),
      { id: 'D4', question: 'From the plan?', options: ['Once'], default: 'Once', readOnly: true, answerIn: { file: '../plan.html' }, waiting: [] },
    ],
  };
}

const writeData = (dir, data) => writeFileSync(join(dir, 'map-data.js'), `window.PROJECT_MAP = ${JSON.stringify(data)};`);

test('decisions collect into one block of answers that survives reloads', async (t) => {
  const { browser, skip } = await launch();
  if (skip) return t.skip(skip);
  t.after(() => browser.close());

  const dir = tempDir(t);
  copyFileSync(join(MAP, 'map.html'), join(dir, 'map.html'));
  writeData(dir, mapData(1));
  const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(pathToFileURL(join(dir, 'map.html')).href);

  const pick = async (id, option) => {
    await page.click(`#page .dec[data-ref="${id}"]`);
    await page.check(`input[name=pick][value="${option}"]`);
    await page.click('#close');
  };
  const block = () => page.locator('#line').textContent();

  assert.equal(await page.locator('#answers').count(), 0, 'no block before a pick');
  await pick('D1', 'Two hours before');
  await pick('D3', 'Newest first');
  assert.match(await page.locator('#answers').textContent(), /2 of 3 answered/);
  const text = await block();
  assert.match(text, /^Map answers: Slotbook \(map version 1, read 7 Oct 2026, 21:00\)/);
  assert.ok(text.includes('D1. When does the reminder go out?\n   -> Two hours before'));
  assert.ok(text.includes('D2. Show times in the customer time zone?\n   -> (no answer; the default stands: Yes)'));
  assert.ok(!text.includes('D4.'), 'plan decisions are answered in the plan');

  await page.reload();
  assert.equal(await block(), text, 'picks survive a reload');

  writeData(dir, mapData(2, { D1: 'Two hours before' }));
  await page.waitForEvent('load', { timeout: 30000 });
  const after = await block();
  assert.ok(!after.includes('D1.') && after.includes('map version 2') && after.includes('-> Newest first'), 'a recorded answer drops its pick');

  await page.click('#page .dec[data-ref="D3"]');
  await page.click('#toanswers');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'copy', 'the drawer link leads to Copy answers');
  await page.click('#clearpicks');
  assert.equal(await page.locator('#answers').count(), 0, 'clear picks empties the block');

  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), 'no sideways scroll on a phone');
  assert.deepEqual(errors, []);
});

test("a task's drawer leads with its outcome and says what was checked", async (t) => {
  const { browser, skip } = await launch();
  if (skip) return t.skip(skip);
  t.after(() => browser.close());

  const dir = tempDir(t);
  copyFileSync(join(MAP, 'map.html'), join(dir, 'map.html'));
  const data = mapData(1);
  data.parts[0].tasks = ['T1', 'T2'];
  data.tasks = [
    { id: 'T1', name: 'Refuse double bookings', status: 'done', part: 'P1',
      outcome: { before: 'Two customers could book one slot.', now: 'The second booking is refused.', tryIt: 'Book one slot from two windows.' },
      verified: [{ check: 'npm test: 12 passed', result: 'passed', at: 'abc1234' }] },
    { id: 'T2', name: 'Cancel a booking', status: 'done', part: 'P1' },
  ];
  writeData(dir, data);
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${pathToFileURL(join(dir, 'map.html')).href}#open=T1`);
  const drawer = page.locator('#drawer');
  const text = await drawer.textContent();
  assert.ok(text.includes('BeforeTwo customers could book one slot.') && text.includes('NowThe second booking is refused.') && text.includes('Try itBook one slot from two windows.'));
  assert.match(text, /Passed: npm test: 12 passed at abc1234/);
  assert.ok(text.indexOf('Before') < text.indexOf('What changed'), 'the outcome comes before the files');

  await page.goto(`${pathToFileURL(join(dir, 'map.html')).href}#open=T2`);
  await page.reload();
  const unchecked = await drawer.textContent();
  assert.match(unchecked, /Done, not checked/);
  assert.match(unchecked, /No check is recorded for this task\.Its code is committed/);
  assert.equal(await drawer.locator('.wait.unchecked').count(), 1, 'the missing check is flagged, not left as body text');
  const tiles = await page.locator('.slot .sstat').allTextContents();
  assert.deepEqual(tiles, ['Done', 'Done, not checked'], 'a tile says when no check backs a done task');
});

test('"since you last looked" lists what moved across updates until it is marked as seen', async (t) => {
  const { browser, skip } = await launch();
  if (skip) return t.skip(skip);
  t.after(() => browser.close());

  const dir = tempDir(t);
  copyFileSync(join(MAP, 'map.html'), join(dir, 'map.html'));
  const withTasks = (version, t1, answered) => {
    const data = mapData(version, answered);
    data.parts[0].tasks = ['T1'];
    data.tasks = [{ id: 'T1', name: 'Refuse double bookings', status: t1, part: 'P1' }];
    return data;
  };
  writeData(dir, withTasks(1, 'in-progress'));
  const page = await (await browser.newContext()).newPage();
  await page.goto(pathToFileURL(join(dir, 'map.html')).href);
  assert.equal(await page.locator('#since').count(), 0, 'the first visit only records a baseline');

  writeData(dir, withTasks(2, 'done'));
  await page.waitForEvent('load', { timeout: 30000 });
  assert.match(await page.locator('#since').textContent(), /version 1 to 2/);
  writeData(dir, withTasks(3, 'done', { D1: 'Two hours before' }));
  await page.waitForEvent('load', { timeout: 30000 });
  const since = await page.locator('#since').textContent();
  assert.match(since, /version 1 to 3/);
  assert.match(since, /Refuse double bookings: In progress → Done/);
  assert.match(since, /Answered: Two hours before/);

  await page.click('#seen');
  assert.equal(await page.locator('#since').count(), 0);
  await page.reload();
  assert.equal(await page.locator('#since').count(), 0, 'marked as seen stays seen');
});

test('milestone headers stay inside their own column, and the page never scrolls sideways', async (t) => {
  const { browser, skip } = await launch();
  if (skip) return t.skip(skip);
  t.after(() => browser.close());

  const dir = tempDir(t);
  copyFileSync(join(MAP, 'map.html'), join(dir, 'map.html'));
  const data = mapData(1);
  const task = (id) => ({ id, name: `Task ${id}`, status: 'not-started', part: 'P1' });
  const many = Array.from({ length: 9 }, (_, i) => `T${i + 1}`);
  data.tasks = [...many, 'T10', 'T11', 'T12'].map(task);
  data.parts[0].tasks = data.tasks.map((x) => x.id);
  data.milestones = [
    { id: 'M1', name: 'Customers can book a slot and pay for it', proposed: true, tasks: many },
    { id: 'M2', name: 'Reminders are kept after the 24 hour window', proposed: true, tasks: ['T10'] },
    { id: 'M3', name: 'Hardening', proposed: true, tasks: ['T11'] },
  ];
  writeData(dir, data);

  for (const width of [1440, 1024, 390]) {
    const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
    await page.goto(pathToFileURL(join(dir, 'map.html')).href);
    const seen = await page.evaluate(() => ({
      heads: document.querySelectorAll('.ms-head').length,
      spills: [...document.querySelectorAll('.ms-head')].filter((head) => {
        const column = head.parentElement.getBoundingClientRect();
        return [...head.children].some((child) => child.getBoundingClientRect().right > column.right + 1);
      }).map((head) => head.textContent),
      sideways: document.documentElement.scrollWidth - window.innerWidth,
    }));
    assert.equal(seen.heads, 4, 'three milestones and the tasks in none');
    assert.deepEqual(seen.spills, [], `at ${width}px a milestone header runs past its column`);
    assert.ok(seen.sideways <= 0, `at ${width}px the page is ${seen.sideways}px wider than the window`);
  }
});

test('the keyboard reaches the details and comes back to where it was', async (t) => {
  const { browser, skip } = await launch();
  if (skip) return t.skip(skip);
  t.after(() => browser.close());

  const dir = tempDir(t);
  copyFileSync(join(MAP, 'map.html'), join(dir, 'map.html'));
  const data = mapData(1);
  data.parts[0].tasks = ['T1', 'T2'];
  data.tasks = [
    { id: 'T1', name: 'Refuse double bookings', status: 'not-started', part: 'P1' },
    { id: 'T2', name: 'Cancel a booking', status: 'done', part: 'P1' },
  ];
  writeData(dir, data);
  const page = await (await browser.newContext()).newPage();
  await page.goto(pathToFileURL(join(dir, 'map.html')).href);

  const focused = () => page.evaluate(() => { const el = document.activeElement; return el.id || el.getAttribute('data-ref') || el.tagName; });
  for (let i = 0; i < 40 && !(await page.evaluate(() => document.activeElement.matches('.slot[data-ref="T1"]'))); i++) await page.keyboard.press('Tab');
  assert.equal(await focused(), 'T1', 'Tab reaches the first task');
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return `${cs.outlineStyle} ${cs.outlineWidth}`; });
  assert.equal(ring, 'solid 2px', 'a not-started task shows the focus ring, not its dashed edge');

  await page.keyboard.press('Enter');
  assert.equal(await focused(), 'drawer', 'opening the details moves focus into them');
  const dialog = page.getByRole('dialog', { name: 'Refuse double bookings' });
  assert.equal(await dialog.count(), 1, 'the details are a dialog named by the task');

  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'close', 'the next stop is inside the details');
  await page.keyboard.press('Escape');
  assert.equal(await focused(), 'T1', 'closing returns to the task that opened them');
  assert.equal(await page.locator('.slot[data-ref="T1"].is-selected').count(), 0);
});

test('a hand check shows the code path, and its result joins the answers', async (t) => {
  const { browser, skip } = await launch();
  if (skip) return t.skip(skip);
  t.after(() => browser.close());

  const dir = tempDir(t);
  copyFileSync(join(MAP, 'map.html'), join(dir, 'map.html'));
  const data = mapData(1);
  data.update.uncommittedWork = true;
  data.parts[0].tasks = ['T1', 'T2'];
  data.tasks = [
    { id: 'T1', name: 'Refuse double bookings', status: 'done', part: 'P1',
      calls: [{ fn: 'POST /bookings', at: 'src/routes.js:14', depth: 0 }, { fn: 'confirmBooking()', at: 'src/bookings.js:22', depth: 1 }] },
    { id: 'T2', name: 'Cancel a booking', status: 'done', part: 'P1', verified: [{ check: 'npm test: 12 passed', result: 'passed', at: 'abc1234' }] },
  ];
  data.checks = [{ name: 'Server tests', result: 'failed', summary: '1 failed', at: 'abc1234' }];
  writeData(dir, data);
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${pathToFileURL(join(dir, 'map.html')).href}#open=T1`);
  const drawer = page.locator('#drawer');
  assert.deepEqual(await drawer.locator('.call').allTextContents(), ['POST /bookingsroutes.js:14', 'confirmBooking()bookings.js:22']);
  assert.match(await page.locator('#page').textContent(), /Failed: Server tests\. 1 failed at abc1234/, 'a failing suite is shown for the whole project');

  await drawer.getByLabel('It worked').check();
  const block = await page.locator('#line').textContent();
  assert.ok(block.endsWith('Checked by hand at abc1234 plus uncommitted work:\nT1. Refuse double bookings\n   -> passed'), block);
  assert.match(await page.locator('#answers .msg').first().textContent(), /1 task checked by hand\./);
  await page.reload();
  assert.ok(await drawer.getByLabel('It worked').isChecked(), 'the result survives a reload');

  await page.goto(`${pathToFileURL(join(dir, 'map.html')).href}#open=T2`);
  await page.reload();
  assert.equal(await drawer.getByLabel('It worked').count(), 0, 'a task with a recorded check is not asked for one');

  data.tasks[0].verified = [{ check: 'Checked by hand by the owner', result: 'passed', at: 'abc1234' }];
  data.update.version = 2;
  writeData(dir, data);
  await page.waitForEvent('load', { timeout: 30000 });
  assert.equal(await page.locator('#answers').count(), 0, 'a result the map has recorded leaves the answers');
});

test('the page works when the browser blocks storage', async (t) => {
  const { browser, skip } = await launch();
  if (skip) return t.skip(skip);
  t.after(() => browser.close());

  const dir = tempDir(t);
  copyFileSync(join(MAP, 'map.html'), join(dir, 'map.html'));
  writeData(dir, mapData(1));
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(pathToFileURL(join(dir, 'map.html')).href);
  await page.click('#page .dec[data-ref="D2"]');
  await page.check('input[name=pick][value="No"]');
  assert.equal(await page.locator('#answers').count(), 1);
  assert.deepEqual(errors, []);
});
