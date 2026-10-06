/**
 * Text helpline — enums and fixed numbers.
 *
 * The contract every surface builds against is `docs/text-helpline.md`; the
 * values here are its §4 enums verbatim. Each enum-backed column has a CHECK
 * constraint in `1975700000000-CreateTextHelpline.ts`, and
 * `check-constraints-cover-enums.spec.ts` fails if the two drift.
 */

export enum HelplineChannel {
  TEXT_WEB = 'TEXT_WEB',
  TEXT_WHATSAPP = 'TEXT_WHATSAPP',
}

export enum HelplineChatStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
}

export enum HelplineEndedReason {
  LISTENER_ENDED = 'LISTENER_ENDED',
  TALKER_ENDED = 'TALKER_ENDED',
  TALKER_LEFT_QUEUE = 'TALKER_LEFT_QUEUE',
  TALKER_DISCONNECTED = 'TALKER_DISCONNECTED',
  WAIT_EXPIRED = 'WAIT_EXPIRED',
  QUEUE_ABANDONED = 'QUEUE_ABANDONED',
  SUPERVISOR_ENDED = 'SUPERVISOR_ENDED',
  TALKER_ERASED = 'TALKER_ERASED',
  TALKER_BLOCKED = 'TALKER_BLOCKED',
}

/** The chat's denormalised max risk. */
export enum HelplineRiskLevel {
  NONE = 'NONE',
  ELEVATED = 'ELEVATED',
  HIGH = 'HIGH',
}

/** A single flag's level — a flag is never NONE. */
export enum HelplineRiskFlagLevel {
  ELEVATED = 'ELEVATED',
  HIGH = 'HIGH',
}

export enum HelplineRiskSource {
  KEYWORD = 'KEYWORD',
  CLASSIFIER = 'CLASSIFIER',
}

export enum HelplineRiskSubject {
  SELF = 'SELF',
  OTHER = 'OTHER',
  UNCLEAR = 'UNCLEAR',
}

export enum HelplineRiskOutcome {
  UNREVIEWED = 'UNREVIEWED',
  CONFIRMED = 'CONFIRMED',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
}

export enum HelplineKeywordMatchType {
  /** Substring of the normalised text. For Indic stems, which inflect. */
  CONTAINS = 'CONTAINS',
  /** Whole words (or a whole phrase) of the normalised text. */
  WORD = 'WORD',
}

export enum HelplineQaStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

export enum HelplineSenderRole {
  TALKER = 'TALKER',
  LISTENER = 'LISTENER',
  SUPERVISOR = 'SUPERVISOR',
  SYSTEM = 'SYSTEM',
  COPILOT = 'COPILOT',
}

export enum HelplineMessageType {
  TEXT = 'TEXT',
  SYSTEM = 'SYSTEM',
  SUGGESTION = 'SUGGESTION',
  NUDGE = 'NUDGE',
  STAGE = 'STAGE',
  RISK = 'RISK',
  WHISPER = 'WHISPER',
  TRANSFER = 'TRANSFER',
}

/**
 * The only message types that may EVER be talker-visible. Mirrors the DB
 * CHECK `type IN ('TEXT','SYSTEM') OR visible_to_talker = false`.
 */
export const TALKER_VISIBLE_MESSAGE_TYPES: readonly HelplineMessageType[] = [
  HelplineMessageType.TEXT,
  HelplineMessageType.SYSTEM,
];

/** SYSTEM message kinds a talker may see (contract §5.2 `GuestSystemKind`). */
export enum HelplineGuestSystemKind {
  ACCEPTED = 'ACCEPTED',
  RESOURCES = 'RESOURCES',
  CLOSING = 'CLOSING',
  TRANSFERRING = 'TRANSFERRING',
  LISTENER_RECONNECTING = 'LISTENER_RECONNECTING',
  LISTENER_BACK = 'LISTENER_BACK',
  ENDED = 'ENDED',
}

/** SYSTEM message kinds that are staff-only (`visible_to_talker = false`). */
export enum HelplineStaffSystemKind {
  TALKER_DISCONNECTED = 'TALKER_DISCONNECTED',
  TALKER_RECONNECTED = 'TALKER_RECONNECTED',
  TAKEN_OVER = 'TAKEN_OVER',
  TRANSFERRED = 'TRANSFERRED',
  ASSIGNED = 'ASSIGNED',
  /** The listener pressed "Alert supervisor"; content = their optional note. */
  SUPERVISOR_REQUESTED = 'SUPERVISOR_REQUESTED',
}

export enum HelplineChatEventType {
  ENQUEUED = 'ENQUEUED',
  CLAIMED = 'CLAIMED',
  TALKER_DISCONNECTED = 'TALKER_DISCONNECTED',
  TALKER_RECONNECTED = 'TALKER_RECONNECTED',
  LISTENER_DISCONNECTED = 'LISTENER_DISCONNECTED',
  LISTENER_RECONNECTED = 'LISTENER_RECONNECTED',
  TRANSFER_REQUESTED = 'TRANSFER_REQUESTED',
  TRANSFERRED = 'TRANSFERRED',
  ASSIGNED = 'ASSIGNED',
  TAKEN_OVER = 'TAKEN_OVER',
  RESOURCES_SENT = 'RESOURCES_SENT',
  RISK_FLAGGED = 'RISK_FLAGGED',
  RISK_ACKNOWLEDGED = 'RISK_ACKNOWLEDGED',
  SUPERVISOR_ALERTED = 'SUPERVISOR_ALERTED',
  ENDED = 'ENDED',
  ERASURE_REQUESTED = 'ERASURE_REQUESTED',
  TALKER_BLOCKED = 'TALKER_BLOCKED',
}

export enum HelplineSummaryKind {
  ROLLING = 'ROLLING',
  HANDOFF = 'HANDOFF',
  FINAL = 'FINAL',
}

export enum HelplinePresence {
  AVAILABLE = 'AVAILABLE',
  AWAY = 'AWAY',
  OFFLINE = 'OFFLINE',
}

export enum HelplineAccess {
  LISTENER = 'LISTENER',
  READ_ONLY = 'READ_ONLY',
}

/** Languages a talker may chat in and an org may offer. */
export const HELPLINE_LANGUAGES = ['en', 'hi', 'mr', 'ta', 'kn'] as const;
export type HelplineLanguage = (typeof HELPLINE_LANGUAGES)[number];

/**
 * The consent text version the talker page shows (contract §7, Phase 0 draft).
 * Bump it whenever that copy changes: a session created against an older
 * version is refused with HELPLINE_CONSENT_OUTDATED, so nobody starts a chat on
 * terms they were not shown.
 */
export const HELPLINE_CONSENT_VERSION = '2026-10-05';

export const HELPLINE_GUEST = {
  AUDIENCE: 'helpline-guest',
  TOKEN_TYPE: 'helpline_guest',
  /** Domain-separation label for deriving the signing secret. */
  SECRET_LABEL: 'helpline-guest-v1',
  /** Domain-separation label for deriving the ip-hash salt. */
  IP_SALT_LABEL: 'helpline-ip-salt-v1',
  TTL_SECONDS: 24 * 60 * 60,
  /** A token may be refreshed until this long after the chat ended. */
  REFRESH_AFTER_END_MS: 24 * 60 * 60 * 1000,
} as const;

export const HELPLINE_LIMITS = {
  MESSAGE_MAX_CHARS: 2000,
  DISPLAY_NAME_MAX_CHARS: 40,
  DEFAULT_DISPLAY_NAME: 'Anonymous',
  LOBBY_PREVIEW_CHARS: 140,
  OUTCOME_NOTE_MAX_CHARS: 500,
  SUPERVISOR_NOTE_MAX_CHARS: 300,
  FEEDBACK_COMMENT_MAX_CHARS: 1000,
  SUMMARY_VALUE_MAX_CHARS: 4000,
  SUMMARY_MAX_FIELDS: 20,
  /** Per-socket token bucket: 1 message/s sustained, burst 5 (contract §6.3). */
  SOCKET_BUCKET_CAPACITY: 5,
  SOCKET_BUCKET_REFILL_PER_SECOND: 1,
  /** Typing events from one socket are relayed at most this often. */
  TYPING_MIN_INTERVAL_MS: 1000,
  TEAM_MAX_ITEMS: 1000,
  CHAT_LIST_MAX_LIMIT: 100,
} as const;

export const HELPLINE_TIMINGS = {
  /** `hl:conn:*` liveness keys; refreshed on connect and every HEARTBEAT (15 s). */
  CONN_TTL_SECONDS: 45,
  TYPING_TTL_SECONDS: 4,
  STATUS_CACHE_TTL_SECONDS: 10,
  /** How long a "missing since" (`hl:gone:*`) marker outlives its participant. */
  GONE_TTL_SECONDS: 2 * 24 * 60 * 60,
  /** Per-chat once-flags (reconnecting notice sent, alert sent …). */
  FLAG_TTL_SECONDS: 2 * 24 * 60 * 60,
  SWEEP_INTERVAL_MS: 15_000,
  SWEEP_LOCK_SECONDS: 14,
  WAITING_ABANDON_AFTER_MS: 2 * 60 * 1000,
  ABANDONED_EXPIRE_AFTER_MS: 10 * 60 * 1000,
  LISTENER_RECONNECTING_AFTER_MS: 30 * 1000,
  LISTENER_FLAG_AFTER_MS: 3 * 60 * 1000,
  LISTENER_ALERT_AFTER_MS: 10 * 60 * 1000,
  BLOCK_WINDOW_MS: 24 * 60 * 60 * 1000,
  TENANT_CACHE_MS: 5 * 60 * 1000,
  SETTINGS_CACHE_MS: 15 * 1000,
  RULE_CACHE_MS: 60 * 1000,
  /** Lobby recomputes are coalesced per tenant over this window. */
  QUEUE_UPDATE_DEBOUNCE_MS: 250,
  /** Hard ceiling on the FINAL summary call; it runs off the request path. */
  SUMMARY_TIMEOUT_MS: 90_000,
  /** ROLLING / HANDOFF: shorter — a stale rolling summary is worth little. */
  ROLLING_SUMMARY_TIMEOUT_MS: 60_000,
  LAST_SEEN_WRITE_INTERVAL_MS: 60_000,
} as const;

/** Median of the last N claimed waits, only with ≥ MIN samples in the window. */
export const HELPLINE_WAIT_ESTIMATE = {
  SAMPLE_SIZE: 20,
  MIN_SAMPLES: 5,
  WINDOW_DAYS: 7,
} as const;

export const HELPLINE_RETENTION = {
  BATCH_SIZE: 500,
  /** What every blanked body becomes. Same placeholder as the WhatsApp sweep. */
  ERASED: '[erased]',
} as const;

/** Socket.io rooms in the `/helpline-chat` namespace (contract §6.1). */
export const HelplineRooms = {
  talker: (chatId: string) => `talker:${chatId}`,
  staff: (chatId: string) => `staff:${chatId}`,
  user: (userId: number) => `user:${userId}`,
  lobby: (tenantId: string) => `lobby:${tenantId}`,
  supervisors: (tenantId: string) => `supervisors:${tenantId}`,
} as const;

export const HELPLINE_NAMESPACE = '/helpline-chat';

/** Client → server socket events (contract §6.3). */
export const HelplineClientEvents = {
  SEND_MESSAGE: 'SEND_MESSAGE',
  USER_TYPING: 'USER_TYPING',
  USER_STOPPED_TYPING: 'USER_STOPPED_TYPING',
  SYNC_SINCE: 'SYNC_SINCE',
  JOIN_CHAT: 'JOIN_CHAT',
  LEAVE_CHAT: 'LEAVE_CHAT',
  PRESENCE_SET: 'PRESENCE_SET',
  HEARTBEAT: 'HEARTBEAT',
} as const;

/** Server → client socket events (contract §6.3). */
export const HelplineServerEvents = {
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  USER_TYPING: 'USER_TYPING',
  USER_STOPPED_TYPING: 'USER_STOPPED_TYPING',
  QUEUE_POSITION: 'QUEUE_POSITION',
  CHAT_ACCEPTED: 'CHAT_ACCEPTED',
  CHAT_UPDATED: 'CHAT_UPDATED',
  CHAT_ENDED: 'CHAT_ENDED',
  QUEUE_UPDATED: 'QUEUE_UPDATED',
  PRESENCE_UPDATED: 'PRESENCE_UPDATED',
  PARTICIPANT_STATUS: 'PARTICIPANT_STATUS',
  RISK_FLAGGED: 'RISK_FLAGGED',
  /** Additive to contract §6.3: an acknowledged/updated flag, so a banner can clear without re-alerting. */
  RISK_FLAG_UPDATED: 'RISK_FLAG_UPDATED',
  SUGGESTIONS: 'SUGGESTIONS',
  NUDGE: 'NUDGE',
  STAGE: 'STAGE',
  COPILOT_STATUS: 'COPILOT_STATUS',
  SUMMARY_UPDATED: 'SUMMARY_UPDATED',
  WHISPER: 'WHISPER',
  TRANSFER_REQUESTED: 'TRANSFER_REQUESTED',
  TRANSFERRED: 'TRANSFERRED',
  ALERT: 'ALERT',
  ERROR: 'ERROR',
} as const;

export type HelplineServerEvent =
  (typeof HelplineServerEvents)[keyof typeof HelplineServerEvents];

/**
 * The ONLY server events a `talker:{chatId}` room may receive. Anything else
 * addressed to a talker room is dropped by `HelplineRealtimeService` and again
 * by the gateway before it reaches a socket (invariants 1 and 2).
 */
export const TALKER_ROOM_EVENTS: ReadonlySet<string> = new Set<string>([
  HelplineServerEvents.MESSAGE_RECEIVED,
  HelplineServerEvents.USER_TYPING,
  HelplineServerEvents.USER_STOPPED_TYPING,
  HelplineServerEvents.QUEUE_POSITION,
  HelplineServerEvents.CHAT_ACCEPTED,
  HelplineServerEvents.CHAT_UPDATED,
  HelplineServerEvents.CHAT_ENDED,
  HelplineServerEvents.ERROR,
]);

/** Socket ack error strings (contract §6.3 plus `invalid` / `not_found`). */
export const HelplineAckErrors = {
  RATE_LIMITED: 'rate_limited',
  TOO_LONG: 'too_long',
  EMPTY: 'empty',
  CHAT_ENDED: 'chat_ended',
  NOT_ALLOWED: 'not_allowed',
  INVALID: 'invalid',
  NOT_FOUND: 'not_found',
  INTERNAL: 'internal_error',
} as const;

/**
 * English fallback copy for talker-visible SYSTEM messages. The client renders
 * its own localised copy from `systemKind`; RESOURCES and CLOSING are the
 * exceptions — they carry the org's own text in the talker's language.
 */
export const HELPLINE_SYSTEM_COPY = {
  ACCEPTED: (listenerName: string) =>
    `You're now chatting with ${listenerName}.`,
  TRANSFERRING: "You're being connected to another listener. Please stay here.",
  LISTENER_RECONNECTING:
    "Your listener's connection dropped. They're trying to reconnect — please stay here.",
  LISTENER_BACK: 'Your listener is back.',
  ENDED: 'This chat has ended.',
} as const;

/** Staff-only content of a RISK message, by source. Never the matched text. */
export const HELPLINE_RISK_MESSAGE_COPY = {
  [HelplineRiskSource.KEYWORD]: {
    [HelplineRiskFlagLevel.HIGH]:
      'Possible high risk detected (keyword match).',
    [HelplineRiskFlagLevel.ELEVATED]: 'Possible risk detected (keyword match).',
  },
  [HelplineRiskSource.CLASSIFIER]: {
    [HelplineRiskFlagLevel.HIGH]:
      'Possible high risk detected (AI risk check).',
    [HelplineRiskFlagLevel.ELEVATED]: 'Possible risk detected (AI risk check).',
  },
} as const;

/** Lobby priority for a WAITING chat once it is HIGH risk (contract §9.3). */
export const HELPLINE_HIGH_RISK_PRIORITY = 100;
