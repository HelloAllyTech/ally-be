import { BadRequestException, Injectable } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { TrackItemType } from '../type/track.type';
import { AnnotationContent, AnnotationMark } from '../type/annotation.type';
import { TrackAnnotationAttempt } from '../entity/track-annotation-attempt.entity';
import { TrackAnnotationAttemptRepository } from '../repository/track-annotation-attempt.repository';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackEnrollmentService } from './track-enrollment.service';
import { TrackProgressService } from './track-progress.service';
import { annotationScorePct, gradeAnnotation } from './track-annotation.grader';
import {
  AnnotationAttemptView,
  buildAnnotationAttemptView,
} from './track-annotation.sanitizer';

export interface AnnotationAttemptResult extends AnnotationAttemptView {
  itemCompleted: boolean;
  unlockedItemIds: string[];
  sectionCompleted: boolean;
  trackCompleted: boolean;
}

@Injectable()
export class TrackAnnotationService {
  private readonly logger = LoggerService.getInstance(
    TrackAnnotationService.name,
  );

  constructor(
    private readonly trackAnnotationAttemptRepository: TrackAnnotationAttemptRepository,
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackEnrollmentService: TrackEnrollmentService,
    private readonly trackProgressService: TrackProgressService,
  ) {}

  /**
   * Grade a submitted set of marks. Grading is pure and synchronous — no LLM,
   * so unlike the quiz path there is no PENDING_GRADING state and nothing to
   * regrade.
   */
  async submitAttempt(
    trackItemId: string,
    marks: AnnotationMark[],
  ): Promise<AnnotationAttemptResult> {
    const { item, progress } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.ANNOTATED_ARTIFACT) {
      throw new BadRequestException('This component is not an annotation');
    }
    const content = item.content as AnnotationContent;

    const attemptsUsed =
      await this.trackAnnotationAttemptRepository.countByProgressId(
        progress.id,
      );
    const maxAttempts = content.settings.maxAttempts ?? null;
    if (maxAttempts !== null && attemptsUsed >= maxAttempts) {
      throw new BadRequestException(
        'You have used all attempts for this annotation.',
      );
    }

    // An empty submission is a misunderstanding, not an answer — the player
    // blocks it too, but a direct API call must not burn an attempt on it.
    if (!marks.length) {
      throw new BadRequestException(
        'Mark at least one line before submitting.',
      );
    }
    this.assertMarksResolve(content, marks);

    const grading = gradeAnnotation(content, marks);
    const scorePct = annotationScorePct(grading);
    const passed = scorePct >= content.settings.passScore;

    const attempt = (await this.trackAnnotationAttemptRepository.save({
      trackItemProgressId: progress.id,
      trackItemId: item.id,
      userId: progress.userId,
      attemptNumber: attemptsUsed + 1,
      marks,
      grading,
      scorePct,
      passed,
      submittedAt: new Date(),
    } as Partial<TrackAnnotationAttempt>)) as TrackAnnotationAttempt;

    await this.trackItemProgressRepository.update(progress.id, {
      attemptCount: attemptsUsed + 1,
    });

    this.logger.info(
      `[TRACK_ANNOTATION] graded item=${item.id} attempt=${attempt.attemptNumber} ` +
        `score=${scorePct}% found=${grading.found} missed=${grading.missed} ` +
        `notHere=${grading.notHere}`,
    );

    // Completing is idempotent, so a learner replaying a finished component
    // and passing again is a no-op.
    let completion = {
      completed: false,
      unlockedItemIds: [] as string[],
      sectionCompleted: false,
      trackCompleted: false,
    };
    if (passed) {
      completion = await this.trackProgressService.completeItem(progress.id, {
        score: scorePct,
      });
    }
    const refreshed = await this.trackItemProgressRepository.findOne({
      where: { id: progress.id },
    });

    return {
      ...buildAnnotationAttemptView(attempt, content, attemptsUsed + 1),
      itemCompleted:
        completion.completed ||
        refreshed?.status === SessionItemStatus.COMPLETED,
      unlockedItemIds: completion.unlockedItemIds,
      sectionCompleted: completion.sectionCompleted,
      trackCompleted: completion.trackCompleted,
    };
  }

  /**
   * Marks must resolve against the artifact the learner was served. An
   * unresolvable id means the client and the item have diverged (a stale tab
   * across a content edit), and silently dropping it would score the learner
   * on something other than what they saw.
   */
  private assertMarksResolve(
    content: AnnotationContent,
    marks: AnnotationMark[],
  ): void {
    const unitIds = new Set(content.units.map((unit) => unit.id));
    const labelIds = new Set(content.labels.map((label) => label.id));
    for (const mark of marks) {
      if (!unitIds.has(mark.unitId)) {
        throw new BadRequestException(
          `Mark references unknown line: ${mark.unitId}`,
        );
      }
      if (!labelIds.has(mark.labelId)) {
        throw new BadRequestException(
          `Mark references unknown label: ${mark.labelId}`,
        );
      }
    }
  }
}
