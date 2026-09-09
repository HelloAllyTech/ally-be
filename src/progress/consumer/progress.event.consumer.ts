import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ScenarioSessionLeaderboardEndedEventParams,
  ScenarioSessionLeaderboardEvent,
} from 'src/learn/type/scenario-session-leaderboard-event.type';
import { TRACK_EVENTS } from 'src/track/service/track-progress.service';
import {
  DebriefEngagementEvent,
  DebriefThreadQualifiedEventParams,
} from 'src/learn/type/debrief-engagement-event.type';
import {
  ReviewCommentAddedEventParams,
  ScenarioSessionReviewEvents,
} from 'src/review/type/review-event.type';
import { isSubstantivePeerComment } from '../progress.constants';
import { XpAwardService } from '../service/xp-award.service';

interface TrackItemCompletedEvent {
  userId: number;
  tenantId: string;
  trackItemId: string;
  /** One of TrackItemType — sets the item's XP weight. */
  itemType?: string;
}

@Injectable()
export class ProgressEventConsumer {
  constructor(private readonly xpAwardService: XpAwardService) {}

  /**
   * Session XP rides the event the leaderboard already uses rather than a direct call
   * into the end-of-session writer.
   *
   * Two things fall out of that. The emit only happens after a caller has won the
   * IN_PROGRESS -> COMPLETED compare-and-set, so XP inherits the same single-winner
   * guarantee that stops the minutes being counted twice. And the sweeper that recovers
   * unfinalised sessions emits it too, so a session whose score never arrived still
   * earns its practice XP without a second hook.
   */
  @OnEvent(ScenarioSessionLeaderboardEvent.SCENARIO_SESSION_ENDED, {
    async: true,
  })
  async handleScenarioSessionEnded(
    event: ScenarioSessionLeaderboardEndedEventParams,
  ): Promise<void> {
    await this.xpAwardService.awardForSession({
      userId: event.userId,
      tenantId: event.tenantId,
      scenarioSessionId: event.scenarioSessionId,
      durationMs: event.durationMinutes * 60 * 1000,
      endedAt: event.date,
    });
  }

  /**
   * Track items award XP off the existing progress event rather than by editing
   * `completeItem`, so every component type — quiz, annotation, journal, video,
   * reading, roleplay — is covered by one listener.
   *
   * The emit happens inside `completeItem`'s transaction, so this handler uses only
   * what the payload carries and never re-reads the progress row: from another
   * connection that row may not be committed yet. `itemType` is on the payload already,
   * which is what lets the award be weighted without touching the emitter.
   */
  @OnEvent(TRACK_EVENTS.ITEM_COMPLETED, { async: true })
  async handleTrackItemCompleted(
    event: TrackItemCompletedEvent,
  ): Promise<void> {
    await this.xpAwardService.awardForTrackItem({
      userId: event.userId,
      tenantId: event.tenantId,
      trackItemId: event.trackItemId,
      itemType: event.itemType,
    });
  }

  /**
   * A debrief conversation that reached the substance floor.
   *
   * The floor is applied by the emitter, which has the thread in hand. This listener's
   * only job is to pay for it, at most once per session.
   */
  @OnEvent(DebriefEngagementEvent.THREAD_QUALIFIED, { async: true })
  async handleDebriefThreadQualified(
    event: DebriefThreadQualifiedEventParams,
  ): Promise<void> {
    await this.xpAwardService.awardForDebriefThread({
      userId: event.userId,
      tenantId: event.tenantId,
      scenarioSessionId: event.scenarioSessionId,
    });
  }

  /**
   * A comment on a peer's session review.
   *
   * Two things are refused here rather than in the award service, because both are
   * about what the comment *is* rather than what it is worth. Commenting on your own
   * review earns nothing — the community consumer has always taken the same line — and
   * a comment below the substance floor earns nothing, which is what keeps the softest
   * signal in the model from being the cheapest to farm. Reactions never earn XP at
   * all, so they have no listener here.
   */
  @OnEvent(ScenarioSessionReviewEvents.COMMENT_ADDED, { async: true })
  async handleReviewCommentAdded({
    review,
    comment,
  }: ReviewCommentAddedEventParams): Promise<void> {
    if (review.createdBy === comment.createdBy) return;
    if (!isSubstantivePeerComment(comment.content)) return;

    await this.xpAwardService.awardForPeerComment({
      userId: comment.createdBy,
      tenantId: comment.tenantId,
      commentId: comment.id,
    });
  }
}
