#!/usr/bin/env node
// Prints where a project stands, read from its map, in a few lines: how old the map is against git,
// the next milestone and items left, the next step, what is stuck, and the open decisions.
//   node status.mjs [path/to/.project-map/map-data.js]
//   node status.mjs --session-start     (as a hook: says something only when the map is out of date)
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fingerprint } from './fingerprint.mjs';

const argv = process.argv.slice(2);
const sessionStart = argv.includes('--session-start');
const file = resolve(argv.find((a) => !a.startsWith('--')) || join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.project-map', 'map-data.js'));
const list = (v) => (Array.isArray(v) ? v : []);

if (!existsSync(file)) {
  if (!sessionStart) console.log(`No map yet: ${file} does not exist. Ask Claude to draw one.`);
  process.exit(0);
}

let data;
try {
  const text = readFileSync(file, 'utf8');
  data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
} catch (err) {
  if (!sessionStart) console.log(`The map's data cannot be read (${err.message}). Ask Claude to update the map.`);
  process.exit(sessionStart ? 0 : 1);
}

const projectRoot = dirname(dirname(file));
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', projectRoot, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch {
    return null;
  }
};

const update = data.update || {};
// The map is current when this checkout is at the commit it was read at and its uncommitted work
// has the fingerprint recorded then. Any other commit, older or newer, or any new edit makes it stale.
function freshness() {
  if (!update.commit) return { stale: false, text: '' };
  const head = git('rev-parse', '--short', 'HEAD');
  if (head === null) return { stale: false, text: '' };
  const parts = [];
  if (git('rev-parse', '--verify', '-q', `${update.commit}^{commit}`) === null) {
    parts.push(`drawn at ${update.commit}, which this repository no longer has`);
  } else if (git('rev-parse', 'HEAD') !== git('rev-parse', `${update.commit}^{commit}`)) {
    const ahead = +git('rev-list', '--count', `${update.commit}..HEAD`);
    const back = +git('rev-list', '--count', `HEAD..${update.commit}`);
    if (ahead && !back) parts.push(`${ahead} commit${ahead === 1 ? '' : 's'} behind HEAD (${head})`);
    else if (back && !ahead) parts.push(`drawn at ${update.commit}, ${back} commit${back === 1 ? '' : 's'} newer than the checked-out ${head}`);
    else parts.push(`drawn at ${update.commit}, on a different line of history from HEAD (${head})`);
  }
  if (update.fingerprint) {
    let now = null;
    try { now = fingerprint(projectRoot); } catch { /* git could not be read: say nothing about edits */ }
    if (now && now !== update.fingerprint) parts.push('the uncommitted work has changed since it was read');
  }
  return { stale: parts.length > 0, text: parts.length ? parts.join('; ') : 'up to date with git' };
}
const fresh = freshness();
const readAt = update.readAtShort || update.readAt || 'an unknown time';

if (sessionStart) {
  if (!fresh.stale) process.exit(0);
  const context = `The project map at .project-map/map.html was read at ${readAt} and is out of date: ${fresh.text}. `
    + 'Update it with the mapping-progress skill before you answer "where are we?" or start a long stretch of work.';
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
  process.exit(0);
}

const tasks = new Map(list(data.tasks).map((t) => [t.id, t]));
const parts = new Map(list(data.parts).map((p) => [p.id, p]));
const name = (id) => (tasks.get(id) && (tasks.get(id).label ? `${tasks.get(id).label} ${tasks.get(id).name}` : tasks.get(id).name))
  || (parts.get(id) && parts.get(id).name) || id;
const isOpen = (id) => !tasks.has(id) || tasks.get(id).status !== 'done';

const lines = [];
lines.push(`${data.project || 'Project'}: map version ${update.version ?? '?'}, read ${readAt}${update.commit ? ` at ${update.commit}` : ''}${fresh.text ? `; ${fresh.text}` : ''}.`);

const nextMilestone = list(data.milestones).find((m) => list(m.tasks).some(isOpen));
if (nextMilestone) {
  const left = list(nextMilestone.tasks).filter(isOpen).length;
  lines.push(`Next milestone: ${nextMilestone.name}${nextMilestone.proposed ? ' (proposed)' : ''}, ${left} of ${list(nextMilestone.tasks).length} items left.`);
} else if (list(data.milestones).length) {
  lines.push('Every milestone on the map is done.');
}
if (data.next && data.next.step) lines.push(`Next step: ${data.next.step}${data.next.reason ? ` (${data.next.reason})` : ''}`);

const changed = list(update.changed).map(name);
lines.push(changed.length ? `Changed since the last map: ${changed.join('; ')}.` : (update.changedNote ? `Changed: ${update.changedNote}` : 'Changed since the last map: nothing recorded.'));

const stuck = [...list(data.parts), ...list(data.tasks)].filter((o) => o.status === 'stuck');
for (const o of stuck) lines.push(`Stuck: ${o.label ? `${o.label} ` : ''}${o.name}, waiting on ${o.waitingShort || o.waitingOn || 'something not stated'}.`);

const open = list(data.decisions).filter((d) => !d.answer);
for (const d of open) {
  lines.push(d.readOnly
    ? `Waiting for you in the plan: ${d.question} (proposed: ${d.default || 'no default'})`
    : `Open decision ${d.id}: ${d.question} (if unanswered: ${d.default || 'no default'})`);
}
if (data.plan && data.plan.approval) lines.push(`Plan ${data.plan.label || data.plan.file}: ${data.plan.approval === 'approved' ? 'approved' : 'awaiting your response'}.`);
const findings = list(data.findings).length;
if (findings) lines.push(`${findings} finding${findings === 1 ? '' : 's'} on the map worth a look.`);
if (fresh.stale) lines.push('The map is out of date with the code: update it before relying on these statuses.');

console.log(lines.join('\n'));
