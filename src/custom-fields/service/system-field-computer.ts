import { Chat } from '../../chat/entity/chat.entity';
import { CallDetails } from '../../chat/entity/call.details.entity';
import { ScribeSessionMode } from '../../common/constants/chat.constants';

/**
 * Data needed to compute any SYSTEM-fillMode custom field's value for one
 * chat. Resolved once per getValues() call and reused across every SYSTEM
 * definition for that chat — not refetched per field.
 */
export interface SystemFieldContext {
  chat: Chat;
  callDetails: CallDetails | null;
  /** Assigned counselor's display name, already resolved via UserService. */
  counselorName: string | null;
}

/**
 * One computer per SYSTEM-fillMode seedKey, mirroring the exact source each
 * field reads from today (chat-summary.service.ts / CallSummary.tsx)
 * without any display formatting — locale-sensitive formatting (minutes,
 * dates, percentages) is applied client-side per seedKey instead, so a
 * value here is always raw.
 *
 * `callDate` returns a single ISO timestamp (call start). `callTime`
 * returns two ISO timestamps joined by "|" (start and end), since the UI
 * shows it as a "HH:mm - HH:mm" range rather than one point in time.
 */
const SYSTEM_FIELD_COMPUTERS: Record<
  string,
  (ctx: SystemFieldContext) => string | null
> = {
  callId: (ctx) => ctx.chat.id.toString(),
  callDuration: (ctx) => ctx.callDetails?.callDuration?.toString() ?? null,
  callDate: (ctx) => ctx.callDetails?.startTime?.toISOString() ?? null,
  callTime: (ctx) =>
    ctx.chat.startedAt && ctx.chat.endedAt
      ? `${ctx.chat.startedAt.toISOString()}|${ctx.chat.endedAt.toISOString()}`
      : null,
  clientId: (ctx) =>
    ctx.chat.clientId != null && ctx.chat.clientId !== -1
      ? ctx.chat.clientId.toString()
      : null,
  // seedKey matches ally-web's SummaryFieldKey.CounsellorName VALUE
  // ("counselorName", single L) — see default-field-templates.constants.ts.
  counselorName: (ctx) => ctx.counselorName,
  listeningShare: (ctx) =>
    ctx.callDetails?.callInfo?.clientTalkingPercentage != null
      ? ctx.callDetails.callInfo.clientTalkingPercentage.toString()
      : null,
  mode: (ctx) => {
    const mode = ctx.callDetails?.callInfo?.mode ?? ScribeSessionMode.SCRIBE;
    return mode === ScribeSessionMode.DICTATION ? 'Dictation' : 'Scribe';
  },
};

export const SYSTEM_FIELD_SEED_KEYS = Object.keys(SYSTEM_FIELD_COMPUTERS);

export function isSystemFieldSeedKey(
  seedKey: string | null | undefined,
): boolean {
  return !!seedKey && seedKey in SYSTEM_FIELD_COMPUTERS;
}

export function computeSystemFieldValue(
  seedKey: string,
  ctx: SystemFieldContext,
): string | null {
  const computer = SYSTEM_FIELD_COMPUTERS[seedKey];
  return computer ? computer(ctx) : null;
}
