import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderSteerStatus } from '../enum/builder.enum';

/**
 * A course correction an admin sent to a build already in flight.
 *
 * The inverse of `builder_questions`. That table is the agent asking a person
 * and stopping until it is answered; this one is a person telling the agent
 * something it did not ask for and did not stop for. Until now the only way to
 * redirect a build going the wrong way was to cancel it — which discards the
 * working tree, every dollar spent, and starts again from the PRD. A note that
 * reaches the next phase costs nothing and saves all of it.
 *
 * ## Why it is a queue and not a column
 *
 * Steers accumulate. An admin watching a build may send three in a minute,
 * each about a different thing, and collapsing them into one "current
 * instruction" field would silently drop two. They are also a record: what
 * someone told the build, when, and whether it arrived before the phase that
 * needed it. A field cannot answer that afterwards and a queue can.
 *
 * ## Delivery
 *
 * Phase boundaries only, alongside the budget check — never mid-phase. A
 * coding agent is a single long invocation; there is no point during it at
 * which new text can be inserted, and a steer that arrives while the coder is
 * running waits for the next boundary rather than being lost. That is also
 * the honest contract to show an admin: "the build will see this when it
 * finishes what it is doing", not "the build has changed course".
 *
 * `deliveredToRunId` rather than a bare flag: a session's build can be retried
 * as a new run, and knowing which run actually received a note is the
 * difference between "it was told and ignored it" and "it never heard".
 *
 * SUPERSEDED exists for the cancel path — a note the admin withdrew, or one
 * left pending when the session finished. It is not DELIVERED and must never
 * read as it.
 */
@Entity('builder_steers')
@Index('idx_builder_steers_session', ['sessionId', 'status'])
export class BuilderSteer extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  /**
   * The run in flight when the note was written, for the audit trail. Null
   * when nothing was running — a note left for whatever runs next.
   */
  @Column({ type: 'uuid', nullable: true })
  runId?: string | null;

  @Column({ type: 'text' })
  note!: string;

  @Column({
    type: 'varchar',
    length: 12,
    enum: BuilderSteerStatus,
    default: BuilderSteerStatus.PENDING,
  })
  status!: BuilderSteerStatus;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date | null;

  /** Which run actually read it — not necessarily the one it was written during. */
  @Column({ type: 'uuid', nullable: true })
  deliveredToRunId?: string | null;

  /** The phase the run was entering when it picked the note up. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  deliveredAtPhase?: string | null;

  @Column({ type: 'int', nullable: true })
  createdByUserId?: number | null;
}
