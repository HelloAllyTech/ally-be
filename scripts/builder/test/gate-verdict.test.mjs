#!/usr/bin/env node
//
// The gate's policy, exercised directly.
//
// This is the judgement that decides whether a change becomes a pull request,
// and it has two failure modes that look identical from the outside: blocking a
// build for a test that was already red, and waving through a regression
// because the suite was red anyway. Both are cheap to introduce and expensive
// to notice, so the table below pins the policy down.
//
// Run: node scripts/builder/test/gate-verdict.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GATE_VERDICT = path.join(HERE, '..', 'gate-verdict.mjs');
const PARSER = path.join(HERE, '..', 'parse-check-failures.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-gate-test-'));
let passed = 0;
const failures = [];

function verdictFor({ current, baseline }) {
  const currentPath = path.join(tmp, `current-${Math.random()}.json`);
  fs.writeFileSync(currentPath, JSON.stringify(current));

  const args = ['--repo', 'demo', '--current', currentPath];
  if (baseline) {
    const baselinePath = path.join(tmp, `baseline-${Math.random()}.json`);
    fs.writeFileSync(baselinePath, JSON.stringify(baseline));
    args.push('--baseline', baselinePath);
  } else {
    args.push('--baseline', path.join(tmp, 'does-not-exist.json'));
  }

  const eventsPath = path.join(tmp, `events-${Math.random()}.json`);
  args.push('--events-out', eventsPath);

  const stdout = execFileSync('node', [GATE_VERDICT, ...args], {
    encoding: 'utf8',
  }).trim();
  const events = fs.existsSync(eventsPath)
    ? JSON.parse(fs.readFileSync(eventsPath, 'utf8')).events
    : [];
  return { verdict: stdout, events };
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message.split('\n')[0]}`);
    failures.push(name);
  }
}

const check = (overrides = {}) => ({
  passed: false,
  command: 'npm test',
  failures: [],
  outputTail: 'boom',
  ...overrides,
});

console.log('── gate policy ──');

test('a clean tree passes', () => {
  const { verdict } = verdictFor({
    current: { checks: { test: check({ passed: true, outputTail: null }) } },
  });
  assert.equal(verdict, 'passed');
});

test('a test this change broke blocks', () => {
  const { verdict, events } = verdictFor({
    current: { checks: { test: check({ failures: ['src/a.spec.ts'] }) } },
    baseline: { checks: { test: { passed: true, failures: [] } } },
  });
  assert.equal(verdict, 'blocked');
  assert.deepEqual(events[0].payload.newFailures, ['src/a.spec.ts']);
});

test('a test that was already red does NOT block', () => {
  // The case that would otherwise make every build in a repo with one flaky
  // spec unbuildable — and whose only other fix is letting the agent excuse
  // its own failures.
  const { verdict, events } = verdictFor({
    current: { checks: { test: check({ failures: ['src/legacy.spec.ts'] }) } },
    baseline: {
      checks: { test: { passed: false, failures: ['src/legacy.spec.ts'] } },
    },
  });
  assert.equal(verdict, 'passed');
  assert.deepEqual(events[0].payload.preExistingFailures, [
    'src/legacy.spec.ts',
  ]);
  assert.deepEqual(events[0].payload.newFailures, []);
});

test('a NEW failure in an already-red suite still blocks', () => {
  // The subtle one: "was red, is red" is not enough. The identities matter.
  const { verdict, events } = verdictFor({
    current: {
      checks: {
        test: check({ failures: ['src/legacy.spec.ts', 'src/new.spec.ts'] }),
      },
    },
    baseline: {
      checks: { test: { passed: false, failures: ['src/legacy.spec.ts'] } },
    },
  });
  assert.equal(verdict, 'blocked');
  assert.deepEqual(events[0].payload.newFailures, ['src/new.spec.ts']);
  assert.deepEqual(events[0].payload.preExistingFailures, [
    'src/legacy.spec.ts',
  ]);
});

test('lint is a hard gate even when it was already failing', () => {
  // Unlike tests: lint and typecheck are fast and deterministic, and a change
  // has no business leaving new ones behind. A pre-existing lint failure is
  // reported but does not excuse the check.
  const { verdict, events } = verdictFor({
    current: { checks: { lint: check({ failures: ['src/a.ts:1 no-unused'] }) } },
    baseline: {
      checks: { lint: { passed: false, failures: ['src/a.ts:1 no-unused'] } },
    },
  });
  assert.equal(verdict, 'blocked');
  assert.equal(events[0].payload.hardGate, true);
});

test('typecheck is a hard gate too', () => {
  const { verdict } = verdictFor({
    current: { checks: { typecheck: check() } },
    baseline: { checks: { typecheck: { passed: false, failures: [] } } },
  });
  assert.equal(verdict, 'blocked');
});

test('an unparseable failure with no baseline blocks', () => {
  // We could not tell what broke and have nothing to compare against, so the
  // safe direction is to make a person look.
  const { verdict, events } = verdictFor({
    current: { checks: { test: check() } },
  });
  assert.equal(verdict, 'blocked');
  assert.equal(events[0].payload.baselineKnown, false);
});

test('a suite that is just red, with a matching red baseline, passes', () => {
  const { verdict } = verdictFor({
    current: { checks: { test: check() } },
    baseline: { checks: { test: { passed: false, failures: [] } } },
  });
  assert.equal(verdict, 'passed');
});

test('a repo whose checks all vanished cannot be a pass', () => {
  const { verdict } = verdictFor({ current: { checks: {} } });
  assert.equal(verdict, 'blocked');
});

test('every check emits a machine-attributed event', () => {
  // The UI and /complete both distinguish these from the agent's own
  // `test_output` narration, so the marker has to be on every one.
  const { events } = verdictFor({
    current: {
      checks: {
        test: check({ passed: true, outputTail: null }),
        lint: check({ passed: true, outputTail: null }),
      },
    },
  });
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.equal(event.type, 'gate_result');
    assert.equal(event.payload.machine, true);
  }
});

console.log('── failure parsing ──');

function parse(log) {
  const logPath = path.join(tmp, `log-${Math.random()}.txt`);
  const tallyPath = path.join(tmp, `tally-${Math.random()}.tsv`);
  const outPath = path.join(tmp, `out-${Math.random()}.json`);
  fs.writeFileSync(logPath, log);
  fs.writeFileSync(tallyPath, `test\tfalse\tnpm test\t${logPath}\n`);
  execFileSync('node', [
    PARSER,
    '--tally', tallyPath,
    '--repo', 'demo',
    '--out', outPath,
  ]);
  return JSON.parse(fs.readFileSync(outPath, 'utf8')).checks.test.failures;
}

test('names jest failures', () => {
  const found = parse(
    'PASS src/ok.spec.ts\nFAIL src/broken.spec.ts\n  ✕ persists the value (4 ms)\n',
  );
  assert.ok(found.includes('src/broken.spec.ts'));
  assert.ok(found.includes('persists the value'));
});

test('names pytest failures', () => {
  const found = parse('FAILED tests/test_foo.py::test_bar - AssertionError\n');
  assert.deepEqual(found, ['tests/test_foo.py::test_bar']);
});

test('names tsc errors with their code', () => {
  const found = parse("src/foo.ts(12,3): error TS2345: Argument of type…\n");
  assert.deepEqual(found, ['src/foo.ts:12 TS2345']);
});

test('names eslint findings', () => {
  const found = parse('src/foo.ts:12:3: error Unexpected any  no-explicit-any\n');
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith('src/foo.ts:12'));
});

test('returns nothing rather than guessing on unfamiliar output', () => {
  // A line we cannot attribute is better dropped than invented: a wrong
  // failure identity makes a pre-existing failure look new.
  assert.deepEqual(parse('Something went wrong somewhere.\n'), []);
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
