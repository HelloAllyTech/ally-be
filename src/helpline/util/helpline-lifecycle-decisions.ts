import {
  HELPLINE_TIMINGS,
  HelplineChatStatus,
  HelplineEndedReason,
} from '../constants/helpline.constants';

/**
 * The lifecycle sweep's rules (contract §6.5) as a pure function of chat
 * state, connection liveness and time, so every row of that table is a unit
 * test rather than a timing-dependent integration test.
 */

export type SweepAction =
  | { type: 'END'; reason: HelplineEndedReason }
  | { type: 'MARK_ABANDONED' }
  | { type: 'CLEAR_ABANDONED' }
  | { type: 'LISTENER_RECONNECTING' }
  | { type: 'LISTENER_BACK' }
  | { type: 'LISTENER_GONE_FLAG' }
  | { type: 'LISTENER_GONE_CLEAR' }
  | { type: 'LISTENER_GONE_ALERT' };

export interface SweepChatState {
  status: HelplineChatStatus;
  waitStartedAt: Date;
  abandonedAt: Date | null;
  listenerId: number | null;
}

export interface SweepContext {
  now: Date;
  maxWaitMinutes: number;
  idleEndMinutes: number;
  /** null = the talker's connection key is live. */
  talkerGoneSince: Date | null;
  /** null = the listener's connection key is live (or there is no listener). */
  listenerGoneSince: Date | null;
  /** Per-chat once-flags, kept in Redis. */
  reconnectingSent: boolean;
  listenerFlagged: boolean;
  alertSent: boolean;
}

const elapsed = (since: Date | null, now: Date): number =>
  since ? now.getTime() - since.getTime() : 0;

export function decideSweepActions(
  chat: SweepChatState,
  ctx: SweepContext,
): SweepAction[] {
  const { now } = ctx;

  if (chat.status === HelplineChatStatus.WAITING) {
    // Expiry first: a talker who waited past the limit is told so, whatever
    // their connection state.
    if (elapsed(chat.waitStartedAt, now) > ctx.maxWaitMinutes * 60_000) {
      return [{ type: 'END', reason: HelplineEndedReason.WAIT_EXPIRED }];
    }
    if (chat.abandonedAt) {
      if (!ctx.talkerGoneSince) return [{ type: 'CLEAR_ABANDONED' }];
      if (
        elapsed(chat.abandonedAt, now) >
        HELPLINE_TIMINGS.ABANDONED_EXPIRE_AFTER_MS
      ) {
        return [{ type: 'END', reason: HelplineEndedReason.QUEUE_ABANDONED }];
      }
      return [];
    }
    if (
      ctx.talkerGoneSince &&
      elapsed(ctx.talkerGoneSince, now) >=
        HELPLINE_TIMINGS.WAITING_ABANDON_AFTER_MS
    ) {
      return [{ type: 'MARK_ABANDONED' }];
    }
    return [];
  }

  if (chat.status !== HelplineChatStatus.ACTIVE) return [];

  if (
    ctx.talkerGoneSince &&
    elapsed(ctx.talkerGoneSince, now) >= ctx.idleEndMinutes * 60_000
  ) {
    return [{ type: 'END', reason: HelplineEndedReason.TALKER_DISCONNECTED }];
  }

  if (chat.listenerId == null) return [];

  const actions: SweepAction[] = [];
  if (!ctx.listenerGoneSince) {
    if (ctx.reconnectingSent) actions.push({ type: 'LISTENER_BACK' });
    if (ctx.listenerFlagged) actions.push({ type: 'LISTENER_GONE_CLEAR' });
    return actions;
  }

  const gone = elapsed(ctx.listenerGoneSince, now);
  if (
    gone >= HELPLINE_TIMINGS.LISTENER_RECONNECTING_AFTER_MS &&
    !ctx.reconnectingSent
  ) {
    actions.push({ type: 'LISTENER_RECONNECTING' });
  }
  if (gone >= HELPLINE_TIMINGS.LISTENER_FLAG_AFTER_MS && !ctx.listenerFlagged) {
    actions.push({ type: 'LISTENER_GONE_FLAG' });
  }
  if (gone >= HELPLINE_TIMINGS.LISTENER_ALERT_AFTER_MS && !ctx.alertSent) {
    actions.push({ type: 'LISTENER_GONE_ALERT' });
  }
  return actions;
}
