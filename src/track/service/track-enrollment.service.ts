import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SessionItemStatus } from 'src/common/type/common.type';
import { CaseSessionService } from 'src/case/service/case-session.service';
import { LoggerService } from 'src/logger/logger.service';
import { TrackEnrollment } from '../entity/track-enrollment.entity';
import { TrackItemProgress } from '../entity/track-item-progress.entity';
import { TrackItem } from '../entity/track-item.entity';
import { TrackRepository } from '../repository/track.repository';
import { TrackTenantRepository } from '../repository/track-tenant.repository';
import { TrackEnrollmentRepository } from '../repository/track-enrollment.repository';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackJournalEntryRepository } from '../repository/track-journal-entry.repository';
import { TrackQuizAttemptRepository } from '../repository/track-quiz-attempt.repository';
import { TrackAnnotationAttemptRepository } from '../repository/track-annotation-attempt.repository';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import {
  AnsweredArticleQuestion,
  ArticleContent,
  ArticleQuestion,
  JournalContent,
  parseArticleQuestionMarkers,
  TrackItemType,
  TrackStatus,
  VideoContent,
  VideoSource,
} from '../type/track.type';
import { QuizAnswer, QuizContent } from '../type/quiz.type';
import { AnnotationContent } from '../type/annotation.type';
import { TrackSharedService, TrackWithStructure } from './track-shared.service';
import { TrackProgressService } from './track-progress.service';
import { TrackLocalizationService } from './track-localization.service';
import { TrackTranslation } from '../entity/track-translation.entity';
import { TrackTranslationFallbackReason } from '../type/track-translation.type';
import { GameContent } from '../type/game.type';
import {
  sanitizeQuizForLearner,
  sanitizeQuizQuestionForLearner,
} from './track-quiz.sanitizer';
import {
  buildAnnotationAttemptView,
  sanitizeAnnotationForLearner,
} from './track-annotation.sanitizer';
import { autogradeQuestion } from './track-quiz.autograder';
import { CohortVisibilityService } from 'src/cohort/service/cohort-visibility.service';
import { CohortContentType } from 'src/cohort/constants/cohort.constants';
import { TrackItemCompletionCriteriaVersion } from '../entity/track-item-completion-criteria-version.entity';

@Injectable()
export class TrackEnrollmentService {
  private readonly logger = LoggerService.getInstance(
    TrackEnrollmentService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly trackRepository: TrackRepository,
    private readonly trackTenantRepository: TrackTenantRepository,
    private readonly trackEnrollmentRepository: TrackEnrollmentRepository,
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackJournalEntryRepository: TrackJournalEntryRepository,
    private readonly trackQuizAttemptRepository: TrackQuizAttemptRepository,
    private readonly trackAnnotationAttemptRepository: TrackAnnotationAttemptRepository,
    private readonly trackSharedService: TrackSharedService,
    private readonly trackProgressService: TrackProgressService,
    private readonly caseSessionService: CaseSessionService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly trackLocalizationService: TrackLocalizationService,
    private readonly cohortVisibilityService: CohortVisibilityService,
  ) {}

  async getTracksForLearner(options: {
    limit?: number;
    offset?: number;
    languageCode?: string;
  }) {
    const userId = this.requireUserId();
    const tenantId = ExecutionManager.getTenantId();

    const cohortId =
      await this.cohortVisibilityService.resolveUserCohortId(userId);

    const result = await this.trackRepository.getTracksForLearner({
      userId,
      tenantId,
      cohortScope: { cohortId },
      limit: options.limit,
      offset: options.offset,
    });

    const index = await this.trackLocalizationService.buildPublishedIndex(
      result.data.map((track) => track.id),
    );

    return {
      data: result.data.map((track) => {
        const preferred =
          track.enrollment?.languageCode ?? options.languageCode ?? null;
        const translation = index.get(track.id, preferred);
        const translated = this.trackLocalizationService.localizeTrack(
          track as any,
          translation,
        );
        return {
          id: track.id,
          title: translated.title,
          description: translated.description,
          languageCode: translation ? preferred : null,
          coverImageUrl: track.coverImageUrl,
          totalItems: track.totalItems,
          simulationsCount: track.simulationsCount,
          estimatedDurationMinutes: track.estimatedDurationMinutes,
          enrolled: !!track.enrollment,
          completedItems: track.enrollment?.completedItems ?? 0,
          completedAt: track.enrollment?.completedAt ?? null,
          lastActivityAt: track.enrollment?.lastActivityAt ?? null,
          trackEnrollmentId: track.enrollment?.id ?? null,
        };
      }),
      count: result.count,
    };
  }

  async getTrackDetailForLearner(trackId: string, languageCode?: string) {
    const userId = this.requireUserId();
    const structure =
      await this.trackSharedService.getTrackWithStructure(trackId);
    const enrollment = await this.trackEnrollmentRepository.findByTrackAndUser(
      trackId,
      userId,
    );
    if (!enrollment) {
      await this.assertTrackAvailable(structure);
    }

    const progressRows = enrollment
      ? await this.trackItemProgressRepository.findByEnrollmentId(enrollment.id)
      : [];
    const progressByItemId = new Map(
      progressRows.map((row) => [row.trackItemId, row]),
    );

    const allItemIds = structure.sections.flatMap((s) =>
      s.items.map((i) => i.id),
    );
    const versions = await this.dataSource
      .getRepository(TrackItemCompletionCriteriaVersion)
      .find({
        where: { trackItemId: In(allItemIds) },
      });
    const itemsWithHistory = new Set(versions.map((v) => v.trackItemId));
    
    const resolvedLanguage =
      await this.trackLocalizationService.resolveLearnerLanguage(
        trackId,
        enrollment?.languageCode,
        languageCode,
      );
    const [translation, languages] = await Promise.all([
      this.trackLocalizationService.resolvePublished(trackId, resolvedLanguage),
      this.trackLocalizationService.listLearnerLanguages(trackId),
    ]);
    const translated = this.trackLocalizationService.localizeTrack(
      structure as any,
      translation,
    );

    return {
      id: structure.id,
      title: translated.title,
      description: translated.description,
      coverImageUrl: structure.coverImageUrl,
      status: structure.status,
      totalItems: structure.totalItems,
      simulationsCount: structure.sections.reduce(
        (sum, section) =>
          sum +
          section.items.filter((item) => item.type === TrackItemType.ROLEPLAY)
            .length,
        0,
      ),
      estimatedDurationMinutes: structure.estimatedDurationMinutes,
      enrolled: !!enrollment,
      trackEnrollmentId: enrollment?.id ?? null,
      completedItems: enrollment?.completedItems ?? 0,
      completedAt: enrollment?.completedAt ?? null,
      languageCode: resolvedLanguage,
      availableLanguages: languages,
      sections: structure.sections.map((section) => {
        const localizedSection = this.trackLocalizationService.localizeSection(
          section as any,
          translation,
        );
        return {
          id: section.id,
          title: localizedSection.title,
          description: localizedSection.description,
          order: section.order,
          items: section.items.map((item) =>
            this.toLearnerItem(
              this.trackLocalizationService.localizeItem(item, translation),
              progressByItemId.get(item.id),
              this.fallbackReasonFor(item, translation),
              itemsWithHistory.has(item.id),
            ),
          ),
        };
      }),
    };
  }

  private fallbackReasonFor(
    item: TrackItem,
    translation: TrackTranslation | null,
  ): TrackTranslationFallbackReason | null {
    if (!translation) return null;
    if (
      item.type === TrackItemType.VIDEO &&
      !this.trackLocalizationService.hasLocalisedMedia(item, translation)
    ) {
      return TrackTranslationFallbackReason.VIDEO_NOT_LOCALISED;
    }
    if (item.type === TrackItemType.CASE) {
      return TrackTranslationFallbackReason.CASE_NOT_TRANSLATED;
    }
    return null;
  }

  private toLearnerItem(
    item: TrackItem,
    progress?: TrackItemProgress,
    fallbackReason: TrackTranslationFallbackReason | null = null,
    hasCriteriaHistory?: boolean,
  ) {
    return {
      id: item.id,
      type: item.type,
      order: item.order,
      title: item.title,
      description: item.description,
      languageFallbackReason: fallbackReason,
      scenarioId: item.scenarioId ?? null,
      caseId: item.caseId ?? null,
      completionCriteria: item.completionCriteria ?? null,
      hasCriteriaHistory: hasCriteriaHistory ?? false,
      contentMeta: this.buildContentMeta(item),
      hasDiscussion: item.hasDiscussion ?? false,
      status: progress?.status ?? SessionItemStatus.LOCKED,
      startedAt: progress?.startedAt ?? null,
      completedAt: progress?.completedAt ?? null,
      score: progress?.score ?? null,
      attemptCount: progress?.attemptCount ?? 0,
      maxWatchedPct: progress?.meta?.maxWatchedPct ?? 0,
    };
  }

    async getTrackLanguages(trackId: string): Promise<any> {}
    async setTrackLanguage(trackId: string, languageCode: string): Promise<any> {}
    async enroll(trackId: string, appLanguageCode?: string): Promise<any> {}
    async startItem(trackItemId: string): Promise<any> {}
    async markArticleRead(trackItemId: string): Promise<any> {}
    async reportVideoProgress(trackItemId: string, watchedPct: number): Promise<any> {}
    async submitInterjectionAnswer(trackItemId: string, interjectionId: string, answer: any): Promise<any> {}
    async submitArticleQuestionAnswer(trackItemId: string, questionId: string, selectedOptionId: string): Promise<any> {}
    async getNextItem(trackId: string): Promise<any> {}
    async getPermittedItemProgress(trackItemId: string): Promise<any> {}
    private buildContentMeta(item: TrackItem): any {}
    private async touchEnrollment(trackEnrollmentId: string): Promise<any> {}
    private async assertTrackAvailable(track: TrackWithStructure): Promise<any> {}
    private requireUserId(): number {
    const userIdStr = ExecutionManager.getUserId();
    if (!userIdStr) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return Number(userIdStr);
  }
}

function unansweredArticleQuestionCount(
  item: TrackItem,
  progress: TrackItemProgress,
): number {
  if (item.type !== TrackItemType.ARTICLE) return 0;
  const article = item.content as ArticleContent | undefined;
  if (!article) return 0;
  const questions = articleQuestionsInReadingOrder(article);
  if (!questions.length) return 0;
  const answered = progress.meta?.answeredArticleQuestions ?? {};
  return questions.filter((question) => !answered[question.id]).length;
}

function articleQuestionsInReadingOrder(
  article: ArticleContent,
): ArticleQuestion[] {
  const questions = article.questions ?? [];
  if (!questions.length) return [];
  const byId = new Map(questions.map((question) => [question.id, question]));
  const ordered: ArticleQuestion[] = [];
  for (const id of parseArticleQuestionMarkers(article.html)) {
    const question = byId.get(id);
    if (question && !ordered.includes(question)) ordered.push(question);
  }
  return ordered;
}

function buildArticleQuestionView(
  question: ArticleQuestion,
  answered: AnsweredArticleQuestion | undefined,
) {
  return {
    ...sanitizeQuizQuestionForLearner(question),
    answered: answered ?? null,
    correctOptionId: answered ? question.correctOptionIds[0] : null,
    explanation: answered ? (question.explanation ?? null) : null,
  };
}
