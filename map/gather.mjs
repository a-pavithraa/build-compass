#!/usr/bin/env node
// Gathers the git facts a map needs and prints them as JSON: HEAD, push state, commits with
// their files, uncommitted work, and the work in other worktrees. Run it from the project root.
//   node gather.mjs [--since <commit>] [--limit 20]
// Every hash, path and line count in the output comes from git or the file on disk.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const since = opt('--since');
const limit = Math.max(1, +(opt('--limit') || 20));
const SKIP = /^(\.project-map|\.grill)\//;
const BINARY_PROBE = 8000;
const MAX_COUNTED_BYTES = 5e6;
const CHANGES = ['--no-color', '--no-ext-diff', '--no-textconv', '-M', '--numstat', '--summary'];

const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'core.quotePath=false', '-C', cwd, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256e6,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
});
const tryGitIn = (cwd, ...args) => { try { return gitIn(cwd, ...args).trim(); } catch { return null; } };
const here = process.cwd();
const git = (...args) => gitIn(here, ...args);
const tryGit = (...args) => tryGitIn(here, ...args);

if (tryGit('rev-parse', '--is-inside-work-tree') !== 'true') {
  console.log(JSON.stringify({ git: false, note: 'Not a git repository.' }, null, 2));
  process.exit(0);
}

const head = tryGit('rev-parse', '--short', 'HEAD');
const branch = tryGit('symbolic-ref', '--short', '-q', 'HEAD') || (head ? '(detached)' : null);
const upstream = head ? tryGit('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') : null;
const remotes = (tryGit('remote') || '').split('\n').filter(Boolean);
// A commit counts as pushed when any remote-tracking branch has it, as of the last fetch:
// a branch with no upstream can still be pushed elsewhere, as `git push <remote> release:main` does.
const unpushed = new Set(head && remotes.length ? (tryGit('rev-list', 'HEAD', '--not', '--remotes') || '').split('\n').filter(Boolean) : []);
const isPushed = (full) => remotes.length > 0 && !unpushed.has(full);
const remoteBranchesWithHead = head && remotes.length
  ? (tryGit('branch', '-r', '--contains', 'HEAD', '--format=%(refname:short)') || '').split('\n').filter((b) => b.includes('/') && !b.endsWith('/HEAD'))
  : [];
const remoteName = upstream ? upstream.split('/')[0]
  : (remoteBranchesWithHead[0] || '').split('/')[0] || (remotes.includes('origin') ? 'origin' : remotes[0]);
const remoteUrl = remoteName ? tryGit('remote', 'get-url', remoteName) : null;
const github = (() => {
  const m = remoteUrl && remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
})();

// Turns `--numstat --summary` output into one entry per file.
function parseChanges(lines) {
  const files = new Map();
  const kinds = new Map();
  for (const line of lines) {
    const stat = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (stat) {
      const [, added, removed, rawPath] = stat;
      const renamed = rawPath.includes(' => ');
      const path = renamed ? renameTarget(rawPath) : rawPath;
      files.set(path, {
        path,
        kind: renamed ? 'renamed' : 'edited',
        ...(renamed ? { from: renameSource(rawPath) } : {}),
        added: added === '-' ? null : +added,
        removed: removed === '-' ? null : +removed,
        ...(added === '-' ? { note: 'Binary file.' } : {}),
      });
      continue;
    }
    const summary = line.match(/^ (create|delete) mode \d+ (.+)$/);
    if (summary) kinds.set(summary[2], summary[1] === 'create' ? 'new' : 'deleted');
  }
  for (const [path, kind] of kinds) if (files.has(path)) files.get(path).kind = kind;
  return [...files.values()].filter((f) => !SKIP.test(f.path));
}
function renameSource(p) {
  const m = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  return (m ? m[1] + m[2] + m[4] : p.split(' => ')[0]).replace(/\/\//g, '/');
}
function renameTarget(p) {
  const m = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  return (m ? m[1] + m[3] + m[4] : p.split(' => ')[1]).replace(/\/\//g, '/');
}

function readCommits(cwd, range, isPushed) {
  const SEP = '\x1e';
  const log = gitIn(cwd, 'log', ...CHANGES, '--date=format:%Y-%m-%d %H:%M', `--format=${SEP}%h%x1f%H%x1f%ad%x1f%s`, ...range);
  return log.split(SEP).slice(1).map((chunk) => {
    const [first, ...rest] = chunk.split('\n');
    const [hash, full, date, subject] = first.split('\x1f');
    const pushed = isPushed(full);
    return {
      hash, date, subject, pushed,
      ...(pushed && github ? { url: `${github}/commit/${full}` } : {}),
      files: parseChanges(rest),
    };
  });
}

function countLines(path) {
  try {
    const size = statSync(path).size;
    if (size > MAX_COUNTED_BYTES) return { added: null, note: `Untracked, ${Math.round(size / 1e6)} MB; lines not counted.` };
    const buf = readFileSync(path);
    if (buf.subarray(0, BINARY_PROBE).includes(0)) return { added: null, note: 'Untracked binary file.' };
    const text = buf.toString('utf8');
    const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return { added: lines, note: 'Untracked; lines counted from the file.' };
  } catch {
    return { added: null, note: 'Untracked; could not be read.' };
  }
}

function readUncommitted(cwd, hasHead) {
  const tracked = parseChanges(gitIn(cwd, 'diff', ...(hasHead ? ['HEAD'] : ['--cached']), ...CHANGES).split('\n'));
  const untracked = gitIn(cwd, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter((p) => p && !SKIP.test(p))
    .map((path) => ({ path, kind: 'new', removed: 0, ...countLines(join(cwd, path)) }));
  return [...tracked, ...untracked];
}

let commits = [];
let sinceNote = null;
if (head) {
  let range = ['-n', String(limit), 'HEAD'];
  if (since) {
    if (tryGit('cat-file', '-e', `${since}^{commit}`) !== null) range = [`${since}..HEAD`];
    else sinceNote = `Commit ${since} was not found (rebased or reset?); listed the last ${limit} commits instead.`;
  }
  commits = readCommits(here, range, isPushed);
}

// Other worktrees hold work in flight on their own branches: parallel subagents, or the owner's own.
// Their commits are the ones not yet on this checkout's HEAD.
function readWorktrees() {
  const list = tryGit('worktree', 'list', '--porcelain');
  if (!list) return [];
  const self = resolve(tryGit('rev-parse', '--show-toplevel'));
  return list.split(/\n\n+/).map((block) => {
    const field = (name) => (block.match(new RegExp(`^${name} (.+)$`, 'm')) || [])[1] || null;
    return { path: field('worktree'), head: field('HEAD'), branch: field('branch'), bare: /^bare$/m.test(block), prunable: /^prunable/m.test(block) };
  }).filter((w) => w.path && !w.bare && resolve(w.path) !== self).map((w) => {
    const base = {
      path: w.path,
      branch: w.branch ? w.branch.replace(/^refs\/heads\//, '') : '(detached)',
      head: w.head ? w.head.slice(0, 7) : null,
    };
    if (w.prunable || !existsSync(w.path)) return { ...base, note: 'The worktree folder is missing.' };
    const notOnRemote = new Set(remotes.length ? (tryGit('rev-list', w.head, '--not', '--remotes') || '').split('\n').filter(Boolean) : []);
    const ahead = head && w.head ? readCommits(here, [`HEAD..${w.head}`], (full) => remotes.length > 0 && !notOnRemote.has(full)) : [];
    const merged = head && w.head ? tryGit('merge-base', '--is-ancestor', w.head, 'HEAD') !== null : false;
    return { ...base, mergedIntoHead: merged, commitsAhead: ahead, uncommitted: readUncommitted(w.path, Boolean(w.head)) };
  });
}

function localTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function shortTime(d) {
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${d.getDate()} ${month} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const now = new Date();
const ahead = unpushed.size;
const shown = remoteBranchesWithHead.slice(0, 3).join(', ') + (remoteBranchesWithHead.length > 3 ? ', …' : '');
const pushNote = !head ? 'No commits yet.'
  : !remotes.length ? 'Not pushed: the repo has no remote.'
  : ahead === 0 ? (upstream ? `Up to date with ${upstream}.` : `Every commit is on a remote (${shown || 'a remote branch'}); ${branch} has no upstream branch.`)
  : `${ahead} commit${ahead === 1 ? '' : 's'} on ${branch} ${ahead === 1 ? 'is' : 'are'} on no remote${upstream ? ` (upstream ${upstream})` : ''}, as of the last fetch.`;

const worktrees = readWorktrees();
console.log(JSON.stringify({
  git: true,
  readAt: localTime(now),
  readAtShort: shortTime(now),
  head, branch, upstream, github,
  pushNote,
  ...(since ? { since } : {}),
  ...(sinceNote ? { sinceNote } : {}),
  commits,
  uncommitted: readUncommitted(here, Boolean(head)),
  ...(worktrees.length ? { worktrees } : {}),
}, null, 2));
