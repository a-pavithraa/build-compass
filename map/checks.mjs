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

// The newest results always show for the whole project, each with what it ran on: a pass must never
// stay hidden behind an older failure because the code moved between the map's read and the run.
// `otherWork` marks results that ran on a commit or uncommitted work other than what the map read.
// Results go on tasks only when they ran on the commit the map was read at; otherwise the checks
// already on each task stand, each with the commit it ran at.
// A check that passed goes on every task with a file under what the check covers. One that failed
// is shown for the whole project and on no task: a failing suite does not say which task broke.
export function attach(data, saved) {
  const update = data.update || {};
  if (!saved || !list(saved.results).length) return false;
  const sameCommit = Boolean(saved.commit && update.commit) && (saved.commit.startsWith(update.commit) || update.commit.startsWith(saved.commit));
  const otherWork = !sameCommit || Boolean(update.fingerprint && saved.fingerprint !== update.fingerprint);

  data.checks = saved.results.map(({ name, run, result, summary, failing, seconds, covers }) => ({
    name, run, result, summary, ...(list(failing).length ? { failing } : {}), at: saved.at, seconds, covers, ...(otherWork ? { otherWork: true } : {}),
  }));
  if (!sameCommit) return true;
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
