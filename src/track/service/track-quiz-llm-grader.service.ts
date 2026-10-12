import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import {
  renderTemplate,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import { OpenEndedQuestion } from '../type/quiz.type';
import { TRACK_QUIZ_LLM_GRADING_TIMEOUT_MS } from '../constants/track.constant';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SkillExperimentRouterService } from 'src/skill-experiment/service/skill-experiment-router.service';

const MAX_TOKENS = 1024;
const PROMPT_CODE = 'track_quiz_open_ended_grading_user';
/** AI-task-registry row id; the key for per-task model config. */
const AI_TASK_ID = 'track-quiz-grading';

export interface OpenEndedGrading {
  score: number;
  feedback: string;
  criteriaScores?: { name: string; score: number }[];
}

/**
 * Grades one open-ended quiz answer against the trainer's rubric.
 *
 * Runs through LlmCompletionService, so which model grades is resolved config
 * (prompt row -> task row -> platform tier) rather than a client this service
 * constructs. REASONING tier: a wrong grade is shown to a learner as their
 * result, and nothing here is latency-sensitive.
 *
 * Throws on failure — the caller decides the PENDING_GRADING fallback.
 */
@Injectable()
export class TrackQuizLlmGraderService {
  private readonly logger = LoggerService.getInstance(
    TrackQuizLlmGraderService.name,
  );
  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
    private readonly skillExperiments: SkillExperimentRouterService,
  ) {}

  async gradeOpenEndedAnswer(
    question: OpenEndedQuestion,
    answer: string,
  ): Promise<OpenEndedGrading> {
    // Auto-improve (skill experiments): which text grades this answer. Null
    // when no experiment is live — the skill resolves exactly as before.
    const arm = await this.skillExperiments.assign(PROMPT_CODE);
    const input = {
      question: question.prompt,
      guidance: question.rubric.guidance,
      criteria: JSON.stringify(question.rubric.criteria ?? []),
      maxScore: String(question.rubric.maxScore),
      answer,
    };
    const tenantId = ExecutionManager.getTenantId() ?? null;
    try {
      const { grading, raw } = await this.grade(
        question,
        input,
        arm?.content ?? null,
      );
      void this.skillExperiments.record(arm, { input, output: raw, tenantId });
      return grading;
    } catch (error) {
      void this.skillExperiments.record(arm, {
        input,
        output: (error as { rawOutput?: string })?.rawOutput,
        error: error instanceof Error ? error.message : String(error),
        tenantId,
      });
      // A challenger that broke the reply must not cost the learner their
      // grade: retry once on the skill's own text. The failure is already
      // recorded against the challenger, which is how the loop retires it.
      if (arm && !arm.isOriginal) {
        this.logger.warn(
          `[TRACK_QUIZ] experiment variant failed for question=${question.id}; regrading on the skill's own text`,
        );
        return (await this.grade(question, input, null)).grading;
      }
      throw error;
    }
  }

  private async grade(
    question: OpenEndedQuestion,
    variables: Record<string, string>,
    templateOverride: string | null,
  ): Promise<{ grading: OpenEndedGrading; raw: string }> {
    const template =
      templateOverride ??
      (await this.promptSharedService.getPromptByCode(PROMPT_CODE));
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found for code: ${PROMPT_CODE}`,
      );
    }
    const maxScore = question.rubric.maxScore;
    const prompt = renderTemplate(template, variables);

    const startedAt = Date.now();
    // No assistant-turn prefill: the Claude 4.6+ family rejects a trailing
    // assistant message with a 400, and it would not translate across
    // providers anyway. The prompt demands a bare JSON object; fences are
    // stripped defensively because every model family fences sometimes.
    const response = await this.llmCompletion.complete({
      taskId: AI_TASK_ID,
      task: LlmTask.TRACK_QUIZ_GRADING,
      promptCode: PROMPT_CODE,
      prompt,
      maxTokens: MAX_TOKENS,
      timeoutMs: TRACK_QUIZ_LLM_GRADING_TIMEOUT_MS,
      usageMetadata: { questionId: question.id },
    });

    const cleaned = stripMarkdownFences(response.text).trim();
    const jsonStart = cleaned.indexOf('{');
    if (jsonStart < 0) {
      throw withRawOutput(
        new Error('LLM grading response contained no JSON object'),
        response.text,
      );
    }
    let parsed: OpenEndedGrading;
    try {
      parsed = JSON.parse(
        cleaned.slice(jsonStart, cleaned.lastIndexOf('}') + 1),
      ) as OpenEndedGrading;
    } catch (error) {
      throw withRawOutput(error as Error, response.text);
    }

    if (typeof parsed.score !== 'number' || !parsed.feedback) {
      throw withRawOutput(
        new Error('LLM grading response missing score/feedback'),
        response.text,
      );
    }
    parsed.score = Math.max(0, Math.min(maxScore, parsed.score));
    this.logger.info(
      `[TRACK_QUIZ] graded open-ended question=${question.id} score=${parsed.score}/${maxScore} elapsedMs=${Date.now() - startedAt}`,
    );
    return { grading: parsed, raw: response.text };
  }
}

/** Carry the model's reply on a parse failure so the experiment can store what broke. */
function withRawOutput(error: Error, rawOutput: string): Error {
  return Object.assign(error, { rawOutput });
}
