// The agent copies the data example in its prompt. If the example and check.mjs disagree,
// every map starts from a shape the checker refuses, so the example must pass the checker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, run, writeMap } from './helpers.mjs';

const PROMPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'project-map.md');

function example(heading, language) {
  const text = readFileSync(PROMPT, 'utf8');
  const block = text.slice(text.indexOf(heading)).match(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```'));
  assert.ok(block, `agents/project-map.md has a \`\`\`${language} block under "${heading}"`);
  return block[1];
}

function dataExample() {
  const source = stripComments(example('## The data file', 'js'));
  return JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
}

// Drops `// …` comments that sit outside strings, so URLs inside strings survive.
function stripComments(source) {
  let out = '';
  let inString = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      out += c;
      if (c === '\\') out += source[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
    } else {
      out += c;
    }
  }
  return out;
}

test("the data example in the agent's prompt passes check.mjs", (t) => {
  let data;
  assert.doesNotThrow(() => { data = dataExample(); }, 'the example is valid JSON once comments are removed');
  const result = run('check.mjs', [writeMap(tempDir(t), data)]);
  assert.equal(result.code, 0, `check.mjs refused the prompt's example:\n${result.stderr}`);
});

test("the patch example in the agent's prompt merges into the data example", (t) => {
  const dir = tempDir(t);
  writeMap(dir, dataExample());
  writeFileSync(join(dir, '.project-map', 'map-patch.json'), example('### An update is a patch', 'json'));
  const result = run('merge.mjs', [join(dir, '.project-map')]);
  assert.equal(result.code, 0, `merge.mjs refused the prompt's patch example:\n${result.stderr}`);
  assert.match(result.stdout, /merged: map version 3/);
});
