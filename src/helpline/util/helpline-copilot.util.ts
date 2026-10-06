import {
  HelplineChatStatus,
  HelplineMessageType,
  HelplineRiskFlagLevel,
  HelplineRiskSource,
  HelplineRiskSubject,
  HelplineSenderRole,
} from '../constants/helpline.constants';
import type {
  HelplineCopilotTurnMessage,
  HelplineRiskResponse,
} from 'src/ai/dto/helpline-copilot.dto';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { HelplineRiskFlag } from '../entity/helpline-risk-flag.entity';
import {
  HelplineCopilotStatus,
  HelplineSettings,
  HelplineSummaryField,
} from '../type/helpline.types';

/**
 * The copilot's rules as pure functions (contract §9.2), so each threshold is
 * tested rather than trusted. HelplineCopilotService only fetches, calls and
 * persists around them.
 */

export const HELPLINE_COPILOT = {
  /** Wait this long after the talker's latest message before drafting (debounce). */
  TURN_DEBOUNCE_MS: 2_500,
  /** While the listener is typing, hold the copilot's emits at most this long. */
  TYPING_HOLD_MAX_MS: 4_000,
  TYPING_POLL_MS: 250,
  RISK_RECENT_TURNS: 4,
  TURN_CONTEXT_TURNS: 12,
  NUDGE_MAX_PER_CHAT: 10,
  NUDGE_MIN_TALKER_TURNS_BETWEEN: 2,
  NUDGE_MAX_CHARS: 240,
  SUGGESTION_MAX_CHARS: 300,
  SUGGESTION_MAX_COUNT: 3,
  PROMPT_CACHE_MS: 60_000,
} as const;

/** ally-ai prompt codes the copilot sends overrides for. */
export const HELPLINE_PROMPT_CODES = [
  'ally_ai_helpline_risk_classify',
  'ally_ai_helpline_copilot_turn',
] as const;

/** `skill_key` values ally-ai may return (contract §9.1). */
export const HELPLINE_SKILL_KEYS: ReadonlySet<string> = new Set([
  'rapport',
  'confidentiality',
  'feelings',
  'empathy',
  'harm',
  'functioning',
  'explanation',
  'family',
  'goals',
  'hope',
  'coping',
  'psychoeducation',
  'feedback',
  'verbal',
]);

const STAGES = new Set(['Engage', 'Understand', 'Support', 'Close']);

const LEVEL_RANK: Record<HelplineRiskFlagLevel, number> = {
  [HelplineRiskFlagLevel.ELEVATED]: 1,
  [HelplineRiskFlagLevel.HIGH]: 2,
};

/**
 * Classifier verdict → flag level. `is_crisis` at or above the org's
 * threshold is HIGH, below it ELEVATED; not a crisis, or a failed call, is no
 * flag at all (a failed call is reported separately as UNAVAILABLE).
 */
export function mapRiskVerdict(
  response: Pick<HelplineRiskResponse, 'is_crisis' | 'confidence' | 'failed'>,
  riskHighConfidence: number,
): HelplineRiskFlagLevel | null {
  if (!response || response.failed || response.is_crisis !== true) return null;
  const confidence = Number(response.confidence);
  return Number.isFinite(confidence) && confidence >= riskHighConfidence
    ? HelplineRiskFlagLevel.HIGH
    : HelplineRiskFlagLevel.ELEVATED;
}

/**
 * Whether a classifier verdict adds anything to the flags this message
 * already has: never a second CLASSIFIER flag for one message, and nothing
 * when the keyword screen already flagged it at the same level or higher. A
 * classifier HIGH over a keyword ELEVATED is an escalation and is recorded.
 */
export function classifierAddsFlag(
  existing: Pick<HelplineRiskFlag, 'source' | 'level'>[],
  level: HelplineRiskFlagLevel,
): boolean {
  if (existing.some((f) => f.source === HelplineRiskSource.CLASSIFIER)) {
    return false;
  }
  return !existing.some((f) => LEVEL_RANK[f.level] >= LEVEL_RANK[level]);
}

export function cleanSubject(raw: unknown): HelplineRiskSubject {
  return raw === HelplineRiskSubject.SELF ||
    raw === HelplineRiskSubject.OTHER ||
    raw === HelplineRiskSubject.UNCLEAR
    ? raw
    : HelplineRiskSubject.UNCLEAR;
}

/**
 * Where the classifier's verbatim `signal` sits in the message, so the flag
 * can store offsets instead of text (invariant 5). Exact first, then
 * case-insensitive; null when the model paraphrased rather than quoted.
 */
export function signalOffsets(
  text: string,
  signal: string | null | undefined,
): { start: number; end: number } | null {
  const needle = (signal ?? '').trim();
  if (!needle || !text) return null;
  let start = text.indexOf(needle);
  if (start < 0) start = text.toLowerCase().indexOf(needle.toLowerCase());
  if (start < 0) return null;
  return { start, end: start + needle.length };
}

/** TEXT rows → the `{role, content}` turns ally-ai expects, oldest first. */
export function toCopilotTurns(
  messages: Pick<
    HelplineMessage,
    'type' | 'senderRole' | 'content' | 'erasedAt'
  >[],
): HelplineCopilotTurnMessage[] {
  return messages
    .filter(
      (m) =>
        m.type === HelplineMessageType.TEXT &&
        m.erasedAt == null &&
        m.content.trim().length > 0,
    )
    .map((m) => ({
      role: m.senderRole === HelplineSenderRole.TALKER ? 'talker' : 'listener',
      content: m.content,
    }));
}

/**
 * `include_nudge` (contract §9.2 step 3): nudges on, under the per-chat cap,
 * at least two talker turns since the last nudge, and never the first talker
 * turn. Sparse on purpose — a coach who speaks every turn is noise.
 */
export function shouldIncludeNudge(
  settings: Pick<HelplineSettings, 'copilot'>,
  chat: Pick<
    HelplineChat,
    'nudgeCount' | 'talkerTurnsSinceNudge' | 'talkerMessageCount'
  >,
): boolean {
  return (
    settings.copilot.nudges === true &&
    chat.nudgeCount < HELPLINE_COPILOT.NUDGE_MAX_PER_CHAT &&
    chat.talkerTurnsSinceNudge >=
      HELPLINE_COPILOT.NUDGE_MIN_TALKER_TURNS_BETWEEN &&
    chat.talkerMessageCount > 1
  );
}

export interface CleanSuggestion {
  index: number;
  text: string;
  skillKey: string;
}

/** Trim, cap and index the suggestions; unknown skill keys become ''. */
export function cleanSuggestions(raw: unknown): CleanSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: CleanSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const text =
      typeof (item as { text?: unknown }).text === 'string'
        ? (item as { text: string }).text.trim()
        : '';
    if (!text) continue;
    const key = (item as { skill_key?: unknown }).skill_key;
    out.push({
      index: out.length,
      text: text.slice(0, HELPLINE_COPILOT.SUGGESTION_MAX_CHARS),
      skillKey:
        typeof key === 'string' && HELPLINE_SKILL_KEYS.has(key) ? key : '',
    });
    if (out.length >= HELPLINE_COPILOT.SUGGESTION_MAX_COUNT) break;
  }
  return out;
}

/** A nudge, only when one was asked for; ≤ 240 characters. */
export function cleanNudge(raw: unknown, requested: boolean): string | null {
  if (!requested || typeof raw !== 'string') return null;
  const text = raw.trim();
  return text ? text.slice(0, HELPLINE_COPILOT.NUDGE_MAX_CHARS) : null;
}

export function cleanStage(raw: unknown): string | null {
  return typeof raw === 'string' && STAGES.has(raw) ? raw : null;
}

/** Every `every` talker turns (4, 8, 12 … by default); 0 or less = never. */
export function isRollingSummaryTurn(
  talkerMessageCount: number,
  every: number,
): boolean {
  return (
    every > 0 && talkerMessageCount > 0 && talkerMessageCount % every === 0
  );
}

/** The rolling summary as one block of text for the copilot turn. */
export function rollingSummaryText(
  fields: Record<string, string>,
  summaryFields: HelplineSummaryField[],
): string {
  const labels = new Map(summaryFields.map((f) => [f.key, f.label]));
  return Object.entries(fields)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `${labels.get(key) ?? key}: ${value.trim()}`)
    .join('\n');
}

/** ChatDetailDto.copilot.status: OFF when the org turned every part off. */
export function copilotStatusFor(
  settings: Pick<HelplineSettings, 'copilot'>,
  stored: string | null,
): HelplineCopilotStatus {
  const { suggestions, nudges, riskClassifier } = settings.copilot;
  if (!suggestions && !nudges && !riskClassifier) return 'OFF';
  return stored === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'OK';
}

/** ChatDetailDto.copilot.stage: the newest STAGE row's stage. */
export function latestStage(
  rows: Pick<HelplineMessage, 'type' | 'metadata'>[],
): string | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.type !== HelplineMessageType.STAGE) continue;
    const stage = row.metadata?.stage;
    return typeof stage === 'string' ? stage : null;
  }
  return null;
}

/** Only an ACTIVE chat gets suggestions; a WAITING talker has no listener yet. */
export function wantsCopilotTurn(
  chat: Pick<HelplineChat, 'status'>,
  settings: Pick<HelplineSettings, 'copilot'>,
): boolean {
  return (
    chat.status === HelplineChatStatus.ACTIVE &&
    (settings.copilot.suggestions || settings.copilot.nudges)
  );
}

/**
 * How far the listener moved from the suggestion they inserted:
 * Levenshtein distance ÷ the longer length, 0 (sent as is) … 1 (rewritten),
 * two decimals. Normalised so a short and a long reply compare.
 */
export function normalisedEditDistance(
  suggestion: string,
  sent: string,
  distance: (a: string, b: string) => number,
): number {
  const longest = Math.max(suggestion.length, sent.length);
  if (longest === 0) return 0;
  return Math.round((distance(suggestion, sent) / longest) * 100) / 100;
}
