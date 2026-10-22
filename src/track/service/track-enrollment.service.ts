import { CohortVisibilityService } from 'src/cohort/service/cohort-visibility.service';
import { CohortContentType } from 'src/cohort/constants/cohort.constants';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
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
  TrackAccessDenialReason,
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
import { GameContent, TrackGameKey } from '../type/game.type';
import { BucketSortContent } from '../type/bucket-sort.type';
import { sanitizeBucketSortForLearner } from './track-bucket-sort.sanitizer';
import {
  BranchingScenarioContent,
  resolveBranchingRound,
} from '../type/branching.type';
import {
  sanitizeQuizForLearner,
  sanitizeQuizQuestionForLearner,
} from './track-quiz.sanitizer';
import {
  buildAnnotationAttemptView,
  sanitizeAnnotationForLearner,
} from './track-annotation.sanitizer';
import { autogradeQuestion } from './track-quiz.autograder';
import {
  buildPublicTrackStory,
  localiseTriggerWarningName,
  normaliseTrackLandingPage,
} from '../util/track-landing-page.util';
import { PublicTrackStory } from '../type/track-landing-page.type';
import {
  TRACK_TRIGGER_WARNINGS_BY_SECTION_SQL,
  TrackSectionTriggerWarningRow,
} from '../constants/track-landing-page.constant';

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

    // `null` means this learner is in no cohort — the "Unassigned" audience,
    // which restrictions can target. It is not a signal to skip filtering.
    const cohortId =
      await this.cohortVisibilityService.resolveUserCohortId(userId);

    const result = await this.trackRepository.getTracksForLearner({
      userId,
      tenantId,
      cohortScope: { cohortId },
      limit: options.limit,
      offset: options.offset,
    });

    // Two queries for the whole page, rather than two per course.
    const index = await this.trackLocalizationService.buildPublishedIndex(
      result.data.map((track) => track.id),
    );

    return {
      data: result.data.map((track) => {
        // An enrolled learner's saved choice wins; otherwise the app language
        // they are browsing in, when the course is published in it.
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

  /**
   * Track detail for the learner: sections + items with per-item progress
   * state. Item `content` is intentionally NOT included (quiz answer keys
   * must never reach the client from here) — the player fetches content via
   * the start endpoint per item.
   */
  async getTrackDetailForLearner(trackId: string, languageCode?: string) {
    const userId = this.requireUserId();
    const structure =
      await this.trackSharedService.getTrackWithStructure(trackId);
    const enrollment = await this.trackEnrollmentRepository.findByTrackAndUser(
      trackId,
      userId,
    );
    // Non-enrolled learners can only browse ACTIVE tenant-visible tracks;
    // enrolled learners can keep finishing an ARCHIVED one.
    if (!enrollment) {
      await this.assertTrackAvailable(structure);
    }

    const progressRows = enrollment
      ? await this.trackItemProgressRepository.findByEnrollmentId(enrollment.id)
      : [];
    const progressByItemId = new Map(
      progressRows.map((row) => [row.trackItemId, row]),
    );

    // The saved per-course choice wins over the app language, and both lose to
    // reality: an unpublished language reads in English.
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
      /** What the learner is reading now, and what else they can switch to. */
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
            ),
          ),
        };
      }),
    };
  }

  /**
   * Why an item will read in English despite the learner picking another
   * language, or null when it reads in their language. Surfaced per item so a
   * learner meets "this lesson is in English" on the card rather than as a
   * surprise once the video starts.
   */
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

  /**
   * The outline a shared course link shows to anyone, signed in or not.
   *
   * Served only while the author has switched public view on and the course is
   * published; every other case — no such course, deleted, draft, archived,
   * public view off — is the same 404, so the endpoint cannot be used to learn
   * which private course ids exist.
   *
   * Titles, descriptions, types and the answer-free `contentMeta` counts only:
   * the same fields the learner detail view shows before a component is
   * opened, minus progress and the internal scenario/case ids.
   */
  async getPublicTrackOutline(trackId: string, languageCode?: string) {
    let structure: TrackWithStructure;
    try {
      structure = await this.trackSharedService.getTrackWithStructure(trackId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('This course is not available');
      }
      throw error;
    }
    if (!structure.isPublicView || structure.status !== TrackStatus.ACTIVE) {
      throw new NotFoundException('This course is not available');
    }

    const resolvedLanguage =
      await this.trackLocalizationService.resolveLearnerLanguage(
        trackId,
        null,
        languageCode,
      );
    const translation = await this.trackLocalizationService.resolvePublished(
      trackId,
      resolvedLanguage,
    );
    const translated = this.trackLocalizationService.localizeTrack(
      structure as any,
      translation,
    );
    const story = await this.buildPublicStory(structure, resolvedLanguage);

    return {
      id: structure.id,
      title: translated.title,
      description: translated.description,
      coverImageUrl: structure.coverImageUrl,
      totalItems: structure.totalItems,
      simulationsCount: structure.sections.reduce(
        (sum, section) =>
          sum +
          section.items.filter((item) => item.type === TrackItemType.ROLEPLAY)
            .length,
        0,
      ),
      estimatedDurationMinutes: structure.estimatedDurationMinutes,
      languageCode: resolvedLanguage,
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
          items: section.items.map((item) => {
            const localized = this.trackLocalizationService.localizeItem(
              item,
              translation,
            );
            return {
              id: localized.id,
              type: localized.type,
              order: localized.order,
              title: localized.title,
              description: localized.description,
              contentMeta: this.buildContentMeta(localized),
            };
          }),
        };
      }),
      story,
    };
  }

  /**
   * The story-led landing page for the public outline, or null when the course
   * has none (no landing page, or no hook — the classic layout).
   *
   * The display rules live in `buildPublicTrackStory`; this only gathers what
   * they need. The trigger-warning lookup runs for story courses alone, so a
   * classic course pays nothing for the feature. Story text is English in v1
   * (it is authored once, not translated); only the warning names localise.
   */
  private async buildPublicStory(
    structure: TrackWithStructure,
    languageCode: string,
  ): Promise<PublicTrackStory | null> {
    if (!structure.landingPage) return null;
    // Normalise again on read: the stored value was normalised on the way in,
    // but this is the one place a half-valid row would reach the public.
    const page = normaliseTrackLandingPage(structure.landingPage);
    if (!page.hero.hook) return null;

    const warnings = await this.loadWarningsBySection(
      structure.id,
      languageCode,
    );
    return buildPublicTrackStory(page, structure.sections, warnings);
  }

  /**
   * Trigger-warning names per section, from the scenarios behind the course's
   * roleplays — and behind its cases, which are a sequence of scenarios linked
   * through `case_items`. One query for the whole course, not one per item.
   * Names are localised from `trigger_warnings.translations`, English when the
   * language has no translation.
   */
  private async loadWarningsBySection(
    trackId: string,
    languageCode: string,
  ): Promise<Map<string, string[]>> {
    const rows: TrackSectionTriggerWarningRow[] = await this.dataSource.query(
      TRACK_TRIGGER_WARNINGS_BY_SECTION_SQL,
      [trackId],
    );

    const bySection = new Map<string, string[]>();
    for (const row of rows) {
      const name = localiseTriggerWarningName(
        row.name,
        row.translations,
        languageCode,
      );
      bySection.set(row.sectionId, [
        ...(bySection.get(row.sectionId) ?? []),
        name,
      ]);
    }
    return bySection;
  }

  /**
   * Can the signed-in learner take this course? Answers the question the
   * shared-link landing page asks right after login, with the same rules as
   * the detail view and enrolment — an enrolled learner keeps access (even to
   * an archived course); anyone else needs a published course assigned to
   * their organisation and open to their group.
   *
   * Returns a reason instead of throwing so a "not available for you" answer
   * is a state the page renders, not an error it has to recover from.
   */
  async getTrackAccess(trackId: string): Promise<{
    hasAccess: boolean;
    enrolled: boolean;
    reason: TrackAccessDenialReason | null;
  }> {
    const userId = this.requireUserId();
    const denied = (reason: TrackAccessDenialReason) => ({
      hasAccess: false,
      enrolled: false,
      reason,
    });

    const track = await this.trackRepository.findOne({
      where: { id: trackId },
    });
    if (!track) {
      return denied(TrackAccessDenialReason.NOT_AVAILABLE);
    }
    const enrollment = await this.trackEnrollmentRepository.findByTrackAndUser(
      trackId,
      userId,
    );
    if (enrollment) {
      return { hasAccess: true, enrolled: true, reason: null };
    }
    if (track.status !== TrackStatus.ACTIVE) {
      return denied(TrackAccessDenialReason.NOT_AVAILABLE);
    }
    const denial = await this.findAccessDenial(trackId, userId, false);
    return denial
      ? denied(denial)
      : { hasAccess: true, enrolled: false, reason: null };
  }

  /* ---------------------------------------------------------------- *
   * Language choice
   * ---------------------------------------------------------------- */

  /** Languages this course is published in, for the learner's picker. */
  async getTrackLanguages(trackId: string) {
    const languages =
      await this.trackLocalizationService.listLearnerLanguages(trackId);
    const enrollment = await this.trackEnrollmentRepository.findByTrackAndUser(
      trackId,
      this.requireUserId(),
    );
    return {
      languages,
      selectedLanguageCode: enrollment?.languageCode ?? null,
    };
  }

  /**
   * Persists the learner's language for this course.
   *
   * Requires enrollment, because the choice lives on the enrollment row — and
   * because it is the language their answers will be marked in. Switching
   * mid-course is safe: progress rows are keyed by item id, which does not
   * change with language.
   */
  async setTrackLanguage(trackId: string, languageCode: string) {
    const userId = this.requireUserId();
    const enrollment = await this.trackEnrollmentRepository.findByTrackAndUser(
      trackId,
      userId,
    );
    if (!enrollment) {
      throw new BadRequestException(
        'Enroll in this course before choosing a language for it.',
      );
    }

    const languages =
      await this.trackLocalizationService.listLearnerLanguages(trackId);
    if (!languages.some((option) => option.languageCode === languageCode)) {
      throw new BadRequestException(
        'This course is not available in that language.',
      );
    }

    await this.trackEnrollmentRepository.update(enrollment.id, {
      languageCode,
    });
    return { languageCode };
  }

  /** Idempotent enrollment: creates the enrollment + ALL progress rows. */
  async enroll(trackId: string, appLanguageCode?: string) {
    const userId = this.requireUserId();
    const tenantId = ExecutionManager.getTenantId();

    const existing = await this.trackEnrollmentRepository.findByTrackAndUser(
      trackId,
      userId,
    );
    if (existing) {
      return { trackEnrollmentId: existing.id, alreadyEnrolled: true };
    }

    const structure =
      await this.trackSharedService.getTrackWithStructure(trackId);
    await this.assertTrackAvailable(structure);
    if (structure.status !== TrackStatus.ACTIVE) {
      throw new BadRequestException('This track is not open for enrollment');
    }
    const orderedItems = structure.sections.flatMap((section) => section.items);
    if (orderedItems.length === 0) {
      throw new BadRequestException('This track has no content yet');
    }

    // Seed the per-course language from the app language they enrolled in, so
    // a Hindi-UI learner opening a Hindi-published course starts in Hindi
    // without touching the picker. Falls back to English when the course is not
    // published in their app language.
    const initialLanguage =
      await this.trackLocalizationService.resolveLearnerLanguage(
        trackId,
        null,
        appLanguageCode,
      );

    const enrollmentId = await this.dataSource.transaction(async (manager) => {
      const enrollmentRepo = manager.getRepository(TrackEnrollment);
      const progressRepo = manager.getRepository(TrackItemProgress);
      const enrollment = await enrollmentRepo.save({
        trackId,
        userId,
        tenantId,
        languageCode: initialLanguage,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      });
      await progressRepo.save(
        orderedItems.map((item, index) =>
          progressRepo.create({
            trackEnrollmentId: enrollment.id,
            trackItemId: item.id,
            userId,
            status:
              index === 0
                ? SessionItemStatus.UNLOCKED
                : SessionItemStatus.LOCKED,
          }),
        ),
      );
      return enrollment.id;
    });

    this.logger.info(`User ${userId} enrolled in track ${trackId}`);
    return { trackEnrollmentId: enrollmentId, alreadyEnrolled: false };
  }

  /**
   * Open a component. Gated on UNLOCKED/COMPLETED (replay of a completed item
   * is allowed and has no progression side effects). Returns the type-specific
   * payload the player renders.
   */
  async startItem(trackItemId: string) {
    const { item, sourceItem, progress, languageCode } =
      await this.getPermittedItemProgress(trackItemId);

    if (!progress.startedAt) {
      await this.trackItemProgressRepository.update(progress.id, {
        startedAt: new Date(),
      });
    }
    await this.touchEnrollment(progress.trackEnrollmentId);

    switch (item.type) {
      case TrackItemType.ROLEPLAY: {
        const lastScenarioSessionId =
          progress.status === SessionItemStatus.COMPLETED
            ? await this.scenarioSharedService.getLatestScenarioSessionIdByTrackItemProgressId(
                progress.id,
              )
            : null;
        const scenarioTranslated =
          await this.trackLocalizationService.hasScenarioTranslation(
            item.scenarioId,
            languageCode,
          );
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          scenarioId: item.scenarioId,
          completionCriteria: item.completionCriteria ?? null,
          lastScenarioSessionId,
          /** The roleplay runs in the scenario's own translated language, which
           *  is translated separately from the course. */
          languageFallbackReason: scenarioTranslated
            ? null
            : TrackTranslationFallbackReason.SCENARIO_NOT_TRANSLATED,
        };
      }

      case TrackItemType.CASE: {
        let caseSession =
          await this.caseSessionService.getUserCaseSessionByCaseId(
            item.caseId!,
          );
        if (!caseSession) {
          // Returns only the first session-item id — re-read the session row.
          await this.caseSessionService.createUserCaseSession(item.caseId!);
          caseSession =
            await this.caseSessionService.getUserCaseSessionByCaseId(
              item.caseId!,
            );
        }
        if (!caseSession) {
          throw new BadRequestException(
            'Could not start a case session for this component',
          );
        }
        if (progress.caseSessionId !== caseSession.id) {
          await this.trackItemProgressRepository.update(progress.id, {
            caseSessionId: caseSession.id,
          });
        }
        // The learner may have finished this case elsewhere already.
        if (
          caseSession.completedAt &&
          progress.status !== SessionItemStatus.COMPLETED
        ) {
          await this.trackProgressService.completeItem(progress.id, {});
        }
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          caseId: item.caseId,
          caseSessionId: caseSession.id,
          caseCompleted: !!caseSession.completedAt,
        };
      }

      case TrackItemType.QUIZ: {
        const quiz = item.content as QuizContent;
        const attemptsUsed =
          await this.trackQuizAttemptRepository.countByProgressId(progress.id);
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          quiz: sanitizeQuizForLearner(
            quiz,
            `${progress.id}:${attemptsUsed + 1}`,
          ),
          attemptsUsed,
          maxAttempts: quiz.settings.maxAttempts ?? null,
        };
      }

      case TrackItemType.ANNOTATED_ARTIFACT: {
        const annotation = item.content as AnnotationContent;
        const attemptsUsed =
          await this.trackAnnotationAttemptRepository.countByProgressId(
            progress.id,
          );
        // A learner reopening a finished annotation is almost always coming
        // back for the author's notes, so the last graded attempt ships with
        // the payload rather than making them re-mark to see it.
        const lastAttempt = attemptsUsed
          ? await this.trackAnnotationAttemptRepository.findLatestByProgressId(
              progress.id,
            )
          : null;
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          annotation: sanitizeAnnotationForLearner(annotation),
          attemptsUsed,
          maxAttempts: annotation.settings.maxAttempts ?? null,
          lastResult: lastAttempt
            ? buildAnnotationAttemptView(lastAttempt, annotation, attemptsUsed)
            : null,
        };
      }

      case TrackItemType.GAME: {
        const game = item.content as GameContent;
        /**
         * Completing on open is what makes a game skippable. Progression is
         * SEQUENTIAL, so an item that is never completed leaves everything
         * after it LOCKED — a learner who bounced off the game would be stuck
         * behind it. Opening it is the whole requirement; playing, replaying
         * and walking away are all equally fine.
         */
        const completion = await this.trackProgressService.completeItem(
          progress.id,
          {},
        );
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          gameKey: game.gameKey,
          intro: game.intro ?? null,
          bestScore: progress.meta?.bestGameScore ?? null,
          playCount: progress.meta?.gamePlayCount ?? 0,
          completion,
          // The breathing exercise is native, not an HTML bundle, so the client
          // has nothing to run unless the author's timings and wording come with
          // the payload.
          ...(game.gameKey === TrackGameKey.BREATHING_EXERCISE
            ? { breathingExercise: game.breathingExercise }
            : {}),
        };
      }

      case TrackItemType.BUCKET_SORT: {
        const sort = item.content as BucketSortContent;
        // The key stays here. Each placement is checked one at a time (see
        // TrackBucketSortService); the item completes when all are placed.
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          bucketSort: sanitizeBucketSortForLearner(
            sort,
            progress.meta?.bucketSortAnswers,
            `${progress.id}:${progress.meta?.bucketSortRounds ?? 0}`,
          ),
          rounds: progress.meta?.bucketSortRounds ?? 0,
          bestFirstTryPct: progress.meta?.bucketSortBestFirstTryPct ?? null,
        };
      }

      case TrackItemType.BRANCHING_SCENARIO: {
        const scenario = item.content as BranchingScenarioContent;
        const completed = progress.status === SessionItemStatus.COMPLETED;
        const round = resolveBranchingRound(
          progress.meta?.branchingRoundRuns,
          scenario.settings?.maxAttempts ?? null,
          completed,
          new Date(),
        );
        /**
         * No answer key exists, so the whole scenario ships as authored. The
         * item is not completed here — it completes when a finished run is
         * recorded and clears the pass mark, if there is one (see
         * TrackBranchingService).
         */
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          intro: scenario.intro ?? null,
          startNodeId: scenario.startNodeId,
          nodes: scenario.nodes,
          passScore: scenario.settings?.passScore || null,
          maxAttempts: scenario.settings?.maxAttempts ?? null,
          attemptsUsed: round.attemptsUsed,
          exhausted: round.exhausted,
          nextRoundAt: round.nextRoundAt,
          // What they reached this round, so the "out of attempts" screen can
          // show it. Empty unless the round is exhausted.
          recap: round.exhausted ? round.runs : [],
          bestScore: progress.meta?.branchingBestScore ?? null,
          completed,
          endingsReached: progress.meta?.branchingEndingsReached ?? [],
        };
      }

      case TrackItemType.ARTICLE: {
        if (!progress.meta?.articleFirstOpenedAt) {
          await this.trackItemProgressRepository.update(progress.id, {
            meta: {
              ...(progress.meta ?? {}),
              articleFirstOpenedAt: new Date().toISOString(),
            },
          });
        }
        const article = item.content as ArticleContent;
        const questions = articleQuestionsInReadingOrder(article);
        const answered = progress.meta?.answeredArticleQuestions ?? {};
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          html: article.html,
          minReadSeconds: item.completionCriteria?.minReadSeconds ?? 0,
          questions: questions.map((question) =>
            buildArticleQuestionView(question, answered[question.id]),
          ),
          answeredQuestionCount: questions.filter(
            (question) => answered[question.id],
          ).length,
          resources: article.resources ?? [],
        };
      }

      case TrackItemType.VIDEO: {
        const video = item.content as VideoContent;
        const sourceVideo = sourceItem.content as VideoContent | undefined;
        // Interjections only ever fire on S3-hosted video — see
        // `validateInterjections` — so a non-S3 source simply carries none.
        const interjections =
          video.source === VideoSource.S3 ? (video.interjections ?? []) : [];
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          source: video.source,
          url: video.url,
          durationSeconds: video.durationSeconds ?? null,
          requiredWatchPct: item.completionCriteria?.watchPct ?? 90,
          maxWatchedPct: progress.meta?.maxWatchedPct ?? 0,
          interjections: interjections.map((interjection) => ({
            id: interjection.id,
            timestampSeconds: interjection.timestampSeconds,
            question: sanitizeQuizQuestionForLearner(interjection.question),
            answered: progress.meta?.answeredInterjections?.[interjection.id],
          })),
          /**
           * A video is a file, not text — it is only in the learner's language
           * if the trainer supplied a localised cut. `localizeItem` swaps the
           * URL when they did, so an unchanged URL means English.
           */
          languageFallbackReason:
            languageCode && video.url === sourceVideo?.url
              ? TrackTranslationFallbackReason.VIDEO_NOT_LOCALISED
              : null,
        };
      }

      case TrackItemType.JOURNAL: {
        const journal = item.content as JournalContent;
        const entries = await this.trackJournalEntryRepository.findByProgressId(
          progress.id,
        );
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          prompts: journal.prompts,
          savedResponses: entries.map((entry) => ({
            promptId: entry.promptId,
            response: entry.response,
            submittedAt: entry.submittedAt,
          })),
        };
      }

      default:
        throw new BadRequestException(`Unknown component type: ${item.type}`);
    }
  }

  /** Mark an article read; completes the item (honouring minReadSeconds). */
  async markArticleRead(trackItemId: string) {
    const { item, progress } = await this.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.ARTICLE) {
      throw new BadRequestException('This component is not an article');
    }
    /**
     * Inline questions are the point of the article that carries them: a
     * mark-as-read button that completed the item regardless would let a
     * learner scroll past every one of them and still progress, which is
     * exactly the shortcut the questions exist to close.
     */
    const unanswered = unansweredArticleQuestionCount(item, progress);
    if (unanswered > 0) {
      throw new BadRequestException(
        unanswered === 1
          ? 'Answer the question in this article before continuing.'
          : `Answer the ${unanswered} questions in this article before continuing.`,
      );
    }
    const minReadSeconds = item.completionCriteria?.minReadSeconds ?? 0;
    if (minReadSeconds > 0 && progress.meta?.articleFirstOpenedAt) {
      const openedAt = new Date(progress.meta.articleFirstOpenedAt).getTime();
      const elapsedSeconds = (Date.now() - openedAt) / 1000;
      if (elapsedSeconds < minReadSeconds) {
        throw new BadRequestException(
          'Please spend a little more time with this article before continuing.',
        );
      }
    }
    const result = await this.trackProgressService.completeItem(progress.id, {
      meta: { articleReadAt: new Date().toISOString() },
    });
    return { ...result };
  }

  /** Monotonic watch-progress reporting; completes at the required pct. */
  async reportVideoProgress(trackItemId: string, watchedPct: number) {
    if (typeof watchedPct !== 'number' || watchedPct < 0 || watchedPct > 100) {
      throw new BadRequestException('watchedPct must be between 0 and 100');
    }
    const { item, progress } = await this.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.VIDEO) {
      throw new BadRequestException('This component is not a video');
    }

    const maxWatchedPct = Math.max(
      progress.meta?.maxWatchedPct ?? 0,
      watchedPct,
    );
    await this.trackItemProgressRepository.update(progress.id, {
      meta: { ...(progress.meta ?? {}), maxWatchedPct },
    });

    const requiredPct = item.completionCriteria?.watchPct ?? 90;
    if (
      maxWatchedPct >= requiredPct &&
      progress.status !== SessionItemStatus.COMPLETED
    ) {
      const result = await this.trackProgressService.completeItem(progress.id, {
        meta: { maxWatchedPct },
      });
      return { maxWatchedPct, ...result };
    }
    return {
      maxWatchedPct,
      completed: progress.status === SessionItemStatus.COMPLETED,
      unlockedItemIds: [],
      sectionCompleted: false,
      trackCompleted: false,
    };
  }

  /**
   * Grade one video interjection answer and record it on the progress row.
   * Gates playback only — an interjection never completes or scores the
   * VIDEO item itself; that stays entirely driven by `reportVideoProgress`'s
   * watch-percentage logic.
   */
  async submitInterjectionAnswer(
    trackItemId: string,
    interjectionId: string,
    answer: QuizAnswer,
  ) {
    const { item, progress } = await this.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.VIDEO) {
      throw new BadRequestException('This component is not a video');
    }

    const video = item.content as VideoContent;
    const interjection = (video.interjections ?? []).find(
      (candidate) => candidate.id === interjectionId,
    );
    if (!interjection) {
      throw new NotFoundException('Interjection not found');
    }

    const grading = autogradeQuestion(interjection.question, answer);
    await this.trackItemProgressRepository.update(progress.id, {
      meta: {
        ...(progress.meta ?? {}),
        answeredInterjections: {
          ...(progress.meta?.answeredInterjections ?? {}),
          [interjectionId]: {
            passed: !!grading.correct,
            pointsAwarded: grading.pointsAwarded,
          },
        },
      },
    });

    return { correct: grading.correct, grading };
  }

  /**
   * Answer one inline article question. Graded on the spot against the key the
   * learner never receives, recorded on the progress row, and — unlike a video
   * interjection — counted towards completing the item: an article whose
   * questions have all been answered is finished, provided any `minReadSeconds`
   * dwell rule has also been met.
   *
   * The answer is final. Returning the correct option alongside the verdict is
   * what lets the player show *which* answer was right rather than only that
   * the learner was wrong, and it is safe precisely because the question can
   * never be answered again.
   */
  async submitArticleQuestionAnswer(
    trackItemId: string,
    questionId: string,
    selectedOptionId: string,
  ) {
    const { item, progress } = await this.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.ARTICLE) {
      throw new BadRequestException('This component is not an article');
    }

    const article = item.content as ArticleContent;
    const questions = articleQuestionsInReadingOrder(article);
    const question = questions.find((candidate) => candidate.id === questionId);
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    const answeredSoFar = progress.meta?.answeredArticleQuestions ?? {};
    if (answeredSoFar[questionId]) {
      throw new BadRequestException('You have already answered this question.');
    }

    if (!question.options.some((option) => option.id === selectedOptionId)) {
      throw new BadRequestException('Choose one of the given options.');
    }

    const grading = autogradeQuestion(question, {
      questionId,
      selectedOptionIds: [selectedOptionId],
    });
    const record: AnsweredArticleQuestion = {
      selectedOptionId,
      correct: !!grading.correct,
      answeredAt: new Date().toISOString(),
    };
    const answered = { ...answeredSoFar, [questionId]: record };
    await this.trackItemProgressRepository.update(progress.id, {
      meta: { ...(progress.meta ?? {}), answeredArticleQuestions: answered },
    });

    const answeredQuestionCount = questions.filter(
      (candidate) => answered[candidate.id],
    ).length;
    const allAnswered = answeredQuestionCount === questions.length;

    /**
     * Both gates still apply. An author who set a dwell time on an article
     * meant the reading to take that long, and answering the last question
     * early does not make that untrue — the learner finishes with the
     * mark-as-read button once the clock is satisfied, which by then is the
     * only thing left holding them.
     */
    const completion =
      allAnswered &&
      progress.status !== SessionItemStatus.COMPLETED &&
      this.hasMetArticleDwellTime(item, progress)
        ? await this.trackProgressService.completeItem(progress.id, {
            meta: {
              answeredArticleQuestions: answered,
              articleReadAt: new Date().toISOString(),
            },
          })
        : null;

    return {
      correct: record.correct,
      selectedOptionId,
      correctOptionId: question.correctOptionIds[0],
      explanation: question.explanation ?? null,
      answeredQuestionCount,
      totalQuestionCount: questions.length,
      completion,
    };
  }

  /** Whether an article's `minReadSeconds` rule (if any) is already satisfied. */
  private hasMetArticleDwellTime(
    item: TrackItem,
    progress: TrackItemProgress,
  ): boolean {
    const minReadSeconds = item.completionCriteria?.minReadSeconds ?? 0;
    if (minReadSeconds <= 0) return true;
    const openedAt = progress.meta?.articleFirstOpenedAt;
    if (!openedAt) return true;
    return (Date.now() - new Date(openedAt).getTime()) / 1000 >= minReadSeconds;
  }

  /** First non-completed unlocked item — the "continue" pointer. */
  async getNextItem(trackId: string) {
    const userId = this.requireUserId();
    const enrollment = await this.trackEnrollmentRepository.findByTrackAndUser(
      trackId,
      userId,
    );
    if (!enrollment) {
      throw new NotFoundException('You are not enrolled in this track');
    }
    const structure =
      await this.trackSharedService.getTrackWithStructure(trackId);
    const progressRows =
      await this.trackItemProgressRepository.findByEnrollmentId(enrollment.id);
    const progressByItemId = new Map(
      progressRows.map((row) => [row.trackItemId, row]),
    );

    const translation = await this.trackLocalizationService.resolvePublished(
      trackId,
      enrollment.languageCode,
    );

    for (const section of structure.sections) {
      for (const item of section.items) {
        const progress = progressByItemId.get(item.id);
        if (progress && progress.status === SessionItemStatus.UNLOCKED) {
          const localizedSection =
            this.trackLocalizationService.localizeSection(
              section as any,
              translation,
            );
          return {
            trackCompleted: false,
            nextItem: {
              ...this.toLearnerItem(
                this.trackLocalizationService.localizeItem(item, translation),
                progress,
                this.fallbackReasonFor(item, translation),
              ),
              sectionId: section.id,
              sectionTitle: localizedSection.title,
            },
          };
        }
      }
    }
    return { trackCompleted: !!enrollment.completedAt, nextItem: null };
  }

  /**
   * Shared gate for all learner item endpoints: the item must exist, the
   * caller must be enrolled, and the row must be UNLOCKED or COMPLETED.
   *
   * The returned `item` is **localised to the learner's enrolled language**.
   * Every learner content and grading path funnels through here, which is what
   * makes translation safe for assessed components: a Hindi learner's
   * fill-blank answer is compared against the Hindi `acceptedAnswers` they were
   * shown, and an open-ended answer is graded against the Hindi rubric.
   *
   * The language comes from the enrollment row, never from the request. A
   * client cannot ask to be marked in a language other than the one it
   * rendered, and it cannot dodge a translation by omitting a query param.
   *
   * `sourceItem` is the untranslated row, for callers that need the authored
   * values (nothing may write to it — item ids anchor progress rows).
   */
  async getPermittedItemProgress(trackItemId: string): Promise<{
    item: TrackItem;
    sourceItem: TrackItem;
    progress: TrackItemProgress;
    enrollment: TrackEnrollment;
    languageCode: string | null;
  }> {
    const userId = this.requireUserId();
    const item = await this.dataSource
      .getRepository(TrackItem)
      .findOne({ where: { id: trackItemId } });
    if (!item) {
      throw new NotFoundException('Track component not found');
    }
    const enrollment = await this.trackEnrollmentRepository.findByTrackAndUser(
      item.trackId,
      userId,
    );
    if (!enrollment) {
      throw new ForbiddenException('You are not enrolled in this track');
    }
    const progress = await this.trackItemProgressRepository.findOne({
      where: { trackEnrollmentId: enrollment.id, trackItemId: item.id },
    });
    if (!progress) {
      throw new NotFoundException('Track component progress not found');
    }
    if (progress.status === SessionItemStatus.LOCKED) {
      throw new BadRequestException(
        'This component is locked. Complete the previous one to unlock it.',
      );
    }

    const translation = await this.trackLocalizationService.resolvePublished(
      item.trackId,
      enrollment.languageCode,
    );

    return {
      item: this.trackLocalizationService.localizeItem(item, translation),
      sourceItem: item,
      progress,
      enrollment,
      languageCode: translation ? (enrollment.languageCode ?? null) : null,
    };
  }

  private toLearnerItem(
    item: TrackItem,
    progress?: TrackItemProgress,
    fallbackReason: TrackTranslationFallbackReason | null = null,
  ) {
    return {
      id: item.id,
      type: item.type,
      order: item.order,
      title: item.title,
      description: item.description,
      /** Non-null when this component reads in English despite the chosen
       *  language — the card shows the learner why. */
      languageFallbackReason: fallbackReason,
      scenarioId: item.scenarioId ?? null,
      caseId: item.caseId ?? null,
      completionCriteria: item.completionCriteria ?? null,
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

  /** Safe, answer-free summary of inline content for list/detail views. */
  private buildContentMeta(item: TrackItem) {
    switch (item.type) {
      case TrackItemType.QUIZ: {
        const quiz = item.content as QuizContent | undefined;
        return {
          questionCount: quiz?.questions?.length ?? 0,
          passScore: quiz?.settings?.passScore ?? null,
        };
      }
      case TrackItemType.VIDEO: {
        const video = item.content as VideoContent | undefined;
        return {
          durationSeconds: video?.durationSeconds ?? null,
          source: video?.source ?? null,
          interjectionCount: video?.interjections?.length ?? 0,
        };
      }
      case TrackItemType.ARTICLE: {
        const article = item.content as ArticleContent | undefined;
        // Count only, like the quiz's — enough for the card to say the
        // article has questions in it, with nothing about what they ask.
        return {
          questionCount: article?.questions?.length ?? 0,
          resourceCount: article?.resources?.length ?? 0,
        };
      }
      case TrackItemType.JOURNAL: {
        const journal = item.content as JournalContent | undefined;
        return { promptCount: journal?.prompts?.length ?? 0 };
      }
      case TrackItemType.GAME: {
        const game = item.content as GameContent | undefined;
        return { gameKey: game?.gameKey ?? null };
      }
      case TrackItemType.BUCKET_SORT: {
        const sort = item.content as BucketSortContent | undefined;
        return {
          bucketCount: sort?.buckets?.length ?? 0,
          itemCount: sort?.items?.length ?? 0,
        };
      }
      case TrackItemType.BRANCHING_SCENARIO: {
        const scenario = item.content as BranchingScenarioContent | undefined;
        const nodes = scenario?.nodes ?? [];
        return {
          sceneCount: nodes.length,
          endingCount: nodes.filter((n) => !n.choices?.length).length,
          passScore: scenario?.settings?.passScore || null,
          maxAttempts: scenario?.settings?.maxAttempts ?? null,
        };
      }
      case TrackItemType.ANNOTATED_ARTIFACT: {
        const annotation = item.content as AnnotationContent | undefined;
        // Deliberately no target count — see sanitizeAnnotationForLearner.
        return {
          kind: annotation?.kind ?? null,
          unitCount: annotation?.units?.length ?? 0,
          labelCount: annotation?.labels?.length ?? 0,
          passScore: annotation?.settings?.passScore ?? null,
        };
      }
      default:
        return null;
    }
  }

  private async touchEnrollment(trackEnrollmentId: string): Promise<void> {
    await this.trackEnrollmentRepository.update(trackEnrollmentId, {
      lastActivityAt: new Date(),
    });
  }

  /**
   * Both access layers for one course: assigned to the tenant at all, then
   * reachable by this learner's cohort.
   *
   * This is the single choke point for the detail view and for enrolment, which
   * is what stops a direct link from bypassing a restriction the list query
   * applies — filtering the browse list alone would only hide the course, not
   * protect it.
   *
   * The cohort half honours "finish what you started": a learner with a live
   * enrolment keeps full access even after their cohort loses it, so losing
   * access stops the next course rather than confiscating one in progress. That
   * is also why enrolment order matters in `enroll` — the already-enrolled
   * early return runs before this check, so an in-progress learner is never
   * asked the question at all.
   */
  private async assertTrackAvailable(track: TrackWithStructure): Promise<void> {
    const userId = this.requireUserId();
    const enrolment = await this.trackEnrollmentRepository.findByTrackAndUser(
      track.id,
      userId,
    );
    const denial = await this.findAccessDenial(track.id, userId, !!enrolment);
    switch (denial) {
      case TrackAccessDenialReason.NO_ORGANIZATION:
        throw new UnauthorizedException('Tenant not found');
      case TrackAccessDenialReason.NOT_IN_ORGANIZATION:
        throw new ForbiddenException(
          'This track is not available for your organization',
        );
      case TrackAccessDenialReason.NOT_IN_GROUP:
        throw new ForbiddenException(
          'This course is not available for your group',
        );
    }
  }

  /**
   * The two access layers as a value: null when the learner may take the
   * course, else the first layer that refuses them. `assertTrackAvailable`
   * turns it into an exception; `getTrackAccess` returns it.
   */
  private async findAccessDenial(
    trackId: string,
    userId: number,
    alreadyStarted: boolean,
  ): Promise<TrackAccessDenialReason | null> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      return TrackAccessDenialReason.NO_ORGANIZATION;
    }
    const tenantMapping = await this.trackTenantRepository.findOne({
      where: { trackId, tenantId },
    });
    if (!tenantMapping) {
      return TrackAccessDenialReason.NOT_IN_ORGANIZATION;
    }
    const allowed = await this.cohortVisibilityService.canAccess({
      contentType: CohortContentType.TRACK,
      contentId: trackId,
      tenantId,
      userId,
      alreadyStarted,
    });
    return allowed ? null : TrackAccessDenialReason.NOT_IN_GROUP;
  }

  private requireUserId(): number {
    const userIdStr = ExecutionManager.getUserId();
    if (!userIdStr) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return Number(userIdStr);
  }
}

/**
 * How many of an article's inline questions the learner still owes an answer
 * for. Zero for an article that carries none, which is what keeps the
 * mark-as-read path unchanged for every article authored before this existed.
 */
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

/**
 * The questions an article actually shows, in the order they are met while
 * reading — derived from the placeholders in the HTML being served rather
 * than from `content.questions` alone.
 *
 * Authoring validation keeps the two in step, so for the English source this
 * is just `content.questions` in reading order. It matters for a translated
 * article: the body HTML passes through the translator, and if a placeholder
 * did not survive that trip, a question the learner can never see must not go
 * on holding the article's completion open. Reading the served HTML makes
 * that failure lose a question instead of stranding the learner behind it.
 */
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

/**
 * One inline question as the learner receives it. Unanswered, it is stripped
 * of its answer key like any other question bound for a learner; answered, it
 * carries the verdict back so a reopened article redraws the resolved state
 * instead of offering a second go at a question that is already spent.
 */
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
