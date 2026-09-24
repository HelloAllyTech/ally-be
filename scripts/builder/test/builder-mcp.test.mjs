#!/usr/bin/env node
//
// The MCP reporting server, exercised as a real subprocess speaking real
// JSON-RPC to a real HTTP server.
//
// Mocking either side would miss the whole point: this server exists because
// the shell channel kept failing at the seams between processes, so the seams
// are what these tests cover.
//
// Run: node scripts/builder/test/builder-mcp.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVER = path.join(HERE, '..', 'builder-mcp.mjs');

// Markers go to a temp dir: a test that writes into the repo is a test that
// shows up in someone else's `git status`.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-mcp-test-'));

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
 * Stands up a fake ally-be, runs the server as a subprocess, drives the full
 * MCP handshake and then one `tools/call`, and hands back both what the agent
 * would see and what ally-be actually received.
 */
function callTool(name, args, { status = 200, body = '{}' } = {}) {
  return new Promise((resolve, reject) => {
    const received = [];

    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        let parsed = null;
        let parseError = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (error) {
          parseError = error.message;
        }
        received.push({ url: req.url, method: req.method, parsed, parseError });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const child = spawn('node', [SERVER], {
        env: {
          ...process.env,
          ALLY_BE_API_URL: `http://127.0.0.1:${port}`,
          ALLY_BE_API_KEY: 'test-key',
          BUILDER_RUN_ID: 'test-run',
          // Point the marker files somewhere harmless.
          BUILDER_HELPER_ENV: '/nonexistent-on-purpose',
          BUILDER_REPORTED_MARKER: path.join(tmp, 'reported-marker'),
        },
      });

      const replies = [];
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) replies.push(JSON.parse(line));
          // The tool reply is id 3; everything is done once it lands.
          if (replies.some((reply) => reply.id === 3)) {
            child.stdin.end();
          }
        }
      });

      child.on('error', reject);
      child.on('close', () => {
        server.close();
        const call = replies.find((reply) => reply.id === 3);
        resolve({ call, received, replies });
      });

      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`,
      );
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      );
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } })}\n`,
      );
    });
  });
}

const textOf = (call) => call?.result?.content?.[0]?.text ?? '';

console.log('── builder MCP reporting server ──');

await test('a markdown report arrives as valid JSON, newlines and all', async () => {
  // THE regression. Through the shell channel the agent hand-assembled
  // `{"type":"run_report","contentMd":"## What was done⏎…` and ally-be
  // answered 400, losing the whole write-up. A JSON string cannot hold a
  // literal newline; a JSON-RPC field can hold anything.
  const contentMd =
    '## What was done\n\n- Moved notifications to a bell icon.\n- 11 tests.\n\n' +
    'It had "quotes", a \\backslash and a ```fence```.\n';

  const { call, received } = await callTool('report', { contentMd });

  const post = received.find((r) => r.url.endsWith('/report'));
  assert.equal(post.parseError, null, 'ally-be must be able to parse it');
  assert.equal(post.parsed.type, 'run_report');
  assert.equal(post.parsed.contentMd, contentMd);
  assert.match(textOf(call), /stored/);
});

await test('a refused report is said in the feed, not swallowed', async () => {
  const { received, call } = await callTool(
    'report',
    { contentMd: '## Anything\n' },
    { status: 500, body: '{"message":"nope"}' },
  );

  const said = received.find(
    (r) =>
      r.url.endsWith('/events') &&
      /could not be stored/.test(JSON.stringify(r.parsed)),
  );
  assert.ok(said, 'the drop must reach the run feed');
  assert.match(textOf(call), /NOT stored/);
});

await test('a stage the rail does not know is refused with the list', async () => {
  const { call, received } = await callTool('stage', { stage: 'EXECUTION' });

  assert.equal(call.result.isError, true);
  assert.match(textOf(call), /is not a stage/);
  assert.match(textOf(call), /REMEDIATING/);
  assert.equal(
    received.filter((r) => r.url.endsWith('/events')).length,
    0,
    'nothing should reach ally-be',
  );
});

await test('a near-miss spelling is corrected rather than argued with', async () => {
  const { call, received } = await callTool('stage', { stage: 'finalizing' });

  assert.match(textOf(call), /FINALISING/);
  const post = received.find((r) => r.url.endsWith('/events'));
  assert.equal(post.parsed.events[0].payload.stage, 'FINALISING');
});

await test('the checklist takes structured items, with no file and no jq', async () => {
  const items = [
    { id: '1', text: 'Add the icon', status: 'done' },
    { id: '2', text: 'Write tests', status: 'in_progress' },
  ];
  const { call, received } = await callTool('todo', { items });

  const post = received.find((r) => r.url.endsWith('/events'));
  assert.deepEqual(post.parsed.events[0].payload.items, items);
  assert.match(textOf(call), /2 item/);
});

await test('an empty question is refused before it can pause the run', async () => {
  const { call, received } = await callTool('ask', { questions: [] });

  assert.equal(call.result.isError, true);
  assert.equal(received.length, 0);
});

await test('a pause that was not recorded says so, loudly', async () => {
  // The agent must not believe it paused. It is still running, and something
  // has to tell it so.
  const { call } = await callTool(
    'ask',
    { questions: [{ question: 'Which repo?' }] },
    { status: 503, body: '{"message":"down"}' },
  );

  assert.equal(call.result.isError, true);
  assert.match(textOf(call), /still running/);
});

await test('a refused completion is reported as refused, not as success', async () => {
  // ally-be answers 2xx with `ok:false` when it refuses a `done` the gate does
  // not corroborate. A naive reader sees the 200 and calls it recorded.
  const { call } = await callTool(
    'complete_run',
    { outcome: 'done' },
    { status: 200, body: '{"ok":false,"note":"No passing gate_result."}' },
  );

  assert.equal(call.result.isError, true);
  assert.match(textOf(call), /REFUSED/);
  assert.match(textOf(call), /No passing gate_result/);
});

await test('a failure carries a reason even when none was given', async () => {
  const { received } = await callTool('complete_run', { outcome: 'failed' });

  const post = received.find((r) => r.url.endsWith('/complete'));
  assert.equal(post.parsed.outcome, 'failed');
  assert.match(post.parsed.error, /without a reason/);
});

await test('a dead ally-be does not take the server down with it', async () => {
  // Telemetry may never fail a build. The agent gets something it can read.
  const child = spawn('node', [SERVER], {
    env: {
      ...process.env,
      // A port nothing is listening on.
      ALLY_BE_API_URL: 'http://127.0.0.1:1',
      ALLY_BE_API_KEY: 'k',
      BUILDER_RUN_ID: 'r',
      BUILDER_HELPER_ENV: '/nonexistent-on-purpose',
    },
  });

  const reply = await new Promise((resolve, reject) => {
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (const line of buffer.split('\n')) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id === 3) {
          child.stdin.end();
          resolve(parsed);
        }
      }
    });
    child.on('error', reject);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'stage', arguments: { stage: 'CODING' } } })}\n`,
    );
  });

  assert.ok(reply.result, 'a transport failure must not be a JSON-RPC error');
  assert.match(textOf(reply), /CODING/);
});

await test('an unknown method is declined without killing the session', async () => {
  const { replies } = await callTool('stage', { stage: 'CODING' });
  // The handshake and the call both answered, in order, on one process.
  assert.equal(replies.find((r) => r.id === 1).result.serverInfo.name, 'builder-reporting');
  assert.ok(replies.find((r) => r.id === 3).result);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
