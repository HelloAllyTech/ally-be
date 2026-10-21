import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BUILDER_DISCOVERY_PLAN_SYSTEM_PROMPT } from '../constants/builder-discovery-prompt';
import { BUILDER_AI_TASKS } from '../constants/builder.constants';
import { BUILDER_REPO_NAMES } from '../constants/builder-repos.constants';
import {
  BuilderSseFrame,
  BuilderToolExecutionOutcome,
} from '../type/builder-sse.type';

/**
 * The discovery sweep (W4): what Builder searches before it asks anything.
 *
 * Root cause 2 of the interview fix plan was that research was optional and
 * came late — 0 to 4 code searches per interview, questions sent before reads
 * came back, "this already exists" corrections in 5 of 11 sessions. The sweep
 * makes the first look the server's job: one cheap call plans 8–12 short
 * queries, the server runs them through the interview's own lookup tools (so
 * every result lands in the evidence log), and the interview's first turn
 * starts from what they found.
 */

/** Lookups a sweep may run, in the order the plan should use them. */
export const BUILDER_DISCOVERY_TOOLS = [
  'capability_lookup',
  'docs_search',
  'wiki_search',
  'github_search_code',
  'ai_tasks_lookup',
] as const;
export type BuilderDiscoveryTool = (typeof BUILDER_DISCOVERY_TOOLS)[number];

/**
 * The three that go through GitHub code search, which allows about ten
 * searches a minute: a sweep keeps to eight of them, two at a time, and leaves
 * the interview room for its own.
 */
const GITHUB_TOOLS = new Set<string>([
  'docs_search',
  'wiki_search',
  'github_search_code',
]);
const MAX_GITHUB_QUERIES = 8;
const GITHUB_CONCURRENCY = 2;

export const BUILDER_DISCOVERY_MAX_QUERIES = 12;
const MAX_WORDS = 3;
const FINDINGS_PER_QUERY = 6;
const PLAN_MAX_TOKENS = 1_200;

export interface BuilderDiscoveryQuery {
  tool: BuilderDiscoveryTool;
  query: string;
  repo?: string;
}

/** One query and what it found, numbered so the brief can cite it. */
export interface BuilderDiscoveryItem {
  ref: string;
  tool: BuilderDiscoveryTool;
  query: string;
  repo?: string;
  ok: boolean;
  /** What came back, one line each: `ally-be:src/skill-experiment` or a name. */
  found: string[];
  /** Why it failed, when it did. */
  failure?: string;
}

export interface BuilderDiscovery {
  ranAt: string;
  /** `model` when the planner wrote the queries; `fallback` when it could not. */
  planned: 'model' | 'fallback';
  items: BuilderDiscoveryItem[];
}

const STOP_WORDS = new Set(
  (
    'a an and are as at be but by can could do for from has have how i if in into is it its ' +
    'let me my need of on or our should so that the their them then there these this to ' +
    'us want we what when where which who will with would you your add build make new ' +
    'feature please also like just get'
  ).split(' '),
);

/** At most three words, lower-cased, punctuation dropped. */
const shortQuery = (value: unknown): string =>
  String(value ?? '')
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .join(' ')
    .trim();

/** The planner's queries, made safe to run: known tools, short, deduplicated, capped. */
export function normaliseDiscoveryQueries(
  raw: unknown,
): BuilderDiscoveryQuery[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const queries: BuilderDiscoveryQuery[] = [];
  let github = 0;
  for (const entry of list) {
    const tool = String(
      (entry as Record<string, unknown>)?.tool ?? '',
    ) as BuilderDiscoveryTool;
    if (!BUILDER_DISCOVERY_TOOLS.includes(tool)) continue;
    const query = shortQuery((entry as Record<string, unknown>)?.query);
    if (!query) continue;
    const repoValue = String((entry as Record<string, unknown>)?.repo ?? '');
    const repo =
      tool !== 'capability_lookup' &&
      tool !== 'ai_tasks_lookup' &&
      tool !== 'wiki_search' &&
      BUILDER_REPO_NAMES.includes(repoValue)
        ? repoValue
        : undefined;
    const key = `${tool}|${query.toLowerCase()}|${repo ?? ''}`;
    if (seen.has(key)) continue;
    if (GITHUB_TOOLS.has(tool)) {
      if (github >= MAX_GITHUB_QUERIES) continue;
      github += 1;
    }
    seen.add(key);
    queries.push({ tool, query, ...(repo ? { repo } : {}) });
    if (queries.length >= BUILDER_DISCOVERY_MAX_QUERIES) break;
  }
  return queries;
}

/**
 * Queries from the request's own words, for when the planner could not run.
 * Cruder than a plan, and still a sweep: a discovery step that silently
 * skipped itself would leave the brief nothing to cite.
 */
export function fallbackDiscoveryQueries(
  ...texts: (string | null | undefined)[]
): BuilderDiscoveryQuery[] {
  const words: string[] = [];
  for (const text of texts) {
    for (const word of String(text ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)) {
      if (word.length > 2 && !STOP_WORDS.has(word) && !words.includes(word)) {
        words.push(word);
      }
    }
  }
  const terms = words.slice(0, 4);
  if (!terms.length) return [];
  const pair = terms.slice(0, 2).join(' ');
  return normaliseDiscoveryQueries([
    { tool: 'capability_lookup', query: pair },
    ...terms.map((term) => ({ tool: 'capability_lookup', query: term })),
    { tool: 'docs_search', query: pair },
    ...terms.slice(0, 2).map((term) => ({ tool: 'docs_search', query: term })),
    { tool: 'wiki_search', query: terms[0] },
    { tool: 'github_search_code', query: terms[0] },
    { tool: 'ai_tasks_lookup', query: terms[0] },
  ]);
}

/**
 * Plan the sweep. One fast-tier completion; any failure falls back to the
 * request's own words rather than skipping discovery.
 */
export async function planDiscovery(
  llmCompletion: LlmCompletionService,
  input: {
    sessionId: string;
    title?: string | null;
    opening: string;
    handoff?: string | null;
  },
  onError?: (message: string) => void,
): Promise<{
  queries: BuilderDiscoveryQuery[];
  planned: 'model' | 'fallback';
}> {
  try {
    const result = await llmCompletion.complete({
      taskId: BUILDER_AI_TASKS.DISCOVERY_PLAN,
      task: LlmTask.BUILDER_DISCOVERY_PLAN,
      system: BUILDER_DISCOVERY_PLAN_SYSTEM_PROMPT,
      jsonMode: true,
      maxTokens: PLAN_MAX_TOKENS,
      usageMetadata: { builderSessionId: input.sessionId },
      prompt: [
        `<title>${String(input.title ?? '').slice(0, 200)}</title>`,
        '<request>',
        input.opening.slice(0, 4_000),
        '</request>',
        ...(input.handoff
          ? ['<earlier_work>', input.handoff.slice(0, 6_000), '</earlier_work>']
          : []),
      ].join('\n'),
    });
    const parsed = JSON.parse(
      result.text.replace(/^```(?:json)?\s*|\s*```$/g, ''),
    ) as { queries?: unknown };
    const queries = normaliseDiscoveryQueries(parsed?.queries);
    if (queries.length >= 4) return { queries, planned: 'model' };
    onError?.(`planner returned ${queries.length} usable queries`);
  } catch (error) {
    onError?.(error instanceof Error ? error.message : String(error));
  }
  return {
    queries: fallbackDiscoveryQueries(input.title, input.opening),
    planned: 'fallback',
  };
}

/** One line per thing a lookup found: `repo:path`, or a catalog entry's name and where. */
export function foundLines(result: Record<string, any>): string[] {
  const list = Array.isArray(result?.results) ? result.results : [];
  return list
    .slice(0, FINDINGS_PER_QUERY)
    .map((hit: Record<string, any>) => {
      if (typeof hit === 'string') return hit;
      const path = hit?.path ? String(hit.path) : '';
      const repo = hit?.repo ? String(hit.repo) : '';
      const where = path
        ? repo && !path.startsWith(`${repo}:`)
          ? `${repo}:${path}`
          : path
        : repo;
      if (hit?.name) {
        const kind = hit?.kind ? `${hit.kind} ` : '';
        return `${kind}${hit.name}${where ? ` (${where})` : ''}`;
      }
      return where;
    })
    .filter(Boolean);
}

/** Run up to `limit` jobs at a time, keeping their order in the result. */
async function inBatches<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * Run the sweep: catalog lookups at once, GitHub searches two at a time.
 * Every query is announced as a `tool_call` and settled with a `tool_result`,
 * so the admin watches discovery happen in the chips they already know, and
 * every result goes through `execute` — the interview's own tools — so the
 * evidence log records it like any other lookup.
 */
export async function* runDiscovery(
  queries: BuilderDiscoveryQuery[],
  execute: (
    name: string,
    input: Record<string, any>,
  ) => Promise<BuilderToolExecutionOutcome>,
  planned: 'model' | 'fallback',
): AsyncGenerator<BuilderSseFrame, BuilderDiscovery> {
  const inputOf = (query: BuilderDiscoveryQuery) => ({
    query: query.query,
    ...(query.repo ? { repo: query.repo } : {}),
  });
  for (const query of queries) {
    yield {
      event: 'tool_call',
      data: { name: query.tool, input: inputOf(query) },
    };
  }
  const local = queries.filter((query) => !GITHUB_TOOLS.has(query.tool));
  const remote = queries.filter((query) => GITHUB_TOOLS.has(query.tool));
  const run = (query: BuilderDiscoveryQuery) =>
    execute(query.tool, inputOf(query));
  const [localOutcomes, remoteOutcomes] = await Promise.all([
    Promise.all(local.map(run)),
    inBatches(remote, GITHUB_CONCURRENCY, run),
  ]);
  const outcomeOf = new Map<
    BuilderDiscoveryQuery,
    BuilderToolExecutionOutcome
  >();
  local.forEach((query, index) => outcomeOf.set(query, localOutcomes[index]));
  remote.forEach((query, index) => outcomeOf.set(query, remoteOutcomes[index]));

  const items: BuilderDiscoveryItem[] = [];
  for (const [index, query] of queries.entries()) {
    const outcome = outcomeOf.get(query)!;
    const result = outcome.modelResult ?? {};
    const ok = result.ok !== false;
    yield {
      event: 'tool_result',
      data: { name: query.tool, summary: outcome.summary },
    };
    items.push({
      ref: `E${index + 1}`,
      tool: query.tool,
      query: query.query,
      ...(query.repo ? { repo: query.repo } : {}),
      ok,
      found: ok ? foundLines(result) : [],
      ...(ok
        ? {}
        : {
            failure: String(result.message ?? result.error ?? 'failed').slice(
              0,
              200,
            ),
          }),
    });
  }
  return { ranAt: new Date().toISOString(), planned, items };
}

/** The discovery block on the opening turn's user message. */
export function renderDiscoveryBlock(discovery: BuilderDiscovery): string {
  const lines = discovery.items.map((item) => {
    const where = item.repo ? ` in ${item.repo}` : '';
    const head = `${item.ref} ${item.tool} "${item.query}"${where}`;
    if (!item.ok) return `${head} — FAILED: ${item.failure}`;
    if (!item.found.length) return `${head} — nothing`;
    return `${head} — ${item.found.join('; ')}`;
  });
  return [
    '<discovery>',
    'The server searched before this turn. Each line is a lookup and what it found; cite ' +
      'them by ref (E1, E2…) in the situation brief. "nothing" means that search found ' +
      'nothing — not that nothing exists; a FAILED search tells you nothing either way.',
    ...lines,
    '</discovery>',
  ].join('\n');
}
