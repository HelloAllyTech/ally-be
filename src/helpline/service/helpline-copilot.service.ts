import { Injectable } from '@nestjs/common';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineMessage } from '../entity/helpline-message.entity';
import {
  HelplineCopilotStatus,
  HelplineSettings,
} from '../type/helpline.types';

/**
 * The seam the copilot orchestration (contract §9.2 steps 2–4: risk
 * classifier, copilot turn, rolling / handoff summaries) plugs into.
 *
 * Callers invoke these AFTER the message is persisted and emitted, and never
 * await them on the delivery path (invariant 3: a copilot failure never delays
 * message delivery). An implementation must therefore return quickly, run its
 * work detached with its own hard timeouts, and swallow its own errors —
 * emitting `COPILOT_STATUS: UNAVAILABLE` on failure and nothing else.
 */
export interface HelplineCopilotHooks {
  /** A talker TEXT was persisted and delivered (keyword screen already ran). */
  onTalkerMessage(chat: HelplineChat, message: HelplineMessage): void;
  /** A listener / supervisor TEXT was persisted and delivered. */
  onListenerMessage(chat: HelplineChat, message: HelplineMessage): void;
  /** A listener claimed the chat (first claim or a transfer claim). */
  onChatClaimed(chat: HelplineChat, previousListenerId: number | null): void;
  /** The chat ended (after the FINAL summary was kicked off). */
  onChatEnded(chat: HelplineChat): void;
  /** What ChatDetailDto.copilot reports. */
  status(chat: HelplineChat, settings: HelplineSettings): HelplineCopilotStatus;
  /** The current conversation stage, if the copilot tracks one. */
  stage(chat: HelplineChat): string | null;
}

/**
 * Phase-1 implementation: the copilot is not wired yet, so every hook is a
 * deliberate no-op and the status is honestly `OFF`. The second backend pass
 * replaces these bodies; no caller changes.
 */
@Injectable()
export class HelplineCopilotService implements HelplineCopilotHooks {
  onTalkerMessage(chat: HelplineChat, message: HelplineMessage): void {
    void chat;
    void message;
  }

  onListenerMessage(chat: HelplineChat, message: HelplineMessage): void {
    void chat;
    void message;
  }

  onChatClaimed(chat: HelplineChat, previousListenerId: number | null): void {
    void chat;
    void previousListenerId;
  }

  onChatEnded(chat: HelplineChat): void {
    void chat;
  }

  status(
    chat: HelplineChat,
    settings: HelplineSettings,
  ): HelplineCopilotStatus {
    void chat;
    void settings;
    return 'OFF';
  }

  stage(chat: HelplineChat): string | null {
    void chat;
    return null;
  }
}
