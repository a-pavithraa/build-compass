#!/usr/bin/env node
// Runs the check commands the owner listed for this project, and nothing else, and saves what
// each one said. Run it from the project root.
//   node run-checks.mjs            runs each check, or reuses its result when nothing has changed
//   node run-checks.mjs --force    runs every check again
//   node run-checks.mjs --attach   also writes the results into map-data.js (for a first map;
//                                  on an update merge.mjs does this)
//
// The list is .project-map/checks.json, written by the owner or by setup with their yes:
//   { "checks": [ { "name": "Server tests", "run": "npm test", "in": "server", "timeoutSeconds": 300 } ] }
// "in" is the folder to run in; "covers" (folders) defaults to it. A check passes when its command exits 0.
// A list that git tracks is refused: it could have arrived with someone else's repository.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from './fingerprint.mjs';
import { listPath, savedPath, readSaved, attach } from './checks.mjs';

const argv = process.argv.slice(2);
const root = process.cwd();
const mapDir = join(root, '.project-map');
const DEFAULT_SECONDS = 300;
// An agent's shell call is cut off at ten minutes, so no new check starts after nine. The rest run next time.
const BUDGET_SECONDS = 540;
const say = (out) => console.log(JSON.stringify(out, null, 1));
// Progress goes to stderr as each check starts and ends, so a long run does not look stuck and stdout stays one JSON result.
const note = (line) => process.stderr.write(`${line}\n`);

if (!existsSync(listPath(mapDir))) {
  say({ checks: false, note: 'No .project-map/checks.json, so no check was run. The owner lists the commands there.' });
  process.exit(0);
}

const git = (...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
}).trim();
const tryGit = (...args) => { try { return git(...args); } catch { return null; } };

if (tryGit('rev-parse', '--is-inside-work-tree') !== 'true') {
  say({ checks: false, note: 'Not a git repository, so no check was run.' });
  process.exit(0);
}
if (tryGit('ls-files', '--error-unmatch', '.project-map/checks.json') !== null) {
  console.error('problem: .project-map/checks.json is tracked by git, so it may not be the owner\'s own list. No check was run. Untrack it (.project-map/ belongs in .gitignore).');
  process.exit(1);
}

let wanted;
try {
  wanted = JSON.parse(readFileSync(listPath(mapDir), 'utf8')).checks;
  if (!Array.isArray(wanted) || wanted.some((c) => !c || typeof c.name !== 'string' || typeof c.run !== 'string')) throw new Error('"checks" must be a list, each with a name and a run command');
} catch (err) {
  console.error(`problem: cannot read .project-map/checks.json: ${err.message}`);
  process.exit(1);
}

const folder = (text) => String(text || '').replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
const under = (text) => (folder(text) ? `${folder(text)}/` : '');
const commit = git('rev-parse', '--short', 'HEAD');
const print = fingerprint(root);
const dirty = git('status', '--porcelain', '--', '.', ':!.project-map', ':!.grill') !== '';
const before = argv.includes('--force') ? null : readSaved(mapDir);
const current = before && before.commit === commit && before.fingerprint === print ? before.results : [];

// A test runner often ends on a duration or a rule, so the line that counts results is preferred over the
// last one: for a passed check the last line counting passes, for a failed one the last counting failures.
const COUNTS = {
  passed: /\d+\s+pass(ed)?\b|\bpass(ed)?[:\s]+\d+/i,
  failed: /\d+\s+(fail(ed|ures?)?|errors?)\b|\b(fail(ed|ures?)?|errors?)[:\s]+\d+/i,
};
function summaryOf(text, result) {
  const lines = String(text || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const counting = (pattern) => lines.findLast((line) => pattern.test(line));
  const line = counting(COUNTS[result]) || counting(COUNTS.passed) || counting(COUNTS.failed) || lines.at(-1) || '';
  return line.replace(/^[^\w[(]+/, '').slice(0, 160);
}

// Run without waiting on the shell alone: when time runs out, everything the command started has to go
// with it, or a test runner is left holding the project's files.
function runOne(check) {
  const seconds = Math.max(1, +check.timeoutSeconds || DEFAULT_SECONDS);
  const began = Date.now();
  const took = () => Math.round((Date.now() - began) / 1000);
  note(`${check.name}: running, up to ${seconds} s`);
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let timedOut = false;
    const child = spawn(check.run, {
      cwd: join(root, folder(check.in)), shell: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1' }, detached: process.platform !== 'win32',
    });
    child.stdout.on('data', (chunk) => { out = (out + chunk).slice(-4000); });
    child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-4000); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, seconds * 1000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ result: 'failed', summary: `could not start: ${error.message}`.slice(0, 160), seconds: took() });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) resolve({ result: 'failed', summary: `timed out after ${seconds} s`, seconds: took() });
      else {
        const result = code === 0 ? 'passed' : 'failed';
        resolve({ result, summary: summaryOf(out, result) || summaryOf(err, result) || `exit code ${code}`, seconds: took() });
      }
    });
  });
}

const started = Date.now();
const results = [];
const left = [];
const save = () => writeFileSync(savedPath(mapDir), `${JSON.stringify({ commit, fingerprint: print, at: dirty ? `${commit} plus uncommitted work` : commit, results }, null, 1)}\n`);
for (const check of wanted) {
  const covers = (Array.isArray(check.covers) ? check.covers : [check.in]).map(under);
  const same = current.find((r) => r.name === check.name && r.run === check.run && r.in === folder(check.in));
  if (same) {
    results.push({ ...same, covers, reused: true });
    note(`${check.name}: ${same.result}, reused from the last run`);
  } else if ((Date.now() - started) / 1000 > BUDGET_SECONDS) {
    left.push(check.name);
    note(`${check.name}: left for the next run, out of time`);
    continue;
  } else {
    const ran = await runOne(check);
    results.push({ name: check.name, run: check.run, in: folder(check.in), covers, ...ran, reused: false });
    note(`${check.name}: ${ran.result} in ${ran.seconds} s`);
  }
  save();
}

const out = { checks: true, at: dirty ? `${commit} plus uncommitted work` : commit, results: results.map(({ name, result, summary, seconds, reused, covers }) => ({ name, result, summary, seconds, reused, covers })) };
if (left.length) out.left = { names: left, note: 'Out of time for this run. Run it again to finish these; the finished ones are reused.' };

if (argv.includes('--attach')) {
  const dataFile = join(mapDir, 'map-data.js');
  const text = readFileSync(dataFile, 'utf8');
  const data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  out.attached = attach(data, readSaved(mapDir));
  if (out.attached) {
    writeFileSync(dataFile, `window.PROJECT_MAP = ${JSON.stringify(data, null, 2)};\n`);
    try {
      out.check = execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'check.mjs'), dataFile], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (err) {
      say(out);
      process.stderr.write(err.stderr || `problem: check.mjs could not run: ${err.message}\n`);
      process.exit(1);
    }
  } else {
    out.note = 'Nothing attached: the map was read at a different commit or different uncommitted work than the checks ran on.';
  }
}
say(out);
