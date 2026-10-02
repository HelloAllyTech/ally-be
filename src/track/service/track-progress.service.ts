import { BadRequestException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Not } from 'typeorm';
import { SessionItemStatus } from 'src/common/type/common.type';
import { meetsMinimumScore } from 'src/common/util/progression.util';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { TrackEnrollment } from '../entity/track-enrollment.entity';
import { TrackItemProgress } from '../entity/track-item-progress.entity';
import { TrackItem } from '../entity/track-item.entity';
import { TrackSection } from '../entity/track-section.entity';
import { TrackTenant } from '../entity/track-tenant.entity';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackItemRepository } from '../repository/track-item.repository';
import { TrackQuizAttempt } from '../entity/track-quiz-attempt.entity';
import {
  TrackItemProgressMeta,
  TrackItemCompletionCriteria,
  TrackItemType,
} from '../type/track.type';
import { TrackItemCompletionCriteriaVersion } from '../entity/track-item-completion-criteria-version.entity';
import { TrackItemProgressCriteriaLock } from '../entity/track-item-progress-criteria-lock.entity';

export const TRACK_EVENTS = {
  ITEM_COMPLETED: 'track.item.completed',
  SECTION_COMPLETED: 'track.section.completed',
  TRACK_COMPLETED: 'track.completed',
} as const;

export const CASE_SESSION_COMPLETED_EVENT = 'case.session.completed';

export interface CaseSessionCompletedEvent {
  caseSessionId: string;
  userId: number;
}

export interface CompleteItemResult {
  completed: boolean;
  unlockedItemIds: string[];
  sectionCompleted: boolean;
  trackCompleted: boolean;
}

const NOOP_RESULT: CompleteItemResult = {
  completed: false,
  unlockedItemIds: [],
  sectionCompleted: false,
  trackCompleted: false,
};

/**
 * The Track 2.0 progression engine. `completeItem` is the single place any
 * component type funnels into: it marks the progress row COMPLETED, unlocks
 * the next item (crossing section boundaries), and stamps section/track
 * completion. Idempotent — re-completing a COMPLETED item is a no-op, so
 * learners can freely replay finished components.
 */
@Injectable()
export class TrackProgressService {
  private readonly logger = LoggerService.getInstance(
    TrackProgressService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: AppConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackItemRepository: TrackItemRepository,
  ) {}

  /**
   * Start-time gate for a roleplay played inside a track (called from
   * scenario-session.service validateStartScenarioSession). Throws
   * BadRequestException on any mismatch.
   */
  async validateRoleplayStart(
    trackItemProgressId: string,
    scenarioId: number,
    { userId, tenantId }: { userId: number; tenantId: string },
  ): Promise<void> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: trackItemProgressId },
    });
    if (!progress || progress.userId !== userId) {
      throw new BadRequestException('Track component progress not found');
    }
    if (progress.status === SessionItemStatus.LOCKED) {
      throw new BadRequestException('This track component is locked');
    }
    const item = await this.trackItemRepository.findOne({
      where: { id: progress.trackItemId },
    });
    if (!item || item.scenarioId !== scenarioId) {
      throw new BadRequestException(
        'Scenario does not match the track component',
      );
    }
    const trackTenant = await this.dataSource
      .getRepository(TrackTenant)
      .findOne({ where: { trackId: item.trackId, tenantId } });
    if (!trackTenant) {
      throw new BadRequestException(
        'Track is not available for your organization',
      );
    }
  }

  /**
   * The track item progress row a case session belongs to, if that case is
   * being played inside a track. Lets the case flow fall back to track-level
   * previous memory for the FIRST item of a nested case (which has no
   * within-case memory to inherit).
   */
  async getProgressIdByCaseSessionId(
    caseSessionId: string,
  ): Promise<string | null> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { caseSessionId },
    });
    return progress?.id ?? null;
  }

  /**
   * Sources of "previous memory" for a track item, most-recent-first: the
   * ROLEPLAY / CASE items that precede this one in track order, mapped to
   * this learner's progress rows. The learn side resolves each candidate to
   * an actual session memory (a candidate item may have been replayed or
   * left no memory, so callers take the first that resolves). Capped — a
   * long track only ever needs the nearest few conversation items.
   */
  async getPreviousMemoryCandidates(
    trackItemProgressId: string,
    limit = 5,
  ): Promise<Array<{ trackItemProgressId?: string; caseSessionId?: string }>> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: trackItemProgressId },
    });
    if (!progress) return [];
    const item = await this.trackItemRepository.findOne({
      where: { id: progress.trackItemId },
    });
    if (!item) return [];

    // Same ordered walk as completeItem: sections by order, items by order
    // within their section.
    const [sections, items, progressRows] = await Promise.all([
      this.dataSource.getRepository(TrackSection).find({
        where: { trackId: item.trackId },
        order: { order: 'ASC' },
      }),
      this.trackItemRepository.find({ where: { trackId: item.trackId } }),
      this.trackItemProgressRepository.find({
        where: { trackEnrollmentId: progress.trackEnrollmentId },
      }),
    ]);
    const orderedItems = sections.flatMap((section) =>
      items
        .filter((i) => i.trackSectionId === section.id)
        .sort((a, b) => a.order - b.order),
    );
    const progressByItemId = new Map(
      progressRows.map((row) => [row.trackItemId, row]),
    );

    const currentIndex = orderedItems.findIndex((i) => i.id === item.id);
    if (currentIndex <= 0) return [];

    const candidates: Array<{
      trackItemProgressId?: string;
      caseSessionId?: string;
    }> = [];
    for (let i = currentIndex - 1; i >= 0 && candidates.length < limit; i--) {
      const prev = orderedItems[i];
      const prevProgress = progressByItemId.get(prev.id);
      if (!prevProgress) continue;
      if (prev.type === TrackItemType.ROLEPLAY) {
        candidates.push({ trackItemProgressId: prevProgress.id });
      } else if (
        prev.type === TrackItemType.CASE &&
        prevProgress.caseSessionId
      ) {
        candidates.push({ caseSessionId: prevProgress.caseSessionId });
      }
    }
    return candidates;
  }

  /**
   * Roleplay played inside a track has ended. Mirrors the legacy
   * scenario-path semantics: callDuration arrives in **milliseconds**;
   * completion requires minimum duration AND (when set) minimum score.
   * A miss is not an error — the item stays UNLOCKED for a retry.
   */
  async handleRoleplayEnd({
    trackItemProgressId,
    score,
    callDuration = 0,
  }: {
    trackItemProgressId: string;
    score?: number;
    callDuration: number;
  }): Promise<CompleteItemResult> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: trackItemProgressId },
    });
    if (!progress) {
      this.logger.error(
        `Track item progress not found: ${trackItemProgressId}`,
      );
      return NOOP_RESULT;
    }
    if (progress.status === SessionItemStatus.COMPLETED) {
      return { ...NOOP_RESULT, completed: true };
    }

    await this.trackItemProgressRepository.update(progress.id, {
      attemptCount: progress.attemptCount + 1,
    });

    const item = await this.trackItemRepository.findOne({
      where: { id: progress.trackItemId },
    });
    if (!item) {
      this.logger.error(`Track item not found: ${progress.trackItemId}`);
      return NOOP_RESULT;
    }

    const effectiveCriteria = await this.getEffectiveCompletionCriteria(trackItemProgressId);

    const callDurationInSeconds = (callDuration ?? 0) / 1000;
    const minDurationSeconds =
      effectiveCriteria?.minDurationSeconds ??
      this.configService.simulationPath
        ?.simulationPathItemMinDurationForCompletion ??
      0;
    if (callDurationInSeconds < minDurationSeconds) {
      this.logger.info(
        `Track roleplay too short (${callDurationInSeconds}s < ${minDurationSeconds}s) for progress ${trackItemProgressId}`,
      );
      return NOOP_RESULT;
    }

    const minScore = effectiveCriteria?.minScore;
    if (!meetsMinimumScore(score, minScore)) {
      this.logger.info(
        `Track roleplay score ${score} below minScore ${minScore} for progress ${trackItemProgressId}`,
      );
      return NOOP_RESULT;
    }

    return this.completeItem(trackItemProgressId, { score });
  }

  /**
   * A case session finished its last roleplay (emitted from
   * case-session.service). Complete every non-completed track item progress
   * row linked to that case session — the same case can sit in several
   * tracks.
   */
  @OnEvent(CASE_SESSION_COMPLETED_EVENT)
  async handleCaseSessionCompleted(
    event: CaseSessionCompletedEvent,
  ): Promise<void> {
    try {
      const progressRows = await this.trackItemProgressRepository.find({
        where: {
          caseSessionId: event.caseSessionId,
          status: Not(SessionItemStatus.COMPLETED),
        },
      });
      for (const progress of progressRows) {
        await this.completeItem(progress.id, {});
      }
      if (progressRows.length > 0) {
        this.logger.info(
          `Case session ${event.caseSessionId} completed ${progressRows.length} track item(s)`,
        );
      }
    } catch (error) {
      // Track progression must never break the case flow.
      this.logger.error(
        `Failed to propagate case session ${event.caseSessionId} completion to tracks: ${error}`,
      );
    }
  }

  /**
   * Mark a progress row COMPLETED and advance unlock state. Transactional and
   * idempotent.
   */
  async completeItem(
    trackItemProgressId: string,
    { score, meta }: { score?: number; meta?: Partial<TrackItemProgressMeta> },
  ): Promise<CompleteItemResult> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const progressRepo = manager.getRepository(TrackItemProgress);
      const enrollmentRepo = manager.getRepository(TrackEnrollment);
      const itemRepo = manager.getRepository(TrackItem);
      const sectionRepo = manager.getRepository(TrackSection);

      const progress = await progressRepo.findOne({
        where: { id: trackItemProgressId },
      });
      if (!progress) {
        this.logger.error(
          `Track item progress not found: ${trackItemProgressId}`,
        );
        return NOOP_RESULT;
      }
      if (progress.status === SessionItemStatus.COMPLETED) {
        return { ...NOOP_RESULT, completed: true };
      }

      const enrollment = await enrollmentRepo.findOne({
        where: { id: progress.trackEnrollmentId },
      });
      if (!enrollment) {
        this.logger.error(
          `Track enrollment not found: ${progress.trackEnrollmentId}`,
        );
        return NOOP_RESULT;
      }

      const item = await itemRepo.findOne({
        where: { id: progress.trackItemId },
      });
      if (!item) {
        this.logger.error(`Track item not found: ${progress.trackItemId}`);
        return NOOP_RESULT;
      }

      const now = new Date();
      await progressRepo.update(progress.id, {
        status: SessionItemStatus.COMPLETED,
        completedAt: now,
        ...(score !== undefined ? { score } : {}),
        ...(meta ? { meta: { ...(progress.meta ?? {}), ...meta } } : {}),
      });

      const lockRepo = manager.getRepository(TrackItemProgressCriteriaLock);
      const lock = await lockRepo.findOne({ where: { trackItemProgressId: progress.id } });
      if (!lock) {
        const versionRepo = manager.getRepository(TrackItemCompletionCriteriaVersion);
        let latestVersion = await versionRepo.findOne({
          where: { trackItemId: item.id },
          order: { createdAt: 'DESC' },
        });

        if (!latestVersion) {
          // This path is taken when an item is completed against criteria that
          // have never been modified by a trainer. A version is created on the
          // fly to lock the learner's progress to the criteria they passed with.
          // The `createdById` is the learner's ID, which differs from trainer-
          // initiated versions.
          latestVersion = await versionRepo.save({
            trackItemId: item.id,
            completionCriteria: item.completionCriteria,
            createdById: progress.userId,
          });
        }
        await lockRepo.save({
          trackItemProgressId: progress.id,
          criteriaVersionId: latestVersion.id,
        });
      }

      // Ordered walk of the whole track to find what comes next.
      const [sections, items, progressRows] = await Promise.all([
        sectionRepo.find({
          where: { trackId: item.trackId },
          order: { order: 'ASC' },
        }),
        itemRepo.find({ where: { trackId: item.trackId } }),
        progressRepo.find({
          where: { trackEnrollmentId: enrollment.id },
        }),
      ]);
      const orderedItems = sections.flatMap((section) =>
        items
          .filter((i) => i.trackSectionId === section.id)
          .sort((a, b) => a.order - b.order),
      );
      const progressByItemId = new Map(
        progressRows.map((row) => [row.trackItemId, row]),
      );

      const currentIndex = orderedItems.findIndex((i) => i.id === item.id);
      const nextItem =
        currentIndex >= 0 ? orderedItems[currentIndex + 1] : undefined;

      const unlockedItemIds: string[] = [];
      if (nextItem) {
        const nextProgress = progressByItemId.get(nextItem.id);
        if (nextProgress && nextProgress.status === SessionItemStatus.LOCKED) {
          await progressRepo.update(nextProgress.id, {
            status: SessionItemStatus.UNLOCKED,
          });
          unlockedItemIds.push(nextItem.id);
        } else if (!nextProgress) {
          // Defensive backfill — enrollment normally creates all rows upfront.
          const created = await progressRepo.save(
            progressRepo.create({
              trackEnrollmentId: enrollment.id,
              trackItemId: nextItem.id,
              userId: enrollment.userId,
              status: SessionItemStatus.UNLOCKED,
            }),
          );
          progressByItemId.set(nextItem.id, created);
          unlockedItemIds.push(nextItem.id);
        }
      }

      // Section completed = every item in the current section is COMPLETED
      // (counting the row we just flipped).
      const sectionItems = items.filter(
        (i) => i.trackSectionId === item.trackSectionId,
      );
      const sectionCompleted = sectionItems.every((sectionItem) => {
        if (sectionItem.id === item.id) return true;
        return (
          progressByItemId.get(sectionItem.id)?.status ===
          SessionItemStatus.COMPLETED
        );
      });

      const trackCompleted = !nextItem;
      await enrollmentRepo.update(enrollment.id, {
        completedItems: (enrollment.completedItems ?? 0) + 1,
        lastActivityAt: now,
        ...(trackCompleted ? { completedAt: now } : {}),
      });

      this.emitProgressEvents({
        enrollment,
        item,
        sectionCompleted,
        trackCompleted,
      });

      return {
        completed: true,
        unlockedItemIds,
        sectionCompleted,
        trackCompleted,
      };
    });
  }

  /** Best-effort in-process events — the future badge/analytics seam. */
  private emitProgressEvents({
    enrollment,
    item,
    sectionCompleted,
    trackCompleted,
  }: {
    enrollment: TrackEnrollment;
    item: TrackItem;
    sectionCompleted: boolean;
    trackCompleted: boolean;
  }): void {
    try {
      const base = {
        userId: enrollment.userId,
        tenantId: enrollment.tenantId,
        trackId: item.trackId,
        trackEnrollmentId: enrollment.id,
        trackItemId: item.id,
        trackSectionId: item.trackSectionId,
        itemType: item.type,
      };
      this.eventEmitter.emit(TRACK_EVENTS.ITEM_COMPLETED, base);
      if (sectionCompleted) {
        this.eventEmitter.emit(TRACK_EVENTS.SECTION_COMPLETED, base);
      }
      if (trackCompleted) {
        this.eventEmitter.emit(TRACK_EVENTS.TRACK_COMPLETED, base);
      }
    } catch (error) {
      this.logger.error(`Failed to emit track progress events: ${error}`);
    }
  }

  async getCompletedLearnerCount(
    trackItemId: string,
  ): Promise<{ count: number }> {
    const count =
      await this.trackItemProgressRepository.countUsersCompletedByTrackItem(
        trackItemId,
      );
    return { count };
  }

  async reevaluateProgress(trackEnrollmentId: string): Promise<void> {
    const progressRepo = this.dataSource.getRepository(TrackItemProgress);
    const itemRepo = this.dataSource.getRepository(TrackItem);
    const quizAttemptRepo = this.dataSource.getRepository(TrackQuizAttempt);

    const progressRows = await progressRepo.find({
      where: {
        trackEnrollmentId,
        status: Not(SessionItemStatus.COMPLETED),
      },
    });

    for (const progress of progressRows) {
      const item = await itemRepo.findOne({ where: { id: progress.trackItemId } });
      if (!item) continue;

      const effectiveCriteria = await this.getEffectiveCompletionCriteria(
        progress.id,
      );

      if (!effectiveCriteria) continue;

      let shouldComplete = false;
      if (item.type === TrackItemType.QUIZ) {
        const lastAttempt = await quizAttemptRepo.findOne({
          where: { trackItemProgressId: progress.id },
          order: { attemptNumber: 'DESC' },
        });
        if (
          lastAttempt &&
          meetsMinimumScore(lastAttempt.scorePct, effectiveCriteria.passScore)
        ) {
          shouldComplete = true;
        }
      } else if (item.type === TrackItemType.ROLEPLAY) {
        if (meetsMinimumScore(progress.score, effectiveCriteria.minScore)) {
          shouldComplete = true;
        }
      } else if (item.type === TrackItemType.VIDEO) {
        const watchPct = (progress.meta as TrackItemProgressMeta)?.watchPct ?? 0;
        if (watchPct >= (effectiveCriteria.watchPct ?? 101)) {
          shouldComplete = true;
        }
      }

      if (shouldComplete) {
        await this.completeItem(progress.id, {});
      }
    }
  }

  private async getEffectiveCompletionCriteria(
    trackItemProgressId: string,
    manager?: EntityManager,
  ): Promise<TrackItemCompletionCriteria | null> {
    const repositoryProvider = manager || this.dataSource;
    const lockRepo = repositoryProvider.getRepository(TrackItemProgressCriteriaLock);
    const versionRepo = repositoryProvider.getRepository(TrackItemCompletionCriteriaVersion);
    const itemRepo = repositoryProvider.getRepository(TrackItem);
    const progressRepo = repositoryProvider.getRepository(TrackItemProgress);

    const progress = await progressRepo.findOne({ where: { id: trackItemProgressId } });
    if (!progress) return null;

    const lock = await lockRepo.findOne({ where: { trackItemProgressId } });
    if (lock) {
      const version = await versionRepo.findOne({ where: { id: lock.criteriaVersionId } });
      return version?.completionCriteria ?? null;
    }

    const item = await itemRepo.findOne({ where: { id: progress.trackItemId } });
    return item?.completionCriteria ?? null;
  }
}
