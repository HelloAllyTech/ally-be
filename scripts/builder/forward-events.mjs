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
 * Gemini CLI's `--output-format stream-json` schema. Originally read from a
 * real local install's compiled TypeScript declarations
 * (@google/gemini-cli-core's dist/src/output/types.d.ts, v0.22.5); the
 * envelope, `init`/`message`/`tool_use`/`tool_result`/`result` shapes, and
 * the real tool param shapes below (`run_shell_command`'s `command`,
 * `read_file`'s `file_path`, `write_file`'s `file_path`+`content`) are now
 * additionally confirmed against one real successful trivial run — a single
 * shell command, a read, and a write, no multi-round tool_use/tool_result
 * loop and no real `edit` (old_string/new_string) call, so treat those two
 * as still resting on the source schema alone.
 *
 * Confirmed gaps, not guesses:
 *  - Gemini's tool events carry no id correlating a `tool_use` to its later
 *    `tool_result`, so — same as Claude Code's own normalise above — they're
 *    emitted as independent events rather than paired.
 *  - Gemini's terminal `result` event's `stats` has token counts only, no
 *    cost figure at all (unlike Claude Code's `total_cost_usd`). This
 *    normaliser reports `totalCostUsd: 0` for a Gemini-engine run rather than
 *    fabricating a number — real cost tracking for this engine needs a
 *    separate per-model pricing table, not built here.
 *  - Assistant text arrives as `delta: true` fragments ("OK", then ".", each
 *    its own record) rather than complete blocks the way Claude Code's own
 *    stream-json does — confirmed by the same real run. `geminiTextBuffer`
 *    accumulates them and flushes as one event the moment anything else
 *    arrives (a tool call, the terminal result, or stream end), so the feed
 *    reads as sentences instead of a word-by-word trickle.
 */
let geminiTextBuffer = '';
const flushGeminiBuffer = () => {
  if (!geminiTextBuffer) return [];
  const text = geminiTextBuffer;
  geminiTextBuffer = '';
  return [{ type: 'text', payload: { text: truncate(text) } }];
};


// ── What a Gemini invocation cost ───────────────────────────────────────────
//
// Gemini's CLI reports tokens but no dollar figure, where Claude Code reports
// `total_cost_usd` directly. This used to be hardcoded to 0, which was honest
// about what the engine said and wrong about everything downstream: the
// session spend ceiling, the phase budgets, the routing telemetry and the cost
// on the session card all read a Gemini run as free. A run that cannot be
// priced cannot be capped, and "$0.00" on a build that burned 300k tokens is a
// worse answer than an estimate.
//
// So it is computed here from published list prices. Two things follow from
// that and both matter when reading the number:
//
//   - It is an ESTIMATE from a rate card, not a billed amount. Rates change,
//     and this table has to be updated by hand when they do.
//   - It does not know about credits. Spending against a credit grant still
//     shows a dollar figure, because the ceiling exists to stop a runaway run,
//     and a runaway run is just as runaway when something else is paying.
//
// Rates are USD per million tokens. Gemini 2.5 Pro prices in two tiers by
// prompt size, which is why the long-context tier is not a rounding detail: a
// coding run carrying a repo's worth of context sits above the 200k boundary
// for most of its invocations.
const GEMINI_RATES = {
  'gemini-2.5-pro': {
    threshold: 200_000,
    short: { input: 1.25, cached: 0.31, output: 10.0 },
    long: { input: 2.5, cached: 0.625, output: 15.0 },
  },
  'gemini-2.5-flash': {
    threshold: Infinity,
    short: { input: 0.3, cached: 0.075, output: 2.5 },
    long: { input: 0.3, cached: 0.075, output: 2.5 },
  },
  'gemini-2.5-flash-lite': {
    threshold: Infinity,
    short: { input: 0.1, cached: 0.025, output: 0.4 },
    long: { input: 0.1, cached: 0.025, output: 0.4 },
  },
};

const geminiCostUsd = (stats, model) => {
  const modelStr = String(model ?? '');
  const key = Object.keys(GEMINI_RATES)
    .filter((k) => modelStr.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) {
    unpricedModels.add(String(model ?? 'unknown'));
    console.error(
      `[cost] no rate card for gemini model "${model}" — reporting 0. ` +
        `Add it to GEMINI_RATES in forward-events.mjs.`,
    );
    return 0;
  }
  const card = GEMINI_RATES[key];
  const totalIn = Number(stats.input_tokens ?? 0) || 0;
  const cached = Number(stats.cached ?? 0) || 0;
  const out = Number(stats.output_tokens ?? 0) || 0;
  // `input` is the uncached remainder Gemini bills at the full rate; falling
  // back to the subtraction keeps this right if that field ever goes away.
  const fresh = Number(stats.input ?? Math.max(totalIn - cached, 0)) || 0;

  const rates = totalIn > card.threshold ? card.long : card.short;
  const usd =
    (fresh / 1_000_000) * rates.input +
    (cached / 1_000_000) * rates.cached +
    (out / 1_000_000) * rates.output;

  return Math.round(usd * 1e6) / 1e6;
};

// Models this run met that the rate card does not price. Collected so the gap
// can be SAID rather than only logged: stdout has no consumers, and a phase
// silently priced at zero is a budget ceiling that has stopped working.
const unpricedModels = new Set();
const announcedUnpriced = new Set();

/**
 * Price a `result` frame.
 *
 * Prefer `stats.models`, the per-model breakdown 0.60.0 reports, over the model
 * named in `init`. They are not always the same model. Asking 0.60.0 for
 * `gemini-2.5-flash` returns `init` with `gemini-2.5-flash` and stats under
 * `gemini-3.5-flash` — the request is routed, and only the breakdown says where
 * it landed. Pricing the requested name would charge the wrong card; pricing
 * the reported one charges what ran, and names the gap when there is no card
 * for it.
 *
 * Falls back to the flat shape when `models` is absent, so an older engine or a
 * frame without the breakdown prices exactly as it did before.
 */
const geminiResultCostUsd = (stats, fallbackModel) => {
  const perModel = stats?.models;
  if (perModel && typeof perModel === 'object' && Object.keys(perModel).length) {
    return (
      Math.round(
        Object.entries(perModel).reduce(
          (sum, [name, modelStats]) => sum + geminiCostUsd(modelStats ?? {}, name),
          0,
        ) * 1e6,
      ) / 1e6
    );
  }
  return geminiCostUsd(stats ?? {}, fallbackModel);
};

// The model, captured from the stream's `init` frame. The terminal `result`
// frame does not repeat it, and pricing without knowing the model is guessing.
let geminiModel = null;

const normaliseGemini = (record) => {
  if (record?.type === 'init' && record.model) {
    geminiModel = String(record.model);
  }

  if (record?.type === 'message' && record.role === 'assistant' && record.delta === true) {
    geminiTextBuffer += record.content ?? '';
    return [];
  }

  // Anything else ends a run of deltas, if one was in progress — flush it
  // first so streamed commentary is ordered before whatever follows it.
  const events = flushGeminiBuffer();

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
      // Gemini reports no cost of its own; priced from the rate card above so
      // the ceiling, the budget holds and the routing telemetry all work.
      total_cost_usd: geminiResultCostUsd(stats, record.model ?? geminiModel),
      duration_ms: stats.duration_ms ?? null,
      // Tool-call count, not a turn count — the closest field Gemini reports;
      // named num_turns only so report_phase_cost's existing reader picks it
      // up, not because the two concepts are equivalent.
      num_turns: stats.tool_calls ?? null,
    };

    // Say it in the feed, once per model. A phase priced at zero does not look
    // like a broken ceiling, it looks like a cheap phase — and the budget hold,
    // the phase budgets and the routing telemetry are all reading that zero.
    for (const name of unpricedModels) {
      if (announcedUnpriced.has(name)) continue;
      announcedUnpriced.add(name);
      events.push({
        type: 'text',
        payload: {
          text:
            `[cost] This phase ran on "${name}", which has no entry in the rate card, ` +
            `so its spend is counted as $0. The budget ceiling cannot hold against it. ` +
            `Add it to GEMINI_RATES in scripts/builder/forward-events.mjs.`,
        },
      });
    }
  }

  return events;
};

/* ── opencode ────────────────────────────────────────────────────────────── */

// Its cost arrives per STEP, not once at the end.
//
// A run emits a `step_finish` for every model round, each carrying that
// round's tokens and its own dollar figure, and there is no terminal frame
// summing them. Reading only the last one would price a four-step run as one
// step — so they accumulate here, and the totals are written out when the
// stream closes.
//
// The dollars are opencode's own, not a rate card. That is the one thing this
// engine gives the budget ceiling that neither other engine can: gemini-cli
// reports no cost at all and Claude Code reports its own estimate, so spend
// has been priced from a table someone has to keep up to date, and an unpriced
// model silently reads as free.
let opencodeCost = 0;
let opencodeTokens = { input: 0, output: 0, cached: 0 };
let opencodeSawStep = false;
// The session this phase ran in. opencode stamps it on every event, and a
// later phase can continue it instead of starting cold — see run-engine.sh.
let opencodeSessionId = null;
// The assistant's prose, accumulated across the phase. See the text branch.
let opencodeText = '';

const normaliseOpencode = (record) => {
  const part = record?.part ?? {};
  if (!opencodeSessionId && typeof record?.sessionID === 'string') {
    opencodeSessionId = record.sessionID;
  }

  if (record?.type === 'text' && part.text?.trim()) {
    // Kept as well as relayed. run-engine.sh reads the planner's ```plan block
    // and the verifier's ```json verdict out of `result` in the file this
    // forwarder writes, and opencode has no terminal frame carrying the
    // assistant's prose — so without this buffer that field was absent and
    // both parsers read nothing.
    //
    // What that cost is worth stating plainly: the plan event was never
    // posted, so the coder, the remediation prompt and every resume read an
    // empty plan; and the verdict parser, which answers "pass" when it cannot
    // find a block (deliberately, so a reviewer's broken plumbing cannot fail
    // an honest build), therefore answered "pass" every time. The independent
    // verifier has been decorative on every opencode run since the move.
    //
    // Unbounded on purpose. Both parsers take the LAST fenced block, so the
    // tail is what matters — but the verdict is the one thing in this file
    // worth spending memory on being sure about.
    opencodeText += `${part.text}\n`;
    return [{ type: 'text', payload: { text: truncate(part.text) } }];
  }

  if (record?.type === 'tool_use') {
    const name = String(part.tool ?? 'tool');
    const state = part.state ?? {};
    const input = state.input ?? {};
    const events = [];

    // Shapes read from a real run, not from documentation: `part.tool` is the
    // name, `part.state.input` the arguments and `part.state.output` the
    // result, all on ONE event rather than the call/result pair the other
    // engines emit. Both are still forwarded, so the feed reads the same
    // whichever engine produced it.
    if (typeof input.filePath === 'string' || typeof input.path === 'string') {
      const wrote = 'content' in input;
      const edited = 'oldString' in input || 'old_string' in input;
      if (wrote || edited) {
        events.push({
          type: 'file_edit',
          payload: {
            path: String(input.filePath ?? input.path),
            operation: edited ? 'edit' : 'write',
            oldText: truncate(input.oldString ?? input.old_string ?? ''),
            newText: truncate(input.newString ?? input.new_string ?? input.content ?? ''),
          },
        });
      }
    }

    if (!events.length) {
      events.push({
        type: 'tool_call',
        payload: {
          name,
          summary: truncate(
            input.command ?? input.filePath ?? input.path ?? input.pattern ?? '',
          ),
        },
      });
    }

    if (state.output !== undefined || state.status === 'error') {
      events.push({
        type: 'tool_result',
        payload: {
          // `status` is the tool's own verdict. An `invalid` tool — the model
          // reaching for something a denied agent was never offered — comes
          // back completed with an error in its output, which is a refusal
          // worth showing rather than a failure worth hiding.
          isError: state.status === 'error',
          text: truncate(String(state.output ?? '')),
        },
      });
    }

    return events;
  }

  if (record?.type === 'step_finish') {
    opencodeSawStep = true;
    opencodeCost += Number(part.cost ?? 0) || 0;
    const tokens = part.tokens ?? {};
    opencodeTokens = {
      input: opencodeTokens.input + (Number(tokens.input ?? 0) || 0),
      output: opencodeTokens.output + (Number(tokens.output ?? 0) || 0),
      cached: opencodeTokens.cached + (Number(tokens.cache?.read ?? 0) || 0),
    };
    return [];
  }

  if (record?.type === 'error') {
    const detail =
      record.error?.data?.message ?? record.error?.name ?? 'unknown error';
    return [{ type: 'text', payload: { text: truncate(`[opencode] ${detail}`) } }];
  }

  // `step_start` and anything else carry nothing a person watching needs.
  return [];
};

/** Called when the stream ends: opencode has no terminal result frame. */
const finaliseOpencode = () => {
  if (!opencodeSawStep) return;
  lastResult = {
    // The field run-engine.sh parses the plan and the verdict out of. Named
    // `result` because that is what the other engines' terminal frame calls
    // it, and what every reader here already expects.
    result: opencodeText.trim(),
    usage: {
      input_tokens: opencodeTokens.input,
      output_tokens: opencodeTokens.output,
      cached_tokens: opencodeTokens.cached,
    },
    // Rounded the way the rate-card path rounds, so a run's cost reads the
    // same whichever engine produced it.
    total_cost_usd: Math.round(opencodeCost * 1e6) / 1e6,
    duration_ms: null,
    num_turns: null,
    // Handed back so the next coding attempt can continue this conversation
    // rather than re-deriving the codebase from nothing.
    session_id: opencodeSessionId,
  };
};

const normalise = (record) =>
  process.env.BUILDER_ENGINE === 'gemini'
    ? normaliseGemini(record)
    : process.env.BUILDER_ENGINE === 'opencode'
      ? normaliseOpencode(record)
      : normaliseClaudeCode(record);

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

// ── The passthrough, with a lid on it ───────────────────────────────────────
//
// Every line is still relayed, but a line repeated back to back is counted
// rather than reprinted. One Gemini run wrote `Aborted()` 1,028,203 times
// after its shell tool rejected a command, producing a million-line workflow
// log that took minutes to fetch and buried everything the run actually did.
//
// Consecutive-only, deliberately. A repeat counter that remembered every line
// ever seen would collapse legitimate recurrence — the same test name across
// rounds, the same file read twice — and the thing worth suppressing is a tight
// loop, which is always consecutive.
let lastLine = null;
let repeats = 0;

const flushRepeats = () => {
  if (repeats > 0) {
    process.stdout.write(
      `  … previous line repeated ${repeats} more time${repeats === 1 ? '' : 's'}\n`,
    );
    repeats = 0;
  }
};

readline.on('line', (line) => {
  // Pass through first and unconditionally, so a parse failure below can
  // never cost the downstream consumer its data.
  if (line === lastLine) {
    repeats += 1;
  } else {
    flushRepeats();
    process.stdout.write(`${line}\n`);
    lastLine = line;
  }

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
  // A run that ended mid-repeat still says how many it swallowed.
  flushRepeats();
  // A Gemini run whose last assistant message was still mid-delta when the
  // stream ended must not lose it — a no-op for Claude Code, whose buffer is
  // always empty.
  queue.push(...flushGeminiBuffer());
  // opencode reports its cost per step and never sums them, so the totals are
  // only complete once the stream is. A no-op for the other two engines.
  finaliseOpencode();
  await flush();
  if (RESULT_OUT && lastResult) {
    try {
      writeFileSync(RESULT_OUT, JSON.stringify(lastResult));
    } catch {
      // The cost step degrades to "no cost reported" rather than failing.
    }
  }
});
