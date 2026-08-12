import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WaTemplateKind, WaTemplateMatchType } from '../enum/whatsapp.enum';

/**
 * A fixed reply that fires on matching inbound text, before the RAG agent runs.
 *
 * All four kinds live in one table (see WaTemplateKind) with `priority` deciding the order of a
 * single matching pass. One ordered pass over one table is the point: with four tables there would
 * be four matchers and four chances for the ordering between them to be wrong, and the ordering is
 * the safety-critical part — a crisis rule that loses to an FAQ rule is a crisis reply that never
 * gets sent.
 *
 * `matchType` is orthogonal to `kind`, following the same split as
 * conversational-guardrails (governance kind vs detector type): a crisis rule can be ANY_OF while
 * an FAQ rule is CONTAINS, without either concept constraining the other.
 */
@Entity('wa_keyword_templates')
export class WaKeywordTemplate extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_wa_keyword_templates_kind')
  @Column({ type: 'varchar', length: 16 })
  kind!: WaTemplateKind;

  @Column({ type: 'text' })
  name!: string;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'match_type',
    default: WaTemplateMatchType.ANY_OF,
  })
  matchType!: WaTemplateMatchType;

  /** Normalised keywords, or a single regex source when matchType=REGEX. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  patterns!: string[];

  /** Null matches every language. Set to scope a rule to one. */
  @Column({
    type: 'varchar',
    length: 16,
    name: 'language_code',
    nullable: true,
  })
  languageCode?: string | null;

  /**
   * Ascending evaluation order. Bands by convention: crisis 0-99, consent 100-199,
   * command 200-299, faq 300+. Bands rather than one flat sequence so inserting an FAQ rule can
   * never accidentally be placed ahead of a crisis rule.
   */
  @Index('idx_wa_keyword_templates_priority')
  @Column({ type: 'int', default: 300 })
  priority!: number;

  /** Supports {helpline_numbers} and {menu}, substituted from settings at send time. */
  @Column({ type: 'text', name: 'response_text' })
  responseText!: string;

  /**
   * Whether a match skips retrieval entirely. Explicit rather than derived from `kind` so an FAQ
   * rule can later be turned into "prepend this, then still answer" without a schema change.
   */
  @Column({ type: 'boolean', name: 'bypass_rag', default: true })
  bypassRag!: boolean;

  /** Stop the pass outright. True for crisis and opt-out: nothing may run after them. */
  @Column({ type: 'boolean', default: false })
  terminal!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  /**
   * Seeded rules the platform depends on — the crisis replies, STOP/START, the consent disclaimer.
   * Their WORDING is editable (a helpline number changes, the tone needs work) but they cannot be
   * deleted or deactivated, because a bot for this audience with no crisis reply configured is not
   * a degraded bot, it is an unsafe one.
   */
  @Column({ type: 'boolean', default: false })
  mandatory!: boolean;

  @Column({ type: 'timestamp', name: 'archived_at', nullable: true })
  archivedAt?: Date | null;

  @Column({ type: 'int', name: 'created_by', nullable: true })
  createdBy?: number | null;

  @Column({ type: 'int', name: 'updated_by', nullable: true })
  updatedBy?: number | null;
}
