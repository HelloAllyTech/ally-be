#!/usr/bin/env node
/**
 * Relay a coding engine's streaming output to ally-be as build events, and
 * pass it through unchanged.
 *
 * This is what makes the admin feed read like a live terminal rather than a
 * log that appears at the end. It is also the ONLY place that understands an
 * engine's native output shape — everything downstream (the event schema, the
 * pipeline endpoints, the UI) is engine-neutral, so a second engine is a
 * second `normalise` function here and nothing else.
 *
 * Two rules govern the whole file:
 *
 *  1. **Telemetry must never fail a build.** Every network call swallows its
 *     own errors. Losing the live feed is a degraded experience; killing a
 *     ninety-minute build because a POST timed out is a disaster.
 *  2. **stdin is passed through byte-for-byte.** The cost step reads the
 *     engine's final result object from the same stream, and a forwarder that
 *     consumed it would break billing.
 *
 * Zero dependencies: this runs on a bare runner before any `npm ci`.
 */

import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const API_URL = process.env.ALLY_BE_API_URL;
const API_KEY = process.env.ALLY_BE_API_KEY;
const RUN_ID = process.env.BUILDER_RUN_ID;

const resultOutIndex = process.argv.indexOf('--result-out');
const RESULT_OUT = resultOutIndex > -1 ? process.argv[resultOutIndex + 1] : null;

/** Flush on either bound, whichever comes first. */
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_SIZE = 20;
/** Mirrors BUILDER_EVENT_BATCH_MAX in builder.constants.ts — the server 400s above it. */
const MAX_BATCH = 100;
const MAX_RETRIES = 3;
/** Keep any single payload well under the server's own 8KB cap. */
const MAX_FIELD_CHARS = 4000;

const queue = [];
let flushing = false;
let lastResult = null;

const truncate = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (!text) return text;
  return text.length > MAX_FIELD_CHARS
    ? `${text.slice(0, MAX_FIELD_CHARS)}\n…[truncated]`
    : text;
};

/**
 * One engine record → zero or more builder events.
 *
 * Returns an array because a single assistant message can carry both prose
 * and several tool calls, and the feed shows them as separate rows.
 */
const normaliseClaudeCode = (record) => {
  const events = [];

  if (record?.type === 'assistant' && Array.isArray(record?.message?.content)) {
    for (const block of record.message.content) {
      if (block?.type === 'text' && block.text?.trim()) {
        events.push({ type: 'text', payload: { text: truncate(block.text) } });
        continue;
      }
      if (block?.type !== 'tool_use') continue;

      const name = String(block.name ?? 'tool');
      const input = block.input ?? {};

      // Edit and Write become their own event type: "changed this file" is
      // the thing a reader scans for, and burying it inside a generic
      // tool_call row makes the diff invisible in a feed of hundreds.
      if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
        events.push({
          type: 'file_edit',
          payload: {
            path: String(input.file_path ?? input.notebook_path ?? ''),
            operation: name === 'Write' ? 'write' : 'edit',
            oldText: truncate(input.old_string ?? ''),
            newText: truncate(input.new_string ?? input.content ?? ''),
          },
        });
        continue;
      }

      events.push({
        type: 'tool_call',
        payload: {
          name,
          // A one-line summary rather than the whole input: the feed shows
          // this collapsed, and the full input is rarely what anyone wants.
          summary: truncate(
            input.command ??
              input.file_path ??
              input.pattern ??
              input.description ??
              input.prompt ??
              '',
          ),
        },
      });
    }
    return events;
  }

  if (record?.type === 'user' && Array.isArray(record?.message?.content)) {
    for (const block of record.message.content) {
      if (block?.type !== 'tool_result') continue;
      const content = Array.isArray(block.content)
        ? block.content.map((part) => part?.text ?? '').join('\n')
        : (block.content ?? '');
      events.push({
        type: 'tool_result',
        payload: {
          isError: Boolean(block.is_error),
          text: truncate(content),
        },
      });
    }
    return events;
  }

  if (record?.type === 'result') {
    // The terminal record. Kept for the cost step; not itself an event,
    // because the agent posts its own `complete` with a considered outcome.
    lastResult = record;
  }

  return events;
};

/**
 * Gemini CLI's `--output-format stream-json` schema, read directly from a
 * real local install's compiled TypeScript declarations
 * (@google/gemini-cli-core's dist/src/output/types.d.ts, v0.22.5) — not yet
 * exercised against a real successful run (see install-engine.sh's gemini
 * case for why), so treat the mapping below as unverified until one
 * completes, the same caution Claude Code's own shape doesn't need because
 * years of real runs have already exercised it.
 *
 * Two confirmed gaps, not guesses:
 *  - Gemini's tool events carry no id correlating a `tool_use` to its later
 *    `tool_result`, so — same as Claude Code's own normalise above — they're
 *    emitted as independent events rather than paired.
 *  - Gemini's terminal `result` event's `stats` has token counts only, no
 *    cost figure at all (unlike Claude Code's `total_cost_usd`). This
 *    normaliser reports `totalCostUsd: 0` for a Gemini-engine run rather than
 *    fabricating a number — real cost tracking for this engine needs a
 *    separate per-model pricing table, not built here.
 */
const normaliseGemini = (record) => {
  const events = [];

  if (record?.type === 'message' && record.role === 'assistant' && record.content?.trim()) {
    events.push({ type: 'text', payload: { text: truncate(record.content) } });
    return events;
  }

  if (record?.type === 'tool_use') {
    const name = String(record.tool_name ?? 'tool');
    const params = record.parameters ?? {};

    // Gemini's built-in Edit tool uses the same file_path/old_string/
    // new_string shape as Claude Code's — confirmed from the installed
    // package's tools/edit.d.ts, not inferred from the tool name alone.
    if (typeof params.file_path === 'string' && ('old_string' in params || 'content' in params)) {
      events.push({
        type: 'file_edit',
        payload: {
          path: String(params.file_path),
          operation: 'old_string' in params ? 'edit' : 'write',
          oldText: truncate(params.old_string ?? ''),
          newText: truncate(params.new_string ?? params.content ?? ''),
        },
      });
      return events;
    }

    events.push({
      type: 'tool_call',
      payload: {
        name,
        summary: truncate(
          params.command ?? params.file_path ?? params.pattern ?? params.path ?? '',
        ),
      },
    });
    return events;
  }

  if (record?.type === 'tool_result') {
    events.push({
      type: 'tool_result',
      payload: {
        isError: record.status === 'error',
        text: truncate(record.output ?? record.error?.message ?? ''),
      },
    });
    return events;
  }

  // A mid-stream warning/error, distinct from the terminal result's own
  // error field below. Surfaced rather than swallowed — this codebase's
  // stance throughout is that a real failure belongs in the visible feed,
  // not silently dropped telemetry.
  if (record?.type === 'error') {
    events.push({ type: 'text', payload: { text: truncate(`[gemini] ${record.message ?? ''}`) } });
    return events;
  }

  if (record?.type === 'result') {
    const stats = record.stats ?? {};
    lastResult = {
      usage: {
        input_tokens: stats.input_tokens ?? null,
        output_tokens: stats.output_tokens ?? null,
        cached_tokens: stats.cached ?? null,
      },
      // Confirmed absent from Gemini's own stats — see the doc comment above.
      total_cost_usd: 0,
      duration_ms: stats.duration_ms ?? null,
      // Tool-call count, not a turn count — the closest field Gemini reports;
      // named num_turns only so report_phase_cost's existing reader picks it
      // up, not because the two concepts are equivalent.
      num_turns: stats.tool_calls ?? null,
    };
  }

  return events;
};

const normalise = (record) =>
  process.env.BUILDER_ENGINE === 'gemini' ? normaliseGemini(record) : normaliseClaudeCode(record);

const post = async (events) => {
  if (!API_URL || !API_KEY || !RUN_ID || !events.length) return;

  const body = JSON.stringify({ events });
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `${API_URL}/api/v1/builder/pipeline/runs/${RUN_ID}/events`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
          },
          body,
        },
      );
      if (response.ok) return;
      // 5xx might fix itself; a 4xx is our own bug and usually will not. But
      // "usually" cost us: a batch over the server's 100-event cap answers 400,
      // and dropping it silently loses the gate_result that `/complete {done}`
      // refuses to finish without. One retry, so a transient 4xx (an expired
      // token being refreshed, a cap we have since chunked under) gets a second
      // chance without turning a real bug into three pointless round trips.
      if (response.status < 500 && attempt >= 2) return;
    } catch {
      // Network blip — fall through to the retry.
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  // Out of retries. Dropped on purpose: see rule 1 at the top.
};

const flush = async () => {
  if (flushing || !queue.length) return;
  flushing = true;
  try {
    // In chunks the server will accept. ally-be rejects a batch over
    // BUILDER_EVENT_BATCH_MAX (100) with a 400, so draining the whole queue at
    // once meant that a busy phase — exactly when events pile up past 100 while
    // a flush is in flight — silently dropped the lot. A dropped `gate_result`
    // is not cosmetic: it is the evidence `/complete {done}` refuses to finish
    // without, so telemetry loss was failing runs whose gate had genuinely
    // passed. Chunking here is the fix; the single 4xx retry in `post` is the
    // belt to this pair of braces.
    while (queue.length) {
      await post(queue.splice(0, MAX_BATCH));
    }
  } finally {
    flushing = false;
  }
};

const timer = setInterval(() => {
  void flush();
}, FLUSH_INTERVAL_MS);
// Do not hold the process open on the interval alone.
timer.unref?.();

const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });

readline.on('line', (line) => {
  // Pass through first and unconditionally, so a parse failure below can
  // never cost the downstream consumer its data.
  process.stdout.write(`${line}\n`);

  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return;

  let record;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return;
  }

  try {
    queue.push(...normalise(record));
  } catch {
    // A shape we did not anticipate is not worth stopping for.
    return;
  }

  if (queue.length >= FLUSH_SIZE) {
    void flush();
  }
});

readline.on('close', async () => {
  clearInterval(timer);
  await flush();
  if (RESULT_OUT && lastResult) {
    try {
      writeFileSync(RESULT_OUT, JSON.stringify(lastResult));
    } catch {
      // The cost step degrades to "no cost reported" rather than failing.
    }
  }
});
