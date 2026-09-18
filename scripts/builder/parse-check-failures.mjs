#!/usr/bin/env node
//
// Turn a check tally (kind, passed, command, logfile) into JSON that names the
// individual failures, so the gate can compare failure *identities* rather
// than a bare pass/fail.
//
// That distinction is the whole reason this file exists. A repo whose suite was
// already red for one spec still has to be gated on the specs this run broke —
// comparing only "was red / is red" would either wave through a new regression
// or block a build for a failure that predates it.
//
// Extraction is deliberately best-effort and framework-shaped: jest, vitest,
// pytest, tsc and eslint each name failures differently, and a line we cannot
// attribute is better dropped than guessed at. When nothing can be extracted
// the caller still knows the check failed; it just cannot diff the reasons, and
// the gate falls back to pass/fail for that check.

import fs from 'node:fs';

const args = process.argv.slice(2);
const argOf = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1];
};

const tallyPath = argOf('tally');
const repo = argOf('repo') ?? '';
const outPath = argOf('out');

if (!tallyPath || !outPath) {
  console.error('usage: parse-check-failures.mjs --tally <file> --repo <name> --out <file>');
  process.exit(1);
}

/** Named failures from a check's log, newest framework conventions first. */
export function extractFailures(log) {
  const found = new Set();
  const lines = log.split('\n');

  for (const line of lines) {
    // jest / vitest: "FAIL src/foo/bar.spec.ts" or "✕ does the thing"
    const jestFile = line.match(/^\s*FAIL\s+(\S+)/);
    if (jestFile) found.add(jestFile[1]);

    const jestCase = line.match(/^\s*[✕×]\s+(.+?)(?:\s+\(\d+\s*ms\))?\s*$/);
    if (jestCase) found.add(jestCase[1].trim());

    // pytest: "FAILED tests/test_foo.py::test_bar - AssertionError"
    const pytest = line.match(/^FAILED\s+(\S+)/);
    if (pytest) found.add(pytest[1]);

    // pytest short summary: "tests/test_foo.py::test_bar FAILED"
    const pytestInline = line.match(/^(\S+::\S+)\s+FAILED/);
    if (pytestInline) found.add(pytestInline[1]);

    // tsc: "src/foo.ts(12,3): error TS2345: …"
    const tsc = line.match(/^(\S+?)\((\d+),\d+\):\s+error\s+(TS\d+)/);
    if (tsc) found.add(`${tsc[1]}:${tsc[2]} ${tsc[3]}`);

    // eslint / flake8: "src/foo.ts:12:3  error  message  rule-name"
    const lintish = line.match(
      /^(\S+?):(\d+):\d+:?\s+(?:error|E\d+|F\d+)\s+(.+)$/,
    );
    if (lintish) {
      found.add(`${lintish[1]}:${lintish[2]} ${lintish[3].slice(0, 80).trim()}`);
    }

    // nx run-many summary. Without this an ally-web failure names nothing, so
    // the gate treats it as unattributable and blocks even when the identical
    // failure was already in the baseline — which is the whole point of having
    // a baseline. Two shapes, both emitted by `nx run-many`:
    //
    //   "✖  nx run ally-admin-dashboard:test"
    //   "   ✖  2/3 failed"                        (the tally, deliberately skipped)
    //   "> nx run ally-admin-dashboard:test  [existing outputs match]"
    const nxTarget = line.match(/^\s*[✖✗]\s+nx run\s+(\S+)/);
    if (nxTarget) found.add(nxTarget[1]);

    // "Failed tasks: ally-admin-dashboard:test, ally-helpline-dashboard:test"
    const nxFailedList = line.match(/^\s*Failed tasks?:\s*(.+)$/i);
    if (nxFailedList) {
      for (const task of nxFailedList[1].split(/[,\s]+/)) {
        if (task.includes(':')) found.add(task.trim());
      }
    }
  }

  return [...found];
}

/** The tail a person would actually read to understand a failure. */
export function outputTail(log, maxChars = 3000) {
  const trimmed = log.trimEnd();
  if (trimmed.length <= maxChars) return trimmed;
  return `…[earlier output trimmed]\n${trimmed.slice(-maxChars)}`;
}

const checks = {};
const tally = fs.existsSync(tallyPath)
  ? fs.readFileSync(tallyPath, 'utf8').split('\n').filter(Boolean)
  : [];

for (const row of tally) {
  const [kind, passed, command, logFile] = row.split('\t');
  if (!kind) continue;
  let log = '';
  try {
    log = fs.readFileSync(logFile, 'utf8');
  } catch {
    log = '';
  }
  checks[kind] = {
    passed: passed === 'true',
    command: command ?? '',
    failures: passed === 'true' ? [] : extractFailures(log),
    outputTail: passed === 'true' ? null : outputTail(log),
  };
}

fs.writeFileSync(outPath, `${JSON.stringify({ repo, checks }, null, 2)}\n`);
