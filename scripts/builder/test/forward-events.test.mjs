#!/usr/bin/env node
//
// forward-events.mjs's normalisers, exercised as a subprocess against real
// captured engine output — not just unit-tested in isolation, because the
// bug this guards against (Gemini's delta-streamed assistant text arriving
// as separate "OK" / "." records) was only found by running the actual
// script against a real captured run, not by reasoning about the schema.
//
// Run: node scripts/builder/test/forward-events.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FORWARDER = path.join(HERE, '..', 'forward-events.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-events-test-'));
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
 * Starts a throwaway HTTP server standing in for ally-be's events endpoint,
 * runs forward-events.mjs as a real subprocess against `lines` on stdin, and
 * returns everything observable from the outside: the passed-through stdout,
 * the result-out file (if any events posted), and every event batch the
 * server received.
 */
function runForwarder(lines, { engine } = {}) {
  return new Promise((resolve, reject) => {
    const batches = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        batches.push(JSON.parse(body).events);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const resultOut = path.join(tmp, `result-${Math.random()}.json`);

      const child = spawn('node', [FORWARDER, '--result-out', resultOut], {
        env: {
          ...process.env,
          ALLY_BE_API_URL: `http://127.0.0.1:${port}`,
          ALLY_BE_API_KEY: 'test-key',
          BUILDER_RUN_ID: 'test-run',
          ...(engine ? { BUILDER_ENGINE: engine } : {}),
        },
      });

      let stdout = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));

      child.on('error', reject);
      child.on('close', (code) => {
        server.close();
        if (code !== 0) {
          reject(new Error(`forward-events.mjs exited ${code}: ${stderr}`));
          return;
        }
        const result = fs.existsSync(resultOut)
          ? JSON.parse(fs.readFileSync(resultOut, 'utf8'))
          : null;
        resolve({ stdout, result, events: batches.flat() });
      });

      child.stdin.write(lines.map((line) => `${line}\n`).join(''));
      child.stdin.end();
    });
  });
}


// ── opencode ────────────────────────────────────────────────────────────────
//
// Shapes captured from a real run on a real runner
// (.github/workflows/opencode-spike.yml), not from documentation.
const OPENCODE_RUN = [
  '{"type":"step_start","part":{"type":"step-start"}}',
  '{"type":"text","part":{"type":"text","text":"Adding the bell icon."}}',
  '{"type":"tool_use","part":{"type":"tool","tool":"write","state":{"status":"completed","input":{"filePath":"src/Bell.tsx","content":"export const Bell = () => null;"},"output":"written"}}}',
  '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":100,"input":80,"output":20,"cache":{"read":5}},"cost":0.012}}',
  '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":50,"input":40,"output":10,"cache":{"read":0}},"cost":0.008}}',
];

await test('opencode cost is summed across steps, not read off the last one', async () => {
  // The trap this engine brings: cost arrives PER STEP and nothing sums it.
  // Reading only the final frame would price a four-step run as one step.
  const { result } = await runForwarder(OPENCODE_RUN, { engine: 'opencode' });

  assert.equal(result.total_cost_usd, 0.02);
  assert.deepEqual(result.usage, {
    input_tokens: 120,
    output_tokens: 30,
    cached_tokens: 5,
  });
});

await test('an opencode write surfaces as a file edit, not an opaque tool call', async () => {
  const { events } = await runForwarder(OPENCODE_RUN, { engine: 'opencode' });

  assert.deepEqual(
    events.map((event) => event.type),
    ['text', 'file_edit', 'tool_result'],
  );
  const edit = events.find((event) => event.type === 'file_edit');
  assert.equal(edit.payload.path, 'src/Bell.tsx');
  assert.equal(edit.payload.operation, 'write');
});

await test('a refusal from a read-only agent is shown, not hidden', async () => {
  // What the spike actually saw when a denied agent reached for bash: the tool
  // is not offered at all, and opencode answers with a completed `invalid`
  // call carrying the explanation. That is a refusal worth reading.
  const refused = [
    '{"type":"tool_use","part":{"type":"tool","tool":"invalid","state":{"status":"completed","input":{"tool":"bash"},"output":"Model tried to call unavailable tool \'bash\'."}}}',
    '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":1,"output":1},"cost":0.001}}',
  ];
  const { events } = await runForwarder(refused, { engine: 'opencode' });

  const result = events.find((event) => event.type === 'tool_result');
  assert.match(result.payload.text, /unavailable tool/);
});

await test('an opencode auth failure reaches the feed as words', async () => {
  // The spike's own first run died exactly this way, and a silent version of
  // it would look like a model that simply said nothing.
  const failed = [
    '{"type":"error","error":{"name":"ProviderAuthError","data":{"providerID":"google","message":"Google Generative AI API key is missing."}}}',
  ];
  const { events, result } = await runForwarder(failed, { engine: 'opencode' });

  assert.match(events[0].payload.text, /API key is missing/);
  // No step ran, so there is nothing to price — and no fabricated zero either.
  assert.equal(result, null);
});

// Last, not mid-file: this directory is where runForwarder writes each
// result, so removing it early makes every test after it read `null`.


// ── the verdict has to survive the trip ─────────────────────────────────────
//
// run-engine.sh reads the planner's ```plan block and the verifier's ```json
// verdict out of `result` in the file this forwarder writes. opencode has no
// terminal frame carrying the assistant's prose, so that field was simply
// absent — and the consequences were silent rather than loud.
//
// The plan event was never posted, so the coder and every resume read an empty
// plan. And the verdict parser answers "pass" when it cannot find a block, by
// design, so that a reviewer's broken plumbing cannot fail an honest build —
// which meant it answered "pass" on every opencode run ever made. Run 7 of
// session 02def4a3 shipped ally-mobile#104 with 142 events and not one of them
// a `plan` or a `verification`.
const OPENCODE_VERDICT_RUN = [
  '{"type":"step_start","part":{"type":"step-start"}}',
  '{"type":"text","part":{"type":"text","text":"Read the diff against master."}}',
  '{"type":"text","part":{"type":"text","text":"```json\\n{\\"verdict\\":\\"fail\\",\\"objections\\":[{\\"severity\\":\\"blocking\\",\\"summary\\":\\"R1 untested\\"}]}\\n```"}}',
  '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":10,"input":8,"output":2,"cache":{"read":0}},"cost":0.001}}',
];

await test("carries the assistant's prose into the result file", async () => {
  const { result } = await runForwarder(OPENCODE_VERDICT_RUN, {
    engine: 'opencode',
  });

  assert.equal(typeof result.result, 'string');
  assert.match(result.result, /Read the diff against master\./);
});

await test('a failing verdict is readable, instead of reading as a pass', async () => {
  const { result } = await runForwarder(OPENCODE_VERDICT_RUN, {
    engine: 'opencode',
  });

  // Exactly what run-engine.sh does: last ```json block, parsed.
  const blocks = [...result.result.matchAll(/```json\s*([\s\S]*?)```/g)];
  assert.ok(blocks.length, 'no fenced verdict found in the result');
  assert.equal(JSON.parse(blocks[blocks.length - 1][1]).verdict, 'fail');
});

await test('a plan block survives for the coder to read back', async () => {
  const run = [
    '{"type":"step_start","part":{"type":"step-start"}}',
    '{"type":"text","part":{"type":"text","text":"```plan\\n## Approach\\nDo the thing.\\n```"}}',
    '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":5,"input":4,"output":1,"cache":{"read":0}},"cost":0.001}}',
  ];

  const { result } = await runForwarder(run, { engine: 'opencode' });

  const blocks = [...result.result.matchAll(/```plan\s*([\s\S]*?)```/g)];
  assert.ok(blocks.length, 'no fenced plan found in the result');
  assert.match(blocks[blocks.length - 1][1], /Do the thing\./);
});



fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);