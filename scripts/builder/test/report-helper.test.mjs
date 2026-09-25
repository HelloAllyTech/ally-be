#!/usr/bin/env node
//
// The `report` helper, exercised as a real subprocess against a real HTTP
// server — the only way to catch what it is guarding against, which is a body
// ally-be refuses to parse.
//
// Run: node scripts/builder/test/report-helper.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const HELPER = path.join(HERE, '..', 'agent-helpers', 'report');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'report-helper-test-'));
let passed = 0;
const failures = [];

function test(name, fn) {
  return fn()
    .then(() => {
      console.log(`  ok   ${name}`);
      passed += 1;
    })
    .catch((error) => {
      console.log(`  FAIL ${name}`);
      console.log(`       ${error.message.split('\n')[0]}`);
      failures.push(name);
    });
}

/**
 * Stands up a fake ally-be that parses each body exactly as Nest would — a
 * JSON body parser in front of the handler — runs the helper against a file,
 * and reports what arrived where.
 */
function runHelper(contents, { reportStatus = 200 } = {}) {
  return new Promise((resolve, reject) => {
    const reports = [];
    const events = [];
    let reportParseError = null;

    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const isReport = req.url.endsWith('/report');
        try {
          const parsed = JSON.parse(body);
          (isReport ? reports : events).push(parsed);
        } catch (error) {
          // Exactly what ally-be did on 2026-09-23: 400, unparseable.
          if (isReport) reportParseError = error.message;
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"message":"Unexpected token"}');
          return;
        }
        res.writeHead(isReport ? reportStatus : 200, {
          'Content-Type': 'application/json',
        });
        res.end('{}');
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const file = path.join(tmp, `report-${Math.random()}`);
      fs.writeFileSync(file, contents);

      const envFile = path.join(tmp, `env-${Math.random()}`);
      fs.writeFileSync(
        envFile,
        [
          `ALLY_BE_API_URL='http://127.0.0.1:${port}'`,
          "BUILDER_RUN_ID='test-run'",
          "ALLY_BE_API_KEY='test-key'",
        ].join('\n'),
      );

      const child = spawn('bash', [HELPER, file], {
        env: { ...process.env, BUILDER_HELPER_ENV: envFile },
      });

      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        server.close();
        resolve({ code, stderr, reports, events, reportParseError });
      });
    });
  });
}

console.log('── report helper ──');

// The body from the real failure: a correct envelope whose markdown carries
// the literal newlines JSON does not allow.
const HAND_ASSEMBLED_BROKEN = `{ "type": "run_report", "contentMd": "## What was done

- Moved notifications to a bell icon.
- 11 new tests, all passing.
" }`;

await test('markdown is wrapped into an envelope ally-be can parse', async () => {
  const md = '## What was done\n\n- Moved notifications to a bell icon.\n';
  const { reports, reportParseError } = await runHelper(md);

  assert.equal(reportParseError, null);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].type, 'run_report');
  assert.equal(reports[0].contentMd, md);
});

await test('hand-assembled JSON broken by its own newlines still arrives', async () => {
  // The regression. Before this helper composed the envelope itself, this
  // body went to ally-be verbatim and came back 400, losing the report.
  const { reports, reportParseError } = await runHelper(HAND_ASSEMBLED_BROKEN);

  assert.equal(reportParseError, null, 'the body must be parseable');
  assert.equal(reports.length, 1);
  assert.match(reports[0].contentMd, /What was done/);
  assert.match(reports[0].contentMd, /11 new tests/);
});

await test('a valid envelope is passed through untouched', async () => {
  const envelope = JSON.stringify({
    type: 'run_report',
    contentMd: '## Fine\n',
    metrics: { attempts: 2 },
  });
  const { reports } = await runHelper(envelope);

  assert.equal(reports.length, 1);
  assert.equal(reports[0].contentMd, '## Fine\n');
  assert.deepEqual(reports[0].metrics, { attempts: 2 });
});

await test('a refused report is said in the run feed, not swallowed', async () => {
  // Telemetry may never fail a build, so the exit code stays 0 — but a
  // dropped report used to leave no trace a person would ever read.
  const { code, events, stderr } = await runHelper('## Anything\n', {
    reportStatus: 500,
  });

  assert.equal(code, 0, 'must not fail the build');
  assert.match(stderr, /was not stored/);
  const texts = events.flatMap((batch) =>
    (batch.events ?? []).map((event) => event.payload?.text ?? ''),
  );
  assert.equal(texts.filter((t) => /could not be stored/.test(t)).length, 1);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
