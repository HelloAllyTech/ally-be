import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioEvaluationMemoryUpdate } from 'src/ai/dto/ai.response.dto';
import { LearnerSupervisorMemory } from '../entity/learner-supervisor-memory.entity';

/** How many past sessions the trail keeps. See `recordFromEvaluation`. */
const MAX_RECENT_SESSIONS = 5;

/**
 * The AI supervisor's memory of one LEARNER, carried from debrief to debrief.
 *
 * Read before an evaluation (to give the note its continuity callback) and
 * written after one. Deliberately never throws into the caller: a debrief that
 * loses its callback is a smaller failure than a session that ends with no
 * feedback at all, so every path here degrades to "no memory" and logs.
 */
@Injectable()
export class LearnerSupervisorMemoryService {
  private logger = LoggerService.getInstance(
    LearnerSupervisorMemoryService.name,
  );

  constructor(
    @InjectRepository(LearnerSupervisorMemory)
    private readonly repository: Repository<LearnerSupervisorMemory>,
  ) {}

  /**
   * Render this learner's stored memory as the prose block ally-ai injects into
   * the supervisor prompt. Returns null when there is nothing to say, which the
   * prompt turns into "No previous sessions with this learner yet." — the model
   * is then explicitly told not to imply it has met them before.
   */
  async getSupervisorMemoryPrompt(
    counselorId: number,
    tenantId: string,
  ): Promise<string | null> {
    try {
      const row = await this.repository.findOne({
        where: { counselorId, tenantId },
      });
      if (!row?.memory) return null;

      const {
        focusAreas,
        trajectory,
        nextTime,
        recentSessions,
        totalSessions,
      } = row.memory;
      const lines: string[] = [];

      if (Array.isArray(focusAreas) && focusAreas.length) {
        lines.push(`Currently working on: ${focusAreas.join('; ')}`);
      }
      if (typeof trajectory === 'string' && trajectory.trim()) {
        lines.push(`How they are developing: ${trajectory.trim()}`);
      }
      if (typeof nextTime === 'string' && nextTime.trim()) {
        lines.push(
          `What you asked them to try after their last session: ${nextTime.trim()}`,
        );
      }
      // `totalSessions` is the running count; `recentSessions.length` is only
      // a fallback for rows written before that counter existed.
      const sessionCount =
        typeof totalSessions === 'number'
          ? totalSessions
          : Array.isArray(recentSessions)
            ? recentSessions.length
            : 0;
      if (sessionCount > 0) {
        lines.push(`Sessions debriefed with them so far: ${sessionCount}`);
      }

      return lines.length ? lines.join('\n') : null;
    } catch (error) {
      this.logger.error(
        `getSupervisorMemoryPrompt failed for counselor ${counselorId}: ${error?.message}`,
      );
      return null;
    }
  }

  /**
   * Persist what the supervisor carries forward after a debrief.
   *
   * Upserts onto the (counselorId, tenant_id) unique index, so two sessions
   * ending at once resolve to last-write-wins rather than forking the learner
   * into two memories.
   *
   * The `recentSessions` trail is capped at MAX_RECENT_SESSIONS: it exists only
   * so the note can say how far along someone is, and an unbounded list of
   * session ids on a row read before every evaluation would grow without ever
   * being useful.
   */
  async recordFromEvaluation(
    counselorId: number,
    tenantId: string,
    scenarioSessionId: string,
    memoryUpdate?: ScenarioEvaluationMemoryUpdate | null,
  ): Promise<void> {
    if (!memoryUpdate) return;

    try {
      const existing = await this.repository.findOne({
        where: { counselorId, tenantId },
      });

      const previousTrail = Array.isArray(existing?.memory?.recentSessions)
        ? existing.memory.recentSessions
        : [];
      const isRedelivery = previousTrail.some(
        (entry: any) => entry?.scenarioSessionId === scenarioSessionId,
      );
      // Guard against a redelivered end-of-session event stacking the same
      // session onto the trail twice.
      const trail = [
        { scenarioSessionId, at: new Date().toISOString() },
        ...previousTrail.filter(
          (entry: any) => entry?.scenarioSessionId !== scenarioSessionId,
        ),
      ].slice(0, MAX_RECENT_SESSIONS);

      // The trail above is a shallow, capped preview; this counter is the
      // uncapped running total the debrief note reports to the learner.
      const previousTotal =
        typeof existing?.memory?.totalSessions === 'number'
          ? existing.memory.totalSessions
          : previousTrail.length;
      const totalSessions = isRedelivery ? previousTotal : previousTotal + 1;

      await this.repository.upsert(
        {
          counselorId,
          tenantId,
          lastScenarioSessionId: scenarioSessionId,
          memory: {
            focusAreas: Array.isArray(memoryUpdate.focus_areas)
              ? memoryUpdate.focus_areas
              : [],
            trajectory: memoryUpdate.trajectory ?? '',
            nextTime: memoryUpdate.next_time ?? '',
            recentSessions: trail,
            totalSessions,
          } as Record<string, any>,
        },
        { conflictPaths: ['counselorId', 'tenantId'] },
      );
    } catch (error) {
      this.logger.error(
        `recordFromEvaluation failed for counselor ${counselorId}, session ${scenarioSessionId}: ${error?.message}`,
      );
    }
  }
}
