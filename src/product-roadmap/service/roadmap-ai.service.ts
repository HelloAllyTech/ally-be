import { Injectable, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import {
  renderTemplate,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import { AiService } from 'src/ai/service/ai.service';

import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import { RoadmapProductGoalRepository } from '../repository/roadmap-taxonomy.repository';

/** AI-task-registry row id; the key for per-task model config. */
const AI_TASK_ID = 'roadmap-ai';
import { RoadmapOpportunityType } from '../enum/roadmap-opportunity.enum';
import {
  ROADMAP_DUPLICATES,
  ROADMAP_LIMITS,
  ROADMAP_PROMPT_CODES,
} from '../constants/product-roadmap.constants';
import {
  DuplicateMatchDto,
  DuplicatesResponseDto,
} from '../dto/roadmap-response.dto';

const MAX_TOKENS = {
  CLASSIFY: 1000,
  DUPLICATES: 1000,
  SUMMARISE: 2000,
  CLAUDE_PROMPT: 2000,
  // A verdict plus a ≤200-char reason per goal, at the 12-goal ceiling, with headroom.
  GOAL_IMPACT: 1600,
} as const;

@Injectable()
export class RoadmapAiService {
  private readonly logger = LoggerService.getInstance(RoadmapAiService.name);

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
    private readonly aiService: AiService,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly goalRepository: RoadmapProductGoalRepository,
  ) {}

  /**
   * Map a draft to one of the existing product goals.
   *
   * Returns `category: null` when the model answers with something that is not a live goal.
   * That guard matters: the standalone app had no equivalent, so when its backfill run failed
   * wholesale it wrote its FALLBACK category ('Foundation & Experiments', confidence 0) to 241
   * opportunities and reported success — which is why ~54% of production goal data is now
   * meaningless. Never let an unvalidated model answer become stored taxonomy.
   */
  async classifyGoal(description: string): Promise<{
    category: string | null;
    confidence: number;
    rationale: string;
  }> {
    const goals = await this.goalRepository.findAllOrdered();
    const parsed = await this.runJson<{
      category?: string;
      confidence?: number;
      rationale?: string;
    }>(
      ROADMAP_PROMPT_CODES.CLASSIFY_GOAL,
      `Available product goals:\n${goals.map((g) => `- ${g.name}`).join('\n')}\n\n` +
        `Opportunity to classify:\n"""\n${description}\n"""`,
      MAX_TOKENS.CLASSIFY,
      LlmTask.AUTOFILL_ENHANCE_FIELD,
      'classify',
    );

    const valid = goals.some((g) => g.name === parsed?.category);
    if (!valid && parsed?.category) {
      this.logger.warn(
        `[ROADMAP] Classifier returned "${parsed.category}", which is not a live product goal. ` +
          `Discarding rather than storing it.`,
      );
    }
    return {
      category: valid ? (parsed!.category as string) : null,
      confidence: Number(parsed?.confidence ?? 0),
      rationale: parsed?.rationale ?? '',
    };
  }

  /** Summarise an interview transcript. Plain text, not JSON — multiline prose in JSON is fragile. */
  async summariseTranscript(transcript: string): Promise<string> {
    return this.runText(
      ROADMAP_PROMPT_CODES.SUMMARISE_INTERVIEW,
      `Interview transcript:\n"""\n${transcript.slice(
        0,
        ROADMAP_LIMITS.INTERVIEW_TRANSCRIPT_MAX,
      )}\n"""`,
      MAX_TOKENS.SUMMARISE,
      LlmTask.AUTOFILL_ENHANCE_FIELD,
      'summarise',
    );
  }

  /**
   * Two-stage duplicate detection, ported from the source's /api/ai/duplicates route.
   *
   *   1. Vector search in ally-ai/Weaviate for the top N similar opportunities.
   *   2. Union with same-goal opportunities as a safety net for when the index is cold —
   *      relevant here, since 431 of 505 migrated rows arrived with no vector at all.
   *   3. An LLM confirmation pass, because cosine similarity alone surfaces plenty of merely
   *      related items.
   *
   * THE PIPELINE FILTERS TWICE, and both filters are load-bearing:
   *   - returned ids are checked against the candidate set, so a hallucinated id cannot become
   *     a "duplicate" (the source did this too);
   *   - and against live, non-deleted Postgres rows, because Weaviate is a DERIVED index that
   *     can drift when a delete call fails. Without this, a deleted opportunity would be
   *     proposed forever.
   *
   * Degrades to `{ matches: [] }` on any failure: a dead ally-ai must not block someone filing
   * an opportunity.
   */
  async findDuplicates(
    description: string,
    productGoal?: string,
  ): Promise<DuplicatesResponseDto> {
    try {
      const candidates = new Map<string, { similarity: number }>();

      try {
        const search = await this.aiService.findSimilarRoadmapOpportunities({
          description,
          product_goal: productGoal,
          limit: ROADMAP_DUPLICATES.CANDIDATE_LIMIT,
          threshold: ROADMAP_DUPLICATES.SIMILARITY_THRESHOLD,
        });
        for (const match of search?.matches ?? []) {
          candidates.set(match.opportunity_id, {
            similarity: match.similarity,
          });
        }
      } catch (error) {
        this.logger.warn(
          `[ROADMAP] Vector search unavailable, falling back to same-goal candidates only: ` +
            `${(error as Error)?.message}`,
        );
      }

      if (productGoal) {
        const sameGoal = await this.opportunityRepository.find({
          // Ideas only. A bug is not a duplicate of an idea, and offering one as
          // a merge candidate would drag it back onto a board it is no longer
          // listed on — see EXCLUDE_BUGS_SQL in RoadmapOpportunityRepository.
          where: { productGoal, type: RoadmapOpportunityType.IDEA },
          order: { createdAt: 'DESC' },
          take: ROADMAP_DUPLICATES.CANDIDATE_LIMIT,
        });
        for (const o of sameGoal) {
          if (!candidates.has(o.id)) candidates.set(o.id, { similarity: 0 });
        }
      }

      if (candidates.size === 0) return { matches: [] };

      // FILTER 1: resolve every candidate against live Postgres. This is also what supplies the
      // description text — ally-ai stores vectors only, never the opportunity text.
      const live = await this.opportunityRepository.find({
        // Ideas only here too, and not merely for symmetry: the vector index
        // still holds bug embeddings, so without this a bug reaches the LLM as
        // a candidate even though the same-goal branch above filtered them out.
        where: {
          id: In([...candidates.keys()]),
          type: RoadmapOpportunityType.IDEA,
        },
        take: ROADMAP_DUPLICATES.CANDIDATE_LIMIT,
      });
      if (live.length === 0) return { matches: [] };

      const numbered = live
        .map((o, i) => `${i + 1}. [id=${o.id}] ${o.description}`)
        .join('\n');

      const parsed = await this.runJson<{
        matches?: { id?: string; reason?: string }[];
      }>(
        ROADMAP_PROMPT_CODES.DUPLICATE_CHECK,
        `New opportunity:\n"${description}"\n\nExisting opportunities:\n${numbered}\n\n` +
          `Return JSON now.`,
        MAX_TOKENS.DUPLICATES,
        LlmTask.AUTOFILL_ENHANCE_FIELD,
        'duplicates',
      );

      // FILTER 2: only ids that were actually offered as candidates.
      const byId = new Map(live.map((o) => [o.id, o]));
      const matches: DuplicateMatchDto[] = [];
      for (const match of parsed?.matches ?? []) {
        const opportunity = match.id ? byId.get(match.id) : undefined;
        if (!opportunity) continue;
        matches.push({
          id: opportunity.id,
          description: opportunity.description,
          productGoal: opportunity.productGoal,
          stage: opportunity.stage,
          reason: match.reason ?? '',
          similarity: candidates.get(opportunity.id)?.similarity ?? 0,
        });
        if (matches.length >= ROADMAP_DUPLICATES.MAX_CONFIRMED) break;
      }

      return { matches };
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Duplicate detection failed; returning no matches. ${(error as Error)?.message}`,
      );
      return { matches: [] };
    }
  }

  /**
   * Turn an opportunity's description (+ optional PRD) into a ready-to-paste implementation
   * brief for Claude Code. Plain text, not JSON — same reasoning as summariseTranscript: the
   * output is multiline prose, and forcing it through JSON only adds a fragile parse step for
   * no benefit.
   *
   * NOTE: no longer reachable from the admin UI. The drawer's "Open in Builder Agent" replaced
   * the generate-a-prompt flow; this endpoint is kept until the `claudePrompt` column is
   * dropped, and should go with it.
   */
  async generateClaudeCodePrompt(
    description: string,
    prd?: string,
  ): Promise<string> {
    const sections = [`Title:\n"""\n${description}\n"""`];
    if (prd?.trim()) {
      sections.push(`PRD:\n"""\n${prd.trim()}\n"""`);
    }
    return this.runText(
      ROADMAP_PROMPT_CODES.GENERATE_CLAUDE_PROMPT,
      sections.join('\n\n'),
      MAX_TOKENS.CLAUDE_PROMPT,
      LlmTask.AUTOFILL_ENHANCE_FIELD,
      'generate-claude-prompt',
    );
  }

  // ── LLM plumbing ───────────────────────────────────────────────────────────

  /**
   * Judge one opportunity against every strategy goal, in a single call.
   *
   * ONE CALL FOR ALL GOALS, not one per goal: the model reads the same description either way,
   * so per-goal calls would re-bill the description N times for no extra signal — and judging
   * the goals side by side is what stops every goal coming back true, which is the failure mode
   * that makes coverage useless.
   *
   * FAILS CLOSED, like interviewTurn and for the same reason: coverage is a RANKING input, so
   * an answer the model did not give must never read as "yes, this advances the goal". A missing
   * verdict, a non-boolean, unparseable JSON — all resolve to `helped: false` with a reason
   * saying the assessment did not complete, which is honest and visible in the drawer rather
   * than a silent zero.
   *
   * HALLUCINATED GOAL NAMES ARE DROPPED, not stored. The FK would reject them anyway, but
   * catching it here means one invented name does not fail the whole opportunity's assessment.
   * The returned array is always exactly the goals passed in, in that order — the caller
   * replaces a whole opportunity's verdicts with it, so a short answer would silently shrink
   * the numerator while the denominator stayed put.
   */
  async assessGoalImpact(
    description: string,
    goalNames: string[],
  ): Promise<{ goalName: string; helped: boolean; reason: string | null }[]> {
    if (!goalNames.length) return [];

    const parsed = await this.runJson<{
      verdicts?: { goal?: string; helped?: boolean; reason?: string }[];
    }>(
      ROADMAP_PROMPT_CODES.GOAL_IMPACT,
      `Strategy goals:\n${goalNames.map((g) => `- ${g}`).join('\n')}\n\n` +
        `Opportunity to assess:\n"""\n${description}\n"""\n\n` +
        `Return exactly ${goalNames.length} verdict(s), one per goal, in the order listed.`,
      MAX_TOKENS.GOAL_IMPACT,
      // Every roadmap call bills under this task; there is no roadmap-specific LlmTask and
      // inventing one here would split this module's spend across two buckets in analytics.
      LlmTask.AUTOFILL_ENHANCE_FIELD,
      'goal impact',
    );

    // Index the model's answer by goal name so order drift is harmless — the schema asks for
    // the given order, but the verdicts are joined by name, never by position. A positional
    // join would assign goal A's verdict to goal B on a single reordered element.
    const byGoal = new Map<string, { helped?: boolean; reason?: string }>();
    for (const v of parsed?.verdicts ?? []) {
      const name = v?.goal?.trim();
      if (!name) continue;
      if (!goalNames.includes(name)) {
        this.logger.warn(
          `[ROADMAP] Goal impact returned "${name}", which is not a live strategy goal. Dropped.`,
        );
        continue;
      }
      byGoal.set(name, v);
    }

    return goalNames.map((goalName) => {
      const v = byGoal.get(goalName);
      if (typeof v?.helped !== 'boolean') {
        return {
          goalName,
          helped: false,
          reason:
            'Not assessed — the model did not return a verdict for this goal.',
        };
      }
      const reason = v.reason?.trim();
      return {
        goalName,
        helped: v.helped,
        reason: reason
          ? reason.slice(0, ROADMAP_LIMITS.GOAL_IMPACT_REASON_MAX)
          : null,
      };
    });
  }

  /**
   * JSON-shaped call. Correctness rests on the system prompt asking for bare JSON plus the
   * defensive parsing below, which holds across model families rather than depending on one
   * provider's JSON mode. Returns null rather than throwing when the model misbehaves —
   * every caller degrades to an empty result.
   */
  private async runJson<T>(
    promptCode: string,
    userMessage: string,
    maxTokens: number,
    task: LlmTask,
    label: string,
  ): Promise<T | null> {
    const raw = await this.run(promptCode, userMessage, maxTokens, task, label);
    if (!raw) return null;

    // The system prompts all say "output ONLY a JSON object, no markdown fences", but strip
    // fences anyway and fall back to the first brace-delimited span — the same tolerance the
    // standalone app had for models that wrap their answer in prose.
    const cleaned = stripMarkdownFences(raw);
    for (const candidate of [cleaned, cleaned.match(/\{[\s\S]*\}/)?.[0]]) {
      if (!candidate) continue;
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // try the next candidate
      }
    }
    this.logger.warn(
      `[ROADMAP] ${label}: model output was not parseable JSON: ${cleaned.slice(0, 200)}`,
    );
    return null;
  }

  private async runText(
    promptCode: string,
    userMessage: string,
    maxTokens: number,
    task: LlmTask,
    label: string,
  ): Promise<string> {
    const raw = await this.run(promptCode, userMessage, maxTokens, task, label);
    return stripMarkdownFences(raw ?? '');
  }

  /**
   * One LLM call. The prompt FILE is the system prompt and the payload is a separate user
   * message — matching the standalone app exactly (`system: prompt` + one user turn).
   *
   * This is why the prompt files contain no {{placeholders}}: an admin editing a prompt in
   * Prompt Management cannot accidentally delete an interpolation slot and silently break the
   * feature. renderTemplate is still applied so a future prompt CAN use variables if wanted.
   *
   * ⚠️ NO ASSISTANT PREFILL. Forcing JSON by prefilling the assistant turn with `{` is
   * rejected outright by the Claude 4.6+ family, and has no equivalent on the other
   * providers this can now resolve to. The conversation always ends with the user turn and
   * JSON comes from the system prompt saying "output ONLY a JSON object, no fences" plus
   * runJson()'s defensive parsing. Do not reintroduce the prefill.
   *
   * REASONING tier: these calls draft opportunities and adjudicate split/merge decisions an
   * admin then acts on, and none of them sit in front of a live user turn.
   */
  private async run(
    promptCode: string,
    userMessage: string,
    maxTokens: number,
    task: LlmTask,
    label: string,
    variables: Record<string, string> = {},
  ): Promise<string | null> {
    const template = await this.promptSharedService.getPromptByCode(promptCode);
    if (!template) {
      throw new NotFoundException(`Prompt template not found: ${promptCode}`);
    }
    const systemPrompt = renderTemplate(template, variables);

    const response = await this.llmCompletion.complete({
      taskId: AI_TASK_ID,
      task,
      promptCode,
      system: systemPrompt,
      prompt: userMessage,
      maxTokens,
      usageMetadata: { feature: 'product-roadmap', label },
    });

    return response.text || null;
  }
}
