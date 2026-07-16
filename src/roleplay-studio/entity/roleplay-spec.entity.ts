import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { RoleplaySpecStatus } from '../enum/roleplay-spec-status.enum';
import { RoleplaySpecDocument } from '../type/roleplay-spec-document.type';

/**
 * A Roleplay Studio v2 spec: the authoring root for one ROLEPLAY_V2 scenario.
 *
 * `draftSpec` is the single mutable working document (edited by the trainer
 * via PUT /specs/:id/draft or by the copilot's update_spec tool). Every draft
 * mutation also snapshots into roleplay_spec_versions, and publish flips a
 * snapshot to PUBLISHED and materialises the thin `scenarios` row
 * (`scenarioId`, created DRAFT at spec creation so it always exists).
 *
 * Optimistic concurrency on the draft uses this row's `updatedAt` as the
 * token (`expectedUpdatedAt` in the PUT body; mismatch → 409).
 */
@Entity('roleplay_specs')
@Index('idx_roleplay_specs_scenario_id', ['scenarioId'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_roleplay_specs_created_by', ['createdBy'], {
  where: '"deletedAt" IS NULL',
})
export class RoleplaySpec extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  title!: string;

  @Column({ enum: RoleplaySpecStatus, default: RoleplaySpecStatus.DRAFT })
  status!: RoleplaySpecStatus;

  // Primary competency (derived from competencyIds[0]); kept for back-compat.
  @Column({ type: 'uuid', nullable: true })
  competencyId?: string | null;

  // All competencies this spec trains (first-class multi-select). Denormalised
  // from the draft/version jsonb for querying; competencyId stays in sync.
  @Column({ type: 'jsonb', nullable: true })
  competencyIds?: string[] | null;

  // Loose FK to the thin scenarios row (engine=ROLEPLAY_V2) created at spec
  // creation, flipped ACTIVE on first publish. No DB constraint.
  @Column()
  scenarioId!: number;

  // The mutable working document. Snapshots live in roleplay_spec_versions.
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  draftSpec!: Partial<RoleplaySpecDocument>;

  // The roleplay_spec_versions row currently materialised/live. Null until
  // the first publish.
  @Column({ type: 'uuid', nullable: true })
  publishedVersionId?: string | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
