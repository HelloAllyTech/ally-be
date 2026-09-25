import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';

import {
  AGENT_MEMORY_ACTIVE_CAP,
  AGENT_MEMORY_CANDIDATE_TRIGGER,
  AGENT_MEMORY_CURATE_LOCK,
  AGENT_MEMORY_CURATE_LOCK_TTL_SECONDS,
  AGENT_MEMORY_CURATOR_MAX_TOKENS,
} from '../constants/agent-memory.constants';
import {
  AGENT_MEMORY_BODY_MAX,
  AgentMemory,
} from '../entity/agent-memory.entity';
import { AgentMemoryAgent, AgentMemoryStatus } from '../enum/agent-memory.enum';
import { AgentMemoryRepository } from '../repository/agent-memory.repository';
import { AgentMemoryService } from './agent-memory.service';

/** Matched by the AI-task-registry guard, which resolves every `taskId` literal in code. */
const AI_TASK_ID = 'agent-memory-curation';

export interface CurationResult {
  agent: AgentMemoryAgent;
  considered: number;
  applied: number;
  skipped: string | null;
}

/**
 * The consolidation pass that keeps an agent's notebook worth reading.
 *
 * Without it, memory degrades as it grows: every run appends a few entries,
 * nothing merges or retires anything, and the same trap learned five times
 * becomes five rows competing for one fixed prompt budget. This pass takes the
 * CANDIDATE entries an agent wrote and, against the ACTIVE set, decides one
 * operation per candidate — AGREE with an existing entry (fold it in, count the
 * agreement), EDIT one to be more precise, ADD it as genuinely new, or REMOVE
 * an entry it supersedes. The operation set is ExpeL's, and it is also what
 * Mem0 applies per fact; here it is applied to lessons.
 *
 * ## Why this is a second curator and not Builder's
 *
 * Builder has the same pass over `builder_lessons`. The product lead's
 * preference was for Bug Hunter's memory not to require changes to Builder,
 * so this one lives in the agent-memory module, is scoped by the `agent`
 * column, and Builder's stays untouched. When Builder's rows move here
 * (OPP-0714) its curator becomes redundant and this one takes over; until
 * then there are two, which docs/bug-hunter-memory-adr.md says plainly.
 *
 * ## Guardrails are in code
 *
 * A model asked to tidy a set of rules will happily delete the ones a human
 * pinned, or rewrite everything when two entries needed it. So: pinned rows
 * are never edited or retired whatever the model says; a candidate the model
 * did not mention is promoted rather than left invisible; a rewrite over the
 * 600-character cap is refused; and when the model is unavailable every
 * candidate is promoted uncurated, because an untidy notebook beats a lost
 * lesson. The active cap is enforced after every pass by evidence score,
 * pinned rows exempt.
 */
@Injectable()
export class AgentMemoryCuratorService {
  private readonly logger = LoggerService.getInstance(
    AgentMemoryCuratorService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: AgentMemoryRepository,
    private readonly memoryService: AgentMemoryService,
    private readonly llmCompletion: LlmCompletionService,
    private readonly redisService: RedisService,
  ) {}

  /** Curate every agent's notebook in turn. The scheduled entry point. */
  async consolidateAll(force = false): Promise<CurationResult[]> {
    const results: CurationResult[] = [];
    for (const agent of Object.values(AgentMemoryAgent)) {
      results.push(await this.consolidate(agent, force));
    }
    return results;
  }

  /**
   * Curate one agent's candidates if there is anything to curate. One pod at
   * a time: this runs hourly on every pod, so without a lock two pods would
   * send the same candidates to two models and apply both replies.
   */
  async consolidate(
    agent: AgentMemoryAgent,
    force = false,
  ): Promise<CurationResult> {
    const lock = `${AGENT_MEMORY_CURATE_LOCK}:${agent}`;
    const locked = await this.redisService.acquireLock(
      lock,
      AGENT_MEMORY_CURATE_LOCK_TTL_SECONDS,
    );
    if (!locked) {
      return {
        agent,
        considered: 0,
        applied: 0,
        skipped: 'another pod is curating',
      };
    }
    try {
      return await this.consolidateLocked(agent, force);
    } finally {
      await this.redisService.releaseLock(lock).catch(() => undefined);
    }
  }

  private async consolidateLocked(
    agent: AgentMemoryAgent,
    force: boolean,
  ): Promise<CurationResult> {
    const candidates = await this.repository.listByStatus(
      agent,
      AgentMemoryStatus.CANDIDATE,
    );

    // The cap is enforced on every pass, not only when there is new material:
    // an admin adding a batch by hand can push the active set over it.
    if (!candidates.length) {
      await this.enforceActiveCap(agent);
      return { agent, considered: 0, applied: 0, skipped: 'nothing new' };
    }
    if (!force && candidates.length < AGENT_MEMORY_CANDIDATE_TRIGGER) {
      await this.enforceActiveCap(agent);
      return {
        agent,
        considered: candidates.length,
        applied: 0,
        skipped: 'below the batch threshold',
      };
    }

    const active = await this.repository.listByStatus(
      agent,
      AgentMemoryStatus.ACTIVE,
    );

    let operations: CuratorOperation[];
    try {
      operations = await this.askForOperations(agent, candidates, active);
    } catch (error) {
      this.logger.warn(
        `Agent memory curation (${agent}) could not run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const promoted = await this.promoteAll(agent, candidates);
      return {
        agent,
        considered: candidates.length,
        applied: promoted,
        skipped: 'model unavailable — promoted uncurated',
      };
    }

    const applied = await this.apply(agent, operations, candidates, active);
    this.logger.info(
      `Agent memory curation (${agent}): ${candidates.length} candidate(s) → ${applied} operation(s) applied.`,
    );
    return { agent, considered: candidates.length, applied, skipped: null };
  }

  private async askForOperations(
    agent: AgentMemoryAgent,
    candidates: AgentMemory[],
    active: AgentMemory[],
  ): Promise<CuratorOperation[]> {
    const result = await this.llmCompletion.complete({
      taskId: AI_TASK_ID,
      task: LlmTask.AGENT_MEMORY_CURATION,
      maxTokens: AGENT_MEMORY_CURATOR_MAX_TOKENS,
      // No model here: the registry row is tiered FAST and the completion
      // service resolves the model from that tier. Mechanical editing, not
      // judgement, so the fast tier is the right one.
      system: CURATOR_SYSTEM_PROMPT,
      usageMetadata: {
        agent,
        candidates: candidates.length,
        active: active.length,
      },
      prompt: [
        '## Active entries',
        active.length
          ? active.map((entry) => renderEntry(entry)).join('\n')
          : '(none yet)',
        '',
        '## New candidates',
        candidates.map((entry) => renderEntry(entry)).join('\n'),
        '',
        'Return the JSON operations array and nothing else.',
      ].join('\n'),
    });
    return parseOperations(result.text);
  }

  /** Apply the operations in one transaction, every guardrail enforced here. */
  private async apply(
    agent: AgentMemoryAgent,
    operations: CuratorOperation[],
    candidates: AgentMemory[],
    active: AgentMemory[],
  ): Promise<number> {
    const byId = new Map<string, AgentMemory>(
      [...candidates, ...active].map((entry) => [entry.id, entry]),
    );
    const candidateIds = new Set(candidates.map((entry) => entry.id));
    const handled = new Set<string>();
    const touched = new Set<string>();
    let applied = 0;

    await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(AgentMemory);

      for (const operation of operations) {
        const target = operation.id ? byId.get(operation.id) : undefined;
        // The model only ever sees one agent's rows, but a hallucinated id
        // could name another agent's; refuse to cross the boundary.
        if (target && target.agent !== agent) continue;

        switch (operation.op) {
          case 'AGREE': {
            const candidate = operation.candidateId
              ? byId.get(operation.candidateId)
              : undefined;
            if (!candidate || !target || !candidateIds.has(candidate.id)) break;
            if (candidate.id === target.id) break;
            await repo.update(
              { id: target.id },
              {
                sourceCount: target.sourceCount + candidate.sourceCount,
                repos: mergeLists(target.repos, candidate.repos),
                tags: mergeLists(target.tags, candidate.tags),
              },
            );
            await repo.update(
              { id: candidate.id },
              { status: AgentMemoryStatus.MERGED, mergedIntoId: target.id },
            );
            handled.add(candidate.id);
            applied += 1;
            break;
          }

          case 'EDIT': {
            const body = operation.body?.trim();
            if (!target || target.pinned || !body) break;
            if (body.length > AGENT_MEMORY_BODY_MAX) break;
            await repo.update(
              { id: target.id },
              {
                body,
                ...(operation.tags ? { tags: operation.tags } : {}),
                status: AgentMemoryStatus.ACTIVE,
              },
            );
            touched.add(target.id);
            if (candidateIds.has(target.id)) handled.add(target.id);
            applied += 1;
            break;
          }

          case 'ADD': {
            if (!target || !candidateIds.has(target.id)) break;
            const body = operation.body?.trim();
            if (body && body.length > AGENT_MEMORY_BODY_MAX) break;
            await repo.update(
              { id: target.id },
              {
                status: AgentMemoryStatus.ACTIVE,
                ...(body ? { body } : {}),
                ...(operation.tags ? { tags: operation.tags } : {}),
              },
            );
            if (body) touched.add(target.id);
            handled.add(target.id);
            applied += 1;
            break;
          }

          case 'REMOVE': {
            if (!target || target.pinned) break;
            await repo.update(
              { id: target.id },
              { status: AgentMemoryStatus.RETIRED },
            );
            touched.add(target.id);
            if (candidateIds.has(target.id)) handled.add(target.id);
            applied += 1;
            break;
          }

          default:
            break;
        }
      }

      // Silence is not a decision: an unmentioned candidate is promoted.
      for (const candidate of candidates) {
        if (handled.has(candidate.id)) continue;
        await repo.update(
          { id: candidate.id },
          { status: AgentMemoryStatus.ACTIVE },
        );
      }
    });

    // A rewritten or retired entry needs its vector re-pushed or removed; the
    // service owns that and does it best-effort.
    await this.memoryService.resyncVectors([...touched]);
    await this.enforceActiveCap(agent);
    return applied;
  }

  private async promoteAll(
    agent: AgentMemoryAgent,
    candidates: AgentMemory[],
  ): Promise<number> {
    for (const candidate of candidates) {
      await this.repository.update(
        { id: candidate.id },
        { status: AgentMemoryStatus.ACTIVE },
      );
    }
    await this.enforceActiveCap(agent);
    return candidates.length;
  }

  /** Keep the active set inside the cap, retiring the weakest first; pinned rows exempt. */
  private async enforceActiveCap(agent: AgentMemoryAgent): Promise<void> {
    const active = await this.repository.listByStatus(
      agent,
      AgentMemoryStatus.ACTIVE,
    );
    if (active.length <= AGENT_MEMORY_ACTIVE_CAP) return;

    const scored = active
      .filter((entry) => !entry.pinned)
      .sort((a, b) => scoreEntry(a) - scoreEntry(b));
    const overBy = active.length - AGENT_MEMORY_ACTIVE_CAP;
    const retiring = scored.slice(0, overBy);

    for (const entry of retiring) {
      await this.repository.update(
        { id: entry.id },
        { status: AgentMemoryStatus.RETIRED },
      );
    }
    await this.memoryService.resyncVectors(retiring.map((e) => e.id));
    this.logger.info(
      `Agent memory (${agent}): retired ${retiring.length} entr${retiring.length === 1 ? 'y' : 'ies'} to stay inside the active cap of ${AGENT_MEMORY_ACTIVE_CAP}.`,
    );
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

export interface CuratorOperation {
  op: 'AGREE' | 'EDIT' | 'ADD' | 'REMOVE';
  /** The entry being acted on. */
  id?: string;
  /** AGREE only: the candidate being folded into `id`. */
  candidateId?: string;
  body?: string;
  tags?: string[];
}

/** Evidence, not recency: independent sightings plus times applied, penalised for being contradicted. */
export function scoreEntry(entry: AgentMemory): number {
  return entry.sourceCount + entry.timesApplied - 2 * entry.timesContradicted;
}

const renderEntry = (entry: AgentMemory): string =>
  `- [${entry.id}] (${entry.repos?.length ? entry.repos.join('/') : 'platform'}${
    entry.tags?.length ? `; ${entry.tags.join(', ')}` : ''
  }; seen ${entry.sourceCount}×${entry.pinned ? '; PINNED' : ''}) ${entry.body}`;

const mergeLists = (
  existing: string[] | null | undefined,
  incoming: string[] | null | undefined,
): string[] | null => {
  const merged = [...new Set([...(existing ?? []), ...(incoming ?? [])])];
  return merged.length ? merged : null;
};

/**
 * Pull the operations array out of the model's reply. Tolerant by design: an
 * unparseable reply means no operations, which the caller turns into
 * "promote the candidates uncurated" rather than a failure.
 */
export function parseOperations(text: string): CuratorOperation[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    candidates.push(match[1]);
  }
  candidates.push(text);

  for (const raw of candidates) {
    const trimmed = raw.trim();
    const start = trimmed.search(/[[{]/);
    if (start === -1) continue;
    try {
      const parsed = JSON.parse(trimmed.slice(start));
      const list = Array.isArray(parsed) ? parsed : parsed?.operations;
      if (!Array.isArray(list)) continue;
      return list
        .map((entry) => normaliseOperation(entry))
        .filter(Boolean) as CuratorOperation[];
    } catch {
      continue;
    }
  }
  return [];
}

const normaliseOperation = (entry: any): CuratorOperation | null => {
  const op = String(entry?.op ?? '').toUpperCase();
  if (!['AGREE', 'EDIT', 'ADD', 'REMOVE'].includes(op)) return null;
  return {
    op: op as CuratorOperation['op'],
    id: entry?.id ? String(entry.id) : undefined,
    candidateId: entry?.candidateId ? String(entry.candidateId) : undefined,
    body: entry?.body
      ? String(entry.body)
      : entry?.lesson
        ? String(entry.lesson)
        : undefined,
    tags: Array.isArray(entry?.tags)
      ? entry.tags
          .map((tag: unknown) => String(tag).trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 8)
      : undefined,
  };
};

const CURATOR_SYSTEM_PROMPT = `
You maintain the notebook of an autonomous engineering agent that works on one
platform's repos. New entries arrive as short notes the agent wrote at the end
of a run; your job is to fold them into a set that stays worth reading.

The set has a hard size cap, so this is a zero-sum edit: every entry that stays
is one another cannot have. Prefer a short set of specific, checkable entries
over a long set of vague ones. Every entry must stay under 600 characters.

For each candidate, emit exactly one operation:

- **AGREE** — a candidate says what an active entry already says. Fold it in.
  {"op":"AGREE","id":"<active entry id>","candidateId":"<candidate id>"}
- **EDIT** — an active entry (or a candidate) is right but imprecise, or the
  candidate makes it more general. Rewrite it, under 600 characters.
  {"op":"EDIT","id":"<id>","body":"<new text>","tags":["<label>"]}
- **ADD** — genuinely new. Activate the candidate, optionally tightening it.
  {"op":"ADD","id":"<candidate id>","body":"<optional tightened text>","tags":["<label>"]}
- **REMOVE** — an active entry is stale, wrong, or now subsumed by another.
  {"op":"REMOVE","id":"<id>"}

Entries marked PINNED were placed by a person and outrank you: never EDIT or
REMOVE one; you may AGREE a candidate into it.

What makes a good entry: specific and checkable, written for a stranger who
did not see the run (name the repo, the file, the command, the symptom), about
the platform rather than about one night. Tags are open labels — reuse an
existing one where it fits, invent one where nothing does.

Merge aggressively. Two entries about the same trap in different words are one
entry. Prefer AGREE over ADD when in doubt: a count of five on one entry
carries more signal than five entries.

Do not invent entries nobody wrote. Do not restate an entry you are keeping.

Output: a JSON array of operations, nothing else.
`.trim();
