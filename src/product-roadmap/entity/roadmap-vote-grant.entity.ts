import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One batch of votes issued to one user, spendable until it expires.
 *
 * Replaces the old "100 votes per calendar month" cap. Instead of one number that resets on
 * the 1st, a user's spendable balance is the sum of every grant that hasn't expired yet minus
 * what's already been drawn from it — see RoadmapVoteGrantRepository.availableBalance(). Three
 * things issue a grant:
 *
 *  - 'monthly' — ROADMAP_VOTE_GRANT_MONTHLY, once per UTC calendar month
 *  - 'daily'   — ROADMAP_VOTE_GRANT_DAILY, once per UTC calendar day
 *  - 'refund'  — when a user removes a vote they already cast, the freed-up amount comes back
 *                as a brand new grant rather than being credited back onto the grant it was
 *                originally drawn from. There is no per-unit journal of which grant paid for
 *                which cast vote, so an exact reversal would need one; a fresh grant is simpler,
 *                always correct (can't go negative, can't touch an already-expired row), and is
 *                a defensible rule on its own — un-voting gives the credit a full new window to
 *                be used. See RoadmapVoteGrantRepository.refund().
 *
 * `grantKey` makes 'monthly'/'daily' issuance idempotent — 'YYYY-MM' or 'YYYY-MM-DD' (UTC,
 * matching currentPeriodKey()/currentDayKey()) — so a doubled cron tick or a re-run migration
 * can't double-grant. 'refund' grants carry no grantKey; they're one per vote-removal action,
 * not per period, so there's nothing to de-duplicate against.
 *
 * Consumption is FIFO by `expiresAt` — RoadmapAllocationService spends whichever grant would
 * otherwise be wasted first — recorded by incrementing `consumed` in place rather than deleting
 * or splitting rows, so a grant's history (issued, spent, expired-unspent) stays inspectable.
 */
@Entity('roadmap_vote_grants')
@Index('idx_roadmap_vote_grants_user_expires', ['userId', 'expiresAt'])
export class RoadmapVoteGrant extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Ally users.id. Integer, no FK, per convention — see RoadmapAllocation.userId. */
  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'varchar' })
  source!: 'monthly' | 'daily' | 'refund';

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'int', default: 0 })
  consumed!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  grantedAt!: Date;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  /** 'YYYY-MM' (monthly) / 'YYYY-MM-DD' (daily) / null (refund). See class docblock. */
  @Column({ type: 'varchar', nullable: true })
  grantKey!: string | null;
}
