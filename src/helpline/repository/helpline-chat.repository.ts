import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import {
  HELPLINE_HIGH_RISK_PRIORITY,
  HELPLINE_WAIT_ESTIMATE,
  HelplineChatStatus,
  HelplineEndedReason,
  HelplineRiskFlagLevel,
  HelplineRiskLevel,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { returningRows } from '../util/helpline-errors';

/**
 * Every `helpline_chats` query. Each method takes `tenantId` first and puts it
 * in the WHERE clause — a helpline query without tenant isolation is a data
 * leak (`helpline-tenant-isolation.spec.ts` asserts it method by method).
 *
 * The two exceptions are named `…AcrossTenants` and return only tenant ids:
 * the lifecycle and retention sweeps use them to find which tenants to visit,
 * then query each tenant on its own.
 */
@Injectable()
export class HelplineChatRepository {
  constructor(
    @InjectRepository(HelplineChat)
    private readonly repo: Repository<HelplineChat>,
  ) {}

  findById(tenantId: string, chatId: string): Promise<HelplineChat | null> {
    return this.repo.findOne({ where: { id: chatId, tenantId } });
  }

  /** A guest may only ever load the one chat their token names. */
  findForGuest(
    tenantId: string,
    chatId: string,
    talkerId: string,
  ): Promise<HelplineChat | null> {
    return this.repo.findOne({ where: { id: chatId, tenantId, talkerId } });
  }

  create(chat: Partial<HelplineChat>): HelplineChat {
    return this.repo.create(chat);
  }

  async save(chat: HelplineChat): Promise<HelplineChat> {
    if (!chat.tenantId) throw new Error('helpline chat without tenant_id');
    return this.repo.save(chat);
  }

  /**
   * The atomic claim, exactly as contract §6.6. Postgres evaluates every SET
   * expression against the OLD row, so `previous_listener_ids || listener_id`
   * appends the listener being replaced on a transfer claim. Zero rows means
   * someone else won, the chat is aimed at another listener, or it is no
   * longer claimable — the caller answers HELPLINE_ALREADY_CLAIMED.
   */
  async claim(
    tenantId: string,
    chatId: string,
    userId: number,
  ): Promise<boolean> {
    const result = await this.repo.query(
      `UPDATE "helpline_chats"
          SET "status" = 'ACTIVE', "listener_id" = $3, "claimed_at" = now(),
              "previous_listener_ids" = CASE WHEN "listener_id" IS NOT NULL
                THEN "previous_listener_ids" || "listener_id"
                ELSE "previous_listener_ids" END,
              "transfer_requested_at" = NULL, "transfer_requested_by" = NULL,
              "transfer_target_listener_id" = NULL, "taken_over_at" = NULL,
              "updated_at" = now()
        WHERE "id" = $1 AND "tenant_id" = $2
          AND ("status" = 'WAITING' AND "abandoned_at" IS NULL
               OR "status" = 'ACTIVE' AND "transfer_requested_at" IS NOT NULL AND "listener_id" <> $3)
          AND ("transfer_target_listener_id" IS NULL OR "transfer_target_listener_id" = $3)
      RETURNING "id"`,
      [chatId, tenantId, userId],
    );
    return returningRows<{ id: string }>(result).length === 1;
  }

  /**
   * End a chat once. The `status <> 'ENDED'` guard makes every end path —
   * listener, talker, sweep, erasure — race-safe and idempotent: only the
   * first caller gets `true` and runs the side effects.
   */
  async markEnded(
    tenantId: string,
    chatId: string,
    reason: HelplineEndedReason,
    actorUserId: number | null,
  ): Promise<boolean> {
    const result = await this.repo.query(
      `UPDATE "helpline_chats"
          SET "status" = 'ENDED', "ended_at" = now(), "ended_reason" = $3,
              "ended_by" = $4, "transfer_requested_at" = NULL,
              "transfer_target_listener_id" = NULL, "updated_at" = now()
        WHERE "id" = $1 AND "tenant_id" = $2 AND "status" <> 'ENDED'
      RETURNING "id"`,
      [chatId, tenantId, reason, actorUserId],
    );
    return returningRows<{ id: string }>(result).length === 1;
  }

  /**
   * Put an ACTIVE chat up for transfer (contract §10). Only one pending
   * request at a time: false when it is not ACTIVE or already pending.
   */
  async requestTransfer(
    tenantId: string,
    chatId: string,
    byUserId: number,
    targetListenerId: number | null,
  ): Promise<boolean> {
    const result = await this.repo.query(
      `UPDATE "helpline_chats"
          SET "transfer_requested_at" = now(), "transfer_requested_by" = $3,
              "transfer_target_listener_id" = $4, "updated_at" = now()
        WHERE "id" = $1 AND "tenant_id" = $2 AND "status" = 'ACTIVE'
          AND "transfer_requested_at" IS NULL
      RETURNING "id"`,
      [chatId, tenantId, byUserId, targetListenerId],
    );
    return returningRows<{ id: string }>(result).length === 1;
  }

  /**
   * Aim a claimable chat (WAITING and not abandoned, or transfer-pending) at
   * one listener; the claim UPDATE then admits only them. Never the chat's
   * current listener.
   */
  async assignTarget(
    tenantId: string,
    chatId: string,
    listenerId: number,
  ): Promise<boolean> {
    const result = await this.repo.query(
      `UPDATE "helpline_chats"
          SET "transfer_target_listener_id" = $3, "updated_at" = now()
        WHERE "id" = $1 AND "tenant_id" = $2
          AND ("status" = 'WAITING' AND "abandoned_at" IS NULL
               OR "status" = 'ACTIVE' AND "transfer_requested_at" IS NOT NULL)
          AND "listener_id" IS DISTINCT FROM $3
      RETURNING "id"`,
      [chatId, tenantId, listenerId],
    );
    return returningRows<{ id: string }>(result).length === 1;
  }

  /**
   * A supervisor becomes listener of record of an ACTIVE chat at once. The
   * listener being replaced moves to `previous_listener_ids` (read-only), and
   * any pending transfer is cancelled. Returns the replaced listener id
   * (null if there was none), or undefined when nothing changed.
   */
  async takeOver(
    tenantId: string,
    chatId: string,
    userId: number,
  ): Promise<{ previousListenerId: number | null } | undefined> {
    const result = await this.repo.query(
      `WITH "before" AS (
         SELECT "listener_id" FROM "helpline_chats"
          WHERE "id" = $1 AND "tenant_id" = $2 FOR UPDATE
       )
       UPDATE "helpline_chats" c
          SET "listener_id" = $3, "taken_over_at" = now(),
              "previous_listener_ids" = CASE
                WHEN c."listener_id" IS NOT NULL
                 AND NOT (c."listener_id" = ANY(c."previous_listener_ids"))
                THEN c."previous_listener_ids" || c."listener_id"
                ELSE c."previous_listener_ids" END,
              "transfer_requested_at" = NULL, "transfer_requested_by" = NULL,
              "transfer_target_listener_id" = NULL, "updated_at" = now()
        WHERE c."id" = $1 AND c."tenant_id" = $2 AND c."status" = 'ACTIVE'
          AND c."listener_id" IS DISTINCT FROM $3
      RETURNING (SELECT "listener_id" FROM "before") AS "previousListenerId"`,
      [chatId, tenantId, userId],
    );
    const row = returningRows<{ previousListenerId: number | null }>(result)[0];
    return row
      ? {
          previousListenerId:
            row.previousListenerId == null
              ? null
              : Number(row.previousListenerId),
        }
      : undefined;
  }

  /** A talker's WAITING / ACTIVE chats (block ends them all). */
  listOpenForTalker(
    tenantId: string,
    talkerId: string,
  ): Promise<HelplineChat[]> {
    return this.repo.find({
      where: [
        { tenantId, talkerId, status: HelplineChatStatus.WAITING },
        { tenantId, talkerId, status: HelplineChatStatus.ACTIVE },
      ],
    });
  }

  /** Raise `risk_level` monotonically; HIGH lifts a WAITING chat's priority. */
  async raiseRisk(
    tenantId: string,
    chatId: string,
    level: HelplineRiskFlagLevel,
  ): Promise<{
    riskLevel: HelplineRiskLevel;
    priority: number;
    status: HelplineChatStatus;
  } | null> {
    const result = await this.repo.query(
      `UPDATE "helpline_chats"
          SET "risk_level" = CASE
                WHEN "risk_level" = 'HIGH' OR $3::varchar = 'HIGH' THEN 'HIGH'
                WHEN "risk_level" = 'ELEVATED' OR $3::varchar = 'ELEVATED' THEN 'ELEVATED'
                ELSE "risk_level" END,
              "priority" = CASE WHEN "status" = 'WAITING' AND $3::varchar = 'HIGH'
                THEN GREATEST("priority", $4) ELSE "priority" END,
              "updated_at" = now()
        WHERE "id" = $1 AND "tenant_id" = $2
      RETURNING "risk_level" AS "riskLevel", "priority", "status"`,
      [chatId, tenantId, level, HELPLINE_HIGH_RISK_PRIORITY],
    );
    return (
      returningRows<{
        riskLevel: HelplineRiskLevel;
        priority: number;
        status: HelplineChatStatus;
      }>(result)[0] ?? null
    );
  }

  /**
   * Claim the once-per-chat emergency-resources send: true for exactly one
   * caller, and never for an ended chat.
   */
  async markResourcesSent(tenantId: string, chatId: string): Promise<boolean> {
    const result = await this.repo.query(
      `UPDATE "helpline_chats"
          SET "resources_sent_at" = now(), "updated_at" = now()
        WHERE "id" = $1 AND "tenant_id" = $2
          AND "resources_sent_at" IS NULL AND "status" <> 'ENDED'
      RETURNING "id"`,
      [chatId, tenantId],
    );
    return returningRows<{ id: string }>(result).length === 1;
  }

  /** Counters for one persisted talker TEXT; returns the new talker count. */
  async recordTalkerMessage(tenantId: string, chatId: string): Promise<number> {
    const result = await this.repo.query(
      `UPDATE "helpline_chats"
          SET "talker_message_count" = "talker_message_count" + 1,
              "talker_turns_since_nudge" = "talker_turns_since_nudge" + 1,
              "last_talker_message_at" = now(), "updated_at" = now()
        WHERE "id" = $1 AND "tenant_id" = $2
      RETURNING "talker_message_count" AS "count"`,
      [chatId, tenantId],
    );
    return Number(returningRows<{ count: number }>(result)[0]?.count ?? 0);
  }

  /** A nudge was shown: count it and restart the talker-turn spacing. */
  async recordNudge(tenantId: string, chatId: string): Promise<void> {
    await this.repo.query(
      `UPDATE "helpline_chats"
          SET "nudge_count" = "nudge_count" + 1,
              "talker_turns_since_nudge" = 0, "updated_at" = now()
        WHERE "id" = $1 AND "tenant_id" = $2`,
      [chatId, tenantId],
    );
  }

  async recordListenerMessage(tenantId: string, chatId: string): Promise<void> {
    await this.repo.query(
      `UPDATE "helpline_chats"
          SET "listener_message_count" = "listener_message_count" + 1,
              "last_listener_message_at" = now(), "updated_at" = now()
        WHERE "id" = $1 AND "tenant_id" = $2`,
      [chatId, tenantId],
    );
  }

  async setAbandoned(
    tenantId: string,
    chatId: string,
    at: Date | null,
  ): Promise<boolean> {
    const result = await this.repo.update(
      { id: chatId, tenantId, status: HelplineChatStatus.WAITING },
      { abandonedAt: at },
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * The lobby: claimable new chats (WAITING, not abandoned) and transfers
   * awaiting a new listener, priority first, then the longest wait.
   */
  listQueue(tenantId: string): Promise<HelplineChat[]> {
    return this.repo.find({
      where: [
        { tenantId, status: HelplineChatStatus.WAITING, abandonedAt: IsNull() },
        {
          tenantId,
          status: HelplineChatStatus.ACTIVE,
          transferRequestedAt: Not(IsNull()),
        },
      ],
      order: { priority: 'DESC', waitStartedAt: 'ASC' },
    });
  }

  /** 1-based place of a WAITING chat in the lobby order (priority desc, oldest first). */
  async queuePosition(
    tenantId: string,
    chat: Pick<HelplineChat, 'priority' | 'waitStartedAt'>,
  ): Promise<number> {
    const ahead = await this.repo
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.status = :status', { status: HelplineChatStatus.WAITING })
      .andWhere('c.abandonedAt IS NULL')
      .andWhere(
        '(c.priority > :priority OR (c.priority = :priority AND c.waitStartedAt < :waitStartedAt))',
        { priority: chat.priority, waitStartedAt: chat.waitStartedAt },
      )
      .getCount();
    return ahead + 1;
  }

  countWaiting(tenantId: string): Promise<number> {
    return this.repo.count({
      where: {
        tenantId,
        status: HelplineChatStatus.WAITING,
        abandonedAt: IsNull(),
      },
    });
  }

  countActive(tenantId: string): Promise<number> {
    return this.repo.count({
      where: { tenantId, status: HelplineChatStatus.ACTIVE },
    });
  }

  countActiveForListener(tenantId: string, userId: number): Promise<number> {
    return this.repo.count({
      where: {
        tenantId,
        listenerId: userId,
        status: HelplineChatStatus.ACTIVE,
      },
    });
  }

  listActiveForListener(
    tenantId: string,
    userId: number,
  ): Promise<HelplineChat[]> {
    return this.repo.find({
      where: {
        tenantId,
        listenerId: userId,
        status: HelplineChatStatus.ACTIVE,
      },
      order: { claimedAt: 'ASC' },
    });
  }

  /** Every ACTIVE chat of the tenant (the monitor). */
  listActive(tenantId: string): Promise<HelplineChat[]> {
    return this.repo.find({
      where: { tenantId, status: HelplineChatStatus.ACTIVE },
      order: { claimedAt: 'ASC' },
    });
  }

  listOpen(tenantId: string): Promise<HelplineChat[]> {
    return this.repo.find({
      where: [
        { tenantId, status: HelplineChatStatus.WAITING },
        { tenantId, status: HelplineChatStatus.ACTIVE },
      ],
    });
  }

  /**
   * Seconds from wait start to claim for recent first claims (transfers
   * excluded: their `claimed_at` is the second claim, which would read as a
   * very long wait).
   */
  async recentClaimWaitSeconds(
    tenantId: string,
    since: Date,
  ): Promise<number[]> {
    const rows: { seconds: string | number }[] = await this.repo.query(
      `SELECT EXTRACT(EPOCH FROM ("claimed_at" - "wait_started_at")) AS "seconds"
         FROM "helpline_chats"
        WHERE "tenant_id" = $1 AND "claimed_at" IS NOT NULL AND "claimed_at" >= $2
          AND cardinality("previous_listener_ids") = 0
        ORDER BY "claimed_at" DESC
        LIMIT $3`,
      [tenantId, since, HELPLINE_WAIT_ESTIMATE.SAMPLE_SIZE],
    );
    return rows.map((row) => Number(row.seconds));
  }

  /** History / monitor list. `mineFor` limits to chats the user handled. */
  listPage(
    tenantId: string,
    filter: { mineFor?: number; status?: HelplineChatStatus },
    skip: number,
    take: number,
  ): Promise<[HelplineChat[], number]> {
    const qb = this.repo
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId });
    if (filter.mineFor != null) {
      qb.andWhere(
        '(c.listenerId = :uid OR :uid = ANY(c.previousListenerIds))',
        {
          uid: filter.mineFor,
        },
      );
    }
    if (filter.status) {
      qb.andWhere('c.status = :status', { status: filter.status });
    }
    return qb
      .orderBy('c.waitStartedAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();
  }

  async markErased(tenantId: string, chatIds: string[]): Promise<void> {
    if (!chatIds.length) return;
    await this.repo.update(
      { tenantId, id: In(chatIds), erasedAt: IsNull() },
      { erasedAt: new Date() },
    );
  }

  /** Ended chats whose content is past the cutoff and not yet blanked. */
  findRetentionCandidates(
    tenantId: string,
    cutoff: Date,
    limit: number,
  ): Promise<Pick<HelplineChat, 'id' | 'talkerId'>[]> {
    return this.repo.find({
      where: {
        tenantId,
        status: HelplineChatStatus.ENDED,
        endedAt: LessThan(cutoff),
        erasedAt: IsNull(),
      },
      select: ['id', 'talkerId'],
      order: { endedAt: 'ASC' },
      take: limit,
    });
  }

  /** Tenant ids with an open chat — for the lifecycle sweep only. */
  async listOpenTenantIdsAcrossTenants(): Promise<string[]> {
    const rows: { tenant_id: string }[] = await this.repo.query(
      `SELECT DISTINCT "tenant_id" FROM "helpline_chats" WHERE "status" IN ('WAITING','ACTIVE')`,
    );
    return rows.map((row) => row.tenant_id);
  }

  /** Tenant ids with un-erased ended chats — for the retention sweep only. */
  async listRetentionTenantIdsAcrossTenants(): Promise<string[]> {
    const rows: { tenant_id: string }[] = await this.repo.query(
      `SELECT DISTINCT "tenant_id" FROM "helpline_chats" WHERE "status" = 'ENDED' AND "erased_at" IS NULL`,
    );
    return rows.map((row) => row.tenant_id);
  }
}
