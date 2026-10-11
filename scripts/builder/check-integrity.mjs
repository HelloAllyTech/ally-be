#!/usr/bin/env node
//
// Refuse a change that passes the gate by removing what the gate measures.
//
// The test check can only see failures in specs that still exist. In session
// 178e6598 run 2, `wip(builder): code attempt 2` deleted four failing spec
// files (app.module.spec.ts among them) and ~1,900 lines of
// track-enrollment.service.ts. Every later round, and every retry, then saw a
// green ally-be test check on a service that no longer did anything. Lint and
// typecheck agree with an empty file too.
//
// So this adds an `integrity` check to a repo's gate results. It is a hard
// check (gate-verdict.mjs): a baseline cannot excuse it. It fails on:
//   - a deleted test file. Renames are not deletions; git reports them as R.
//   - a code file the change mostly emptied: at least MIN_LINES_REMOVED lines
//     removed net, leaving under half of what was there. A real refactor
//     that moves code shows up as additions in another file, so it still
//     passes as long as the net loss in each file stays under the limit.
//
// Usage: check-integrity.mjs --dir <repo dir> --results <gate results json>
// Compares the working tree with its merge-base on origin/master, so
// uncommitted edits count, as in the gate's affected-test run.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const MIN_LINES_REMOVED = 150;
export const MAX_SHARE_REMOVED = 0.5;

const TEST_FILE =
  /(^|\/)__tests__\/|\.(spec|test)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/;
const CODE_FILE = /\.([cm]?[jt]sx?|py)$/;

/** Named problems for one diff. Pure, so the policy can be tested directly. */
export function integrityProblems({ deleted, numstat, originalLines }) {
  const problems = [];
  for (const file of deleted) {
    if (TEST_FILE.test(file)) {
      problems.push(
        `deleted test file ${file}: restore it from origin/master and fix the code it tests, not the test`,
      );
    }
  }
  const gone = new Set(deleted);
  for (const { file, added, removed } of numstat) {
    // A deleted file is either a deleted test (named above) or a removal a
    // change may legitimately make. Either way it is not "emptied".
    if (gone.has(file) || !CODE_FILE.test(file)) continue;
    const before = originalLines(file);
    const net = removed - added;
    if (!before || net < MIN_LINES_REMOVED) continue;
    if (net / before <= MAX_SHARE_REMOVED) continue;
    problems.push(
      `${file} lost ${net} of its ${before} lines: restore it from origin/master and make the change without emptying it`,
    );
  }
  return problems;
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function collect(dir) {
  // origin/master on a runner clone; plain master in a repo with no remote,
  // which is what the dry-run harness builds.
  let upstream = 'origin/master';
  try {
    git(dir, ['rev-parse', '--verify', '--quiet', upstream]);
  } catch {
    upstream = 'master';
  }
  const base = git(dir, ['merge-base', upstream, 'HEAD']).trim();
  const deleted = git(dir, ['diff', '--name-only', '--diff-filter=D', base])
    .split('\n')
    .filter(Boolean);
  const numstat = git(dir, ['diff', '--numstat', base])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    // Binary files report "-" for both counts.
    .filter(([added, removed]) => added !== '-' && removed !== '-')
    .map(([added, removed, file]) => ({
      file,
      added: Number(added),
      removed: Number(removed),
    }));
  const originalLines = (file) => {
    try {
      return git(dir, ['show', `${base}:${file}`]).split('\n').length;
    } catch {
      return 0;
    }
  };
  return { deleted, numstat, originalLines };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const argOf = (name) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? null : args[index + 1];
  };
  const dir = argOf('dir');
  const resultsPath = argOf('results');
  if (!dir || !resultsPath) {
    console.error('usage: check-integrity.mjs --dir <repo dir> --results <file>');
    process.exit(1);
  }

  let problems;
  try {
    problems = integrityProblems(collect(dir));
  } catch (error) {
    // Cannot read the diff, so cannot vouch for it.
    problems = [`could not read the diff against origin/master: ${error.message}`];
  }

  let results = { checks: {} };
  try {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  } catch {
    // No results yet. The verdict blocks on a missing file anyway.
  }
  results.checks = results.checks ?? {};
  results.checks.integrity = {
    passed: problems.length === 0,
    command: 'deleted tests / emptied files vs origin/master',
    failures: problems,
    outputTail: problems.length ? problems.join('\n') : null,
  };
  fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);

  for (const problem of problems) console.log(`  integrity: ${problem}`);
  if (!problems.length) console.log('  integrity: pass');
}
