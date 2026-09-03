import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Running XP totals for one learner in one tenant.
 *
 * A rollup of `xp_events`, kept because the level indicator renders in the persistent
 * nav on every screen and should not re-SUM a growing ledger each time. Both tables are
 * written in the same transaction, so a drift between them means a bug rather than a
 * race, and `ProgressService.reconcile` exists to prove it.
 *
 * Deliberately holds only XP state. Lifetime practice minutes are NOT stored here —
 * `user_daily_scores."minutesPlayed"` is the sanctioned source and a second copy would
 * let the Progress screen disagree with the certification chart and the badge ladder.
 */
@Entity('user_progress')
@Index('uq_user_progress_user_tenant', ['userId', 'tenantId'], { unique: true })
export class UserProgress extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  @Column({ type: 'integer', default: 0 })
  totalXp!: number;

  /** Derived from totalXp via resolveLevel, stored so the nav read needs no computation. */
  @Column({ type: 'integer', default: 1 })
  level!: number;

  /** Null until the learner first leaves level 1. Drives the level-up celebration. */
  @Column({ type: 'timestamp', nullable: true })
  lastLevelUpAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastAwardedAt?: Date | null;
}
