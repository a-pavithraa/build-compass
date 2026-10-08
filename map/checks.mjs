// Shared by run-checks.mjs and merge.mjs: where the results of the owner's check commands are
// saved, and how they join the map's data. No model writes these results.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const list = (v) => (Array.isArray(v) ? v : []);

export const listPath = (mapDir) => join(mapDir, 'checks.json');
export const savedPath = (mapDir) => join(mapDir, 'checks-last.json');

export function readSaved(mapDir) {
  try {
    return JSON.parse(readFileSync(savedPath(mapDir), 'utf8'));
  } catch {
    return null;
  }
}

// Results count only for the commit and uncommitted work they ran on. When the map was read at
// anything else, the checks already on it stand, each with the commit it ran at.
// A check that passed goes on every task with a file under what the check covers. One that failed
// is shown for the whole project and on no task: a failing suite does not say which task broke.
export function attach(data, saved) {
  const update = data.update || {};
  if (!saved || !list(saved.results).length) return false;
  if (saved.commit !== update.commit || (update.fingerprint && saved.fingerprint !== update.fingerprint)) return false;

  data.checks = saved.results.map(({ name, run, result, summary, seconds, covers }) => ({ name, run, result, summary, at: saved.at, seconds, covers }));
  for (const task of list(data.tasks)) {
    const paths = list(task.work).flatMap((work) => list(work.files).map((f) => f.path));
    const kept = list(task.verified).filter((v) => v.by !== 'script');
    const passed = saved.results
      .filter((r) => r.result === 'passed' && paths.some((path) => list(r.covers).some((under) => under === '' || path.startsWith(under))))
      .map((r) => ({ check: `${r.name}: ${r.summary}`, result: 'passed', at: saved.at, by: 'script' }));
    if (kept.length + passed.length) task.verified = [...kept, ...passed];
    else delete task.verified;
  }
  return true;
}
