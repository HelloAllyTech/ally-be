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
import {
  ArticleContent,
  JournalContent,
  TrackItemType,
  TrackStatus,
  VideoContent,
} from '../type/track.type';
import { QuizContent } from '../type/quiz.type';
import { TrackSharedService, TrackWithStructure } from './track-shared.service';
import { TrackProgressService } from './track-progress.service';
import { sanitizeQuizForLearner } from './track-quiz.sanitizer';

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
    private readonly trackSharedService: TrackSharedService,
    private readonly trackProgressService: TrackProgressService,
    private readonly caseSessionService: CaseSessionService,
  ) {}

  async getTracksForLearner(options: {
    limit?: number;
    offset?: number;
    languageCode?: string;
  }) {
    const userId = this.requireUserId();
    const tenantId = ExecutionManager.getTenantId();
    const result = await this.trackRepository.getTracksForLearner({
      userId,
      tenantId,
      limit: options.limit,
      offset: options.offset,
    });

    return {
      data: result.data.map((track) => {
        const translated = this.applyTranslation(track, options.languageCode);
        return {
          id: track.id,
          title: translated.title,
          description: translated.description,
          coverImageUrl: track.coverImageUrl,
          totalItems: track.totalItems,
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

    const translated = this.applyTranslation(structure, languageCode);
    return {
      id: structure.id,
      title: translated.title,
      description: translated.description,
      coverImageUrl: structure.coverImageUrl,
      status: structure.status,
      totalItems: structure.totalItems,
      estimatedDurationMinutes: structure.estimatedDurationMinutes,
      enrolled: !!enrollment,
      trackEnrollmentId: enrollment?.id ?? null,
      completedItems: enrollment?.completedItems ?? 0,
      completedAt: enrollment?.completedAt ?? null,
      sections: structure.sections.map((section) => ({
        id: section.id,
        title: section.title,
        description: section.description,
        order: section.order,
        items: section.items.map((item) =>
          this.toLearnerItem(item, progressByItemId.get(item.id)),
        ),
      })),
    };
  }

  /** Idempotent enrollment: creates the enrollment + ALL progress rows. */
  async enroll(trackId: string) {
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

    const enrollmentId = await this.dataSource.transaction(async (manager) => {
      const enrollmentRepo = manager.getRepository(TrackEnrollment);
      const progressRepo = manager.getRepository(TrackItemProgress);
      const enrollment = await enrollmentRepo.save({
        trackId,
        userId,
        tenantId,
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
    const { item, progress } = await this.getPermittedItemProgress(trackItemId);

    if (!progress.startedAt) {
      await this.trackItemProgressRepository.update(progress.id, {
        startedAt: new Date(),
      });
    }
    await this.touchEnrollment(progress.trackEnrollmentId);

    switch (item.type) {
      case TrackItemType.ROLEPLAY:
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          scenarioId: item.scenarioId,
          completionCriteria: item.completionCriteria ?? null,
        };

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
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          html: article.html,
          minReadSeconds: item.completionCriteria?.minReadSeconds ?? 0,
        };
      }

      case TrackItemType.VIDEO: {
        const video = item.content as VideoContent;
        return {
          type: item.type,
          trackItemProgressId: progress.id,
          source: video.source,
          url: video.url,
          durationSeconds: video.durationSeconds ?? null,
          requiredWatchPct: item.completionCriteria?.watchPct ?? 90,
          maxWatchedPct: progress.meta?.maxWatchedPct ?? 0,
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

    for (const section of structure.sections) {
      for (const item of section.items) {
        const progress = progressByItemId.get(item.id);
        if (progress && progress.status === SessionItemStatus.UNLOCKED) {
          return {
            trackCompleted: false,
            nextItem: {
              ...this.toLearnerItem(item, progress),
              sectionId: section.id,
              sectionTitle: section.title,
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
   */
  async getPermittedItemProgress(trackItemId: string): Promise<{
    item: TrackItem;
    progress: TrackItemProgress;
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
    return { item, progress };
  }

  private toLearnerItem(item: TrackItem, progress?: TrackItemProgress) {
    return {
      id: item.id,
      type: item.type,
      order: item.order,
      title: item.title,
      description: item.description,
      scenarioId: item.scenarioId ?? null,
      caseId: item.caseId ?? null,
      completionCriteria: item.completionCriteria ?? null,
      contentMeta: this.buildContentMeta(item),
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
        };
      }
      case TrackItemType.JOURNAL: {
        const journal = item.content as JournalContent | undefined;
        return { promptCount: journal?.prompts?.length ?? 0 };
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

  private async assertTrackAvailable(track: TrackWithStructure): Promise<void> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new UnauthorizedException('Tenant not found');
    }
    const tenantMapping = await this.trackTenantRepository.findOne({
      where: { trackId: track.id, tenantId },
    });
    if (!tenantMapping) {
      throw new ForbiddenException(
        'This track is not available for your organization',
      );
    }
  }

  private applyTranslation(
    entity: { title?: string; description?: string; translations?: any },
    languageCode?: string,
  ): { title?: string; description?: string } {
    if (!languageCode || !entity.translations?.[languageCode]) {
      return { title: entity.title, description: entity.description };
    }
    const translation = entity.translations[languageCode];
    return {
      title: translation.title ?? entity.title,
      description: translation.description ?? entity.description,
    };
  }

  private requireUserId(): number {
    const userIdStr = ExecutionManager.getUserId();
    if (!userIdStr) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return Number(userIdStr);
  }
}
