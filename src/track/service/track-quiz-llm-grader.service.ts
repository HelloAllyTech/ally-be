import { Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  renderTemplate,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import { OpenEndedQuestion } from '../type/quiz.type';
import { TRACK_QUIZ_LLM_GRADING_TIMEOUT_MS } from '../constants/track.constant';

const ANTHROPIC_MAX_TOKENS = 1024;
const PROMPT_CODE = 'track_quiz_open_ended_grading_user';

export interface OpenEndedGrading {
  score: number;
  feedback: string;
  criteriaScores?: { name: string; score: number }[];
}

/**
 * Grades one open-ended quiz answer against the trainer's rubric. Same
 * Anthropic + PromptSharedService + LlmUsageService pattern as
 * AnthropicAutofillService; JSON forced via assistant-prefill `{`.
 * Throws on failure — the caller decides the PENDING_GRADING fallback.
 */
@Injectable()
export class TrackQuizLlmGraderService {
  private readonly logger = LoggerService.getInstance(
    TrackQuizLlmGraderService.name,
  );
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.model = this.configService.anthropic.autofillModel;
  }

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
    // No assistant-turn prefill: the 4.6+ model family (incl. the default
    // claude-sonnet-4-6) rejects a trailing assistant message with a 400.
    // The prompt demands a bare JSON object; fences are stripped defensively.
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      },
      { timeout: TRACK_QUIZ_LLM_GRADING_TIMEOUT_MS },
    );

    this.recordUsage(response.usage, { questionId: question.id });

    const block = response.content[0];
    const raw = block?.type === 'text' ? block.text : '';
    const cleaned = stripMarkdownFences(raw).trim();
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

  private recordUsage(
    usage: Anthropic.Messages.Usage | undefined,
    metadata?: Record<string, any>,
  ): void {
    const input = usage?.input_tokens ?? 0;
    const output = usage?.output_tokens ?? 0;
    void this.llmUsage.record({
      provider: 'anthropic',
      model: this.model,
      task: LlmTask.TRACK_QUIZ_GRADING,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      cachedTokens: usage?.cache_read_input_tokens ?? undefined,
      metadata,
    });
  }
}
