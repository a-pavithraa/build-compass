import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAP = join(dirname(fileURLToPath(import.meta.url)), '..', 'map');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
};

export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'build-compass-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

export function repo(t) {
  const dir = tempDir(t);
  git(dir, 'init', '-q');
  return dir;
}

export function write(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

export function commit(dir, message) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return git(dir, 'rev-parse', '--short', 'HEAD');
}

// Runs a map script and returns { code, stdout, stderr } without throwing on a non-zero exit.
export function run(script, args, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [join(MAP, script), ...args], {
      encoding: 'utf8', env: { ...GIT_ENV, ...options.env }, cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

export function writeMap(dir, data) {
  write(dir, '.project-map/map-data.js', `window.PROJECT_MAP = ${JSON.stringify(data)};`);
  return join(dir, '.project-map', 'map-data.js');
}
