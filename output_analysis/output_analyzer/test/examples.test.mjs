// Regenerates the example datasets into a temporary directory and checks that they match the
// committed files byte for byte, and that each module entry's text equals its data file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'data', 'generate_examples.mjs');
const { EXAMPLES } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'examples.js')).href);

test('regenerated files match the committed ones byte for byte', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-'));
  try {
    execFileSync('node', [GEN, '--out', tmp]);
    const files = fs.readdirSync(path.join(tmp, 'data'));
    assert.equal(files.length, 7);
    for (const f of files) {
      assert.ok(fs.readFileSync(path.join(tmp, 'data', f)).equals(fs.readFileSync(path.join(ROOT, 'data', f))), f);
    }
    const mod = path.join('js', 'data', 'examples.js');
    assert.ok(fs.readFileSync(path.join(tmp, mod)).equals(fs.readFileSync(path.join(ROOT, mod))), mod);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('each entry carries its data file text and a mapping with a kind', () => {
  assert.equal(EXAMPLES.length, 7);
  for (const e of EXAMPLES) {
    assert.equal(e.text, fs.readFileSync(path.join(ROOT, 'data', e.file), 'utf8'), e.file);
    assert.ok(['tally', 'time', 'reps'].includes(e.mapping.kind), e.id);
    assert.equal(e.mapping.kind, e.kind);
    assert.ok(['minus1', 'columns'].includes(e.format));
  }
});
