import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ScenarioSessionLeaderboardEndedEventParams,
  ScenarioSessionLeaderboardEvent,
} from 'src/learn/type/scenario-session-leaderboard-event.type';
import { TRACK_EVENTS } from 'src/track/service/track-progress.service';
import { XpAwardService } from '../service/xp-award.service';

interface TrackItemCompletedEvent {
  userId: number;
  tenantId: string;
  trackItemId: string;
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
   * connection that row may not be committed yet.
   */
  @OnEvent(TRACK_EVENTS.ITEM_COMPLETED, { async: true })
  async handleTrackItemCompleted(
    event: TrackItemCompletedEvent,
  ): Promise<void> {
    await this.xpAwardService.awardForTrackItem({
      userId: event.userId,
      tenantId: event.tenantId,
      trackItemId: event.trackItemId,
    });
  }
}
