import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  PrimaryGeneratedColumn,
  Entity,
  DeleteDateColumn,
} from 'typeorm';
import { ScenarioDifficultyLevel, ScenarioStatus } from '../type/scenario.type';
import { ScenarioEngine } from '../enum/scenario-engine.enum';
import { ScenarioCategory } from '../enum/scenario-category.enum';

@Entity('scenarios')
export class Scenarios extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: true })
  title?: string;

  @Column({ nullable: true })
  scenario?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  coverImageUrl?: string;

  @Column({ nullable: true })
  coverVideoUrl?: string;

  @Column({ enum: ScenarioStatus, default: ScenarioStatus.DRAFT })
  status!: ScenarioStatus;

  @Column({ nullable: true })
  prompt?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ default: false })
  isGlobal!: boolean;

  @Column({
    nullable: true,
    enum: ScenarioDifficultyLevel,
    default: ScenarioDifficultyLevel.MEDIUM,
  })
  difficultyLevel?: ScenarioDifficultyLevel;

  @Column({ default: false })
  isPublic!: boolean;

  @Column({ type: 'uuid', nullable: true })
  competencyId?: string;

  // Roleplay Studio v2 first-class multi-competency tagging. competencyId
  // mirrors competencyIds[0] for back-compat; v1 scenarios leave this null.
  @Column({ type: 'jsonb', nullable: true })
  competencyIds?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  translations?: Record<string, any>;

  // Points at the scenario_versions row currently materialised into this live
  // record. Set when a version is published; null for scenarios that predate
  // versioning or have never been published from a version.
  @Column({ type: 'uuid', nullable: true })
  publishedVersionId?: string | null;

  // Which runtime plays this scenario. Single-valued since Roleplay Studio v2
  // was removed: every row is SIMULATION. Kept as a column rather than dropped
  // so a second engine does not need a migration on this table.
  // Optional on the type (defaulted by the DB) so pre-existing structural
  // uses of the entity shape — GetAdminScenarioDto extends it — stay valid.
  @Column({ enum: ScenarioEngine, default: ScenarioEngine.SIMULATION })
  engine?: ScenarioEngine;

  // Vestigial: the loose FK to the removed roleplay_specs table. Always null
  // now; the column is left in place rather than migrated off a hot table.
  @Column({ type: 'uuid', nullable: true })
  roleplaySpecId?: string | null;

  // Editorial grouping for the Studio list (Originals / Demo / Partner Sim…).
  // Null for scenarios that predate the field.
  @Column({ type: 'varchar', nullable: true, enum: ScenarioCategory })
  category?: ScenarioCategory | null;

  // Free-text partner organisation tag, meaningful mainly when
  // category=PARTNER_SIM. Deliberately not an FK to `tenants` — partners may
  // not exist as tenants.
  @Column({ type: 'varchar', nullable: true, length: 255 })
  partnerOrgName?: string | null;
}
