import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_LIMITS,
  HELPLINE_RETENTION,
} from '../constants/helpline.constants';
import { HelplineChatSummary } from '../entity/helpline-chat-summary.entity';
import { HelplineRiskFlag } from '../entity/helpline-risk-flag.entity';
import { HelplineTalkerFeedback } from '../entity/helpline-talker-feedback.entity';
import { HelplineTalker } from '../entity/helpline-talker.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineTenantService } from './helpline-tenant.service';

export interface BlankCounts {
  chats: number;
  messages: number;
}

/**
 * Ages out what can identify a talker or carry what they said, and keeps the
 * aggregates (contract §10). Rows are blanked in place, never deleted, so
 * counts, levels, scores and timings — and every historical figure computed
 * from them — stay put.
 *
 * One blanking routine serves both callers: the hourly sweep (chats ended
 * before the tenant's `retentionDays` cutoff, 500 at a time) and a talker's
 * own erasure (one chat, now). Its list is exactly contract §10's, plus the
 * suggestion text inside message metadata and the talker's user-agent: both
 * outlive the bodies otherwise, and the retention rule is about what a talker
 * said and who they were, not just one column (see the Stacks chunk
 * "Automated Data Retention and Deletion in Agent Systems").
 *
 * Idempotent: every statement skips rows already blanked, so a re-run — or a
 * retention pass over a chat its talker already erased — writes nothing.
 * Logs carry counts only.
 */
@Injectable()
export class HelplineRetentionService {
  private readonly logger = LoggerService.getInstance(
    HelplineRetentionService.name,
  );

  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    @InjectRepository(HelplineTalker)
    private readonly talkers: Repository<HelplineTalker>,
    @InjectRepository(HelplineTalkerFeedback)
    private readonly feedback: Repository<HelplineTalkerFeedback>,
    @InjectRepository(HelplineChatSummary)
    private readonly summaries: Repository<HelplineChatSummary>,
    @InjectRepository(HelplineRiskFlag)
    private readonly flags: Repository<HelplineRiskFlag>,
    private readonly tenants: HelplineTenantService,
    private readonly settings: HelplineSettingsService,
  ) {}

  /** Hourly entry point. One tenant's failure does not stop the others. */
  async runRetentionSweep(): Promise<void> {
    const tenantIds = await this.chats.listRetentionTenantIdsAcrossTenants();
    for (const tenantId of tenantIds) {
      try {
        await this.sweepTenant(tenantId);
      } catch (error) {
        this.logger.error(
          `Helpline retention failed for tenant ${tenantId}: ${(error as Error).message}`,
        );
      }
    }
  }

  async sweepTenant(tenantId: string, now = new Date()): Promise<BlankCounts> {
    const tenant = await this.tenants.resolve(tenantId);
    if (!tenant) return { chats: 0, messages: 0 };
    const { retentionDays } = await this.settings.getSettings(tenant);
    // 0 keeps everything. Logged at info, not debug: a retention job that
    // silently does nothing is indistinguishable from one that works.
    if (!retentionDays || retentionDays <= 0) {
      this.logger.info(
        `Helpline retention skipped for tenant ${tenantId} (retentionDays = 0)`,
      );
      return { chats: 0, messages: 0 };
    }
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);

    const total: BlankCounts = { chats: 0, messages: 0 };
    // Bounded loop: the first run after this ships may face the whole history.
    for (;;) {
      const batch = await this.chats.findRetentionCandidates(
        tenantId,
        cutoff,
        HELPLINE_RETENTION.BATCH_SIZE,
      );
      if (!batch.length) break;
      const counts = await this.blankChats(
        tenantId,
        batch.map((c) => c.id),
        batch.map((c) => c.talkerId),
      );
      total.chats += counts.chats;
      total.messages += counts.messages;
      if (batch.length < HELPLINE_RETENTION.BATCH_SIZE) break;
    }
    if (total.chats) {
      this.logger.info(
        `Helpline retention past ${cutoff.toISOString()} for tenant ${tenantId}: ` +
          `${total.chats} chat(s), ${total.messages} message(s) blanked`,
      );
    }
    return total;
  }

  /**
   * Blank these chats' content. `talkerIds` are the chats' talkers (one each
   * in v1). Sets `erased_at` last, so a crash midway leaves the chat a
   * candidate for the next run rather than half-blanked and forgotten.
   */
  async blankChats(
    tenantId: string,
    chatIds: string[],
    talkerIds: string[],
  ): Promise<BlankCounts> {
    if (!chatIds.length) return { chats: 0, messages: 0 };
    const messages = await this.messages.blankForChats(tenantId, chatIds);

    await this.feedback.update(
      { tenantId, chatId: In(chatIds) },
      { comment: null },
    );
    await this.summaries.update(
      { tenantId, chatId: In(chatIds) },
      { fields: {} },
    );
    await this.flags.update(
      { tenantId, chatId: In(chatIds) },
      { outcomeNote: null },
    );
    if (talkerIds.length) {
      const ids = [...new Set(talkerIds)];
      await this.talkers.update(
        { tenantId, id: In(ids), erasedAt: IsNull() },
        {
          displayName: HELPLINE_LIMITS.DEFAULT_DISPLAY_NAME,
          userAgent: null,
          erasedAt: new Date(),
        },
      );
      // The ip HMAC exists only for the 24 h block window; drop it unless a
      // block is what it is there for.
      await this.talkers.update(
        { tenantId, id: In(ids), blockedAt: IsNull() },
        { ipHash: null },
      );
    }
    await this.chats.markErased(tenantId, chatIds);
    return { chats: chatIds.length, messages };
  }
}
