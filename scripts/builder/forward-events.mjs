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
      // 4xx is our own bug and will not fix itself on a retry; 5xx might.
      if (response.status < 500) return;
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
  const batch = queue.splice(0, queue.length);
  try {
    await post(batch);
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
    queue.push(...normaliseClaudeCode(record));
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
