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
  ) {}

  async gradeOpenEndedAnswer(
    question: OpenEndedQuestion,
    answer: string,
  ): Promise<OpenEndedGrading> {
    const template =
      await this.promptSharedService.getPromptByCode(PROMPT_CODE);
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found for code: ${PROMPT_CODE}`,
      );
    }
    const maxScore = question.rubric.maxScore;
    const prompt = renderTemplate(template, {
      question: question.prompt,
      guidance: question.rubric.guidance,
      criteria: JSON.stringify(question.rubric.criteria ?? []),
      maxScore: String(maxScore),
      answer,
    });

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
      throw new Error('LLM grading response contained no JSON object');
    }
    const parsed = JSON.parse(
      cleaned.slice(jsonStart, cleaned.lastIndexOf('}') + 1),
    ) as OpenEndedGrading;

    if (typeof parsed.score !== 'number' || !parsed.feedback) {
      throw new Error('LLM grading response missing score/feedback');
    }
    parsed.score = Math.max(0, Math.min(maxScore, parsed.score));
    this.logger.info(
      `[TRACK_QUIZ] graded open-ended question=${question.id} score=${parsed.score}/${maxScore} elapsedMs=${Date.now() - startedAt}`,
    );
    return parsed;
  }
}
