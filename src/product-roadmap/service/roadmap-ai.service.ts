import { Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { In } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  renderTemplate,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import { AiService } from 'src/ai/service/ai.service';

import { RoadmapReadinessTokenService } from './roadmap-readiness-token.service';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import { RoadmapProductGoalRepository } from '../repository/roadmap-taxonomy.repository';
import {
  RoadmapOpportunityEffort,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';
import {
  ROADMAP_DUPLICATES,
  ROADMAP_LIMITS,
  ROADMAP_FILEABLE_EFFORTS,
  ROADMAP_PROMPT_CODES,
  ROADMAP_READINESS_CRITERIA,
} from '../constants/product-roadmap.constants';
import {
  AiEnhanceResponseDto,
  AiReadinessResponseDto,
  AiReadinessResultDto,
  AiReviewResponseDto,
  AiReviewSuggestionDto,
  DuplicateMatchDto,
  DuplicatesResponseDto,
  OpportunityInterviewTurnResponseDto,
} from '../dto/roadmap-response.dto';

const MAX_TOKENS = {
  // Room for six verdicts, a size, and a redraft of up to ~900 characters in the same answer.
  READINESS: 2200,
  REVIEW: 1000,
  ENHANCE: 1500,
  DUPLICATES: 1000,
  SUMMARISE: 2000,
  CLAUDE_PROMPT: 2000,
  // A verdict plus a ≤200-char reason per goal, at the 12-goal ceiling, with headroom.
  GOAL_IMPACT: 1600,
  // A question, five gate verdicts with notes, and — on the last turn — a ≤900-char draft.
  OPPORTUNITY_INTERVIEW: 2000,
} as const;

@Injectable()
export class RoadmapAiService {
  private readonly logger = LoggerService.getInstance(RoadmapAiService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
    private readonly aiService: AiService,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly goalRepository: RoadmapProductGoalRepository,
    private readonly readinessToken: RoadmapReadinessTokenService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.model = this.configService.anthropic.autofillModel;
  }

  /**
   * Grade a draft against ROADMAP_READINESS_CRITERIA. One entry per criterion, always.
   *
   * FAILS CLOSED, and that is the whole design. This is a gate — the admin drawer will not let
   * an opportunity be filed until every item comes back green — so any answer the model does
   * not give must read as "not yet", never as a pass. A missing id, a non-boolean verdict, a
   * hallucinated id, unparseable JSON: all resolve to `passed: false` with a reason the writer
   * can act on. The inverse would let a dropped field wave a draft through.
   *
   * The criteria are sent in the user message rather than baked into the prompt file, so
   * editing the constant is the entire change — the prompt file never goes stale against it.
   *
   * The same call also proposes an EFFORT, because it has already read the draft closely enough
   * to size it and a second round trip would buy nothing. That half does not fail closed — it
   * proposes, it does not gate — so an unrecognised size resolves to `null` ("Not sized")
   * rather than to a guess. Never store an unvalidated model answer as taxonomy; see
   * classifyGoal for what that cost us once already.
   *
   * The REDRAFT rides along for the same reason: the model has just read the draft and knows
   * precisely which criteria it failed, so a rewrite costs a few hundred tokens here versus a
   * second call that would have to re-derive all of it. It is suppressed unless something
   * actually failed — a passing draft needs no proposal, and offering one invites people to
   * replace their own words for no reason. Note the ordering: suppression keys off the
   * verdicts THIS METHOD computed, not the model's own claim to have passed everything, so a
   * draft the fail-closed rules knocked down still gets its redraft.
   *
   * Size failing is enough on its own to offer one — that is the case where the redraft has
   * real work to do, narrowing a set of opportunities down to the one shippable slice.
   */
  async checkReadiness(
    description: string,
    productGoal?: string | null,
  ): Promise<AiReadinessResponseDto> {
    const criteria = ROADMAP_READINESS_CRITERIA;
    const rendered = criteria
      .map((c) => `- id: ${c.id}\n  criterion: ${c.label}\n  means: ${c.hint}`)
      .join('\n');

    const parsed = await this.runJson<{
      results?: { id?: string; passed?: boolean; reason?: string }[];
      effort?: string;
      effortReason?: string;
      redraft?: string | null;
    }>(
      ROADMAP_PROMPT_CODES.READINESS_CHECK,
      `Checklist:\n${rendered}\n\nDraft to judge:\n"""\n${description}\n"""\n\n` +
        `Return one result per criterion id now.`,
      MAX_TOKENS.READINESS,
      LlmTask.AUTOFILL_ENHANCE_FIELD,
      'readiness',
    );

    const byId = new Map(
      (parsed?.results ?? [])
        .filter((r) => typeof r?.id === 'string')
        .map((r) => [r.id as string, r]),
    );

    const results: AiReadinessResultDto[] = criteria.map((criterion) => {
      const answer = byId.get(criterion.id);
      // `=== true`, not truthy: a model that answers "yes" or 1 has not answered the schema,
      // and on a gate an unparsed verdict must not become a pass.
      const passed = answer?.passed === true;
      return {
        id: criterion.id,
        passed,
        reason:
          answer?.reason?.trim() ||
          (passed
            ? 'Met.'
            : 'The check did not return a verdict for this item — run it again.'),
      };
    });

    const efforts = Object.values(RoadmapOpportunityEffort) as string[];
    const proposed = parsed?.effort?.trim().toLowerCase();
    const effort = efforts.includes(proposed ?? '')
      ? (proposed as RoadmapOpportunityEffort)
      : null;
    if (!effort && proposed) {
      this.logger.warn(
        `[ROADMAP] Readiness check returned effort "${proposed}", which is not a live size. ` +
          `Filing unsized instead.`,
      );
    }

    // Unsized counts as not-fileable: "we could not tell how big this is" is not a pass, and
    // the drawer's size row says so rather than going quietly green on a missing value.
    const sizeFileable =
      effort !== null &&
      (ROADMAP_FILEABLE_EFFORTS as readonly string[]).includes(effort);
    const needsRedraft = results.some((r) => !r.passed) || !sizeFileable;

    const redraft = parsed?.redraft?.trim();
    return {
      results,
      effort,
      effortReason: effort ? (parsed?.effortReason?.trim() ?? '') : '',
      redraft:
        needsRedraft && redraft
          ? redraft.slice(0, ROADMAP_LIMITS.DESCRIPTION_MAX)
          : null,
      // Signed here rather than assembled by the caller so the thing that graded the draft is
      // the thing that vouches for the grade. Issued even when items failed: the token records
      // WHAT failed, and `create` needs that both to refuse the filing and — when a manager
      // overrides — to stamp the row with the verdicts that were overridden.
      token: this.readinessToken.issue({
        description,
        productGoal,
        failedCriteria: results.filter((r) => !r.passed).map((r) => r.id),
        proposedEffort: effort,
      }),
    };
  }

  /** Critique a draft against writing best practices. Returns at most 3 issue/tip pairs. */
  async reviewDraft(description: string): Promise<AiReviewResponseDto> {
    const parsed = await this.runJson<{
      suggestions?: AiReviewSuggestionDto[];
    }>(
      ROADMAP_PROMPT_CODES.REVIEW_DRAFT,
      `Draft to review:\n"""\n${description}\n"""`,
      MAX_TOKENS.REVIEW,
      LlmTask.AUTOFILL_ENHANCE_FIELD,
      'review',
    );
    const suggestions = (parsed?.suggestions ?? [])
      .filter((s) => s?.issue && s?.tip)
      .slice(0, 3);
    return { suggestions };
  }

  /** Rewrite a draft. Returns the original unchanged if the model gives nothing usable. */
  async enhanceDraft(description: string): Promise<AiEnhanceResponseDto> {
    const parsed = await this.runJson<{ enhanced?: string }>(
      ROADMAP_PROMPT_CODES.ENHANCE_DRAFT,
      `Draft to improve:\n"""\n${description}\n"""`,
      MAX_TOKENS.ENHANCE,
      LlmTask.AUTOFILL_ENHANCE_FIELD,
      'enhance',
    );
    return { enhanced: parsed?.enhanced?.trim() || description };
  }

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
      MAX_TOKENS.REVIEW,
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

  /**
   * One turn of the opportunity interview: read the conversation so far, ask the next question,
   * and report where the five readiness criteria stand.
   *
   * THE GATES ARE THE FILING GATE'S OWN CRITERIA, not a second rubric. An interview grading its
   * own private list can spend eight questions and hand over a draft `create` then refuses —
   * which is the single worst outcome for a surface whose whole promise is "answer these and it
   * is fileable". Same constant, same ids, same order as checkReadiness.
   *
   * FAILS CLOSED, in the direction that costs nothing: an unparsable answer yields no draft and
   * no gates met, so the admin sees "ask me again" rather than a draft nobody graded. The
   * opposite default — treating a missing verdict as met — would file ungraded drafts.
   *
   * The readiness token is minted here, and ONLY alongside a draft with every gate met, because
   * that is the only state in which this conversation has established what the token asserts.
   */
  async interviewTurn(
    messages: { role: 'admin' | 'agent'; content: string }[],
  ): Promise<OpportunityInterviewTurnResponseDto> {
    const criteria = ROADMAP_READINESS_CRITERIA;
    const renderedCriteria = criteria
      .map((c) => `- id: ${c.id}\n  criterion: ${c.label}\n  means: ${c.hint}`)
      .join('\n');

    const goals = await this.goalRepository.findAllOrdered();
    const renderedGoals = goals.length
      ? goals.map((g) => `- ${g.name}`).join('\n')
      : '(none defined — answer null)';

    // The transcript is rendered into ONE user turn rather than replayed as an Anthropic
    // messages array. This call is stateless and single-shot, so there are no tool_use blocks
    // to keep paired (the trap rebuildAnthropicHistory exists for in the Builder agent), and a
    // flat transcript keeps the whole interview inside one cacheable shape.
    const transcript = messages.length
      ? messages
          .map(
            (m) =>
              `${m.role === 'admin' ? 'ADMIN' : 'YOU'}: ${m.content.trim()}`,
          )
          .join('\n\n')
      : '(nothing yet — this is the first turn, so open the interview)';

    const parsed = await this.runJson<{
      reply?: string;
      gates?: { id?: string; met?: boolean; note?: string }[];
      draft?: {
        description?: string;
        productGoal?: string | null;
        effort?: string | null;
      } | null;
    }>(
      ROADMAP_PROMPT_CODES.OPPORTUNITY_INTERVIEW,
      `Criteria to satisfy:\n${renderedCriteria}\n\n` +
        `Product goals to choose from:\n${renderedGoals}\n\n` +
        `Conversation so far:\n"""\n${transcript}\n"""\n\n` +
        `Take your next turn now.`,
      MAX_TOKENS.OPPORTUNITY_INTERVIEW,
      LlmTask.AUTOFILL_ENHANCE_FIELD,
      'opportunity-interview',
    );

    const byId = new Map(
      (parsed?.gates ?? [])
        .filter((g) => typeof g?.id === 'string')
        .map((g) => [g.id as string, g]),
    );

    const gates = criteria.map((criterion) => {
      const answer = byId.get(criterion.id);
      // `=== true` for the same reason checkReadiness uses it: "yes" or 1 is not the schema,
      // and an unparsed verdict must never read as satisfied on something that gates filing.
      const met = answer?.met === true;
      return {
        id: criterion.id,
        met,
        note: answer?.note?.trim() || (met ? 'Covered.' : 'Not covered yet.'),
      };
    });

    const allMet = gates.every((g) => g.met);
    const description = parsed?.draft?.description?.trim();

    // A draft is only a draft when every gate is met AND there is text. A model that hands over
    // early is overruled rather than trusted: the checklist the admin can see is the contract.
    const draft =
      allMet && description
        ? {
            description: description.slice(0, ROADMAP_LIMITS.DESCRIPTION_MAX),
            productGoal: goals.some(
              (g) => g.name === parsed?.draft?.productGoal,
            )
              ? (parsed!.draft!.productGoal as string)
              : null,
            effort: this.validEffort(parsed?.draft?.effort),
          }
        : null;

    if (allMet && !description) {
      this.logger.warn(
        `[ROADMAP] Opportunity interview reported every gate met but returned no draft. ` +
          `Continuing the interview rather than filing nothing.`,
      );
    }

    return {
      reply:
        parsed?.reply?.trim() || 'Sorry — I lost that. Could you say it again?',
      gates,
      draft,
      readinessToken: draft
        ? this.readinessToken.issue({
            description: draft.description,
            productGoal: draft.productGoal,
            failedCriteria: [],
            proposedEffort: draft.effort,
          })
        : null,
    };
  }

  /**
   * A model-proposed size, or null when it is not a live one.
   *
   * Shared by the interview and (by intent) anything else that takes a size from an answer:
   * storing an unvalidated one is how 241 opportunities ended up with meaningless goal data —
   * see classifyGoal.
   */
  private validEffort(
    proposed?: string | null,
  ): RoadmapOpportunityEffort | null {
    const value = proposed?.trim().toLowerCase();
    const efforts = Object.values(RoadmapOpportunityEffort) as string[];
    if (value && efforts.includes(value)) {
      return value as RoadmapOpportunityEffort;
    }
    if (value) {
      this.logger.warn(
        `[ROADMAP] Interview proposed effort "${value}", which is not a live size. ` +
          `Handing over unsized instead.`,
      );
    }
    return null;
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
   * FAILS CLOSED, like checkReadiness and for the same reason: coverage is a RANKING input, so
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
   * JSON-shaped call. Anthropic has no JSON mode and this model rejects assistant prefill
   * (see run()), so correctness rests on the system prompt asking for bare JSON plus the
   * defensive parsing below. Returns null rather than throwing when the model misbehaves —
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
   * One Anthropic call. The prompt FILE is the system prompt and the payload is a separate user
   * message — matching the standalone app exactly (`system: prompt` + one user turn).
   *
   * This is why the prompt files contain no {{placeholders}}: an admin editing a prompt in
   * Prompt Management cannot accidentally delete an interpolation slot and silently break the
   * feature. renderTemplate is still applied so a future prompt CAN use variables if wanted.
   *
   * ⚠️ NO ASSISTANT PREFILL. AnthropicAutofillService forces JSON by prefilling the assistant
   * turn with `{`, but claude-sonnet-4-6 REJECTS that outright:
   *   400 invalid_request_error — "This model does not support assistant message prefill.
   *   The conversation must end with a user message."
   * So the conversation always ends with the user turn and JSON is obtained the way the
   * standalone app did it: the system prompt says "output ONLY a JSON object, no fences", and
   * runJson() parses defensively. Do not reintroduce the prefill.
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

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Cost accounting is mandatory in ally-be; an un-metered LLM call is a billing blind spot.
    // Same shape as AnthropicAutofillService.recordUsage, and fire-and-forget for the same
    // reason: metering must never fail the user's request.
    const input = response.usage?.input_tokens ?? 0;
    const output = response.usage?.output_tokens ?? 0;
    void this.llmUsage.record({
      provider: 'anthropic',
      model: this.model,
      task,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      cachedTokens: response.usage?.cache_read_input_tokens ?? undefined,
      metadata: { feature: 'product-roadmap', label },
    });

    const block = response.content?.[0];
    if (!block || block.type !== 'text') return null;
    return block.text;
  }
}
