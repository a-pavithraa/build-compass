// A short hash of a checkout's uncommitted work: tracked changes against HEAD plus untracked files.
// Two reads of the same working tree give the same fingerprint; any edit, new file or deletion changes it.
// The map's own folders are left out, so drawing the map does not change it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = /^(\.project-map|\.grill)\//;
const MAX_HASHED_BYTES = 5e6;

export function fingerprint(cwd) {
  const git = (...args) => execFileSync('git', ['-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], {
    stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256e6,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
  });
  const hash = createHash('sha256');
  let hasHead = true;
  try { git('rev-parse', '--verify', '-q', 'HEAD'); } catch { hasHead = false; }
  const diff = git('diff', hasHead ? 'HEAD' : '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--binary', '--', '.', ':(exclude).project-map', ':(exclude).grill');
  hash.update(diff);
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').toString('utf8').split('\0').filter((p) => p && !SKIP.test(p)).sort();
  for (const path of untracked) {
    hash.update(`\0${path}\0`);
    try {
      const { size } = statSync(join(cwd, path));
      hash.update(size > MAX_HASHED_BYTES ? `size:${size}` : readFileSync(join(cwd, path)));
    } catch {
      hash.update('unreadable');
    }
  }
  return hash.digest('hex').slice(0, 16);
}
