#!/usr/bin/env node
//
// The design run's reporting protocol, as MCP tools.
//
// run-engine.sh drafts a technical design in two read-only passes, and this
// server is how each pass reports back to ally-be: the designer submits through
// `design`, the cold critic through `design_review`, and both may leave a
// `note` in the run feed. Neither pass has a shell, so these typed tool calls
// are the only channel they have.
//
// An MCP tool call is a typed JSON-RPC request the agent's harness makes
// directly. There is no PATH to resolve, no shell to spawn, no environment to
// forward and no quoting decision anywhere — a markdown design is simply a
// string field. The shell helpers this replaced broke in five distinct ways,
// none of them about the protocol and all of them about the channel.
//
// ## No dependencies, on purpose
//
// This runs on a fresh GitHub runner beside a checkout that is not installed.
// The subset of MCP needed here — initialize, tools/list, tools/call over
// newline-delimited JSON-RPC on stdio — is small enough to write out, and the
// platform already speaks MCP by hand in BuilderStacksService for the same
// reason.

import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

/* ── Configuration ───────────────────────────────────────────────────────── */

// From a file rather than the environment. An MCP server is spawned by the
// harness with whatever environment the harness decides to pass; a file is the
// only channel that does not depend on another process choosing to forward
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

/* ── Talking to ally-be ──────────────────────────────────────────────────── */

/**
 * Never throws. A transport failure arrives at the caller as a RESULT, so each
 * tool decides for itself what an unreachable ally-be means: for `note` the
 * feed misses a line and the run carries on; for `design` the agent is told
 * its design was not stored.
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
    // Status 0 is "never reached ally-be", deliberately not a 4xx.
    return { status: 0, ok: false, text: error?.message ?? String(error) };
  }
};

const postEvents = (events) => request('POST', 'events', { events });

/* ── What this phase may do ──────────────────────────────────────────────── */

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

/**
 * Each pass gets its own tool and `note`, nothing else. The designer must not
 * file a verdict on its own design, and the critic must not rewrite the design
 * it is reviewing. A tool absent from `tools/list` cannot be called at all —
 * the same guarantee opencode's denied agents get — which held where refusing
 * the call did not: on 2026-09-24 a coding agent called a refused tool
 * twenty-three times in a row.
 *
 * Any other phase (setup, or a runner too old to write the file) gets `note`
 * only: no pass outside these two has anything to submit.
 */
const PHASE_TOOLS = {
  design: ['design', 'note'],
  'design-review': ['design_review', 'note'],
};

const toolsForPhase = () => PHASE_TOOLS[currentPhase()] ?? ['note'];

/* ── The tools ───────────────────────────────────────────────────────────── */

/**
 * Each tool returns the text the agent sees. A transport failure is REPORTED,
 * not thrown.
 */
const TOOLS = {
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

  design: {
    description:
      'Submit the technical design. Call it once the design is complete; the ' +
      'reply lists whatever still blocks approval — fix each and call again ' +
      'with the whole design until none remain.',
    inputSchema: {
      type: 'object',
      properties: {
        designMd: {
          type: 'string',
          description: 'The design itself, markdown.',
        },
        scope: {
          type: 'array',
          description:
            'Per repo, the exact files (globs allowed) the build may change. ' +
            "This becomes the build's hard scope check.",
          items: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              files: { type: 'array', items: { type: 'string' } },
            },
            required: ['repo', 'files'],
          },
        },
        contracts: {
          type: 'array',
          description:
            'Every stored field, API field, enum or table the change alters, ' +
            'with every reader found, as "repo:path:line".',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              change: { type: 'string' },
              readers: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'change', 'readers'],
          },
        },
        compatibilityMd: {
          type: 'string',
          description:
            'How released mobile builds and existing data keep working.',
        },
        testMap: {
          type: 'array',
          description: 'Every requirement id → the test that proves it.',
          items: {
            type: 'object',
            properties: {
              requirementId: { type: 'string' },
              repo: { type: 'string' },
              file: { type: 'string' },
              asserts: { type: 'string' },
            },
            required: ['requirementId', 'repo', 'file', 'asserts'],
          },
        },
        openDecisions: {
          type: 'array',
          description:
            'Decisions only a person can make, each with its options. Any ' +
            'entry blocks approval until the PRD settles it.',
          items: { type: 'string' },
        },
      },
      required: [
        'designMd',
        'scope',
        'contracts',
        'compatibilityMd',
        'testMap',
        'openDecisions',
      ],
    },
    handler: async (design) => {
      const result = await request('POST', 'design', design);
      if (!result.ok) {
        return {
          isError: true,
          text: `design NOT stored (${result.status}): ${result.text}`,
        };
      }
      // The runner reads this to tell "submitted" from "finished without
      // submitting".
      writeFileSync(
        process.env.BUILDER_DESIGN_SUBMITTED || '/tmp/builder-design-submitted',
        new Date().toISOString(),
      );
      let blockers = [];
      try {
        blockers = JSON.parse(result.text).blockers ?? [];
      } catch {
        // Stored, and nothing to report.
      }
      return {
        text: blockers.length
          ? `design stored, but approval is blocked by:\n- ${blockers.join('\n- ')}\nFix each and call design again with the whole design.`
          : 'design stored; nothing blocks approval.',
      };
    },
  },

  design_review: {
    description:
      'File your review of the technical design. Defects are what would make ' +
      'the build wrong or a released client break, within the scope the ' +
      "PRD's requirements set; suggestions are scope the design could widen " +
      'to. Any defect makes the verdict concerns; none makes it pass.',
    inputSchema: {
      type: 'object',
      properties: {
        defects: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Each: what is wrong, where (repo:path:line), and what the design should say instead.',
        },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Each: scope the design could widen to, and what it would take.',
        },
        notesMd: {
          type: 'string',
          description: 'Anything else worth a person reading. Optional.',
        },
      },
      required: ['defects', 'suggestions'],
    },
    handler: async ({ defects, suggestions, notesMd }) => {
      const clean = (list) =>
        (Array.isArray(list) ? list : []).map((item) => String(item).trim()).filter(Boolean);
      const found = clean(defects);
      const ideas = clean(suggestions);
      const verdict = found.length ? 'concerns' : 'pass';
      // The verdict and a rendered notesMd are sent as well, so an ally-be
      // from before the split still stores a review a person can read.
      const rendered = [
        found.length ? `**Defects**\n\n${found.map((d) => `- ${d}`).join('\n')}` : '',
        ideas.length ? `**Suggestions**\n\n${ideas.map((d) => `- ${d}`).join('\n')}` : '',
        String(notesMd ?? '').trim(),
      ]
        .filter(Boolean)
        .join('\n\n');
      const result = await request('POST', 'design-review', {
        verdict,
        defects: found,
        suggestions: ideas,
        notesMd: rendered,
      });
      if (!result.ok) {
        return {
          isError: true,
          text: `review NOT stored (${result.status}): ${result.text}`,
        };
      }
      writeFileSync(
        process.env.BUILDER_DESIGN_REVIEWED || '/tmp/builder-design-reviewed',
        new Date().toISOString(),
      );
      return {
        text: `review stored (${verdict}: ${found.length} defect(s), ${ideas.length} suggestion(s))`,
      };
    },
  },
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
