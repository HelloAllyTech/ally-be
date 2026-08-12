/**
 * The `whatsapp_bot` global-settings blob.
 *
 * A single jsonb row rather than a table because every value is a scalar the admin edits as one
 * form, and every retrieval threshold is passed straight through to ally-ai per request — which is
 * what lets retrieval be tuned without a deploy.
 */
export interface WhatsAppBotSettings {
  /**
   * The kill switch. When false, inbound messages are recorded and discarded without a reply.
   *
   * Deliberately not "delete the webhook": leaving the webhook registered and recording what
   * arrives means an admin can turn the bot off during an incident and still see what people were
   * asking while it was down.
   */
  enabled: boolean;

  /** Which provider implementation to bind. Only 'meta' is implemented. */
  provider: string;

  /** Require the disclaimer to be shown (and consent recorded) on first contact. */
  consentRequired: boolean;

  /**
   * Shown once, prefixed onto the answer to the worker's actual first question rather than sent as
   * a standalone message. A bare disclaimer with no answer reads as a bot that ignored you.
   */
  disclaimerText: string;

  /** Fixed reply for a crisis match. Never generated. */
  crisisEscalationText: string;

  /** Sent when something failed — not the same as "the corpus doesn't cover this". */
  fallbackText: string;

  /** Sent when the corpus genuinely does not cover the question. */
  declineText: string;

  /** Sent when a media message arrives, since there is nothing to read. */
  unsupportedMediaText: string;

  /** Sent once per window when a number exceeds its limit. */
  rateLimitText: string;

  rateLimit: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };

  retrieval: {
    topK: number;
    /** Permissive retrieval floor. */
    minSimilarity: number;
    /** The actual decline decision — see the agent's schemas for why they differ. */
    declineSimilarity: number;
    maxPassages: number;
    maxContextTokens: number;
    similarityBand: number;
    /** Translate a non-English question to English before embedding. */
    translateQuery: boolean;
  };

  /** Answer budget; source lines are appended on top, capped by maxReplyChars. */
  maxAnswerChars: number;
  /** Hard ceiling for the whole message. 1600 is the portable limit across providers. */
  maxReplyChars: number;
  maxCitations: number;

  /** Minutes of silence that close a conversation thread. */
  conversationIdleMinutes: number;

  /**
   * Days after which message bodies and phone numbers are blanked.
   *
   * The bound on how long identifiable data about mental healthcare workers lives here. Masking in the
   * UI limits who sees it; this limits how long it exists at all, which is the only mitigation that
   * survives a database dump.
   *
   * 0 disables the job. That is a real choice an operator may need during a pilot, so it is explicit
   * rather than expressed as an absurdly large number.
   */
  retentionDays: number;

  /**
   * Run the LLM crisis classifier alongside retrieval.
   *
   * The second layer of the safety net, on by default. The keyword rules are the first and are not
   * affected by this flag — turning the classifier off degrades the net to keywords alone, it does
   * not remove it. Exposed as a setting because it is a real per-deployment cost decision: one
   * small-model call per question, concurrent so it costs no latency.
   */
  crisisClassifierEnabled: boolean;

  /** Substituted into {helpline_numbers} in template bodies. */
  helplineNumbers: string;
}

export const WHATSAPP_SETTINGS_NAME = 'whatsapp_bot';

/**
 * Defaults, applied per-field over whatever the row holds.
 *
 * Merged field by field rather than "row or defaults" so a settings row written before a new field
 * existed does not leave that field undefined — which for a threshold would silently disable a gate.
 */
export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppBotSettings = {
  enabled: false,
  provider: 'meta',
  consentRequired: true,
  disclaimerText:
    'This is an automated assistant that answers from our reference material. It is not ' +
    'medical advice and not a crisis service. Reply STOP to opt out.',
  crisisEscalationText:
    'It sounds like this may be urgent. This assistant cannot help with a crisis. Please ' +
    'contact a supervisor or a crisis line now: {helpline_numbers}',
  fallbackText:
    'Something went wrong on my side and I could not answer that. Please try again in a moment.',
  declineText:
    'My reference material does not cover that. A colleague or supervisor is the better route ' +
    'for this one.',
  unsupportedMediaText:
    'I can only read text messages. Please type your question.',
  rateLimitText:
    'That is a lot of questions at once. Please wait a few minutes and try again.',
  rateLimit: { perMinute: 6, perHour: 30, perDay: 100 },
  retrieval: {
    topK: 8,
    minSimilarity: 0.35,
    declineSimilarity: 0.42,
    maxPassages: 5,
    maxContextTokens: 3000,
    similarityBand: 0.08,
    translateQuery: true,
  },
  maxAnswerChars: 1400,
  maxReplyChars: 1600,
  maxCitations: 3,
  conversationIdleMinutes: 1440,
  // 180 days: long enough that a quarterly review of what workers actually ask still has data to
  // read, short enough that the log is not an indefinite archive of clinical questions tied to phone
  // numbers. Aggregates survive erasure, so shortening this does not rewrite the usage dashboard.
  retentionDays: 180,
  crisisClassifierEnabled: true,
  helplineNumbers: '',
};
