import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Lifecycle of a single (prompt, language) translation.
 * Stored as a varchar column (see the CreatePromptTranslations migration).
 */
export enum PromptTranslationStatus {
  PENDING = 'pending',
  TRANSLATING = 'translating',
  READY = 'ready',
  FAILED = 'failed',
}

/**
 * The current translated body of a `main_agent`/`branching` prompt template for
 * one language. One live row per (promptId, languageId), overwritten on
 * re-translation — runtime only ever needs the *current* body's translation.
 *
 * `sourceHash` is the correctness key: a translation is served at runtime only
 * when its `sourceHash` still matches the hash of the current English body,
 * which is what keeps translations aligned to the (read-only-to-users) English
 * source across both the override-on and file-backed paths.
 */
@Entity('prompt_translations')
@Index('uq_prompt_translations_prompt_language', ['promptId', 'languageId'], {
  unique: true,
})
@Index('idx_prompt_translations_language', ['languageId'])
@Index('idx_prompt_translations_status', ['status'])
export class PromptTranslation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  promptId!: string;

  @Column({ type: 'int' })
  languageId!: number;

  /**
   * Provenance: the `prompts_versions` row this translation was made from.
   * Null for file-backed prompts, which have no version rows.
   */
  @Column({ type: 'uuid', nullable: true })
  promptVersionId?: string;

  /** Translated body with `{placeholders}` and `[audio tags]` preserved. Null until ready. */
  @Column({ type: 'text', nullable: true })
  translatedPrompt?: string;

  /** Hash of the effective English body this translation was produced from. */
  @Column({ type: 'varchar', length: 64 })
  sourceHash!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: PromptTranslationStatus.PENDING,
  })
  status!: PromptTranslationStatus;

  /** Engine actually used, e.g. 'gemini' / 'gemini-2.5-pro'. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  provider?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model?: string;

  /**
   * Runtime override for the MULTILINGUAL path: which provider/model runs the
   * main agent when this translated body is served for its language. Null =
   * inherit the prompt's own provider/model. (Distinct from provider/model
   * above, which is the engine that produced the translation.)
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  runtimeProvider?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  runtimeModel?: string;

  /** Which translation-prompt/glossary produced this (for deliberate re-translation). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  translationPromptVersion?: string;

  @Column({ type: 'text', nullable: true })
  error?: string;
}
