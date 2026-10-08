#!/usr/bin/env node
//
// The integrity check's policy, and its end-to-end path through a real repo.
//
// Run: node scripts/builder/test/check-integrity.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { integrityProblems } from '../check-integrity.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CHECK = path.join(HERE, '..', 'check-integrity.mjs');

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

const lines = (counts) => (file) => counts[file] ?? 0;

test('a deleted spec blocks', () => {
  const problems = integrityProblems({
    deleted: ['src/app.module.spec.ts', 'src/track/service/test/track-progress.min-score.spec.ts'],
    numstat: [],
    originalLines: lines({}),
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /deleted test file src\/app\.module\.spec\.ts/);
});

test('vitest, __tests__ and pytest files count as tests', () => {
  const problems = integrityProblems({
    deleted: [
      'apps/a/src/api/__tests__/helpers.ts',
      'apps/a/src/Foo.test.tsx',
      'tests/test_agent.py',
      'app/agent_test.py',
    ],
    numstat: [],
    originalLines: lines({}),
  });
  assert.equal(problems.length, 4);
});

test('a deleted non-test file is not a test deletion', () => {
  const problems = integrityProblems({
    deleted: ['src/old-helper.ts', 'docs/notes.md'],
    numstat: [],
    originalLines: lines({}),
  });
  assert.deepEqual(problems, []);
});

test('an emptied service blocks (session 178e6598 run 2)', () => {
  const problems = integrityProblems({
    deleted: [],
    numstat: [{ file: 'src/track/service/track-enrollment.service.ts', added: 20, removed: 1923 }],
    originalLines: lines({ 'src/track/service/track-enrollment.service.ts': 2100 }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /lost 1903 of its 2100 lines/);
});

test('a large file losing under half passes', () => {
  const problems = integrityProblems({
    deleted: [],
    numstat: [{ file: 'src/big.ts', added: 0, removed: 400 }],
    originalLines: lines({ 'src/big.ts': 1000 }),
  });
  assert.deepEqual(problems, []);
});

test('a small file emptied below the line floor passes', () => {
  const problems = integrityProblems({
    deleted: [],
    numstat: [{ file: 'src/small.ts', added: 0, removed: 100 }],
    originalLines: lines({ 'src/small.ts': 110 }),
  });
  assert.deepEqual(problems, []);
});

test('non-code files are ignored', () => {
  const problems = integrityProblems({
    deleted: [],
    numstat: [{ file: 'package-lock.json', added: 0, removed: 5000 }],
    originalLines: lines({ 'package-lock.json': 6000 }),
  });
  assert.deepEqual(problems, []);
});

test('end to end: merges an integrity check into the results file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-integrity-'));
  const origin = path.join(tmp, 'origin');
  const repo = path.join(tmp, 'repo');
  const git = (dir, ...args) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' });

  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'master');
  git(origin, 'config', 'user.email', 't@example.com');
  git(origin, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(origin, 'src'));
  fs.writeFileSync(path.join(origin, 'src', 'a.spec.ts'), 'it("works", () => {});\n');
  fs.writeFileSync(
    path.join(origin, 'src', 'service.ts'),
    Array.from({ length: 300 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n',
  );
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'init');
  execFileSync('git', ['clone', '-q', origin, repo]);
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');

  const results = path.join(tmp, 'results.json');
  const run = () => {
    fs.writeFileSync(results, JSON.stringify({ repo: 'demo', checks: { lint: { passed: true } } }));
    execFileSync('node', [CHECK, '--dir', repo, '--results', results], { stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(results, 'utf8')).checks;
  };

  // Untouched: passes, and the existing checks survive the merge.
  let checks = run();
  assert.equal(checks.integrity.passed, true);
  assert.equal(checks.lint.passed, true);

  // Uncommitted damage counts, as in the gate's affected-test run.
  fs.rmSync(path.join(repo, 'src', 'a.spec.ts'));
  fs.writeFileSync(path.join(repo, 'src', 'service.ts'), 'export {};\n');
  checks = run();
  assert.equal(checks.integrity.passed, false);
  assert.equal(checks.integrity.failures.length, 2);

  // A rename is not a deletion.
  git(repo, 'checkout', '-q', '--', '.');
  git(repo, 'mv', 'src/a.spec.ts', 'src/b.spec.ts');
  checks = run();
  assert.equal(checks.integrity.passed, true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

if (failures.length) {
  console.error(`${failures.length} failed, ${passed} passed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`check-integrity: ${passed} passed`);
