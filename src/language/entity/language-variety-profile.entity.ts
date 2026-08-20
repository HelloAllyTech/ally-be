import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { VarietyFeatures } from '../util/variety-feature.util';

/** Lifecycle: inferred (machine-proposed) → confirmed (human-reviewed). */
export enum VarietyProfileStatus {
  INFERRED = 'inferred',
  CONFIRMED = 'confirmed',
  ARCHIVED = 'archived',
}

/**
 * A language variety profile — how one deployment population actually speaks
 * a language, inferred from the LEARNER side of its judged-session
 * transcripts (address forms, code-mix, discourse markers, characteristic
 * lexemes). Profiles are shared entities: tenants attach to them many-to-one
 * via `variety_profile_attachments`, so two orgs serving the same population
 * pool their evidence and a multi-site org can attach per population later.
 *
 * v1 scope: inference + storage only. Nothing reads profiles at runtime yet —
 * the follow-up phases feed them to the language judge (per-population
 * `targetVariety`) and scope glossary overlays to them.
 */
@Entity('language_variety_profiles')
@Index('idx_variety_profiles_language_status', ['languageId', 'status'])
export class LanguageVarietyProfile extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  languageId!: number;

  /** Human-readable name; auto-generated at inference, renameable on review. */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Deterministic plain-words summary of the features (regenerated on refresh). */
  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: VarietyProfileStatus.INFERRED,
  })
  status!: VarietyProfileStatus;

  /** The feature vector (variety-feature.util.VarietyFeatures). */
  @Column({ type: 'jsonb' })
  features!: VarietyFeatures;

  /** Representative learner utterances, shown as evidence on review. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  exemplars!: string[];

  /** Inference provenance: window, corpus sizes, seed tenant. */
  @Column({ type: 'jsonb', nullable: true })
  source?: {
    inferredFromTenantId: string;
    windowDays: number;
    sessionCount: number;
    turnCount: number;
    contrastTurnCount: number;
  };

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updatedBy?: string;
}
