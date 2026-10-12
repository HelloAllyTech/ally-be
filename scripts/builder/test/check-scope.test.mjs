#!/usr/bin/env node
//
// The scope check's policy, and its end-to-end path through a real repo.
//
// Run: node scripts/builder/test/check-scope.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { globToRegExp, planScope, scopeProblems } from '../check-scope.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CHECK = path.join(HERE, '..', 'check-scope.mjs');

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

// The shape builder-plan-prompt.ts asks for, trimmed to what the check reads.
const PLAN = [
  '## Approach',
  'Additive promptHtml.',
  '',
  '## Per-repo changes',
  '',
  '### ally-web',
  '- `apps/ally-admin-dashboard/src/types/tracks.ts` — add promptHtml',
  '',
  '## Workstreams',
  '',
  '- **W1 editors** — admin editors',
  '  - requirements: R1',
  '  - files: `repos/ally-web/apps/ally-admin-dashboard/src/pages/CreateTrack/components/editors/**`',
  '- **W2 players** — learner players',
  '  - files: `repos/ally-web/apps/ally-helpline-dashboard/src/pages/track-player/components/players/quiz/QuizItemPlayer.tsx`, `repos/ally-be/src/track/type/quiz.type.ts`',
  '',
  '## Test plan',
  '- R1 — `QuizItemEditor.test.tsx`',
].join('\n');

test('reads workstream files and per-repo changes for one repo only', () => {
  assert.deepEqual(planScope(PLAN, 'ally-web').sort(), [
    'apps/ally-admin-dashboard/src/pages/CreateTrack/components/editors/**',
    'apps/ally-admin-dashboard/src/types/tracks.ts',
    'apps/ally-helpline-dashboard/src/pages/track-player/components/players/quiz/QuizItemPlayer.tsx',
  ]);
  assert.deepEqual(planScope(PLAN, 'ally-be'), ['src/track/type/quiz.type.ts']);
  assert.deepEqual(planScope(PLAN, 'ally-mobile'), []);
});

test('globs: ** spans directories, * stays within one', () => {
  assert.ok(globToRegExp('src/a/**').test('src/a/b/c.ts'));
  assert.ok(globToRegExp('src/**/x.ts').test('src/x.ts'));
  assert.ok(globToRegExp('src/*.ts').test('src/a.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('src/a/').test('src/a/b.ts'));
});

const planned = planScope(PLAN, 'ally-web');
const editors = 'apps/ally-admin-dashboard/src/pages/CreateTrack/components/editors';
const player = 'apps/ally-helpline-dashboard/src/pages/track-player/components/players/quiz';

/**
 * Session 880e73e6 run 3, 2026-10-12: about six of 21 changed ally-web files
 * were the feature. These are the kinds of the other fifteen.
 */
test('the files run 3 wandered into are each named', () => {
  const { judged, problems } = scopeProblems({
    repo: 'ally-web',
    planned,
    declared: [],
    changes: [
      { status: 'M', file: `${editors}/quiz/QuizItemEditor.tsx` },
      { status: 'M', file: `${player}/QuizItemPlayer.tsx` },
      { status: 'M', file: 'apps/ally-admin-dashboard/src/api/__tests__/productUpdates.test.ts' },
      { status: 'M', file: 'apps/ally-helpline-dashboard/src/pages/stress-buster/__tests__/__snapshots__/StressBuster.test.tsx.snap' },
      { status: 'M', file: 'apps/ally-helpline-dashboard/src/hooks/useHelplineSocket.ts' },
      { status: 'M', file: 'apps/ally-helpline-dashboard/src/pages/helpline/HelplineAccess.tsx' },
    ],
  });
  assert.equal(judged, true);
  assert.equal(problems.length, 4);
  assert.match(problems[0], /productUpdates\.test\.ts: not in the plan/);
  assert.match(problems[1], /StressBuster\.test\.tsx\.snap: a regenerated snapshot/);
  assert.match(problems[2], /useHelplineSocket\.ts/);
  assert.match(problems[3], /HelplineAccess\.tsx/);
});

test('tests for planned files, new tests, docs and lockfiles are in scope', () => {
  const { problems } = scopeProblems({
    repo: 'ally-web',
    planned,
    declared: [],
    changes: [
      { status: 'M', file: `${player}/QuizItemPlayer.tsx` },
      { status: 'M', file: `${player}/__tests__/QuizItemPlayer.test.tsx` },
      { status: 'A', file: 'apps/ally-admin-dashboard/src/utils/__tests__/brandNew.test.ts' },
      { status: 'M', file: 'docs/rich-text.md' },
      { status: 'M', file: 'package-lock.json' },
    ],
  });
  assert.deepEqual(problems, []);
});

test('a new file next to a planned one is in scope; an edit to a neighbour is not', () => {
  const { problems } = scopeProblems({
    repo: 'ally-web',
    planned,
    declared: [],
    changes: [
      { status: 'A', file: `${player}/promptHtml.ts` },
      { status: 'M', file: `${player}/QuizResults.tsx` },
    ],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /QuizResults\.tsx/);
});

test('a declared file is in scope, in its own repo only', () => {
  const declared = [{ repo: 'ally-web', path: 'apps/x/y.ts', reason: 'needed' }];
  const ok = scopeProblems({
    repo: 'ally-web',
    planned,
    declared,
    changes: [{ status: 'M', file: 'apps/x/y.ts' }],
  });
  assert.deepEqual(ok.problems, []);
  const other = scopeProblems({
    repo: 'ally-mobile',
    planned: ['src/a.ts'],
    declared,
    changes: [{ status: 'M', file: 'apps/x/y.ts' }],
  });
  assert.equal(other.problems.length, 1);
});

test('editing the agent rules is never "just docs"', () => {
  const { problems } = scopeProblems({
    repo: 'ally-web',
    planned,
    declared: [],
    changes: [{ status: 'M', file: 'AGENTS.md' }],
  });
  assert.equal(problems.length, 1);
});

test('no file list for the repo: not judged, nothing blocked', () => {
  const verdict = scopeProblems({
    repo: 'ally-mobile',
    planned: [],
    declared: [],
    changes: [{ status: 'M', file: 'src/anything.ts' }],
  });
  assert.deepEqual(verdict, { judged: false, problems: [] });
});

// End to end: a real repo, a real plan file, a real results file.
test('writes a failing scope check into the gate results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'master');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'a\n');
  fs.writeFileSync(path.join(dir, 'src/b.ts'), 'b\n');
  git('add', '-A');
  git('-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'builder/x');
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'a2\n');
  fs.writeFileSync(path.join(dir, 'src/b.ts'), 'b2\n');

  const plan = path.join(dir, '..', `${path.basename(dir)}-plan.md`);
  fs.writeFileSync(plan, '## Workstreams\n- **W1** — x\n  - files: `repos/demo/src/a.ts`\n');
  const results = path.join(dir, '..', `${path.basename(dir)}-results.json`);
  fs.writeFileSync(results, JSON.stringify({ checks: { lint: { passed: true } } }));

  execFileSync('node', [CHECK, '--dir', dir, '--repo', 'demo', '--results', results,
    '--plan', plan, '--declared', path.join(dir, 'none.jsonl')], { stdio: 'ignore' });

  const written = JSON.parse(fs.readFileSync(results, 'utf8'));
  assert.equal(written.checks.lint.passed, true, 'other checks are kept');
  assert.equal(written.checks.scope.passed, false);
  assert.equal(written.checks.scope.failures.length, 1);
  assert.match(written.checks.scope.failures[0], /^src\/b\.ts: not in the plan/);
});

console.log(`check-scope: ${passed} passed`);
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
