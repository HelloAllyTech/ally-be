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

/** The file run-engine.sh rewrites before each phase. */
const writePhase = (phase) => {
  const file = path.join(tmp, `phase-${Math.random()}`);
  fs.writeFileSync(file, phase);
  return file;
};

/** Drives the handshake and returns the tools the server offers. */
function listTools(phase) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SERVER], {
      env: {
        ...process.env,
        ALLY_BE_API_URL: 'http://127.0.0.1:1',
        ALLY_BE_API_KEY: 'k',
        BUILDER_RUN_ID: 'r',
        BUILDER_HELPER_ENV: '/nonexistent-on-purpose',
        BUILDER_PHASE_FILE:
          phase === undefined ? '/nonexistent-on-purpose' : writePhase(phase),
      },
    });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (const line of buffer.split('\n')) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id === 2) {
          child.stdin.end();
          resolve(parsed.result.tools.map((t) => t.name));
        }
      }
    });
    child.on('error', reject);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`,
    );
  });
}

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
function callTool(name, args, { status = 200, body = '{}', phase } = {}) {
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
          BUILDER_PHASE_FILE: phase === undefined ? '/nonexistent-on-purpose' : writePhase(phase),
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

console.log('── builder MCP reporting server (design runs) ──');

// Each pass gets its own tool and `note`, nothing else: the designer must not
// file a verdict on its own design, and the critic must not rewrite it.
await test('each design pass is offered only its own tool and note', async () => {
  assert.deepEqual((await listTools('design')).sort(), ['design', 'note']);
  assert.deepEqual((await listTools('design-review')).sort(), ['design_review', 'note']);
});

await test('any other phase gets note only', async () => {
  for (const phase of ['setup', 'code', 'review', '', undefined]) {
    assert.deepEqual(await listTools(phase), ['note'], `${phase} must get note only`);
  }
});

const DESIGN = {
  designMd: '## Approach',
  scope: [{ repo: 'ally-be', files: ['src/a.ts'] }],
  contracts: [],
  compatibilityMd: '',
  testMap: [],
  openDecisions: [],
};

await test('a markdown design arrives as valid JSON, newlines and all', async () => {
  // Through the old shell channel a hand-assembled JSON string holding
  // multi-line markdown was a 400. A JSON-RPC field can hold anything.
  const designMd =
    '## Approach\n\n- Add a column.\n- 11 tests.\n\n' +
    'It had "quotes", a \\backslash and a ```fence```.\n';
  const { received } = await callTool('design', { ...DESIGN, designMd }, { phase: 'design' });
  const post = received.find((r) => r.url.endsWith('/design'));
  assert.equal(post.parseError, null, 'ally-be must be able to parse it');
  assert.equal(post.parsed.designMd, designMd);
});

await test('a submitted design marks the run and relays what blocks approval', async () => {
  const marker = path.join(tmp, 'design-submitted');
  process.env.BUILDER_DESIGN_SUBMITTED = marker;
  try {
    const { call, received } = await callTool('design', DESIGN, {
      phase: 'design',
      body: JSON.stringify({ ok: true, blockers: ['R1 has no test in the test map'] }),
    });
    const post = received.find((r) => r.url.endsWith('/design'));
    assert.deepEqual(post.parsed, DESIGN);
    assert.ok(fs.existsSync(marker), 'the runner reads this marker');
    assert.match(textOf(call), /blocked by:\n- R1 has no test/);
  } finally {
    delete process.env.BUILDER_DESIGN_SUBMITTED;
  }
});

await test('a refused design is an error and leaves no marker', async () => {
  const marker = path.join(tmp, 'design-refused');
  process.env.BUILDER_DESIGN_SUBMITTED = marker;
  try {
    const { call } = await callTool('design', DESIGN, {
      phase: 'design',
      status: 400,
      body: '{"message":"not this run"}',
    });
    assert.equal(call.result.isError, true);
    assert.ok(!fs.existsSync(marker));
  } finally {
    delete process.env.BUILDER_DESIGN_SUBMITTED;
  }
});

await test('a design review derives its verdict from defects, and keeps suggestions apart', async () => {
  const marker = path.join(tmp, 'design-reviewed');
  process.env.BUILDER_DESIGN_REVIEWED = marker;
  try {
    const { call, received } = await callTool(
      'design_review',
      { defects: [], suggestions: ['Article questions could take rich text too.'] },
      { phase: 'design-review' },
    );
    const post = received.find((r) => r.url.endsWith('/design-review'));
    // A sound design with only suggestions passes.
    assert.equal(post.parsed.verdict, 'pass');
    assert.deepEqual(post.parsed.suggestions, ['Article questions could take rich text too.']);
    assert.match(post.parsed.notesMd, /\*\*Suggestions\*\*/);
    assert.ok(fs.existsSync(marker));
    assert.match(textOf(call), /review stored \(pass: 0 defect\(s\), 1 suggestion\(s\)\)/);

    const second = await callTool(
      'design_review',
      { defects: ['ally-be:src/a.ts:9 reads prompt and is not listed'], suggestions: [] },
      { phase: 'design-review' },
    );
    const failed = second.received.find((r) => r.url.endsWith('/design-review'));
    assert.equal(failed.parsed.verdict, 'concerns');
  } finally {
    delete process.env.BUILDER_DESIGN_REVIEWED;
  }
});

await test('a note reaches the run feed', async () => {
  const { call, received } = await callTool(
    'note',
    { type: 'plan', text: 'Reading the three readers.' },
    { phase: 'design' },
  );
  const post = received.find((r) => r.url.endsWith('/events'));
  assert.deepEqual(post.parsed.events, [
    { type: 'plan', payload: { text: 'Reading the three readers.' } },
  ]);
  assert.match(textOf(call), /note recorded/);
});

await test('calling the other pass\'s tool says it does not exist here', async () => {
  const { call, received } = await callTool(
    'design_review',
    { defects: [], suggestions: [] },
    { phase: 'design' },
  );
  assert.equal(call.result.isError, true);
  assert.match(textOf(call), /not available to the design phase/);
  // Nothing reached ally-be.
  assert.equal(received.length, 0);
});

await test('a tool the runner no longer has is unknown', async () => {
  const { call, received } = await callTool('complete_run', { outcome: 'done' });
  assert.match(call.error?.message ?? '', /Unknown tool: complete_run/);
  assert.equal(received.length, 0);
});

await test('a dead ally-be does not take the server down with it', async () => {
  // The agent gets something it can read, not a JSON-RPC error.
  const child = spawn('node', [SERVER], {
    env: {
      ...process.env,
      // A port nothing is listening on.
      ALLY_BE_API_URL: 'http://127.0.0.1:1',
      ALLY_BE_API_KEY: 'k',
      BUILDER_RUN_ID: 'r',
      BUILDER_HELPER_ENV: '/nonexistent-on-purpose',
      BUILDER_PHASE_FILE: writePhase('design'),
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
      `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'note', arguments: { type: 'plan', text: 'x' } } })}\n`,
    );
  });

  assert.ok(reply.result, 'a transport failure must not be a JSON-RPC error');
  assert.match(textOf(reply), /NOT recorded/);
});

await test('the handshake and a call both answer, in order, on one process', async () => {
  const { replies } = await callTool('note', { type: 'plan', text: 'x' }, { phase: 'design' });
  assert.equal(replies.find((r) => r.id === 1).result.serverInfo.name, 'builder-reporting');
  assert.ok(replies.find((r) => r.id === 3).result);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
