#!/usr/bin/env node
// Prints the functions that call one function, read from a graphify graph, so the agent never
// loads graph.json itself. The plugin does not build or refresh that graph: with none in the
// project this prints an empty list.
//   node callers.mjs <function> [file] [--root path/to/project]
// Prints JSON: [ { "fn": "hold()", "at": "src/holds.js:4" } ], at most three, each where the caller is defined.
import { readFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';

const argv = process.argv.slice(2);
const rootAt = argv.indexOf('--root');
const root = resolve(rootAt < 0 ? process.cwd() : argv[rootAt + 1] || '.');
const [fn, file] = argv.filter((a, i) => !a.startsWith('--') && (rootAt < 0 || i !== rootAt + 1));
if (!fn) {
  console.error('usage: node callers.mjs <function> [file] [--root path/to/project]');
  process.exit(2);
}

const CALLERS_KEEP = 3;
const graphDir = join(root, 'graphify-out');
let graph;
try {
  graph = JSON.parse(readFileSync(join(graphDir, 'graph.json'), 'utf8'));
} catch {
  console.log('[]');
  process.exit(0);
}

// graphify records files relative to the folder it scanned, which need not be the project root.
let scanned = root;
try {
  const saved = readFileSync(join(graphDir, '.graphify_root'), 'utf8').trim();
  if (saved) scanned = isAbsolute(saved) ? saved : resolve(root, saved);
} catch { /* an older graph: its files are relative to the project root */ }
const inProject = (sourceFile) => relative(root, resolve(scanned, sourceFile || '')).replace(/\\/g, '/');
const bare = (label) => String(label || '').replace(/\(.*$/, '').trim();
const line = (location) => (/(\d+)/.exec(location || '') || [])[1];

const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
const wanted = [...nodes.values()].filter((node) => bare(node.label) === bare(fn) && (!file || inProject(node.source_file) === file.replace(/\\/g, '/')));
const targets = new Set(wanted.map((node) => node.id));

const seen = new Set();
const callers = [];
for (const link of graph.links || graph.edges || []) {
  if (link.relation !== 'calls' || !targets.has(link.target) || seen.has(link.source)) continue;
  seen.add(link.source);
  const caller = nodes.get(link.source);
  if (!caller || !caller.label || !line(caller.source_location)) continue;
  callers.push({ fn: caller.label, at: `${inProject(caller.source_file)}:${line(caller.source_location)}` });
}
console.log(JSON.stringify(callers.slice(0, CALLERS_KEEP)));
