#!/usr/bin/env node
//
// The reporting protocol, as MCP tools rather than shell commands.
//
// ## Why this exists
//
// Everything a build tells ally-be — which stage it is in, what it did, what
// it wants to ask, how it ended — went through executables on the agent's
// PATH, invoked by the agent's shell tool. That channel has broken in five
// distinct ways, none of which were about the protocol itself:
//
//   1. Shell functions in the prompt: a coding agent spawns a fresh shell per
//      call, so the definitions existed only for an agent that re-pasted them.
//   2. `complete` is a bash BUILTIN, and builtins outrank PATH, so a helper
//      by that name could never be invoked.
//   3. PATH reached the agent's shell but the job's environment did not, so
//      every helper resolved, ran, and died on a missing ALLY_BE_API_URL.
//   4. gemini-cli 0.22.5 refused `gh pr create`, `git add .` and every helper
//      call with "Command rejected because it could not be parsed safely" —
//      a bug in its own parser, which no prompt could work around.
//   5. `report` was handed hand-assembled JSON wrapping multi-line markdown,
//      which is not valid JSON, so every run's write-up was lost to a 400.
//
// Each was fixed where it appeared. The class was never fixed, because the
// channel was wrong: shell is a text protocol between two programs that do not
// agree on quoting, and one of them is a language model.
//
// An MCP tool call is none of those things. It is a typed JSON-RPC request the
// agent's harness makes directly. There is no PATH to resolve, no shell to
// spawn, no builtin to shadow, no environment to forward, no parser to please,
// and no quoting decision anywhere — a markdown report is simply a string
// field. Every failure above is structurally impossible here.
//
// ## What this is not
//
// It is not a replacement for `agent-helpers/`. Those stay: an engine without
// MCP support still needs them, and they are the fallback if this server fails
// to start. Both speak to the same ally-be endpoints, so the contract is the
// HTTP API rather than either implementation.
//
// ## No dependencies, on purpose
//
// This runs on a fresh GitHub runner beside a checkout that is not installed.
// The subset of MCP needed here — initialize, tools/list, tools/call over
// newline-delimited JSON-RPC on stdio — is small enough to write out, and the
// platform already speaks MCP by hand in BuilderStacksService for the same
// reason. A dependency here would mean an install step in the protocol
// checkout to serve 300 lines.

import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

/* ── Configuration, read the way the helpers read it ─────────────────────── */

// From a file rather than the environment. PATH reaches an agent's subprocess;
// the job's own variables do not necessarily, and an MCP server is spawned by
// the harness with whatever environment the harness decides to pass. A file is
// the only channel that does not depend on another process choosing to forward
// something. `environment` in the MCP config covers it too — this is belt and
// braces, and it costs one read at startup.
const loadConfig = () => {
  const path = process.env.BUILDER_HELPER_ENV || '/tmp/builder-helper-env';
  const config = {
    apiUrl: process.env.ALLY_BE_API_URL,
    runId: process.env.BUILDER_RUN_ID,
    apiKey: process.env.ALLY_BE_API_KEY,
  };

  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^([A-Z_]+)='(.*)'$/.exec(line.trim());
      if (!match) continue;
      if (match[1] === 'ALLY_BE_API_URL') config.apiUrl ||= match[2];
      if (match[1] === 'BUILDER_RUN_ID') config.runId ||= match[2];
      if (match[1] === 'ALLY_BE_API_KEY') config.apiKey ||= match[2];
    }
  } catch {
    // Absent is survivable when the environment carries the values.
  }

  return config;
};

const config = loadConfig();
const API = `${config.apiUrl}/api/v1/builder/pipeline/runs/${config.runId}`;

/** Every stage the rail knows. MUST MATCH `BuilderStage` in builder.enum.ts. */
const STAGES = [
  'SETUP',
  'PLANNING',
  'CODING',
  'TESTING',
  'GATE',
  'VERIFYING',
  'REVIEWING',
  'REMEDIATING',
  'FINALISING',
  'E2E_VERIFY',
  'OPENING_PRS',
  'REPORTING',
  'DONE',
];

/* ── Talking to ally-be ──────────────────────────────────────────────────── */

/**
 * Never throws.
 *
 * A transport failure has to arrive at the caller as a RESULT, not as an
 * exception, because each tool decides for itself what an unreachable ally-be
 * means. For `stage` it means the rail did not move and the build carries on;
 * for `ask` it means the agent is still running and must be told so. Letting
 * fetch throw collapsed that distinction into one generic handler error, and
 * a `stage` call that reported "failed" would read to an agent as something it
 * had done wrong.
 */
const request = async (method, path, body) => {
  try {
    const response = await fetch(`${API}/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey ?? '',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text };
  } catch (error) {
    // Status 0 is "never reached ally-be", which is deliberately not a 4xx:
    // `complete_run` retries this and refuses to retry a refusal.
    return { status: 0, ok: false, text: error?.message ?? String(error) };
  }
};

const postEvents = (events) => request('POST', 'events', { events });

/* ── What this phase may do ──────────────────────────────────────────────── */

/**
 * Only one phase may end the run.
 *
 * The runner invokes phases in sequence: a coder that has finished is finished
 * with its own phase, and the build carries on to the gate without it. That
 * has always been in the prompt, and on 2026-09-24 it stopped being enough. A
 * coding agent committed its work, called `complete_run`, was refused because
 * no gate had run, narrated its understanding — "I understand complete-run is
 * not my task" — and called it again. Twenty-three times.
 *
 * Every refusal was correct and every retry was rational. The agent had
 * finished; the tool was named exactly what it wanted to say; nothing else in
 * its hand meant "I am done". Refusing harder could not fix that, because the
 * loop was not a misunderstanding.
 *
 * So the tool is withheld from the phases that must not use it. A tool absent
 * from `tools/list` cannot be called at all — the same guarantee opencode's
 * denied agents get, where the model is told "Model tried to call unavailable
 * tool" rather than being refused one call at a time.
 *
 * `fix` and `review` keep it: those modes run a narrower pipeline and do
 * report their own outcome. An unrecognised or missing phase keeps everything,
 * because a runner too old to write the file must not lose the ability to
 * finish.
 */
const MAY_FINISH_THE_RUN = new Set(['finalise', 'fix', 'review']);

const currentPhase = () => {
  try {
    return readFileSync(
      process.env.BUILDER_PHASE_FILE || '/tmp/builder-phase',
      'utf8',
    ).trim();
  } catch {
    return '';
  }
};

const toolsForPhase = () => {
  const phase = currentPhase();
  // Unknown phase: withhold nothing. See above.
  if (!phase || MAY_FINISH_THE_RUN.has(phase)) return Object.keys(TOOLS);
  return Object.keys(TOOLS).filter((name) => name !== 'complete_run');
};

/* ── The tools ───────────────────────────────────────────────────────────── */

/**
 * Each tool returns the text the agent sees. Telemetry must never fail a
 * build, so a transport failure is REPORTED and not thrown — the one
 * exception being the tools whose whole purpose is to change what happens
 * next (`ask` and `complete_run`), where a silent failure would leave the run
 * believing it had paused or finished when it had not.
 */
const TOOLS = {
  stage: {
    description:
      'Move the build to a new stage. Call it when you START one. The ' +
      'progress rail a person watches is driven entirely by this.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: STAGES,
          description: 'The stage being entered.',
        },
      },
      required: ['stage'],
    },
    handler: async ({ stage }) => {
      // Refused here rather than at the server, so the agent is told which
      // word to use instead of watching its report vanish into a CHECK
      // constraint. A near-miss is corrected in place, because arguing with a
      // model about a spelling is a worse use of a turn than accepting what it
      // plainly meant.
      let want = String(stage ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_');
      if (want === 'FINALIZING') want = 'FINALISING';

      if (!STAGES.includes(want)) {
        return {
          isError: true,
          text: `"${stage}" is not a stage. Use one of: ${STAGES.join(', ')}`,
        };
      }

      const result = await postEvents([
        { type: 'stage_change', payload: { stage: want } },
      ]);
      return {
        text: result.ok ? `stage → ${want}` : `stage → ${want} (not recorded)`,
      };
    },
  },

  note: {
    description:
      'Record a milestone in the run feed: your plan, test output, a ' +
      'verification result, or anything a person reading the build later ' +
      'would want to know.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'The kind of note, e.g. plan, test_output, verification.',
        },
        // A string, not a path. The shell helper took a file for anything long
        // or quoted, because a multi-line argument through a shell is a
        // quoting problem. Here it is a JSON string field and there is nothing
        // to quote.
        text: { type: 'string', description: 'The note itself. Markdown.' },
      },
      required: ['type', 'text'],
    },
    handler: async ({ type, text }) => {
      const result = await postEvents([
        { type: String(type), payload: { text: String(text ?? '') } },
      ]);
      return { text: result.ok ? 'note recorded' : 'note NOT recorded' };
    },
  },

  todo: {
    description:
      'Replace the WHOLE checklist, not a delta. Send every item each time ' +
      'with its current status, including the ones already done.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done'],
              },
            },
            required: ['id', 'text', 'status'],
          },
        },
      },
      required: ['items'],
    },
    handler: async ({ items }) => {
      if (!Array.isArray(items)) {
        return { isError: true, text: 'items must be an array.' };
      }
      const result = await postEvents([{ type: 'todo', payload: { items } }]);
      return {
        text: result.ok
          ? `checklist updated (${items.length} item(s))`
          : 'checklist NOT updated',
      };
    },
  },

  budget: {
    description: "What is left of this session's spend ceiling.",
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const result = await request('GET', 'budget');
      return { text: result.ok ? result.text : `budget unavailable (${result.status})` };
    },
  },

  prs: {
    description: 'Record the pull requests this run opened.',
    inputSchema: {
      type: 'object',
      properties: {
        pullRequests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              branch: { type: 'string' },
              prNumber: { type: 'number' },
              prUrl: { type: 'string' },
              title: { type: 'string' },
            },
            required: ['repo', 'prNumber', 'prUrl'],
          },
        },
      },
      required: ['pullRequests'],
    },
    handler: async ({ pullRequests }) => {
      const result = await request('POST', 'prs', { pullRequests });
      return { text: result.ok ? 'pull requests recorded' : 'NOT recorded' };
    },
  },

  report: {
    description:
      'Your written account of the run. Plain markdown — do not wrap it in ' +
      'JSON yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        contentMd: { type: 'string', description: 'The write-up, as markdown.' },
        metrics: { type: 'object', description: 'Optional structured figures.' },
      },
      required: ['contentMd'],
    },
    handler: async ({ contentMd, metrics }) => {
      // The failure this tool exists to make impossible: on 2026-09-23 a run
      // that had planned, coded, remediated, passed its gate and opened a pull
      // request lost its entire write-up because a JSON string cannot hold a
      // literal newline and a run report is nothing but newlines.
      const result = await request('POST', 'report', {
        type: 'run_report',
        contentMd: String(contentMd ?? ''),
        ...(metrics ? { metrics } : {}),
      });
      if (!result.ok) {
        // Said in the feed, because a dropped report is otherwise invisible:
        // this must not fail the build, and the runner's stdout has no readers.
        await postEvents([
          {
            type: 'text',
            payload: {
              text:
                `[report] This run's written account could not be stored — ` +
                `ally-be answered ${result.status}. The work is unaffected; ` +
                `the write-up is missing.`,
            },
          },
        ]).catch(() => {});
        return { text: `report NOT stored (${result.status})` };
      }
      return { text: 'report stored' };
    },
  },

  ask: {
    description:
      'Pause and ask a person. The run ENDS here; a resume continues from ' +
      'your branches. Use it only when you cannot proceed without an answer.',
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              context: { type: 'string' },
            },
            required: ['question'],
          },
        },
        branches: {
          type: 'object',
          description:
            'Repo to branch. Omit it — the runner fills in the branches you ' +
            'are actually on.',
        },
      },
      required: ['questions'],
    },
    handler: async ({ questions, branches }) => {
      if (!Array.isArray(questions) || questions.length === 0) {
        return {
          isError: true,
          text: 'ask needs at least one question.',
        };
      }

      const result = await request('POST', 'questions', {
        questions,
        ...(branches ? { branches } : {}),
      });

      if (!result.ok) {
        // Not swallowed. An agent that believes it paused when it did not will
        // sit waiting for an answer nobody was asked for.
        return {
          isError: true,
          text:
            `The pause was NOT recorded (HTTP ${result.status}) — you are ` +
            `still running. ${result.text.slice(0, 400)}`,
        };
      }

      markerFile('/tmp/builder-paused');
      return {
        text: 'Paused for input. The run ends here; a resume continues from your branches.',
      };
    },
  },

  complete_run: {
    // Named with an underscore because `complete` is a bash builtin and the
    // shell helper had to be renamed for exactly that reason. Nothing here
    // resolves through a shell, so the name is free — but keeping it aligned
    // with `complete-run` means one name in the prompt for both channels.
    description:
      'Finish the run. Exactly once, and last. A `done` needs a passing test ' +
      'gate behind it or it will be refused.',
    inputSchema: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['done', 'failed'] },
        error: {
          type: 'string',
          description: 'Why it failed. Required when outcome is failed.',
        },
      },
      required: ['outcome'],
    },
    handler: async ({ outcome, error }) => {
      if (outcome !== 'done' && outcome !== 'failed') {
        return { isError: true, text: "outcome must be 'done' or 'failed'." };
      }

      const body =
        outcome === 'done'
          ? { outcome: 'done' }
          : {
              outcome: 'failed',
              error: error || 'The run reported a failure without a reason.',
            };

      // Retried, because this is the one report whose loss changes what the
      // pipeline believes happened.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const result = await request('POST', 'complete', body);

        if (result.ok) {
          let refused = false;
          let note = '';
          try {
            const parsed = JSON.parse(result.text);
            refused = parsed?.ok === false;
            note = parsed?.note ?? parsed?.message ?? '';
          } catch {
            // A 2xx that is not JSON is still a 2xx.
          }
          if (refused) {
            return {
              isError: true,
              text: `REFUSED — your outcome was not recorded. ${note}`,
            };
          }
          markerFile(
            process.env.BUILDER_REPORTED_MARKER ||
              '/tmp/builder-already-reported',
          );
          return { text: 'Outcome recorded.' };
        }

        if (result.status >= 400 && result.status < 500) {
          let note = '';
          try {
            const parsed = JSON.parse(result.text);
            note = parsed?.message ?? parsed?.note ?? '';
          } catch {
            note = result.text.slice(0, 200);
          }
          return {
            isError: true,
            text: `REFUSED — your outcome was not recorded. ${note}`,
          };
        }

        if (attempt < 3) await sleep(3000);
      }

      return {
        isError: true,
        text: 'The outcome could not be recorded after three attempts.',
      };
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The two markers run-engine.sh reads after the engine exits. */
const markerFile = (path) => {
  try {
    writeFileSync(path, '');
  } catch {
    // The runner treats a missing marker as "did not happen", which is the
    // safe reading — it re-checks against evidence either way.
  }
};

/* ── JSON-RPC over stdio ─────────────────────────────────────────────────── */

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const respond = (id, result) => send({ jsonrpc: '2.0', id, result });

const fail = (id, code, message) =>
  send({ jsonrpc: '2.0', id, error: { code, message } });

const handle = async (message) => {
  const { id, method, params } = message;

  switch (method) {
    case 'initialize':
      return respond(id, {
        // Echo the client's version rather than asserting one. A hand-written
        // server has no reason to argue about a protocol revision it will
        // satisfy either way, and refusing an unfamiliar one is how this stops
        // working the next time the harness updates.
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'builder-reporting', version: '1.0.0' },
      });

    case 'notifications/initialized':
      return; // A notification: no id, no reply.

    case 'tools/list': {
      const allowed = new Set(toolsForPhase());
      return respond(id, {
        tools: Object.entries(TOOLS)
          .filter(([name]) => allowed.has(name))
          .map(([name, tool]) => ({
            name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
      });
    }

    case 'tools/call': {
      const tool = TOOLS[params?.name];
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);

      // Belt and braces: a harness that cached an earlier list, or asked for a
      // tool it was never offered, is told the tool does not exist here rather
      // than being refused by the server it would then retry against.
      if (!toolsForPhase().includes(params.name)) {
        return respond(id, {
          content: [
            {
              type: 'text',
              text:
                `${params.name} is not available to the ${currentPhase()} ` +
                `phase. Your phase ends when you stop; the runner starts what ` +
                `comes next and a later phase reports the outcome.`,
            },
          ],
          isError: true,
        });
      }

      try {
        const result = await tool.handler(params?.arguments ?? {});
        return respond(id, {
          content: [{ type: 'text', text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        });
      } catch (error) {
        // Reported as a tool error rather than thrown: a transport failure
        // must reach the agent as something it can read and retry, not as a
        // dead server that takes the rest of the run's telemetry with it.
        return respond(id, {
          content: [
            {
              type: 'text',
              text: `${params?.name} failed: ${error?.message ?? String(error)}`,
            },
          ],
          isError: true,
        });
      }
    }

    default:
      // Unknown methods are declined, not fatal. `ping`, `resources/list` and
      // friends arrive from harnesses that assume a fuller server.
      if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
  }
};

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  // Split on \n only. A generic line reader also splits on Unicode separators,
  // which appear inside JSON payloads — pi's own RPC docs call this out, and a
  // report containing one would otherwise corrupt the frame.
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
      // A frame we cannot parse is dropped rather than fatal.
    }
  }
});

process.stdin.on('end', () => process.exit(0));
