#!/usr/bin/env node
//
// A change to code arrives with a test of it.
//
// Every Builder PRD carries a test plan, and the build prompt says tests are
// part of the change. Session 880e73e6 run 3 (2026-10-12) still changed code
// in ally-be, ally-web and ally-mobile and added no test anywhere; the gate
// was green, because a suite with nothing new in it passes.
//
// For a repo whose diff changes code (not only tests), this looks for at least
// one new test: a test file the change added, or a test case added to an
// existing test file. It is a hard `tests` check for the repos in
// BUILDER_TESTS_REQUIRED_REPOS (default: ally-be). Elsewhere it writes the
// finding to a notes file the reviewer is shown instead of blocking, because
// copy and constants changes in the UI repos have no meaningful test and a
// rule that blocks them would be argued around rather than followed.
//
// Usage: check-tests-added.mjs --dir <repo dir> --repo <name> --results <file>
//          [--notes /tmp/builder-untested.txt]

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TEST_FILE =
  /(^|\/)__tests__\/|\.(spec|test)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/;
const CODE_FILE = /\.([cm]?[jt]sx?|py)$/;
// A test case being added, in jest/vitest or pytest.
const NEW_CASE = /^\+\s*(?:(?:it|test)(?:\.each\(.*?\))?\s*\(|def\s+test_\w*\s*\()/;

export const DEFAULT_REQUIRED_REPOS = ['ally-be'];

/**
 * Pure: whether this diff needs a test and has one. `changes` is [{file,
 * status}]; `addedLines(file)` returns the `+` lines of that file's diff.
 */
export function testsVerdict({ changes, addedLines }) {
  const code = changes.filter(
    (c) => c.status !== 'D' && CODE_FILE.test(c.file) && !TEST_FILE.test(c.file),
  );
  if (!code.length) return { needed: false, found: [] };
  const found = changes
    .filter((c) => c.status !== 'D' && TEST_FILE.test(c.file))
    .filter((c) => c.status === 'A' || addedLines(c.file).some((l) => NEW_CASE.test(l)))
    .map((c) => c.file);
  return { needed: true, found, code: code.map((c) => c.file) };
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function collect(dir) {
  let upstream = 'origin/master';
  try {
    git(dir, ['rev-parse', '--verify', '--quiet', upstream]);
  } catch {
    upstream = 'master';
  }
  const base = git(dir, ['merge-base', upstream, 'HEAD']).trim();
  const changes = git(dir, ['diff', '--name-status', '--find-renames', base])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      return { status: parts[0][0], file: parts[parts.length - 1] };
    });
  const untracked = git(dir, ['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    .map((file) => ({ status: 'A', file }));
  const addedLines = (file) => {
    try {
      return git(dir, ['diff', '-U0', base, '--', file])
        .split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    } catch {
      return [];
    }
  };
  return { changes: [...changes, ...untracked], addedLines };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const argOf = (name) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? null : args[index + 1];
  };
  const dir = argOf('dir');
  const repo = argOf('repo');
  const resultsPath = argOf('results');
  const notesPath = argOf('notes') ?? '/tmp/builder-untested.txt';
  if (!dir || !repo || !resultsPath) {
    console.error('usage: check-tests-added.mjs --dir <repo dir> --repo <name> --results <file>');
    process.exit(1);
  }
  const required = (process.env.BUILDER_TESTS_REQUIRED_REPOS ?? DEFAULT_REQUIRED_REPOS.join(','))
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  let verdict;
  try {
    verdict = testsVerdict(collect(dir));
  } catch (error) {
    console.log(`  tests: not checked (${error.message})`);
    process.exit(0);
  }
  if (!verdict.needed) {
    console.log('  tests: no code changed');
    process.exit(0);
  }
  const missing = verdict.found.length === 0;
  const problem = `${repo} changes code (${verdict.code.slice(0, 5).join(', ')}${
    verdict.code.length > 5 ? ', …' : ''
  }) but adds no test: write the tests the PRD's test plan names for it`;

  if (required.includes(repo)) {
    let results = { checks: {} };
    try {
      results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    } catch {
      // No results yet. The verdict blocks on a missing file anyway.
    }
    results.checks = results.checks ?? {};
    results.checks.tests = {
      passed: !missing,
      command: 'a new test file or test case for a change to code',
      failures: missing ? [problem] : [],
      outputTail: missing ? problem : null,
    };
    fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  } else if (missing) {
    fs.appendFileSync(notesPath, `${problem}\n`);
  }
  console.log(missing ? `  tests: ${problem}` : `  tests: ${verdict.found.length} new test file(s)/case(s)`);
}
