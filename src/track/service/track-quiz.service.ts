import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { TrackItemType } from '../type/track.type';
import {
  OpenEndedQuestion,
  QuizAnswer,
  QuizAttemptStatus,
  QuizContent,
  QuizQuestion,
  QuizQuestionGrading,
  QuizQuestionType,
  QuizShowExplanations,
} from '../type/quiz.type';
import { TrackQuizAttempt } from '../entity/track-quiz-attempt.entity';
import { TrackQuizAttemptRepository } from '../repository/track-quiz-attempt.repository';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackEnrollmentService } from './track-enrollment.service';
import { TrackProgressService } from './track-progress.service';
import { TrackQuizLlmGraderService } from './track-quiz-llm-grader.service';
import { autogradeQuestion, scoreQuizAttempt } from './track-quiz.autograder';
import {
  QuizCorrectAnswer,
  correctAnswerOf,
  isQuestionGraded,
} from '../util/track-quiz-grading.util';

export interface QuizAttemptResult {
  attemptId: string;
  attemptNumber: number;
  status: QuizAttemptStatus;
  scorePct: number | null;
  passed: boolean | null;
  passScore: number;
  attemptsUsed: number;
  maxAttempts: number | null;
  questions: QuizQuestionResult[];
  itemCompleted: boolean;
  unlockedItemIds: string[];
  sectionCompleted: boolean;
  trackCompleted: boolean;
}

export interface QuizQuestionResult {
  questionId: string;
  /** null = pending LLM grading, or ungraded with no key (see `graded`). */
  correct: boolean | null;
  /** false = not scored; never read `correct: null` as pending when so. */
  graded: boolean;
  pointsAwarded: number;
  pointsPossible: number;
  explanation?: string;
  llmFeedback?: string;
  /**
   * The answer key, when there is one and the trainer lets learners see it.
   * Absent otherwise — the verdict in `correct` is still sent.
   */
  correctAnswer?: QuizCorrectAnswer;
}

/**
 * One row of the results screen. Pure, so what does and doesn't leave the
 * server is testable without the persistence around it.
 */
export function buildQuestionResult(
  entry: QuizQuestionGrading,
  question: QuizQuestion | undefined,
  includeExplanations: boolean,
): QuizQuestionResult {
  const correctAnswer = question ? correctAnswerOf(question) : null;
  return {
    questionId: entry.questionId,
    correct: entry.correct,
    graded: entry.graded ?? (question ? isQuestionGraded(question) : true),
    pointsAwarded: entry.pointsAwarded,
    pointsPossible: entry.pointsPossible,
    ...(includeExplanations ? { explanation: question?.explanation } : {}),
    ...(entry.llm ? { llmFeedback: entry.llm.feedback } : {}),
    ...(correctAnswer ? { correctAnswer } : {}),
  };
}

@Injectable()
export class TrackQuizService {
  private readonly logger = LoggerService.getInstance(TrackQuizService.name);

  constructor(
    private readonly trackQuizAttemptRepository: TrackQuizAttemptRepository,
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackEnrollmentService: TrackEnrollmentService,
    private readonly trackProgressService: TrackProgressService,
    private readonly llmGrader: TrackQuizLlmGraderService,
  ) {}

  /**
   * Grade a submitted attempt. Autogradable questions are scored inline;
   * open-ended questions go to the LLM synchronously. If any LLM grading
   * fails, the autograded portion persists and the attempt is stored as
   * PENDING_GRADING for a later `regrade`.
   */
  async submitAttempt(
    trackItemId: string,
    answers: QuizAnswer[],
  ): Promise<QuizAttemptResult> {
    const { item, progress } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.QUIZ) {
      throw new BadRequestException('This component is not a quiz');
    }
    const quiz = item.content as QuizContent;

    const attemptsUsed =
      await this.trackQuizAttemptRepository.countByProgressId(progress.id);
    const maxAttempts = quiz.settings.maxAttempts ?? null;
    if (maxAttempts !== null && attemptsUsed >= maxAttempts) {
      throw new BadRequestException(
        'You have used all attempts for this quiz.',
      );
    }

    const answersByQuestionId = new Map(
      answers.map((answer) => [answer.questionId, answer]),
    );
    for (const answer of answers) {
      const question = quiz.questions.find((q) => q.id === answer.questionId);
      if (!question) {
        throw new BadRequestException(
          `Answer references unknown question: ${answer.questionId}`,
        );
      }
      // Nothing grades a rating, so nothing else would notice one that
      // points at a statement or scale point the question doesn't have —
      // and it would sit in the attempt looking like a real response.
      if (question.type === QuizQuestionType.LIKERT_SCALE && answer.ratings) {
        const statementIds = new Set(question.statements.map((o) => o.id));
        const scaleIds = new Set(question.scale.map((o) => o.id));
        const invalid = answer.ratings.some(
          (rating) =>
            !statementIds.has(rating.statementId) ||
            !scaleIds.has(rating.scaleOptionId),
        );
        if (invalid) {
          throw new BadRequestException(
            `Rating references an unknown statement or scale point: ${answer.questionId}`,
          );
        }
      }
    }

    // 1. Autograde everything gradeable.
    const grading: QuizQuestionGrading[] = quiz.questions.map((question) =>
      autogradeQuestion(question, answersByQuestionId.get(question.id)),
    );

    // 2. LLM-grade open-ended answers (sequential; one retry inside the SDK
    //    timeout). Failures leave `correct: null` → PENDING_GRADING.
    let pendingGrading = false;
    for (const question of quiz.questions) {
      if (question.type !== QuizQuestionType.OPEN_ENDED) continue;
      // An ungraded reflection prompt is recorded, not judged — no model call.
      if (!isQuestionGraded(question)) continue;
      const answer = answersByQuestionId.get(question.id);
      const entry = grading.find((g) => g.questionId === question.id)!;
      const text = (answer?.text ?? '').trim();
      if (!text) {
        entry.correct = false;
        continue;
      }
      try {
        const result = await this.gradeOpenEndedWithRetry(question, text);
        this.applyOpenEndedGrading(entry, question, result);
      } catch (error) {
        this.logger.error(
          `LLM grading failed for question ${question.id}: ${error}`,
        );
        pendingGrading = true;
      }
    }

    const attempt = await this.persistAttempt({
      progressId: progress.id,
      trackItemId: item.id,
      userId: progress.userId,
      attemptNumber: attemptsUsed + 1,
      answers,
      grading,
      quiz,
      pendingGrading,
    });

    await this.trackItemProgressRepository.update(progress.id, {
      attemptCount: attemptsUsed + 1,
    });

    return this.buildResult(attempt, quiz, progress.id);
  }

  /** Re-run LLM grading for a PENDING_GRADING attempt. */
  async regradeAttempt(
    trackItemId: string,
    attemptId: string,
  ): Promise<QuizAttemptResult> {
    const { item, progress } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.QUIZ) {
      throw new BadRequestException('This component is not a quiz');
    }
    const attempt = await this.trackQuizAttemptRepository.findOne({
      where: { id: attemptId, trackItemProgressId: progress.id },
    });
    if (!attempt) {
      throw new NotFoundException('Quiz attempt not found');
    }
    if (attempt.status !== QuizAttemptStatus.PENDING_GRADING) {
      return this.buildResult(
        attempt,
        item.content as QuizContent,
        progress.id,
      );
    }

    const quiz = item.content as QuizContent;
    const answersByQuestionId = new Map(
      attempt.answers.map((answer) => [answer.questionId, answer]),
    );
    const grading = attempt.grading ?? [];
    let stillPending = false;
    for (const question of quiz.questions) {
      if (question.type !== QuizQuestionType.OPEN_ENDED) continue;
      const entry = grading.find((g) => g.questionId === question.id);
      if (!entry || entry.correct !== null || entry.graded === false) continue;
      const text = (answersByQuestionId.get(question.id)?.text ?? '').trim();
      if (!text) {
        entry.correct = false;
        continue;
      }
      try {
        const result = await this.gradeOpenEndedWithRetry(question, text);
        this.applyOpenEndedGrading(entry, question, result);
      } catch (error) {
        this.logger.error(
          `LLM regrading failed for question ${question.id}: ${error}`,
        );
        stillPending = true;
      }
    }

    const updated = await this.persistAttempt({
      progressId: progress.id,
      trackItemId: item.id,
      userId: progress.userId,
      attemptNumber: attempt.attemptNumber,
      answers: attempt.answers,
      grading,
      quiz,
      pendingGrading: stillPending,
      existingAttemptId: attempt.id,
    });
    return this.buildResult(updated, quiz, progress.id);
  }

  private async gradeOpenEndedWithRetry(
    question: OpenEndedQuestion,
    text: string,
  ) {
    try {
      return await this.llmGrader.gradeOpenEndedAnswer(question, text);
    } catch {
      return this.llmGrader.gradeOpenEndedAnswer(question, text);
    }
  }

  private applyOpenEndedGrading(
    entry: QuizQuestionGrading,
    question: OpenEndedQuestion,
    result: { score: number; feedback: string; criteriaScores?: any[] },
  ): void {
    const maxScore = question.rubric.maxScore;
    const fraction = maxScore > 0 ? result.score / maxScore : 0;
    entry.pointsAwarded =
      Math.round(fraction * entry.pointsPossible * 100) / 100;
    entry.correct = fraction >= 0.5;
    entry.llm = {
      score: result.score,
      feedback: result.feedback,
      criteriaScores: result.criteriaScores,
    };
  }

  private async persistAttempt(params: {
    progressId: string;
    trackItemId: string;
    userId: number;
    attemptNumber: number;
    answers: QuizAnswer[];
    grading: QuizQuestionGrading[];
    quiz: QuizContent;
    pendingGrading: boolean;
    existingAttemptId?: string;
  }): Promise<TrackQuizAttempt> {
    const { grading, quiz, pendingGrading } = params;
    const { scorePct, passed } = scoreQuizAttempt(
      grading,
      quiz.settings.passScore,
      pendingGrading,
    );
    const now = new Date();

    const attempt = await this.trackQuizAttemptRepository.save({
      ...(params.existingAttemptId ? { id: params.existingAttemptId } : {}),
      trackItemProgressId: params.progressId,
      trackItemId: params.trackItemId,
      userId: params.userId,
      attemptNumber: params.attemptNumber,
      answers: params.answers,
      grading,
      scorePct,
      passed,
      status: pendingGrading
        ? QuizAttemptStatus.PENDING_GRADING
        : QuizAttemptStatus.GRADED,
      submittedAt: params.existingAttemptId ? undefined : now,
      ...(pendingGrading ? {} : { gradedAt: now }),
    } as Partial<TrackQuizAttempt>);
    return attempt as TrackQuizAttempt;
  }

  private async buildResult(
    attempt: TrackQuizAttempt,
    quiz: QuizContent,
    progressId: string,
  ): Promise<QuizAttemptResult> {
    // Complete the item when the attempt passed (idempotent for replays).
    let completion = {
      completed: false,
      unlockedItemIds: [] as string[],
      sectionCompleted: false,
      trackCompleted: false,
    };
    if (attempt.passed) {
      completion = await this.trackProgressService.completeItem(progressId, {
        score: attempt.scorePct ?? undefined,
      });
    }
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: progressId },
    });

    const showExplanations =
      quiz.settings.showExplanations ?? QuizShowExplanations.AFTER_SUBMIT;
    const includeExplanations = showExplanations !== QuizShowExplanations.NEVER;

    const questionsById = new Map(
      quiz.questions.map((question) => [question.id, question]),
    );
    const attemptsUsed =
      await this.trackQuizAttemptRepository.countByProgressId(progressId);

    return {
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      scorePct:
        attempt.scorePct !== undefined && attempt.scorePct !== null
          ? Number(attempt.scorePct)
          : null,
      passed: attempt.passed ?? null,
      passScore: quiz.settings.passScore,
      attemptsUsed,
      maxAttempts: quiz.settings.maxAttempts ?? null,
      questions: (attempt.grading ?? []).map((entry) =>
        buildQuestionResult(
          entry,
          questionsById.get(entry.questionId),
          includeExplanations,
        ),
      ),
      itemCompleted:
        completion.completed ||
        progress?.status === SessionItemStatus.COMPLETED,
      unlockedItemIds: completion.unlockedItemIds,
      sectionCompleted: completion.sectionCompleted,
      trackCompleted: completion.trackCompleted,
    };
  }
}
