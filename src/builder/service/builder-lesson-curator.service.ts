import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderLesson } from '../entity/builder-lesson.entity';
import { BuilderLessonRepository } from '../repository/builder-knowledge.repository';
import {
  BuilderLessonCategory,
  BuilderLessonStatus,
} from '../enum/builder.enum';
import {
  BUILDER_LESSON_ACTIVE_CAP,
  BUILDER_LESSON_CANDIDATE_TRIGGER,
  BUILDER_MAX_TOKENS,
} from '../constants/builder.constants';

/**
 * The consolidation pass that turns raw retrospective bullets into a curated
 * rule set.
 *
 * Without it, memory degrades as it grows. Every build appended up to ten
 * bullets, retrieval took the newest twenty, and nothing ever merged, edited or
 * retired anything — so the same trap learned five times became five rows
 * competing for one fixed context budget, and after twenty builds the earliest
 * lessons were permanently unreachable regardless of how good they were.
 *
 * The operation set is ExpeL's: for each candidate, either AGREE with an
 * existing rule (fold it in and count the agreement), EDIT one to be more
 * precise, ADD it as genuinely new, or REMOVE a rule it supersedes. Applied by
 * a cheap model, because this is mechanical editing rather than judgement.
 *
 * The guardrails are in code, not in the prompt. A model asked to tidy a set
 * of rules will happily delete the ones a human pinned, or rewrite twelve rows
 * when two needed it, and no amount of instruction makes that reliably not
 * happen.
 */
@Injectable()
export class BuilderLessonCuratorService {
  private readonly logger = LoggerService.getInstance(
    BuilderLessonCuratorService.name,
  );

  // Exposed for tests (mocked with a fake client), matching the orchestrator.
  protected client: Anthropic;

  constructor(
    private readonly configService: AppConfigService,
    private readonly dataSource: DataSource,
    private readonly lessonRepository: BuilderLessonRepository,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
  }

  /**
   * Curate if there is anything to curate.
   *
   * Called on a timer and opportunistically after a harvest, so the no-op path
   * is the common one and has to be cheap: one COUNT, no model call.
   */
  async consolidate(force = false): Promise<{
    considered: number;
    applied: number;
    skipped: string | null;
  }> {
    const candidates = await this.lessonRepository.listByStatus(
      BuilderLessonStatus.CANDIDATE,
    );

    // The cap is enforced on every pass, not only when there is new material.
    // The active set can go over it without any candidate arriving — an admin
    // activating a batch by hand, or the migration that backfilled every
    // pre-curation row to `active` — and a cap nothing checks is not a cap.
    if (!candidates.length) {
      await this.enforceActiveCap();
      return { considered: 0, applied: 0, skipped: 'nothing new' };
    }
    if (!force && candidates.length < BUILDER_LESSON_CANDIDATE_TRIGGER) {
      // Curating one bullet at a time would spend a model call per build to
      // decide almost nothing; the timer picks these up in a batch.
      await this.enforceActiveCap();
      return {
        considered: candidates.length,
        applied: 0,
        skipped: 'below the batch threshold',
      };
    }

    const active = await this.lessonRepository.listByStatus(
      BuilderLessonStatus.ACTIVE,
    );

    let operations: CuratorOperation[];
    try {
      operations = await this.askForOperations(candidates, active);
    } catch (error) {
      this.logger.warn(
        `Builder lesson consolidation could not run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Failing safe means promoting the candidates as-is rather than leaving
      // them invisible: an uncurated lesson still beats a lost one.
      const promoted = await this.promoteAll(candidates);
      return {
        considered: candidates.length,
        applied: promoted,
        skipped: 'model unavailable — promoted uncurated',
      };
    }

    const applied = await this.apply(operations, candidates, active);
    this.logger.info(
      `Builder lesson consolidation: ${candidates.length} candidate(s) → ${applied} operation(s) applied.`,
    );
    return { considered: candidates.length, applied, skipped: null };
  }

  private async askForOperations(
    candidates: BuilderLesson[],
    active: BuilderLesson[],
  ): Promise<CuratorOperation[]> {
    const model = this.configService.builder.mechanicalModel;
    const response = await this.client.messages.create({
      model,
      max_tokens: BUILDER_MAX_TOKENS,
      system: CURATOR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            '## Active rules',
            active.length
              ? active.map((lesson) => renderLesson(lesson)).join('\n')
              : '(none yet)',
            '',
            '## New candidates',
            candidates.map((lesson) => renderLesson(lesson)).join('\n'),
            '',
            'Return the JSON operations array and nothing else.',
          ].join('\n'),
        },
      ],
    });

    const input = response.usage?.input_tokens ?? 0;
    const output = response.usage?.output_tokens ?? 0;
    void this.llmUsage.record({
      provider: 'anthropic',
      model,
      task: LlmTask.BUILDER_LESSON_CURATION,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      metadata: { candidates: candidates.length, active: active.length },
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');
    return parseOperations(text);
  }

  /**
   * Apply the operations in one transaction, with every guardrail enforced
   * here rather than trusted to the model.
   */
  private async apply(
    operations: CuratorOperation[],
    candidates: BuilderLesson[],
    active: BuilderLesson[],
  ): Promise<number> {
    const byId = new Map<string, BuilderLesson>(
      [...candidates, ...active].map((lesson) => [lesson.id, lesson]),
    );
    const candidateIds = new Set(candidates.map((lesson) => lesson.id));
    const handled = new Set<string>();
    let applied = 0;

    await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(BuilderLesson);

      for (const operation of operations) {
        const target = operation.id ? byId.get(operation.id) : undefined;

        switch (operation.op) {
          case 'AGREE': {
            // The candidate says what an existing rule already says: fold the
            // provenance in, count the agreement, tombstone the duplicate.
            const candidate = operation.candidateId
              ? byId.get(operation.candidateId)
              : undefined;
            if (!candidate || !target || !candidateIds.has(candidate.id)) break;
            if (target.pinned && operation.rewrite) break;

            await repo.update(
              { id: target.id },
              {
                sourceCount: target.sourceCount + candidate.sourceCount,
                sourceSessionIds: mergeIds(
                  target.sourceSessionIds,
                  candidate.sourceSessionIds ?? [candidate.sessionId ?? ''],
                ),
                repos: mergeRepos(target.repos, candidate.repos),
              },
            );
            await repo.update(
              { id: candidate.id },
              {
                status: BuilderLessonStatus.MERGED,
                mergedIntoId: target.id,
              },
            );
            handled.add(candidate.id);
            applied += 1;
            break;
          }

          case 'EDIT': {
            // Pinned rules are a human's decision and outrank a tidying pass.
            if (!target || target.pinned || !operation.lesson?.trim()) break;
            await repo.update(
              { id: target.id },
              {
                lesson: operation.lesson.trim(),
                ...(operation.category ? { category: operation.category } : {}),
                ...(operation.tags ? { tags: operation.tags } : {}),
                status: BuilderLessonStatus.ACTIVE,
              },
            );
            if (candidateIds.has(target.id)) handled.add(target.id);
            applied += 1;
            break;
          }

          case 'ADD': {
            if (!target || !candidateIds.has(target.id)) break;
            await repo.update(
              { id: target.id },
              {
                status: BuilderLessonStatus.ACTIVE,
                ...(operation.lesson?.trim()
                  ? { lesson: operation.lesson.trim() }
                  : {}),
                ...(operation.tags ? { tags: operation.tags } : {}),
              },
            );
            handled.add(target.id);
            applied += 1;
            break;
          }

          case 'REMOVE': {
            if (!target || target.pinned) break;
            await repo.update(
              { id: target.id },
              { status: BuilderLessonStatus.RETIRED },
            );
            if (candidateIds.has(target.id)) handled.add(target.id);
            applied += 1;
            break;
          }

          default:
            break;
        }
      }

      // A candidate the model said nothing about is promoted rather than left
      // in limbo — silence is not a decision, and an uncurated lesson still
      // beats an invisible one.
      for (const candidate of candidates) {
        if (handled.has(candidate.id)) continue;
        await repo.update(
          { id: candidate.id },
          { status: BuilderLessonStatus.ACTIVE },
        );
      }
    });

    await this.enforceActiveCap();
    return applied;
  }

  private async promoteAll(candidates: BuilderLesson[]): Promise<number> {
    for (const candidate of candidates) {
      await this.lessonRepository.update(
        { id: candidate.id },
        { status: BuilderLessonStatus.ACTIVE },
      );
    }
    await this.enforceActiveCap();
    return candidates.length;
  }

  /**
   * Keep the active set inside the cap, retiring the weakest first.
   *
   * The cap is the whole reason curation exists: the prompt budget for lessons
   * is fixed, so an unbounded set does not mean more memory, it means the
   * newest twenty crowd out everything ever learned before them. Score is
   * evidence-based — agreement across builds, minus being contradicted — and
   * pinned rows are never candidates for retirement.
   */
  private async enforceActiveCap(): Promise<void> {
    const active = await this.lessonRepository.listByStatus(
      BuilderLessonStatus.ACTIVE,
    );
    if (active.length <= BUILDER_LESSON_ACTIVE_CAP) return;

    const scored = active
      .filter((lesson) => !lesson.pinned)
      .sort((a, b) => scoreLesson(a) - scoreLesson(b));
    const overBy = active.length - BUILDER_LESSON_ACTIVE_CAP;

    for (const lesson of scored.slice(0, overBy)) {
      await this.lessonRepository.update(
        { id: lesson.id },
        { status: BuilderLessonStatus.RETIRED },
      );
    }
    this.logger.info(
      `Retired ${Math.min(overBy, scored.length)} lesson(s) to stay inside the active cap of ${BUILDER_LESSON_ACTIVE_CAP}.`,
    );
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

interface CuratorOperation {
  op: 'AGREE' | 'EDIT' | 'ADD' | 'REMOVE';
  /** The rule being acted on. */
  id?: string;
  /** AGREE only: the candidate being folded into `id`. */
  candidateId?: string;
  lesson?: string;
  category?: BuilderLessonCategory;
  tags?: string[];
  rewrite?: boolean;
}

const CATEGORIES = new Set<string>(Object.values(BuilderLessonCategory));

/**
 * Evidence, not recency: how many builds independently found this, how often
 * it changed what a run did, penalised for being contradicted.
 */
export function scoreLesson(lesson: BuilderLesson): number {
  return (
    lesson.sourceCount + lesson.timesApplied - 2 * lesson.timesContradicted
  );
}

const renderLesson = (lesson: BuilderLesson): string =>
  `- [${lesson.id}] (${lesson.category}${
    lesson.repos?.length ? `, ${lesson.repos.join('/')}` : ''
  }, seen ${lesson.sourceCount}×) ${lesson.lesson}`;

const mergeIds = (
  existing: string[] | null | undefined,
  incoming: string[],
): string[] => [...new Set([...(existing ?? []), ...incoming.filter(Boolean)])];

const mergeRepos = (
  existing: string[] | null | undefined,
  incoming: string[] | null | undefined,
): string[] | null => {
  // A lesson that turns out to apply to two repos is platform-wide-ish, but
  // keeping both names is more useful than erasing them — which is what the
  // old harvest did to every multi-repo build.
  const merged = [...new Set([...(existing ?? []), ...(incoming ?? [])])];
  return merged.length ? merged : null;
};

/**
 * Pull the operations array out of the model's reply.
 *
 * Tolerant by design: the array may arrive fenced, prefixed with prose, or
 * wrapped in an object. An unparseable reply means no operations, which the
 * caller turns into "promote the candidates uncurated" rather than a failure.
 */
export function parseOperations(text: string): CuratorOperation[] {
  const candidates: string[] = [];
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of fenced) candidates.push(match[1]);
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
  const category = String(entry?.category ?? '');
  return {
    op: op as CuratorOperation['op'],
    id: entry?.id ? String(entry.id) : undefined,
    candidateId: entry?.candidateId ? String(entry.candidateId) : undefined,
    lesson: entry?.lesson ? String(entry.lesson) : undefined,
    category: CATEGORIES.has(category)
      ? (category as BuilderLessonCategory)
      : undefined,
    tags: Array.isArray(entry?.tags)
      ? entry.tags.map((tag: unknown) => String(tag)).slice(0, 8)
      : undefined,
    rewrite: Boolean(entry?.rewrite),
  };
};

const CURATOR_SYSTEM_PROMPT = `
You maintain a small library of engineering lessons for a coding agent that
works on one platform's repos. New lessons arrive as raw bullets written by an
agent immediately after finishing a build; your job is to fold them into a set
that stays worth reading.

The set has a hard size cap, so this is a zero-sum edit: every rule that stays
is one another cannot have. Prefer a short set of specific, checkable rules over
a long set of vague ones.

For each candidate, emit exactly one operation:

- **AGREE** — a candidate says what an active rule already says. Fold it in.
  \`{"op":"AGREE","id":"<active rule id>","candidateId":"<candidate id>"}\`
- **EDIT** — an active rule (or a candidate) is right but imprecise, or the
  candidate makes it more general. Rewrite it.
  \`{"op":"EDIT","id":"<id>","lesson":"<new text>","category":"gotcha|convention|estimate|process","tags":["migrations"]}\`
- **ADD** — genuinely new. Activate the candidate, optionally tightening it.
  \`{"op":"ADD","id":"<candidate id>","lesson":"<optional tightened text>","tags":[]}\`
- **REMOVE** — an active rule is stale, wrong, or now subsumed by another.
  \`{"op":"REMOVE","id":"<id>"}\`

What makes a good rule:

- **Specific and checkable.** "Migrations in ally-be need a CHECK constraint
  rewritten when an enum widens" is a rule. "Be careful with migrations" is not.
- **Written for a stranger.** The next reader has no idea which build produced
  it. Name the repo, the file, the command, the symptom.
- **About the platform, not the moment.** "The suite was slow today" is noise;
  "ally-web tests need NX_DAEMON=false or they collide" is a rule.

Merge aggressively. Two rules about the same trap in different words are one
rule. Prefer AGREE over ADD when in doubt: a count of five on one rule carries
more signal than five rules.

Do not invent lessons nobody reported. Do not restate a rule you are keeping.

Output: a JSON array of operations, nothing else.
`.trim();
