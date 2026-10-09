import { Injectable, NotFoundException } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  SKILL_EXPERIMENT_AI_TASK_IDS,
  SKILL_EXPERIMENT_ENGINE,
  SKILL_EXPERIMENT_PROMPT_CODES,
} from '../constants/skill-experiment.constants';
import { parseJudgeVerdict, weightedScore } from '../util/judge-verdict.util';
import {
  CriterionVerdicts,
  RubricCriterion,
} from '../type/skill-experiment.type';

export interface JudgeRequest {
  experimentId: string;
  observationId: string;
  skill: { name: string; description: string; outputDescription: string };
  rubric: RubricCriterion[];
  /** The original skill text: what the job is, for context. */
  taskInstructions: string;
  input: Record<string, unknown>;
  output: string;
  /** Pinned judge model, or null for the task's configured default. */
  model: string | null;
}

export interface JudgeResult {
  score: number;
  criteria: CriterionVerdicts;
  summary: string;
  model: string;
}

/**
 * Scores one skill output against the experiment's rubric.
 *
 * Blind by construction: the request carries no variant id, label or text, so
 * the judge cannot favour the original or the challenger. It sees the ORIGINAL
 * instructions as context for what the job is, never the variant's — otherwise
 * a challenger that lowered its own bar would be graded against that lower bar.
 *
 * The judge's own instructions are the `skill_experiment_judge` System Skill;
 * the rubric and the output travel as a separate message, so editing the
 * instructions cannot delete the slot the data arrives through.
 */
@Injectable()
export class SkillExperimentJudgeService {
  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llm: LlmCompletionService,
  ) {}

  async judge(request: JudgeRequest): Promise<JudgeResult> {
    const system = await this.promptSharedService.getPromptByCode(
      SKILL_EXPERIMENT_PROMPT_CODES.JUDGE,
    );
    if (!system) {
      throw new NotFoundException(
        `Prompt not found: ${SKILL_EXPERIMENT_PROMPT_CODES.JUDGE}`,
      );
    }

    const cap = SKILL_EXPERIMENT_ENGINE.JUDGE_FIELD_CHARS;
    const payload = {
      skill: request.skill,
      rubric: request.rubric,
      taskInstructions: clip(request.taskInstructions, cap),
      input: clipValues(request.input, cap),
      output: clip(request.output, cap),
    };

    const result = await this.llm.complete({
      taskId: SKILL_EXPERIMENT_AI_TASK_IDS.JUDGE,
      task: LlmTask.SKILL_EXPERIMENT_JUDGE,
      promptCode: SKILL_EXPERIMENT_PROMPT_CODES.JUDGE,
      ...(request.model ? { model: request.model } : {}),
      system,
      prompt: JSON.stringify(payload, null, 2),
      jsonMode: true,
      temperature: 0,
      maxTokens: SKILL_EXPERIMENT_ENGINE.JUDGE_MAX_TOKENS,
      timeoutMs: SKILL_EXPERIMENT_ENGINE.JUDGE_TIMEOUT_MS,
      usageMetadata: {
        feature: 'skill-experiment',
        label: 'judge',
        experimentId: request.experimentId,
        observationId: request.observationId,
      },
    });

    const verdict = parseJudgeVerdict(result.text, request.rubric);
    return {
      score: weightedScore(verdict.criteria, request.rubric),
      criteria: verdict.criteria,
      summary: verdict.summary,
      model: result.model,
    };
  }
}

function clip(text: string, cap: number): string {
  return text.length > cap
    ? `${text.slice(0, cap)}… [truncated ${text.length - cap} chars]`
    : text;
}

function clipValues(
  input: Record<string, unknown>,
  cap: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (typeof value === 'string') {
      out[key] = clip(value, cap);
    } else {
      const serialized = JSON.stringify(value) ?? '';
      out[key] = serialized.length > cap ? clip(serialized, cap) : value;
    }
  }
  return out;
}
