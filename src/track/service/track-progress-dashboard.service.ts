import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollmentRepository } from '../repository/track-enrollment.repository';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import {
  RoleplayFeedbackRow,
  TrackProgressDashboardRepository,
} from '../repository/track-progress-dashboard.repository';
import { TrackSharedService } from './track-shared.service';
import {
  TRACK_PROGRESS_MIN_SKILL_SAMPLE,
  TRACK_PROGRESS_SKILL_DEMONSTRATED_PCT,
} from '../constants/track.constant';
import {
  SkillFeedbackClassification,
  TrackProgressDashboard,
  TrackSkillCategoryFeedback,
} from '../type/track-progress-dashboard.type';

/**
 * A learner's progress-and-feedback dashboard for one course: percent
 * complete plus consolidated skill feedback across every ROLEPLAY session
 * evaluated so far. A new sibling to TrackEnrollmentService rather than a
 * method on it — the track module already splits by concern
 * (TrackProgressService, TrackQuizService, TrackJournalService,
 * TrackAnnotationService, TrackGameService, TrackEnrollmentService), and this
 * is a distinct read-model composition, not enrollment/progression logic.
 */
@Injectable()
export class TrackProgressDashboardService {
  constructor(
    private readonly trackEnrollmentRepository: TrackEnrollmentRepository,
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackSharedService: TrackSharedService,
    private readonly trackProgressDashboardRepository: TrackProgressDashboardRepository,
  ) {}

  async getDashboard(trackId: string): Promise<TrackProgressDashboard> {
    const userId = this.requireUserId();
    const structure =
      await this.trackSharedService.getTrackWithStructure(trackId);

    // Unlike getTrackDetailForLearner, which lets a non-enrolled learner
    // browse a course, progress with no enrollment is meaningless — always
    // require it here.
    const enrollment = await this.trackEnrollmentRepository.findByTrackAndUser(
      trackId,
      userId,
    );
    if (!enrollment) {
      throw new ForbiddenException('You are not enrolled in this track');
    }

    const progressRows =
      await this.trackItemProgressRepository.findByEnrollmentId(enrollment.id);
    const progressByItemId = new Map(
      progressRows.map((row) => [row.trackItemId, row]),
    );

    const sections = structure.sections.map((section) => {
      const totalItems = section.items.length;
      const completedItems = section.items.filter(
        (item) =>
          progressByItemId.get(item.id)?.status === SessionItemStatus.COMPLETED,
      ).length;
      return {
        id: section.id,
        title: section.title,
        order: section.order,
        completedItems,
        totalItems,
      };
    });

    const roleplayRows =
      await this.trackProgressDashboardRepository.getRoleplayFeedback(
        enrollment.id,
      );

    const evaluatedScores = roleplayRows
      .map((row) => row.compositeScore)
      .filter((score): score is number => score !== null);

    return {
      trackId: structure.id,
      title: structure.title,
      trackEnrollmentId: enrollment.id,
      totalItems: structure.totalItems,
      completedItems: enrollment.completedItems,
      completionPct:
        structure.totalItems > 0
          ? Math.round((enrollment.completedItems / structure.totalItems) * 100)
          : 0,
      startedAt: enrollment.startedAt?.toISOString() ?? null,
      completedAt: enrollment.completedAt?.toISOString() ?? null,
      lastActivityAt: enrollment.lastActivityAt?.toISOString() ?? null,
      sections,
      evaluatedRoleplaySessionCount: roleplayRows.length,
      averageCompositeScore: evaluatedScores.length
        ? Math.round(
            evaluatedScores.reduce((sum, score) => sum + score, 0) /
              evaluatedScores.length,
          )
        : null,
      skillCategories: this.aggregateSkillCategories(roleplayRows),
      roleplaySessions: roleplayRows.map((row) => ({
        trackItemId: row.trackItemId,
        trackItemTitle: row.trackItemTitle,
        scenarioSessionId: row.scenarioSessionId,
        compositeScore: row.compositeScore,
        occurredAt: row.occurredAt,
        evaluationMarkdown: row.evaluationMarkdown,
      })),
    };
  }

  /**
   * Groups by the raw category string (both skillCoverage label generations
   * can appear — see TrackProgressDashboardRepository), averages the
   * percentage per category, and classifies per TRACK_PROGRESS_MIN_SKILL_SAMPLE
   * / TRACK_PROGRESS_SKILL_DEMONSTRATED_PCT. Order is first-seen across
   * sessions (oldest first) — no hardcoded canonical ordering, since a
   * fixed 3-category grid would falsely imply every tenant's data uses the
   * current label generation.
   */
  private aggregateSkillCategories(
    rows: RoleplayFeedbackRow[],
  ): TrackSkillCategoryFeedback[] {
    const byCategory = new Map<string, { sum: number; count: number }>();
    for (const row of rows) {
      for (const entry of row.skillCoverage ?? []) {
        const bucket = byCategory.get(entry.category) ?? { sum: 0, count: 0 };
        bucket.sum += entry.percentage;
        bucket.count += 1;
        byCategory.set(entry.category, bucket);
      }
    }

    return Array.from(byCategory.entries()).map(
      ([category, { sum, count }]) => {
        const averagePercentage = Math.round(sum / count);
        const classification: SkillFeedbackClassification =
          count < TRACK_PROGRESS_MIN_SKILL_SAMPLE
            ? 'insufficient_data'
            : averagePercentage >= TRACK_PROGRESS_SKILL_DEMONSTRATED_PCT
              ? 'demonstrated'
              : 'needs_practice';
        return {
          category,
          averagePercentage,
          sampleSize: count,
          classification,
        };
      },
    );
  }

  private requireUserId(): number {
    const userIdStr = ExecutionManager.getUserId();
    if (!userIdStr) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return Number(userIdStr);
  }
}
