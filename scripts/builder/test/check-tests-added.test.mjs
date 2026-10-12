#!/usr/bin/env node
//
// The tests-added check's policy, and its end-to-end path through a real repo.
//
// Run: node scripts/builder/test/check-tests-added.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { testsVerdict } from '../check-tests-added.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CHECK = path.join(HERE, '..', 'check-tests-added.mjs');

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

const lines = (byFile) => (file) => byFile[file] ?? [];

test('code with no test change needs one and has none', () => {
  const verdict = testsVerdict({
    changes: [{ status: 'M', file: 'src/track/service/track.service.ts' }],
    addedLines: lines({}),
  });
  assert.equal(verdict.needed, true);
  assert.deepEqual(verdict.found, []);
});

test('a new spec file counts', () => {
  const verdict = testsVerdict({
    changes: [
      { status: 'M', file: 'src/track/service/track.service.ts' },
      { status: 'A', file: 'src/track/service/test/prompt-html.spec.ts' },
    ],
    addedLines: lines({}),
  });
  assert.deepEqual(verdict.found, ['src/track/service/test/prompt-html.spec.ts']);
});

test('a new case in an existing spec counts; an edited assertion does not', () => {
  const changes = [
    { status: 'M', file: 'src/a.ts' },
    { status: 'M', file: 'src/test/a.spec.ts' },
  ];
  const added = testsVerdict({
    changes,
    addedLines: lines({ 'src/test/a.spec.ts': ["+  it('keeps prompt plain', () => {"] }),
  });
  assert.equal(added.found.length, 1);

  // Run 1 of session 880e73e6 rewrote `prompt` to `promptHtml` across ten
  // existing test files. That is editing tests, not adding one.
  const edited = testsVerdict({
    changes,
    addedLines: lines({ 'src/test/a.spec.ts': ["+    promptHtml: 'x',"] }),
  });
  assert.equal(edited.found.length, 0);
});

test('pytest cases count too', () => {
  const verdict = testsVerdict({
    changes: [
      { status: 'M', file: 'app/agent.py' },
      { status: 'M', file: 'tests/test_agent.py' },
    ],
    addedLines: lines({ 'tests/test_agent.py': ['+def test_handles_empty_turn():'] }),
  });
  assert.equal(verdict.found.length, 1);
});

test('a change that touches no code needs no test', () => {
  const verdict = testsVerdict({
    changes: [
      { status: 'M', file: 'docs/x.md' },
      { status: 'M', file: 'src/test/a.spec.ts' },
    ],
    addedLines: lines({}),
  });
  assert.equal(verdict.needed, false);
});

const repoWith = (setup) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tests-added-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'master');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  git('add', '-A');
  git('-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'builder/x');
  setup(dir);
  return dir;
};

const run = (dir, repo, env = {}) => {
  const results = `${dir}-results.json`;
  const notes = `${dir}-notes.txt`;
  fs.writeFileSync(results, JSON.stringify({ checks: {} }));
  execFileSync('node', [CHECK, '--dir', dir, '--repo', repo, '--results', results, '--notes', notes], {
    stdio: 'ignore',
    env: { ...process.env, ...env },
  });
  return {
    checks: JSON.parse(fs.readFileSync(results, 'utf8')).checks,
    notes: fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8') : '',
  };
};

test('blocks a required repo that changed code with no test', () => {
  const dir = repoWith((d) => fs.writeFileSync(path.join(d, 'src/a.ts'), 'export const a = 2;\n'));
  const { checks, notes } = run(dir, 'ally-be');
  assert.equal(checks.tests.passed, false);
  assert.match(checks.tests.failures[0], /ally-be changes code \(src\/a\.ts\) but adds no test/);
  assert.equal(notes, '');
});

test('tells the reviewer, without blocking, for any other repo', () => {
  const dir = repoWith((d) => fs.writeFileSync(path.join(d, 'src/a.ts'), 'export const a = 2;\n'));
  const { checks, notes } = run(dir, 'ally-web');
  assert.equal(checks.tests, undefined);
  assert.match(notes, /ally-web changes code/);
});

test('passes a required repo that added a test', () => {
  const dir = repoWith((d) => {
    fs.writeFileSync(path.join(d, 'src/a.ts'), 'export const a = 2;\n');
    fs.writeFileSync(path.join(d, 'src/a.spec.ts'), "it('is 2', () => {});\n");
  });
  const { checks } = run(dir, 'ally-be');
  assert.equal(checks.tests.passed, true);
});

console.log(`check-tests-added: ${passed} passed`);
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
