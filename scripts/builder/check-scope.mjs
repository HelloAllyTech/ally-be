#!/usr/bin/env node
//
// Refuse a change that wanders outside the plan.
//
// Session 880e73e6 run 3 (2026-10-12) was asked to add rich text to quiz and
// journal prompts. Of the 21 files it changed in ally-web, about six were the
// feature: the rest were three unrelated test files, eight regenerated
// snapshots and live helpline code (useHelplineSocket.ts, useTalkerSession.ts,
// HelplineAccess.tsx), each edited to quiet a check the feature had nothing to
// do with. No check could see it: typecheck, lint and the suites were green,
// and integrity only looks for deleted tests and emptied files.
//
// So this adds a `scope` check to a repo's gate results — a hard check
// (gate-verdict.mjs). The plan's workstream file lists say what the change is
// expected to touch; a changed file is in scope when:
//   - it matches a planned path or glob, or
//   - it is a NEW test file, or a test for a file that is in scope, or
//   - it is new and sits next to a planned file, or
//   - it is documentation (other than AGENTS.md/CLAUDE.md) or a lockfile, or
//   - the coder declared it, with a reason, through the scope_change tool.
// Snapshots are never in scope by association: regenerating one makes a
// failing render test pass whatever the render does, so it is planned or
// declared, and a reviewer reads the declaration.
//
// A plan with no file list for a repo cannot be judged against; the check
// passes and says so rather than blocking a build on the planner's format.
//
// Usage: check-scope.mjs --dir <repo dir> --repo <name> --results <file>
//          [--plan /tmp/builder-plan.md] [--declared /tmp/builder-scope-changes.jsonl]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TEST_FILE =
  /(^|\/)__tests__\/|\.(spec|test)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/;
const SNAPSHOT = /\.snap$/;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock)$/;
const DOC = /\.mdx?$/;
const AGENT_RULES = /(^|\/)(AGENTS|CLAUDE)\.md$/;

/** The repo-relative paths and globs a plan assigns to one repo. */
export function planScope(planMd, repo) {
  if (!planMd) return [];
  const found = new Set();
  const prefix = `repos/${repo}/`;
  let section = null;
  let perRepo = null;
  for (const line of planMd.split('\n')) {
    const heading = line.match(/^(#{2,3})\s+(.*?)\s*$/);
    if (heading) {
      if (heading[1] === '##') {
        section = heading[2].toLowerCase();
        perRepo = null;
      } else if (section && section.startsWith('per-repo')) {
        perRepo = heading[2].replace(/`/g, '').trim();
      }
      continue;
    }
    const ticked = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    if (/^\s*-\s*files:/i.test(line)) {
      for (const item of ticked) {
        if (item.startsWith(prefix)) found.add(item.slice(prefix.length));
        else if (item.startsWith(`${repo}/`)) found.add(item.slice(repo.length + 1));
      }
    } else if (perRepo === repo && /^\s*-\s*`/.test(line) && ticked[0]) {
      const item = ticked[0];
      found.add(item.startsWith(prefix) ? item.slice(prefix.length) : item);
    }
  }
  return [...found].filter(Boolean);
}

/** A planned path or glob as a matcher. A trailing slash means "anything under". */
export function globToRegExp(glob) {
  let pattern = glob.replace(/^\.\//, '');
  if (pattern.endsWith('/')) pattern += '**';
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

const isGlob = (entry) => /[*?]/.test(entry) || entry.endsWith('/');

/** `QuizItemPlayer.test.tsx`, `test_quiz.py` → the name of what they test. */
const subjectOf = (file) =>
  path
    .basename(file)
    .replace(/^test_/, '')
    .replace(/(_test)?\.py$/, '')
    .replace(/\.(spec|test)\.[cm]?[jt]sx?$/, '')
    .replace(/\.[cm]?[jt]sx?$/, '')
    .toLowerCase();

/**
 * Named problems for one repo's diff. Pure, so the policy can be tested
 * directly. `changes` is [{file, status}] with git's A/M/D/R status letter.
 */
export function scopeProblems({ repo, changes, planned, declared }) {
  if (!planned.length) return { judged: false, problems: [] };

  const matchers = planned.map(globToRegExp);
  const inPlan = (file) => matchers.some((re) => re.test(file));
  const plannedDirs = new Set(
    planned.filter((entry) => !isGlob(entry)).map((entry) => path.dirname(entry)),
  );
  const subjects = new Set(
    [
      ...planned.filter((entry) => !isGlob(entry)),
      ...changes.map((c) => c.file).filter(inPlan),
    ].map(subjectOf),
  );
  const declaredHere = new Set(
    declared.filter((d) => d.repo === repo).map((d) => d.path.replace(/^\.\//, '')),
  );

  const problems = [];
  for (const { file, status } of changes) {
    if (inPlan(file) || declaredHere.has(file)) continue;
    if (SNAPSHOT.test(file)) {
      problems.push(
        `${file}: a regenerated snapshot outside the plan — restore it from origin/master, or if the planned change really alters this render, declare it with scope_change and say what changed`,
      );
      continue;
    }
    if (LOCKFILE.test(file)) continue;
    if (DOC.test(file) && !AGENT_RULES.test(file)) continue;
    if (TEST_FILE.test(file) && (status === 'A' || subjects.has(subjectOf(file)))) continue;
    if (status === 'A' && plannedDirs.has(path.dirname(file))) continue;
    problems.push(
      `${file}: not in the plan's file list — restore it from origin/master; if the planned change genuinely needs it, declare it with scope_change and say why`,
    );
  }
  return { judged: true, problems };
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
      // A rename reports old and new; the new path is what changed.
      return { status: parts[0][0], file: parts[parts.length - 1] };
    });
  const untracked = git(dir, ['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    .map((file) => ({ status: 'A', file }));
  return [...changes, ...untracked];
}

const readDeclared = (file) => {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((d) => d && d.repo && d.path);
  } catch {
    return [];
  }
};

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
  const planPath = argOf('plan') ?? '/tmp/builder-plan.md';
  const declaredPath = argOf('declared') ?? '/tmp/builder-scope-changes.jsonl';
  if (!dir || !repo || !resultsPath) {
    console.error('usage: check-scope.mjs --dir <repo dir> --repo <name> --results <file>');
    process.exit(1);
  }

  let planMd = '';
  try {
    planMd = fs.readFileSync(planPath, 'utf8');
  } catch {
    // No plan (a fix run, or the planner failed): nothing to judge against.
  }

  let verdict;
  try {
    verdict = scopeProblems({
      repo,
      changes: collect(dir),
      planned: planScope(planMd, repo),
      declared: readDeclared(declaredPath),
    });
  } catch (error) {
    // Unlike integrity, an unreadable diff is not evidence of a problem here,
    // and integrity already fails on it.
    verdict = { judged: false, problems: [] };
    console.log(`  scope: not checked (${error.message})`);
  }

  let results = { checks: {} };
  try {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  } catch {
    // No results yet. The verdict blocks on a missing file anyway.
  }
  results.checks = results.checks ?? {};
  results.checks.scope = {
    passed: verdict.problems.length === 0,
    command: verdict.judged
      ? "changed files vs the plan's file list"
      : "changed files vs the plan's file list (no list for this repo; not checked)",
    failures: verdict.problems,
    outputTail: verdict.problems.length ? verdict.problems.join('\n') : null,
  };
  fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);

  for (const problem of verdict.problems) console.log(`  scope: ${problem}`);
  if (!verdict.problems.length) {
    console.log(verdict.judged ? '  scope: pass' : '  scope: no file list in the plan for this repo');
  }
}
