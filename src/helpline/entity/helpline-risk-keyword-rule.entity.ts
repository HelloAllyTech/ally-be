import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  HelplineKeywordMatchType,
  HelplineRiskFlagLevel,
} from '../constants/helpline.constants';

/**
 * A keyword risk rule. `tenant_id` NULL = platform default (seeded by
 * 1975760000000-SeedHelplineRiskKeywords); an org may add its own. Matched by
 * `HelplineRiskKeywordService` after Unicode-aware normalisation.
 */
@Entity('helpline_risk_keyword_rules')
export class HelplineRiskKeywordRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', name: 'tenant_id', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  phrase!: string;

  /** The language the phrase is written in. Screening applies every language's rules. */
  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 16, name: 'match_type' })
  matchType!: HelplineKeywordMatchType;

  @Column({ type: 'varchar', length: 16 })
  level!: HelplineRiskFlagLevel;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
