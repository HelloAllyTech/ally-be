import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScenarioVersionStatus } from '../enum/scenario-version-status.enum';

/**
 * A saved snapshot of a scenario's editable configuration.
 *
 * The snapshot (`config`) is the full `UpdateScenarioDto` payload — the same
 * shape the studio form submits. Drafts are edited in place (autosave writes
 * straight to `config`) without touching the live `scenarios` row or its
 * related tables. Publishing a version replays its `config` through
 * `ScenarioService.updateScenario`, which fans the DTO back out across the
 * scenarios row, termination events, behavior instructions, trigger warnings,
 * translations, etc. — so the live runtime, pathways and learner reads never
 * need to know versions exist.
 */
@Entity('scenario_versions')
@Index('idx_scenario_versions_scenario_id', ['scenarioId'], {
  where: '"deletedAt" IS NULL',
})
export class ScenarioVersion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  // Monotonic per scenario (v1, v2 … vn). Never reused, even after a draft is
  // soft-deleted, so version labels stay stable in history.
  @Column({ type: 'int' })
  versionNumber!: number;

  // Optional human label, e.g. "warmer opener". Falls back to `v{n}` in the UI.
  @Column({ nullable: true })
  name?: string;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  config!: Record<string, any>;

  @Column({
    enum: ScenarioVersionStatus,
    default: ScenarioVersionStatus.DRAFT,
  })
  status!: ScenarioVersionStatus;

  // The version this one was branched/cloned from (null for the original v1).
  @Column({ type: 'uuid', nullable: true })
  parentVersionId?: string | null;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;

  @DeleteDateColumn()
  deletedAt?: Date;

  /**
   * Transient (not a column): set on read to flag the version that MIRRORS the
   * live scenario rather than holding an isolated snapshot.
   *
   * The studio edits the live `scenarios` row directly whenever no version is
   * explicitly selected, so the mirroring version's stored `config` goes stale
   * the moment anyone saves — it is a seed, not a record. Reading it must
   * therefore read live, and branching it must rebuild from live. See
   * `ScenarioVersionService.resolveLiveVersionId`.
   */
  isLive?: boolean;
}
