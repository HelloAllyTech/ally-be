export enum WaMessageDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

/**
 * What produced the reply. This is the primary tuning signal for the whole bot: the ratio of
 * `rag` to `declined`, and of `template` to everything else, is what tells an admin whether the
 * corpus is thin or the keyword rules are swallowing real questions.
 */
export enum WaHandledBy {
  /** A keyword template matched (command, consent or FAQ). */
  TEMPLATE = 'template',
  /** A crisis template matched. Separate from TEMPLATE because it must be countable on its own. */
  CRISIS = 'crisis',
  /** The consent/disclaimer gate produced or prefixed the reply. */
  CONSENT = 'consent',
  /** Answered from the corpus. */
  RAG = 'rag',
  /** The corpus did not cover it — an honest "I don't have that". */
  DECLINED = 'declined',
  /** The agent asked a clarifying question instead of guessing. */
  CLARIFIED = 'clarified',
  /** Rate limited. */
  RATE_LIMITED = 'rate_limited',
  /** An image, audio note or document — nothing we can read. */
  UNSUPPORTED_MEDIA = 'unsupported_media',
  /** Something failed and the fallback message went out. */
  ERROR = 'error',
}

export enum WaMessageStatus {
  RECEIVED = 'received',
  QUEUED = 'queued',
  PROCESSING = 'processing',
  SENT = 'sent',
  FAILED = 'failed',
  /** Deliberately not replied to — opted out, blocked, or the bot is off. */
  DISCARDED = 'discarded',
}

export enum WaConsentStatus {
  /** First contact: the disclaimer has not been shown yet. */
  PENDING = 'pending',
  GRANTED = 'granted',
  OPTED_OUT = 'opted_out',
}

/**
 * The four kinds of keyword template, in one entity.
 *
 * One entity rather than four because they differ only in governance and priority, not in
 * mechanism — all four are "match the inbound text, reply with fixed wording". Four tables would
 * mean four matchers and four chances for the ordering between them to be wrong.
 */
export enum WaTemplateKind {
  /** Risk keywords. Short-circuits the LLM entirely and is terminal. */
  CRISIS = 'crisis',
  /** hi / help / menu — so the model never improvises the bot's own description. */
  COMMAND = 'command',
  /** STOP / START and the first-contact disclaimer. */
  CONSENT = 'consent',
  /** High-frequency questions answered with fixed wording, skipping retrieval. */
  FAQ = 'faq',
}

export enum WaTemplateMatchType {
  /** The whole normalised message equals a pattern. */
  EXACT = 'exact',
  /** A pattern appears anywhere in the message. */
  CONTAINS = 'contains',
  /** Any pattern matches as a whole word. Safer than CONTAINS for short risk words. */
  ANY_OF = 'any_of',
  /** A JavaScript regular expression source. */
  REGEX = 'regex',
}

/**
 * Why a question ended up in the unanswered queue.
 *
 * NO_HITS / BELOW_THRESHOLD are decided by a threshold before any LLM call; MODEL_DECLINED is the
 * model judging the retrieved passages insufficient. Keeping them apart is what makes the queue
 * actionable: a pile of BELOW_THRESHOLD means the floor is too high, a pile of MODEL_DECLINED means
 * retrieval is finding the wrong passages, and those have opposite fixes.
 */
export enum WaUnansweredReason {
  NO_HITS = 'no_hits',
  BELOW_THRESHOLD = 'below_threshold',
  MODEL_DECLINED = 'model_declined',
  ERROR = 'error',
}

export enum WaUnansweredStatus {
  OPEN = 'open',
  TRIAGED = 'triaged',
  ANSWERED = 'answered',
  DISMISSED = 'dismissed',
}
