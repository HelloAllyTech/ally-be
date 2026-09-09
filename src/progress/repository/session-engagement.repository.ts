import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Reads the engagement signal for a finished roleplay session.
 *
 * Queries `scenario_session_messages` directly rather than going through LearnModule.
 * ProgressModule is deliberately a leaf — nothing here is imported by the modules it
 * reacts to — and injecting a learn service to read one count would put a forwardRef
 * back in. `ProgressTenantResolver` reads `tenants` the same way for the same reason.
 */
@Injectable()
export class SessionEngagementRepository {
  private readonly logger = new Logger(SessionEngagementRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * How many turns the learner took in a session.
   *
   * `senderId` carries the speaker: the agent's messages are written as -1 and the
   * learner's as their own positive user id (see `scenario_session_messages`), so
   * `> 0` is the learner's side of the transcript.
   *
   * Returns 0 when the count cannot be read. That fails the engagement gate and costs
   * the learner the award, which is the wrong way round — but the alternative, treating
   * an unreadable transcript as engaged, would make the gate trivially bypassable by
   * anything that stops messages being written.
   */
  async countLearnerTurns(scenarioSessionId: string): Promise<number> {
    try {
      const rows: { count: string }[] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM "scenario_session_messages" ` +
          `WHERE "scenarioSessionId" = $1 AND "senderId" > 0`,
        [scenarioSessionId],
      );
      return Number(rows[0]?.count ?? 0);
    } catch (error) {
      this.logger.error(
        `Failed to count learner turns for session ${scenarioSessionId}: ${error}`,
      );
      return 0;
    }
  }
}
