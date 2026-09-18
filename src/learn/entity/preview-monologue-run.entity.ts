import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One admin-Studio preview run and the client's internal monologue it produced.
 *
 * Previews are deliberately ephemeral everywhere else: no scenario_session row
 * exists for them and every SQS processor drops `preview-%` at the door, so a
 * curator who wanted to re-read what the client was thinking had exactly one
 * chance — the live panel, while the run was happening. This table is the
 * exception, and only for the monologue: the point of the feature is to work
 * out why a prompt behaved as it did, which is not something you can do in
 * real time while also playing the counsellor.
 *
 * The row is created at preview start (so a run that produced no monologue is
 * still visible, and still says who ran it and when) and completed when the
 * agent ships its end-of-session write-out. Small by construction: the agent
 * records at most MAX_RECORDED_TURNS turns.
 */
@Entity('preview_monologue_runs')
@Index('IDX_preview_monologue_runs_scenario', ['scenarioId', 'createdAt'])
export class PreviewMonologueRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** LiveKit room name, `preview-<scenarioId>-<uuid>` — the join key the agent knows. */
  @Column({ type: 'varchar', length: 255, unique: true })
  roomName!: string;

  @Column({ type: 'int' })
  scenarioId!: number;

  /** Set when the preview ran a specific draft version rather than the live scenario. */
  @Column({ type: 'uuid', nullable: true })
  scenarioVersionId!: string | null;

  @Column({ type: 'int', nullable: true })
  languageId!: number | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'int', nullable: true })
  startedByUserId!: number | null;

  /** The monologue turns, oldest first, exactly as the preview panel renders them. */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  turns!: Record<string, any>[];

  @Column({ type: 'int', default: 0 })
  turnCount!: number;

  /** When the write-out landed. Null means the run never reported one. */
  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;
}
