import { Injectable, NotFoundException } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  parseFirstJsonObject,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import {
  SKILL_EXPERIMENT_AI_TASK_IDS,
  SKILL_EXPERIMENT_ENGINE,
  SKILL_EXPERIMENT_PROMPT_CODES,
} from '../constants/skill-experiment.constants';
import {
  checkPlaceholderLock,
  extractPlaceholderTokens,
} from '../util/placeholder-lock.util';
import { RubricCriterion } from '../type/skill-experiment.type';

/** Everything the designer is shown. Assembled by the engine from the run's data. */
export interface DesignerContext {
  experimentId: string;
  skill: { name: string; description: string; outputDescription: string };
  rubric: RubricCriterion[];
  targetScore: number;
  /** The original skill text — the placeholder lock is checked against this. */
  originalText: string;
  currentBest: {
    label: string;
    text: string;
    meanScore: number | null;
    criterionMeans: Record<string, number> | null;
  };
  lowScoringExamples: Array<{
    score: number;
    input: Record<string, unknown>;
    output: string;
    judgeReasons: Record<string, { score: number; reason: string }>;
  }>;
  triedBefore: Array<{
    label: string;
    changeSummary: string | null;
    hypothesis: string | null;
    meanScore: number | null;
    outcome: string | null;
  }>;
  /** Pinned designer model, or null for the prompt row / tier default. */
  model: string | null;
}

export type DraftResult =
  | {
      ok: true;
      content: string;
      changeSummary: string;
      hypothesis: string;
      model: string;
    }
  | {
      ok: false;
      errors: string[];
      /** The last draft text, when the model produced one — kept for the admin. */
      lastContent: string | null;
      model: string | null;
    };

/**
 * Drafts the next challenger. Up to three attempts per round: each rejected
 * draft's errors are sent back with the next attempt, so a model that dropped a
 * placeholder is told exactly which one.
 *
 * Nothing the designer returns is trusted. Every draft must pass the placeholder
 * lock against the ORIGINAL text (the contract the call sites were written
 * against), differ from the current best, and stay within a sane length — or it
 * is rejected here and never reaches a user.
 */
@Injectable()
export class SkillExperimentDesignerService {
  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llm: LlmCompletionService,
  ) {}

  async draft(context: DesignerContext): Promise<DraftResult> {
    const system = await this.promptSharedService.getPromptByCode(
      SKILL_EXPERIMENT_PROMPT_CODES.DESIGNER,
    );
    if (!system) {
      throw new NotFoundException(
        `Prompt not found: ${SKILL_EXPERIMENT_PROMPT_CODES.DESIGNER}`,
      );
    }

    let errors: string[] = [];
    let lastContent: string | null = null;
    let model: string | null = null;

    for (
      let attempt = 1;
      attempt <= SKILL_EXPERIMENT_ENGINE.DESIGNER_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const result = await this.llm.complete({
        taskId: SKILL_EXPERIMENT_AI_TASK_IDS.DESIGNER,
        task: LlmTask.SKILL_EXPERIMENT_DESIGNER,
        promptCode: SKILL_EXPERIMENT_PROMPT_CODES.DESIGNER,
        ...(context.model ? { model: context.model } : {}),
        system,
        prompt: JSON.stringify(buildPayload(context, errors), null, 2),
        jsonMode: true,
        maxTokens: SKILL_EXPERIMENT_ENGINE.DESIGNER_MAX_TOKENS,
        timeoutMs: SKILL_EXPERIMENT_ENGINE.DESIGNER_TIMEOUT_MS,
        usageMetadata: {
          feature: 'skill-experiment',
          label: 'designer',
          experimentId: context.experimentId,
          attempt,
        },
      });
      model = result.model;

      const parsed = parseFirstJsonObject(stripMarkdownFences(result.text));
      const content =
        typeof parsed?.revisedPrompt === 'string'
          ? stripMarkdownFences(parsed.revisedPrompt).trim()
          : '';
      if (content) lastContent = content;

      errors = validateDraft(context, content);
      if (!errors.length) {
        return {
          ok: true,
          content,
          changeSummary: stringOr(parsed?.changeSummary, ''),
          hypothesis: stringOr(parsed?.hypothesis, ''),
          model: result.model,
        };
      }
    }

    return { ok: false, errors, lastContent, model };
  }
}

/** Why a draft cannot be served. Empty means it can. Exported for tests. */
export function validateDraft(
  context: Pick<DesignerContext, 'originalText' | 'currentBest'>,
  content: string,
): string[] {
  if (!content) {
    return ['The reply had no "revisedPrompt" text.'];
  }
  const errors = [
    ...checkPlaceholderLock(context.originalText, content).errors,
  ];
  const current = context.currentBest.text;
  if (normalize(content) === normalize(current)) {
    errors.push('The draft is identical to the current best text.');
  }
  const ratio = content.length / Math.max(current.length, 1);
  if (ratio < SKILL_EXPERIMENT_ENGINE.MIN_LENGTH_RATIO) {
    errors.push(
      `The draft is ${Math.round(ratio * 100)}% of the current length — too much was cut.`,
    );
  } else if (ratio > SKILL_EXPERIMENT_ENGINE.MAX_LENGTH_RATIO) {
    errors.push(
      `The draft is ${Math.round(ratio * 100)}% of the current length — keep it focused.`,
    );
  }
  return errors;
}

function buildPayload(context: DesignerContext, previousErrors: string[]) {
  const means = context.currentBest.criterionMeans ?? {};
  const weakestCriteria = [...context.rubric]
    .filter((c) => typeof means[c.key] === 'number')
    .sort((a, b) => means[a.key] - means[b.key])
    .slice(0, 2)
    .map((c) => ({ key: c.key, name: c.name, mean: means[c.key] }));
  const cap = SKILL_EXPERIMENT_ENGINE.DESIGNER_EXAMPLE_CHARS;

  return {
    skill: context.skill,
    rubric: context.rubric,
    targetScore: context.targetScore,
    currentBest: context.currentBest,
    weakestCriteria,
    lowScoringExamples: context.lowScoringExamples.map((example) => ({
      score: example.score,
      input: Object.fromEntries(
        Object.entries(example.input).map(([k, v]) => [
          k,
          clip(typeof v === 'string' ? v : (JSON.stringify(v) ?? ''), cap),
        ]),
      ),
      output: clip(example.output, cap),
      judgeReasons: example.judgeReasons,
    })),
    triedBefore: context.triedBefore,
    lockedPlaceholders: extractPlaceholderTokens(context.originalText),
    ...(previousErrors.length ? { previousAttemptErrors: previousErrors } : {}),
  };
}

function clip(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}
