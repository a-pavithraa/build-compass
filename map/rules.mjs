// Shared by merge.mjs: the project's settings, and the fields of a rule that no model writes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const list = (v) => (Array.isArray(v) ? v : []);

export const settingsPath = (mapDir) => join(mapDir, 'settings.json');

export function readSettings(mapDir) {
  try {
    const settings = JSON.parse(readFileSync(settingsPath(mapDir), 'utf8'));
    return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : null;
  } catch {
    return null;
  }
}

// The longest name in "confirmBooking()" or "POST /bookings/confirm": what to look for in a file.
export const nameIn = (fn) => (String(fn || '').match(/[\w$./-]{3,}/g) || []).sort((a, b) => b.length - a.length)[0] || null;

const TEST_FILE = /(^|[/._-])(tests?|specs?|__tests__)([/._-]|$)/i;

// A test file among the task's own files that names the rule's function. A match on the name is
// all this claims: it does not say the test asserts the rule.
function testFor(rule, task, repoRoot) {
  const name = nameIn(String(rule.fn || '').replace(/\(.*$/, ''));
  if (!name || !task) return null;
  for (const work of list(task.work)) {
    for (const f of list(work.files)) {
      if (!f.path || f.kind === 'deleted' || !TEST_FILE.test(f.path)) continue;
      try {
        if (readFileSync(join(work.worktree || repoRoot, f.path), 'utf8').includes(name)) return f.path;
      } catch { /* a file that cannot be read names nothing */ }
    }
  }
  return null;
}

// A rule this patch wrote is new, or changed when its wording differs from what the map held.
// Only those move to this version, which is what the page shows as changed since it was last seen.
// A touched rule whose wording stands, say with a corrected line, keeps its version.
export function stampRules(data, before, touched, version, repoRoot) {
  const was = new Map(list(before).map((rule) => [rule.id, rule]));
  for (const rule of list(data.rules)) {
    if (!touched.has(rule.id)) continue;
    const old = was.get(rule.id);
    if (rule.change === 'removed') {
      delete rule.test;
      if (!old || old.change !== 'removed') rule.version = version;
      continue;
    }
    rule.test = testFor(rule, list(data.tasks).find((task) => task.id === rule.task), repoRoot);
    if (old && old.change !== 'removed' && old.rule === rule.rule) continue;
    rule.change = old ? 'changed' : 'new';
    if (old) rule.was = old.rule;
    else delete rule.was;
    rule.version = version;
  }
}
