/**
 * Response and settings shapes from `docs/text-helpline.md` §5 and §8,
 * transcribed verbatim. The frontend is built against the contract, so a
 * change here is a contract change — edit the doc in the same commit.
 */
import {
  HelplineAccess,
  HelplineChannel,
  HelplineChatStatus,
  HelplineGuestSystemKind,
  HelplineMessageType,
  HelplinePresence,
  HelplineRiskFlagLevel,
  HelplineRiskLevel,
  HelplineRiskOutcome,
  HelplineRiskSource,
  HelplineRiskSubject,
  HelplineSenderRole,
  HelplineSummaryKind,
} from '../constants/helpline.constants';

// ── §8 Org settings ─────────────────────────────────────────────────────────

export interface HelplineHoursEntry {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** HH:MM, 24-hour, in `tz`. */
  open: string;
  close: string;
}

export interface HelplineHours {
  tz: string;
  weekly: HelplineHoursEntry[];
}

export interface HelplineSummaryField {
  key: string;
  label: string;
  description: string;
}

export interface HelplineSettings {
  retentionDays: number;
  hours: HelplineHours | null;
  languages: string[];
  allowQueueWhenNoListeners: boolean;
  maxWaitMinutes: number;
  idleEndMinutes: number;
  maxWaitingTalkers: number;
  orgMaxConcurrentPerListener: number;
  emergencyResources: Record<string, string>;
  closingMessage: Record<string, string>;
  escalationChecklist: string[];
  supervisorAlertChannels: {
    inApp: boolean;
    push: boolean;
    slackWebhookUrl: string | null;
  };
  listenerSupportContact: string | null;
  ageNotice: string | null;
  copilot: {
    suggestions: boolean;
    nudges: boolean;
    riskClassifier: boolean;
    rollingSummaryEveryTurns: number;
  };
  riskHighConfidence: number;
  summaryFields: HelplineSummaryField[];
}

/** A resolved tenant: helpline rows store `id`; preferences key on `code`. */
export interface HelplineTenant {
  id: string;
  code: string;
  name: string;
  logoUrl: string | null;
}

// ── §5.1 Public ─────────────────────────────────────────────────────────────

export type HelplineClosedReason =
  | 'NO_LISTENERS'
  | 'OUTSIDE_HOURS'
  | 'QUEUE_FULL';

export type PublicStatusDto =
  | { enabled: false }
  | {
      enabled: true;
      open: boolean;
      closedReason: HelplineClosedReason | null;
      org: { name: string; logoUrl: string | null };
      languages: string[];
      hours: HelplineHours | null;
      estimatedWaitMinutes: number | null;
      resources: Record<string, string>;
      consent: {
        version: string;
        retentionDays: number;
        ageNotice: string | null;
      };
    };

// ── §5.2 Guest ──────────────────────────────────────────────────────────────

export interface GuestChatDto {
  id: string;
  status: HelplineChatStatus;
  endedReason: string | null;
  language: string;
  displayName: string;
  listenerName: string | null;
  queuePosition: number | null;
  waitStartedAt: string;
  claimedAt: string | null;
  endedAt: string | null;
  feedbackSubmitted: boolean;
  org: { name: string; logoUrl: string | null };
}

export interface GuestMessageDto {
  id: number;
  clientMessageId: string | null;
  from: 'ME' | 'LISTENER' | 'SERVICE';
  type: HelplineMessageType.TEXT | HelplineMessageType.SYSTEM;
  systemKind: HelplineGuestSystemKind | null;
  content: string;
  params?: Record<string, string>;
  createdAt: string;
}

export interface GuestSessionCreatedDto {
  guestToken: string;
  expiresAt: string;
  chat: GuestChatDto;
  messages: GuestMessageDto[];
}

/** The verified identity on a guest request or socket. */
export interface HelplineGuestIdentity {
  talkerId: string;
  chatId: string;
  tenantId: string;
}

// ── §5.5 Staff ──────────────────────────────────────────────────────────────

export interface ListenerSettingsDto {
  escalationChecklist: string[];
  listenerSupportContact: string | null;
  summaryFields: HelplineSummaryField[];
  copilot: { suggestions: boolean; nudges: boolean; riskClassifier: boolean };
  languages: string[];
  idleEndMinutes: number;
}

export interface ListenerProfileDto {
  displayName: string;
  maxConcurrentChats: number;
  languages: string[];
  notificationsEnabled: boolean;
}

export interface MeDto {
  userId: number;
  profile: ListenerProfileDto;
  presence: HelplinePresence;
  activeChatCount: number;
  orgMaxConcurrentPerListener: number;
  settings: ListenerSettingsDto;
}

export interface LobbyEntryDto {
  chatId: string;
  kind: 'NEW' | 'TRANSFER';
  displayName: string;
  language: string;
  waitStartedAt: string;
  priority: number;
  riskLevel: HelplineRiskLevel;
  preview: string | null;
  transferFromName: string | null;
  targetListenerId: number | null;
}

export interface LobbyCountsDto {
  waiting: number;
  active: number;
  listenersAvailable: number;
}

export interface ChatListItemDto {
  id: string;
  status: HelplineChatStatus;
  talkerName: string;
  language: string;
  listener: { id: number; displayName: string } | null;
  riskLevel: HelplineRiskLevel;
  waitStartedAt: string;
  claimedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
  lastMessageAt: string | null;
  unreadForMe?: number;
  messageCount: number;
  erased: boolean;
}

export interface LobbyDto {
  waiting: LobbyEntryDto[];
  myChats: ChatListItemDto[];
  counts: LobbyCountsDto;
}

export interface StaffChatDto {
  id: string;
  status: HelplineChatStatus;
  channel: HelplineChannel;
  talker: {
    id: string;
    displayName: string;
    language: string;
    consentVersion: string;
    connected: boolean;
    blocked: boolean;
  };
  listener: { id: number; displayName: string } | null;
  myAccess: HelplineAccess;
  priority: number;
  riskLevel: HelplineRiskLevel;
  waitStartedAt: string;
  claimedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
  lastTalkerMessageAt: string | null;
  lastListenerMessageAt: string | null;
  transferPending: boolean;
  resourcesSentAt: string | null;
  listenerConnected: boolean;
  erased: boolean;
}

export interface StaffMessageDto {
  id: number;
  chatId: string;
  clientMessageId: string | null;
  type: HelplineMessageType;
  senderRole: HelplineSenderRole;
  senderUserId: number | null;
  senderName: string | null;
  systemKind: string | null;
  content: string;
  parentMessageId: number | null;
  visibleToTalker: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  erased: boolean;
}

export interface RiskFlagDto {
  id: string;
  messageId: number;
  level: HelplineRiskFlagLevel;
  source: HelplineRiskSource;
  confidence: number | null;
  subject: HelplineRiskSubject | null;
  signal: string | null;
  resourcesSent: boolean;
  /** null = not applicable (ELEVATED); 0 = HIGH but nobody alerted; n = supervisors notified. */
  supervisorsAlerted: number | null;
  /** Messages that hit while this flag was open (folded); 1 = the opener. */
  hitCount: number;
  lastHitAt: string;
  /** The latest folded hit's signal, re-derived from its body; null once erased. */
  latestSignal: string | null;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  outcome: HelplineRiskOutcome;
  outcomeNote: string | null;
  createdAt: string;
}

export interface SummaryDto {
  kind: HelplineSummaryKind;
  fields: Record<string, string>;
  throughMessageId: number;
  editedByName: string | null;
  version: number;
  updatedAt: string;
}

export type HelplineCopilotStatus = 'OK' | 'UNAVAILABLE' | 'OFF';

export interface ChatDetailDto {
  chat: StaffChatDto;
  messages: StaffMessageDto[];
  riskFlags: RiskFlagDto[];
  summaries: {
    rolling: SummaryDto | null;
    handoff: SummaryDto | null;
    final: SummaryDto | null;
  };
  copilot: { status: HelplineCopilotStatus; stage: string | null };
  events: { type: string; at: string; actorName: string | null }[];
}

export interface MonitorActiveChatDto extends ChatListItemDto {
  lastMessageAgeSeconds: number | null;
  listenerConnected: boolean;
  talkerConnected: boolean;
  transferPending: boolean;
  /** Flags on this chat nobody has acknowledged yet. */
  openFlags: number;
}

export interface MonitorListenerDto {
  userId: number;
  displayName: string;
  presence: HelplinePresence;
  activeChatCount: number;
  maxConcurrentChats: number;
  languages: string[];
}

export interface MonitorDto {
  tiles: {
    waiting: number;
    active: number;
    listenersAvailable: number;
    /** Unacknowledged HIGH flags on WAITING / ACTIVE chats. */
    openHighFlags: number;
  };
  activeChats: MonitorActiveChatDto[];
  waiting: LobbyEntryDto[];
  listeners: MonitorListenerDto[];
}

export type RiskOutcomeCounts = Record<HelplineRiskOutcome, number>;

export interface RiskFlagRowDto extends RiskFlagDto {
  chatId: string;
  chatStatus: HelplineChatStatus;
  chatRiskLevel: HelplineRiskLevel;
  listener: { id: number; displayName: string } | null;
  erased: boolean;
}

export interface RiskCalibrationDto {
  items: RiskFlagRowDto[];
  /** By outcome over the whole window (not narrowed by `outcome`), per FLAG. */
  counts: RiskOutcomeCounts;
  /** Hits folded into those flags, in all (≥ the number of flags). */
  totalHits: number;
  bySource: Record<
    HelplineRiskSource,
    RiskOutcomeCounts & { total: number; hits: number }
  >;
  /** CLASSIFIER flags by confidence band — where false positives sit. */
  classifierByConfidence: ({ from: number; to: number } & RiskOutcomeCounts)[];
  /** The org's current HIGH threshold, for reading the bands against. */
  riskHighConfidence: number;
  days: number;
}

export interface QaListItemDto {
  chatId: string;
  listenerId: number;
  listenerName: string;
  endedAt: string;
  compositeScore: number;
  hasUnhelpfulBehaviour: boolean;
  rubricVersion: string;
}

export interface QaSkillDto {
  key: string;
  label: string;
  tier: 'Engage' | 'Understand' | 'Support';
  /** Score 1–4 (never "L1–L4"). */
  level: 1 | 2 | 3 | 4;
  unhelpful: string[];
  basicMet: string[];
  basicMissing: string[];
  advanced: string[];
  /** `quote` is '' once the chat's content is erased. */
  evidence: { messageId: number; quote: string }[];
}

export interface QaDetailDto extends QaListItemDto {
  skills: QaSkillDto[];
}

export interface TeamMemberDto {
  userId: number;
  name: string;
  email: string;
  isListener: boolean;
  isSupervisor: boolean;
  isAdmin: boolean;
}

// ── §5.4 Admin ──────────────────────────────────────────────────────────────

export interface AdminSettingsDto {
  tenantId: string;
  tenantCode: string;
  enabled: boolean;
  settings: HelplineSettings;
  defaults: HelplineSettings;
  publicPath: string;
}

/** The authenticated staff caller, as `JwtStrategy.validate` builds it. */
export interface HelplineStaffUser {
  id: number;
  username?: string;
  tenantId: string;
}
