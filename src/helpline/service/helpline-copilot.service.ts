import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  HelplinePromptOverrides,
  HelplineRiskResponse,
  HelplineTurnResponse,
} from 'src/ai/dto/helpline-copilot.dto';
import { AiService } from 'src/ai/service/ai.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  HelplineMessageType,
  HelplineRiskSource,
  HelplineRooms,
  HelplineSenderRole,
  HelplineServerEvents,
  HelplineSummaryKind,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import {
  HelplineCopilotStatus,
  HelplineSettings,
} from '../type/helpline.types';
import {
  HELPLINE_COPILOT,
  HELPLINE_PROMPT_CODES,
  classifierAddsFlag,
  cleanNudge,
  cleanStage,
  cleanSubject,
  cleanSuggestions,
  copilotStatusFor,
  isRollingSummaryTurn,
  latestStage,
  mapRiskVerdict,
  rollingSummaryText,
  shouldIncludeNudge,
  signalOffsets,
  toCopilotTurns,
  wantsCopilotTurn,
} from '../util/helpline-copilot.util';
import { toStaffMessageDto } from '../util/helpline-serializers';
import { HelplineMessageWriter } from './helpline-message-writer.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineRiskService } from './helpline-risk.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineSummaryService } from './helpline-summary.service';
import { HelplineTenantService } from './helpline-tenant.service';

/**
 * The seam the copilot orchestration plugs into (contract §9.2).
 *
 * Callers invoke these AFTER the message is persisted and emitted, and never
 * await them on the delivery path (invariant 3). Each returns synchronously,
 * runs its work detached with hard timeouts, and swallows its own errors.
 */
export interface HelplineCopilotHooks {
  onTalkerMessage(chat: HelplineChat, message: HelplineMessage): void;
  onListenerMessage(chat: HelplineChat, message: HelplineMessage): void;
  onChatClaimed(chat: HelplineChat, previousListenerId: number | null): void;
  onChatEnded(chat: HelplineChat): void;
  status(
    chat: HelplineChat,
    settings: HelplineSettings,
  ): Promise<HelplineCopilotStatus>;
  stage(chat: HelplineChat): Promise<string | null>;
}

/** Fixed staff-only body of a SUGGESTION row; the drafts live in metadata. */
export const SUGGESTION_CONTENT = 'Suggested replies';

/**
 * The listener's copilot (contract §9.2): for every talker TEXT, off the
 * delivery path —
 *
 *  1. the **risk classifier** (ally-ai `/helpline/risk`, 3 s, no retry),
 *     raising flags through `HelplineRiskService.raiseFlag` — the same path as
 *     the keyword screen — deduped against the flags the message already has;
 *  2. a **copilot turn** (ally-ai `/helpline/turn`, 6 s), debounced 2.5 s per
 *     talker burst across replicas (`hl:copilot:latest:{chatId}`), ACTIVE
 *     chats only: suggested replies, the stage and a sparse nudge, held while
 *     the listener is typing (≤ 4 s);
 *  3. a **rolling summary** every `rollingSummaryEveryTurns` talker turns.
 *
 * A failure emits `COPILOT_STATUS: UNAVAILABLE` and nothing else — no partial
 * output, no retry storm (see the Stacks chunk "Graceful Failure: Transparent
 * Acknowledgment and Fallbacks"). Nothing here ever reaches a talker: every
 * row it writes is staff-only and every emit goes to `staff:{chatId}`.
 */
@Injectable()
export class HelplineCopilotService
  implements HelplineCopilotHooks, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    HelplineCopilotService.name,
  );
  private readonly turnTimers = new Map<string, NodeJS.Timeout>();
  private promptCache: {
    value: HelplinePromptOverrides;
    expires: number;
  } | null = null;

  constructor(
    private readonly aiService: AiService,
    private readonly promptShared: PromptSharedService,
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    private readonly writer: HelplineMessageWriter,
    private readonly risk: HelplineRiskService,
    private readonly presence: HelplinePresenceService,
    private readonly realtime: HelplineRealtimeService,
    private readonly settings: HelplineSettingsService,
    private readonly tenants: HelplineTenantService,
    private readonly summaries: HelplineSummaryService,
  ) {}

  onModuleDestroy(): void {
    this.turnTimers.forEach((timer) => clearTimeout(timer));
    this.turnTimers.clear();
  }

  // ── Hooks ────────────────────────────────────────────────────────────────

  onTalkerMessage(chat: HelplineChat, message: HelplineMessage): void {
    if (
      message.type !== HelplineMessageType.TEXT ||
      message.senderRole !== HelplineSenderRole.TALKER
    ) {
      return;
    }
    // A snapshot: the caller's object keeps changing after we return.
    const snapshot = { ...chat } as HelplineChat;
    this.detach('talker message', () =>
      this.handleTalkerMessage(snapshot, message),
    );
  }

  onListenerMessage(chat: HelplineChat, message: HelplineMessage): void {
    const from = message.metadata?.fromSuggestion as
      | { messageId?: unknown; index?: unknown }
      | undefined;
    if (!from) return;
    const messageId = Number(from.messageId);
    const index = Number(from.index);
    if (!Number.isInteger(messageId) || !Number.isInteger(index)) return;
    this.detach('suggestion accepted', () =>
      this.messages.markSuggestionAccepted(
        chat.tenantId,
        chat.id,
        messageId,
        index,
      ),
    );
  }

  /**
   * A listener just took a chat the talker has already written in (in the
   * waiting room, or before a transfer): draft replies to the latest talker
   * message now rather than after the talker writes again — the first reply
   * is the one a listener most needs help with. One turn per claim.
   */
  onChatClaimed(chat: HelplineChat, previousListenerId: number | null): void {
    void previousListenerId;
    if (chat.talkerMessageCount < 1) return;
    this.detach('claim turn', async () => {
      const latest = await this.presence
        .getCopilotLatest(chat.id)
        .catch(() => null);
      if (latest != null) await this.runTurn(chat.tenantId, chat.id, latest);
    });
  }

  onChatEnded(chat: HelplineChat): void {
    const timer = this.turnTimers.get(chat.id);
    if (timer) clearTimeout(timer);
    this.turnTimers.delete(chat.id);
  }

  async status(
    chat: HelplineChat,
    settings: HelplineSettings,
  ): Promise<HelplineCopilotStatus> {
    return copilotStatusFor(
      settings,
      await this.presence.getCopilotStatus(chat.id).catch(() => null),
    );
  }

  async stage(chat: HelplineChat): Promise<string | null> {
    const row = await this.messages.latestOfType(
      chat.tenantId,
      chat.id,
      HelplineMessageType.STAGE,
    );
    return row ? latestStage([row]) : null;
  }

  // ── Talker message ───────────────────────────────────────────────────────

  /** Exposed for specs; production reaches it only through `onTalkerMessage`. */
  async handleTalkerMessage(
    chat: HelplineChat,
    message: HelplineMessage,
  ): Promise<void> {
    // First, so a turn already scheduled on any replica sees it is stale.
    await this.presence
      .setCopilotLatest(chat.id, message.id)
      .catch(() => undefined);
    const settings = await this.settingsFor(chat.tenantId);
    if (!settings) return;

    const risk = settings.copilot.riskClassifier
      ? this.classify(chat, message, settings)
      : Promise.resolve();
    if (wantsCopilotTurn(chat, settings)) {
      this.scheduleTurn(chat, message.id, risk);
    }
    await risk;

    if (
      isRollingSummaryTurn(
        chat.talkerMessageCount,
        settings.copilot.rollingSummaryEveryTurns,
      )
    ) {
      this.summaries.scheduleRolling(chat);
    }
  }

  /**
   * Step 2: the risk classifier. Never throws (the turn awaits it). A failed
   * call records no flag and marks the copilot UNAVAILABLE; the keyword
   * screen, which already ran, is what still stands.
   */
  async classify(
    chat: HelplineChat,
    message: HelplineMessage,
    settings: HelplineSettings,
  ): Promise<void> {
    try {
      const before = await this.messages.recentTextTurns(
        chat.tenantId,
        chat.id,
        HELPLINE_COPILOT.RISK_RECENT_TURNS + 1,
      );
      const recent = toCopilotTurns(
        before.filter((m) => m.id < message.id),
      ).slice(-HELPLINE_COPILOT.RISK_RECENT_TURNS);

      let verdict: HelplineRiskResponse | null = null;
      try {
        verdict = await this.aiService.classifyHelplineRisk({
          message: message.content,
          recent,
          language: chat.language,
          prompts: await this.promptOverrides(),
        });
      } catch (error) {
        this.logger.warn(
          `Helpline risk classifier unreachable for chat ${chat.id}: ${(error as Error).message}`,
        );
      }
      if (!verdict || verdict.failed) {
        await this.setStatus(chat, 'UNAVAILABLE');
        return;
      }
      await this.setStatus(chat, 'OK');

      const level = mapRiskVerdict(verdict, settings.riskHighConfidence);
      if (!level) return;
      const existing = await this.risk.flagsForMessage(chat, message.id);
      if (!classifierAddsFlag(existing, level)) return;

      const offsets = signalOffsets(message.content, verdict.signal);
      const current =
        (await this.chats.findById(chat.tenantId, chat.id)) ?? chat;
      await this.risk.raiseFlag(current, message, {
        level,
        source: HelplineRiskSource.CLASSIFIER,
        confidence: Number.isFinite(Number(verdict.confidence))
          ? Number(verdict.confidence)
          : null,
        subject: cleanSubject(verdict.subject),
        ruleId: null,
        signalStart: offsets?.start ?? null,
        signalEnd: offsets?.end ?? null,
      });
    } catch (error) {
      this.logger.error(
        `Helpline risk classification failed for chat ${chat.id}: ${(error as Error).message}`,
      );
    }
  }

  // ── Copilot turn ─────────────────────────────────────────────────────────

  /**
   * Debounce per talker burst: this replica's own pending turn for the chat
   * is replaced, and when the timer fires the Redis token decides — any newer
   * talker message, on any replica, cancels it.
   */
  private scheduleTurn(
    chat: HelplineChat,
    messageId: number,
    risk: Promise<void>,
  ): void {
    const pending = this.turnTimers.get(chat.id);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      this.turnTimers.delete(chat.id);
      this.detach('copilot turn', () =>
        this.runTurn(chat.tenantId, chat.id, messageId, risk),
      );
    }, HELPLINE_COPILOT.TURN_DEBOUNCE_MS);
    timer.unref?.();
    this.turnTimers.set(chat.id, timer);
  }

  /** Exposed for specs; production reaches it only through the debounce. */
  async runTurn(
    tenantId: string,
    chatId: string,
    messageId: number,
    risk: Promise<void> = Promise.resolve(),
  ): Promise<void> {
    if (await this.superseded(chatId, messageId)) return;
    // The classifier's flag (if any) should shape this turn's first suggestion.
    await risk.catch(() => undefined);

    const chat = await this.chats.findById(tenantId, chatId);
    if (!chat) return;
    const settings = await this.settingsFor(tenantId);
    if (!settings || !wantsCopilotTurn(chat, settings)) return;

    const includeNudge = shouldIncludeNudge(settings, chat);
    const [turns, rolling, subject] = await Promise.all([
      this.messages.recentTextTurns(
        tenantId,
        chatId,
        HELPLINE_COPILOT.TURN_CONTEXT_TURNS,
      ),
      this.summaries.readFields(tenantId, chatId, HelplineSummaryKind.ROLLING),
      this.risk.latestSubject(chat),
    ]);

    let response: HelplineTurnResponse | null = null;
    try {
      response = await this.aiService.generateHelplineTurn({
        messages: toCopilotTurns(turns),
        rolling_summary: rolling
          ? rollingSummaryText(rolling, settings.summaryFields)
          : '',
        language: chat.language,
        include_nudge: includeNudge,
        risk_level: chat.riskLevel,
        risk_subject: subject ?? '',
        prompts: await this.promptOverrides(),
      });
    } catch (error) {
      this.logger.warn(
        `Helpline copilot turn unreachable for chat ${chatId}: ${(error as Error).message}`,
      );
    }
    if (!response || response.failed) {
      await this.setStatus(chat, 'UNAVAILABLE');
      return;
    }

    // Don't draft over the listener mid-sentence: hold up to 4 s, then go.
    await this.holdWhileListenerTypes(chatId);
    if (await this.superseded(chatId, messageId)) return;
    const current = await this.chats.findById(tenantId, chatId);
    if (!current || !wantsCopilotTurn(current, settings)) return;

    await this.deliverTurn(
      current,
      messageId,
      response,
      settings,
      includeNudge,
    );
    await this.setStatus(current, 'OK');
  }

  private async deliverTurn(
    chat: HelplineChat,
    parentMessageId: number,
    response: HelplineTurnResponse,
    settings: HelplineSettings,
    includeNudge: boolean,
  ): Promise<void> {
    const room = HelplineRooms.staff(chat.id);

    const suggestions = settings.copilot.suggestions
      ? cleanSuggestions(response.suggestions)
      : [];
    // An empty list is never persisted: no row is better than an empty card.
    if (suggestions.length) {
      const row = await this.writer.staffOnly(
        chat,
        HelplineMessageType.SUGGESTION,
        SUGGESTION_CONTENT,
        { suggestions },
        {
          senderRole: HelplineSenderRole.COPILOT,
          parentMessageId,
          emit: false,
        },
      );
      await this.realtime.emit(room, HelplineServerEvents.SUGGESTIONS, {
        chatId: chat.id,
        message: toStaffMessageDto(row, null),
      });
    }

    const nudge = cleanNudge(response.nudge, includeNudge);
    if (nudge) {
      const row = await this.writer.staffOnly(
        chat,
        HelplineMessageType.NUDGE,
        nudge,
        {},
        {
          senderRole: HelplineSenderRole.COPILOT,
          parentMessageId,
          emit: false,
        },
      );
      await this.chats.recordNudge(chat.tenantId, chat.id);
      await this.realtime.emit(room, HelplineServerEvents.NUDGE, {
        chatId: chat.id,
        message: toStaffMessageDto(row, null),
      });
    }

    const stage = cleanStage(response.stage);
    if (stage) {
      const previous = await this.messages.latestOfType(
        chat.tenantId,
        chat.id,
        HelplineMessageType.STAGE,
      );
      if (latestStage(previous ? [previous] : []) !== stage) {
        await this.writer.staffOnly(
          chat,
          HelplineMessageType.STAGE,
          stage,
          { stage },
          {
            senderRole: HelplineSenderRole.COPILOT,
            parentMessageId,
            emit: false,
          },
        );
        await this.realtime.emit(room, HelplineServerEvents.STAGE, {
          chatId: chat.id,
          stage,
        });
      }
    }
  }

  /** True when a newer talker message exists (on any replica). */
  private async superseded(
    chatId: string,
    messageId: number,
  ): Promise<boolean> {
    const latest = await this.presence
      .getCopilotLatest(chatId)
      .catch(() => null);
    return latest != null && latest !== messageId;
  }

  private async holdWhileListenerTypes(chatId: string): Promise<void> {
    const deadline = Date.now() + HELPLINE_COPILOT.TYPING_HOLD_MAX_MS;
    while (Date.now() < deadline) {
      const typing = await this.presence
        .isListenerTyping(chatId)
        .catch(() => false);
      if (!typing) return;
      await sleep(HELPLINE_COPILOT.TYPING_POLL_MS);
    }
  }

  // ── Shared ───────────────────────────────────────────────────────────────

  /** Record the outcome; emit COPILOT_STATUS only when it changes. */
  private async setStatus(
    chat: Pick<HelplineChat, 'id'>,
    status: 'OK' | 'UNAVAILABLE',
  ): Promise<void> {
    const previous = await this.presence
      .swapCopilotStatus(chat.id, status)
      .catch(() => null);
    if (previous === status) return;
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.COPILOT_STATUS,
      { chatId: chat.id, status },
    );
  }

  private async settingsFor(
    tenantId: string,
  ): Promise<HelplineSettings | null> {
    const tenant = await this.tenants.resolve(tenantId);
    return tenant ? this.settings.getSettings(tenant) : null;
  }

  /**
   * Prompt overrides keyed by full code, as ally-ai's helpline service reads
   * them (cached 60 s). The prompt TEXT is sent only when an admin switched the
   * row to its dashboard override: otherwise the row holds a seeded copy that
   * can be older than ally-ai's own file, and sending it would silently undo a
   * prompt fix. Provider / model / temperature are sent whenever set.
   */
  private async promptOverrides(): Promise<HelplinePromptOverrides> {
    if (this.promptCache && this.promptCache.expires > Date.now()) {
      return this.promptCache.value;
    }
    let value: HelplinePromptOverrides = {};
    try {
      const rows = await this.promptShared.getPromptsByOptions({
        promptCode: [...HELPLINE_PROMPT_CODES],
      });
      value = (rows ?? []).reduce<HelplinePromptOverrides>((acc, row) => {
        const entry: HelplinePromptOverrides[string] = {};
        const dashboard =
          (row as { useDashboardOverride?: boolean }).useDashboardOverride ===
          true;
        if (dashboard && row.prompt?.trim()) {
          entry.prompt = row.prompt.trim();
          if (row.availableVariables) {
            entry.availableVariables = row.availableVariables;
          }
        }
        if (row.provider) entry.provider = row.provider;
        if (row.model) entry.model = row.model;
        if (typeof row.temperature === 'number') {
          entry.temperature = row.temperature;
        }
        if (Object.keys(entry).length) acc[row.promptCode] = entry;
        return acc;
      }, {});
    } catch (error) {
      this.logger.warn(
        `Helpline prompt overrides unavailable; ally-ai defaults apply: ${(error as Error).message}`,
      );
    }
    this.promptCache = {
      value,
      expires: Date.now() + HELPLINE_COPILOT.PROMPT_CACHE_MS,
    };
    return value;
  }

  /** Run detached; never throws into the caller, logs no content. */
  private detach(what: string, fn: () => Promise<unknown>): void {
    try {
      void fn().catch((error) =>
        this.logger.error(
          `Helpline copilot (${what}) failed: ${(error as Error)?.message}`,
        ),
      );
    } catch (error) {
      this.logger.error(
        `Helpline copilot (${what}) threw: ${(error as Error)?.message}`,
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
