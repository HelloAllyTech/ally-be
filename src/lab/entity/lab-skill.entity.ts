import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * An AI Lab "skill": a saved, reusable system-prompt template. The `content`
 * may embed `{{variable}}` placeholders (see LabVariable) that are substituted
 * with concrete values (see LabValue) at run time. System-wide (no tenant):
 * one shared library the AI Lab (super-duper-admin) works from.
 */
@Entity('lab_skills')
export class LabSkill extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_lab_skills_name')
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** The system-prompt template text. May contain `{{variable}}` placeholders. */
  @Column({ type: 'text' })
  content!: string;

  /**
   * LLM model this skill runs on (an id from the LLM model registry, e.g.
   * `claude-sonnet-4-6` or `gpt-4o`). Null → the AI Lab default (Anthropic
   * autofill model) is used at run time.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  model?: string | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
