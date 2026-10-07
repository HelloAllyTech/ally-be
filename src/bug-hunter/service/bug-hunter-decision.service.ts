import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { stripMarkdownFences } from 'src/learn/util/autofill-shared.util';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';

import {
  BUG_HUNTER_DECIDE_MAX_TOKENS,
  BUG_HUNTER_DECIDE_MODEL,
  BUG_HUNTER_DECIDE_TASK_ID,
  BUG_HUNTER_PROMPT_CODES,
} from '../constants/bug-hunter.constants';
import { BugHuntDecision } from '../entity/bug-hunt-decision.entity';

export type DecisionPoint =
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D5'
  | 'D6'
  | 'D7'
  | 'D8';

export interface DecisionRequest<T> {
  point: DecisionPoint;
  /** One of 'senses' | 'model' | 'triage' …: the word the prompt keys its guidance on. */
  question: string;
  repo: string | null;
  runId?: string | null;
  findingId?: string | null;
  /** The closed set of options, as the model sees them. */
  menu: unknown;
  /** What both owners are shown: trigger, scoreboard rows, counts. Clipped before storage. */
  context: Record<string, unknown>;
  /** The rule's pick, always computed. */
  rule: () => T;
  /** Whether the model owns this point today. False means the rule acts and the model shadows. */
  modelOwned: boolean;
  /** Accept only a pick that is on the menu; return the normalised pick or null. */
  validate: (raw: unknown) => T | null;
}

export interface DecisionResult<T> {
  pick: T;
  owner: 'model' | 'rule';
  shadowPick: T | null;
  reason: string;
  /** The model's own confidence in its pick, when it answered. */
  confidence: number | null;
  record: BugHuntDecision;
}

/**
 * Makes and records an orchestration decision — see `BugHuntDecision`.
 *
 * The contract: the rule always answers; the model answers when asked; the
 * owner's pick is acted on and the other's is kept as the shadow. A model
 * that fails, times out or picks off the menu never blocks a run: the rule
 * acts and the row says so. Budgets and safety are not decisions here and
 * never were — they veto elsewhere.
 */
@Injectable()
export class BugHunterDecisionService {
  private readonly logger = LoggerService.getInstance(
    BugHunterDecisionService.name,
  );

  constructor(
    @InjectRepository(BugHuntDecision)
    private readonly decisions: Repository<BugHuntDecision>,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
  ) {}

  async decide<T>(req: DecisionRequest<T>): Promise<DecisionResult<T>> {
    const rulePick = req.rule();
    let modelPick: T | null = null;
    let modelReason = '';
    let modelConfidence: number | null = null;
    let modelAnswered = false;
    try {
      const answer = await this.askModel(req);
      if (answer) {
        modelAnswered = true;
        modelPick = req.validate(answer.pick);
        modelReason = answer.reason;
        modelConfidence = answer.confidence;
        if (modelPick === null) {
          this.logger.warn(
            `[BUG_HUNTER] ${req.point}: the model picked off the menu (${JSON.stringify(answer.pick).slice(0, 120)}); the rule acts.`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] ${req.point}: model decision failed, the rule acts: ${
          (error as Error)?.message
        }`,
      );
    }

    const modelActs = req.modelOwned && modelPick !== null;
    const pick = modelActs ? (modelPick as T) : rulePick;
    const owner: 'model' | 'rule' = modelActs ? 'model' : 'rule';
    const shadowPick: T | null = modelActs ? rulePick : modelPick;
    const reason = modelActs
      ? modelReason
      : req.modelOwned
        ? `Rule acted: the model ${modelAnswered ? 'picked off the menu' : 'did not answer'}.`
        : 'Rule-owned point; the model shadows.';

    const record = await this.decisions.save(
      this.decisions.create({
        runId: req.runId ?? null,
        findingId: req.findingId ?? null,
        repo: req.repo,
        point: req.point,
        owner,
        menu: req.menu as object,
        pick: pick as unknown as object,
        shadowOwner:
          shadowPick === null ? null : owner === 'model' ? 'rule' : 'model',
        shadowPick: shadowPick as unknown as object,
        reason: reason.slice(0, 600),
        inputs: {
          ...clipInputs(req.context),
          ...(modelConfidence != null ? { modelConfidence } : {}),
        },
        model: modelAnswered ? BUG_HUNTER_DECIDE_MODEL : null,
      }),
    );
    return {
      pick,
      owner,
      shadowPick,
      reason,
      confidence: modelConfidence,
      record,
    };
  }

  listForRun(runId: string): Promise<BugHuntDecision[]> {
    return this.decisions.find({
      where: { runId },
      order: { createdAt: 'ASC' },
    });
  }

  listForFinding(findingId: string): Promise<BugHuntDecision[]> {
    return this.decisions.find({
      where: { findingId },
      order: { createdAt: 'ASC' },
    });
  }

  private async askModel<T>(req: DecisionRequest<T>): Promise<{
    pick: unknown;
    reason: string;
    confidence: number | null;
  } | null> {
    const template = await this.promptSharedService.getPromptByCode(
      toPromptCode('bug_hunter', 'decide'),
    );
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found: ${BUG_HUNTER_PROMPT_CODES.DECIDE}`,
      );
    }
    const userMessage =
      `Decision point: ${req.point} "${req.question}"\n` +
      `Repo: ${req.repo ?? 'unknown'}\n\n` +
      `Menu:\n${JSON.stringify(req.menu, null, 1)}\n\n` +
      `Context:\n${JSON.stringify(clipInputs(req.context), null, 1)}`;
    const response = await this.llmCompletion.complete({
      taskId: BUG_HUNTER_DECIDE_TASK_ID,
      task: LlmTask.BUG_HUNTER,
      model: BUG_HUNTER_DECIDE_MODEL,
      system: template,
      prompt: userMessage,
      maxTokens: BUG_HUNTER_DECIDE_MAX_TOKENS,
      jsonMode: true,
      usageMetadata: { feature: 'bug-hunter', label: `decide-${req.point}` },
    });
    const raw = response.text || null;
    if (!raw) return null;
    const cleaned = stripMarkdownFences(raw);
    for (const candidate of [cleaned, cleaned.match(/\{[\s\S]*\}/)?.[0]]) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        if (!('pick' in parsed)) return null;
        return {
          pick: parsed.pick,
          reason: typeof parsed.reason === 'string' ? parsed.reason : '',
          confidence:
            typeof parsed.confidence === 'number' &&
            parsed.confidence >= 0 &&
            parsed.confidence <= 1
              ? parsed.confidence
              : null,
        };
      } catch {
        // try the next candidate
      }
    }
    return null;
  }
}

/** Keep the stored inputs small: long strings clipped, deep arrays capped. */
function clipInputs(input: Record<string, unknown>): Record<string, unknown> {
  const clip = (v: unknown, depth = 0): unknown => {
    if (typeof v === 'string')
      return v.length > 400 ? `${v.slice(0, 397)}…` : v;
    if (Array.isArray(v)) return v.slice(0, 40).map((x) => clip(x, depth + 1));
    if (v && typeof v === 'object' && depth < 4) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>))
        out[k] = clip(val, depth + 1);
      return out;
    }
    return v;
  };
  return clip(input) as Record<string, unknown>;
}
