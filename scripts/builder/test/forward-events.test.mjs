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

console.log('── gemini normaliser (real captured run) ──');

// Captured verbatim from a real `gemini --output-format stream-json` run
// (see forward-events.mjs's doc comment on normaliseGemini): one shell
// command, one read, one write, then the assistant's reply streamed as two
// delta fragments before the terminal result.
const GEMINI_RUN = [
  '{"type":"init","timestamp":"2026-09-09T03:45:05.012Z","session_id":"266cbe6b-2a65-43b3-a554-042cb93fea93","model":"auto-gemini-2.5"}',
  '{"type":"message","timestamp":"2026-09-09T03:45:05.013Z","role":"user","content":"List the files, read sample.txt, write spike-output.txt."}',
  '{"type":"tool_use","timestamp":"2026-09-09T03:45:10.105Z","tool_name":"run_shell_command","tool_id":"a","parameters":{"description":"List files","command":"ls -F"}}',
  '{"type":"tool_use","timestamp":"2026-09-09T03:45:10.115Z","tool_name":"read_file","tool_id":"b","parameters":{"file_path":"sample.txt"}}',
  '{"type":"tool_use","timestamp":"2026-09-09T03:45:10.130Z","tool_name":"write_file","tool_id":"c","parameters":{"file_path":"spike-output.txt","content":"done"}}',
  '{"type":"tool_result","timestamp":"2026-09-09T03:45:10.275Z","tool_id":"a","status":"success","output":"sample.txt"}',
  '{"type":"tool_result","timestamp":"2026-09-09T03:45:10.278Z","tool_id":"b","status":"success","output":""}',
  '{"type":"tool_result","timestamp":"2026-09-09T03:45:10.280Z","tool_id":"c","status":"success"}',
  '{"type":"message","timestamp":"2026-09-09T03:45:14.770Z","role":"assistant","content":"OK","delta":true}',
  '{"type":"message","timestamp":"2026-09-09T03:45:14.772Z","role":"assistant","content":".","delta":true}',
  '{"type":"result","timestamp":"2026-09-09T03:45:14.774Z","status":"success","stats":{"input_tokens":25618,"output_tokens":80,"cached":8107,"duration_ms":9762,"tool_calls":3}}',
];

await test('stdin is passed through byte-for-byte', async () => {
  const { stdout } = await runForwarder(GEMINI_RUN, { engine: 'gemini' });
  assert.equal(stdout, GEMINI_RUN.map((line) => `${line}\n`).join(''));
});

await test('delta-streamed assistant text is merged into one event, not two', async () => {
  // The bug a real run exposed: without buffering, "OK" and "." land as two
  // separate choppy text events instead of the sentence "OK.".
  const { events } = await runForwarder(GEMINI_RUN, { engine: 'gemini' });
  const textEvents = events.filter((event) => event.type === 'text');
  assert.equal(textEvents.length, 1);
  assert.equal(textEvents[0].payload.text, 'OK.');
});

await test('tool and file-edit events still surface around the merged text', async () => {
  const { events } = await runForwarder(GEMINI_RUN, { engine: 'gemini' });
  assert.deepEqual(
    events.map((event) => event.type),
    ['tool_call', 'tool_call', 'file_edit', 'tool_result', 'tool_result', 'tool_result', 'text'],
  );
});

await test('the terminal result is captured for the cost step, with no fabricated cost', async () => {
  const { result } = await runForwarder(GEMINI_RUN, { engine: 'gemini' });
  assert.deepEqual(result, {
    usage: { input_tokens: 25618, output_tokens: 80, cached_tokens: 8107 },
    total_cost_usd: 0,
    duration_ms: 9762,
    num_turns: 3,
  });
});

await test('a run ending mid-delta still flushes its last fragment', async () => {
  // No terminal `result` record at all — the stream just stops. The close
  // handler's flush is the only thing that saves this text from being lost.
  const truncatedRun = GEMINI_RUN.slice(0, -1);
  const { events } = await runForwarder(truncatedRun, { engine: 'gemini' });
  const textEvents = events.filter((event) => event.type === 'text');
  assert.equal(textEvents.length, 1);
  assert.equal(textEvents[0].payload.text, 'OK.');
});

console.log('── claude code normaliser (unaffected by the gemini buffer) ──');

const CLAUDE_RUN = [
  '{"type":"assistant","message":{"content":[{"type":"text","text":"Looking at this."}]}}',
  '{"type":"result","total_cost_usd":0.05}',
];

await test('claude code text is emitted immediately, with no buffering', async () => {
  const { events, result } = await runForwarder(CLAUDE_RUN);
  assert.deepEqual(events, [{ type: 'text', payload: { text: 'Looking at this.' } }]);
  assert.equal(result.total_cost_usd, 0.05);
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
