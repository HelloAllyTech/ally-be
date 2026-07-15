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
import { autogradeQuestion } from './track-quiz.autograder';
import { questionPoints } from './track-quiz.sanitizer';

export interface QuizAttemptResult {
  attemptId: string;
  attemptNumber: number;
  status: QuizAttemptStatus;
  scorePct: number | null;
  passed: boolean | null;
  passScore: number;
  attemptsUsed: number;
  maxAttempts: number | null;
  questions: {
    questionId: string;
    correct: boolean | null;
    pointsAwarded: number;
    pointsPossible: number;
    explanation?: string;
    llmFeedback?: string;
  }[];
  itemCompleted: boolean;
  unlockedItemIds: string[];
  sectionCompleted: boolean;
  trackCompleted: boolean;
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
      if (!quiz.questions.some((q) => q.id === answer.questionId)) {
        throw new BadRequestException(
          `Answer references unknown question: ${answer.questionId}`,
        );
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
      if (!entry || entry.correct !== null) continue;
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
    const totalPoints = quiz.questions.reduce(
      (sum, question) => sum + questionPoints(question),
      0,
    );
    const awarded = grading.reduce(
      (sum, entry) => sum + entry.pointsAwarded,
      0,
    );
    const scorePct =
      totalPoints > 0 ? Math.round((awarded / totalPoints) * 100) : 0;
    const passed = pendingGrading ? null : scorePct >= quiz.settings.passScore;
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

    const explanationsByQuestionId = new Map(
      quiz.questions.map((question) => [question.id, question.explanation]),
    );
    const attemptsUsed =
      await this.trackQuizAttemptRepository.countByProgressId(progressId);

    return {
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      scorePct:
        attempt.scorePct !== undefined ? Number(attempt.scorePct) : null,
      passed: attempt.passed ?? null,
      passScore: quiz.settings.passScore,
      attemptsUsed,
      maxAttempts: quiz.settings.maxAttempts ?? null,
      questions: (attempt.grading ?? []).map((entry) => ({
        questionId: entry.questionId,
        correct: entry.correct,
        pointsAwarded: entry.pointsAwarded,
        pointsPossible: entry.pointsPossible,
        ...(includeExplanations
          ? { explanation: explanationsByQuestionId.get(entry.questionId) }
          : {}),
        ...(entry.llm ? { llmFeedback: entry.llm.feedback } : {}),
      })),
      itemCompleted:
        completion.completed ||
        progress?.status === SessionItemStatus.COMPLETED,
      unlockedItemIds: completion.unlockedItemIds,
      sectionCompleted: completion.sectionCompleted,
      trackCompleted: completion.trackCompleted,
    };
  }
}
