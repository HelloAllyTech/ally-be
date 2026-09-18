import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only ledger of every XP award.
 *
 * XP is written here at the moment it is earned and never recomputed from source data.
 * A roleplay session's contribution cannot be rebuilt after the fact — detection rows
 * sum close to a lost total but never equal it — so a derive-on-read design would make
 * a learner's level drift downward as history is corrected. The ledger is the record.
 *
 * `user_progress` holds the running totals; this table is what those totals are
 * reconciled against.
 */
@Entity('xp_events')
@Index(
  'uq_xp_events_user_rule_source',
  ['userId', 'tenantId', 'rule', 'sourceType', 'sourceId'],
  { unique: true },
)
@Index('idx_xp_events_user_tenant_awarded_on', [
  'userId',
  'tenantId',
  'awardedOn',
])
export class XpEvent extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  /** One of XP_RULE. Stored as text so a retired rule still reads back. */
  @Column({ type: 'character varying', length: 64 })
  rule!: string;

  /** One of XP_SOURCE_TYPE — which kind of thing earned this. */
  @Column({ type: 'character varying', length: 32 })
  sourceType!: string;

  /**
   * Identifier of the earning thing, scoped by sourceType.
   *
   * Never null. Postgres treats NULLs as distinct in a unique index, so a nullable
   * column here would silently disable the idempotency guarantee this table exists for.
   * Awards with no natural id (a daily cap marker, a backfill row) use a synthetic
   * deterministic key instead.
   */
  @Column({ type: 'character varying', length: 128 })
  sourceId!: string;

  @Column({ type: 'integer' })
  xp!: number;

  /**
   * Calendar day the award counts against, in the tenant's business timezone. Daily
   * caps are evaluated on this column rather than on createdAt, so a cap cannot be
   * dodged by a session that straddles midnight.
   */
  @Column({ type: 'date' })
  awardedOn!: Date;
}
