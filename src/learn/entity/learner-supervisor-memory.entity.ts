import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * What the AI supervisor carries about ONE LEARNER from debrief to debrief.
 *
 * Not to be confused with the two memories that already existed, both of which
 * are about the *client* and live on `scenario_session_details`:
 *  - `sessionMemory` — the live agent's rolling conversation summary;
 *  - `summary.feedback.cumulativeMemory` — the case's therapeutic narrative.
 *
 * This one is about the practitioner: what they are working on, how they are
 * developing, and what they were asked to try next. It follows the learner
 * across every case and scenario, which is what lets a debrief open with
 * "last time we talked about leaving more silence — you did that twice today".
 *
 * One live row per learner per tenant, rewritten after each evaluated session.
 * History is deliberately not kept: the supervisor needs what is true now, and
 * an unbounded per-learner LLM-written log is a retention liability nobody has
 * scoped. `recentSessions` inside the payload keeps the shallow trail the note
 * actually uses.
 */
@Index(
  'learner_supervisor_memory_counselor_tenant_idx',
  ['counselorId', 'tenantId'],
  { unique: true },
)
@Entity('learner_supervisor_memory')
export class LearnerSupervisorMemory extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** `users.id` of the learner this memory belongs to. */
  @Column({ type: 'int' })
  counselorId!: number;

  /**
   * {
   *   focusAreas: string[],        // 1-3 skills actively being worked on
   *   trajectory: string,          // how they're developing across sessions
   *   nextTime: string,            // the one thing they were asked to try
   *   recentSessions: [{ scenarioSessionId, at }],  // shallow trail, newest first, capped
   *   totalSessions: number,       // uncapped running count of debriefed sessions
   * }
   */
  @Column({ type: 'jsonb' })
  memory!: Record<string, any>;

  /** The session whose debrief last wrote this row; for support and debugging. */
  @Column({ type: 'uuid', nullable: true })
  lastScenarioSessionId?: string;
}
