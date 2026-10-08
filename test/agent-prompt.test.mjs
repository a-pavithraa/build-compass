// The agent copies the data example in its prompt. If the example and check.mjs disagree,
// every map starts from a shape the checker refuses, so the example must pass the checker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, run, writeMap } from './helpers.mjs';

const PROMPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'project-map.md');

function dataExample() {
  const text = readFileSync(PROMPT, 'utf8');
  const section = text.slice(text.indexOf('## The data file'));
  const block = section.match(/```js\n([\s\S]*?)\n```/);
  assert.ok(block, 'agents/project-map.md has a ```js block under "## The data file"');
  return block[1];
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
  const source = stripComments(dataExample());
  const json = source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1);
  let data;
  assert.doesNotThrow(() => { data = JSON.parse(json); }, 'the example is valid JSON once comments are removed');
  const result = run('check.mjs', [writeMap(tempDir(t), data)]);
  assert.equal(result.code, 0, `check.mjs refused the prompt's example:\n${result.stderr}`);
});
