#!/usr/bin/env node
//
// Decide, per check, whether THIS run broke something — and emit the
// gate_result events ally-be stores as machine-verified evidence.
//
// The comparison against the baseline is the whole point. "The suite is red"
// is not a verdict on a change; "the suite is red for three specs that were
// green before you touched it" is. Without the diff, a repo carrying one
// pre-existing failure would block every build in it, and the only escape
// would be letting the agent excuse its own failures.
//
// Policy (mirrors run-test-gate.sh's header):
//   lint, typecheck — any failure blocks. Deterministic, fast, and a change
//     has no business leaving new ones behind. A baseline failure here is
//     still surfaced, but it does not excuse the check.
//   test            — new failures block; baseline-matching ones are carried
//     over and reported.
//
// Prints "passed" or "blocked" on stdout. Writes the events file for the
// caller to POST.

import fs from 'node:fs';

const args = process.argv.slice(2);
const argOf = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1];
};

const repo = argOf('repo') ?? '';
const currentPath = argOf('current');
const baselinePath = argOf('baseline');
const eventsOut = argOf('events-out');

const readJson = (path) => {
  if (!path) return null;
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const current = readJson(currentPath);
if (!current) {
  console.log('blocked');
  process.exit(0);
}

// No baseline (capture failed, or the repo could not be installed) means we
// cannot tell new failures from old ones. Every failure counts as new: the
// safe direction is to make a person look, not to wave a red suite through.
const baseline = readJson(baselinePath);

/** Checks where a pre-existing failure does not excuse the check. */
const HARD_CHECKS = new Set(['lint', 'typecheck']);

const events = [];
let blocked = false;

for (const [kind, result] of Object.entries(current.checks ?? {})) {
  const baselineCheck = baseline?.checks?.[kind] ?? null;
  const baselineFailures = new Set(baselineCheck?.failures ?? []);

  const failures = result.failures ?? [];
  const newFailures = failures.filter((name) => !baselineFailures.has(name));
  const preExisting = failures.filter((name) => baselineFailures.has(name));

  // A check that failed while naming nothing we could parse: treat the whole
  // check as new unless the baseline also failed it with nothing parsed
  // either, which is the "this repo's suite is just red" case.
  const unattributable =
    !result.passed && failures.length === 0
      ? !(baselineCheck && baselineCheck.passed === false)
      : false;

  const isHard = HARD_CHECKS.has(kind);
  const passed = result.passed === true
    ? true
    : isHard
      ? false
      : newFailures.length === 0 && !unattributable;

  if (!passed) blocked = true;

  events.push({
    type: 'gate_result',
    stage: 'GATE',
    payload: {
      repo,
      kind,
      command: result.command ?? '',
      passed,
      // Explicit so a reader can tell "this run broke it" from "it was
      // already broken" without holding the policy in their head.
      newFailures: unattributable
        ? [`${kind} failed (no individual failures could be parsed)`]
        : newFailures,
      preExistingFailures: preExisting,
      hardGate: isHard,
      baselineKnown: Boolean(baselineCheck),
      outputTail: passed ? null : (result.outputTail ?? null),
      machine: true,
    },
  });
}

if (!events.length) {
  // Nothing ran for a repo the diff says changed — cannot be a pass.
  console.log('blocked');
  process.exit(0);
}

if (eventsOut) {
  fs.writeFileSync(eventsOut, JSON.stringify({ events }));
}

console.log(blocked ? 'blocked' : 'passed');
