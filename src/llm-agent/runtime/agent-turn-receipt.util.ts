import {
  AgentTurnCall,
  AgentTurnReceipt,
  AgentTurnResultRecord,
} from './agent-turn.types';

/**
 * The receipt under a validated turn: what it read, searched and changed, and
 * what failed — from the tool results and the agent's own state, never from
 * the model's prose. The agent supplies what "changed" means for it; the rest
 * is the same for every agent.
 */

export const clipText = (value: unknown, max: number): string => {
  const flat = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** One call the turn made, joined to the result it got. */
export interface AgentReceiptCall {
  name: string;
  input: Record<string, any>;
  result: Record<string, any> | undefined;
}

/**
 * Calls and results as the transcript stores them, joined by tool_use id.
 *
 * By occurrence, not by id alone: Gemini's ids were unique only within one
 * response until 2026-10-21, so a stored turn can hold two calls with the same
 * id. The nth call with an id gets the nth result with it.
 */
export function joinCallsToResults(
  toolCalls: AgentTurnCall[] | Record<string, any>[] | null | undefined,
  toolResults:
    | AgentTurnResultRecord[]
    | Record<string, any>[]
    | null
    | undefined,
): AgentReceiptCall[] {
  const queues = new Map<string, Record<string, any>[]>();
  for (const result of (toolResults ?? []) as Record<string, any>[]) {
    const id = String(result?.toolUseId);
    queues.set(id, [...(queues.get(id) ?? []), result]);
  }
  return ((toolCalls ?? []) as Record<string, any>[]).map((call) => ({
    name: String(call?.name ?? ''),
    input: (call?.input ?? {}) as Record<string, any>,
    result: queues.get(String(call?.id))?.shift()?.result as
      | Record<string, any>
      | undefined,
  }));
}

/**
 * Why a call failed, from what it returned. A validation failure's first
 * errors ride along: "invalid" alone gives the reader nothing to act on.
 */
export function describeToolFailure(result: Record<string, any>): string {
  const base = String(result?.message ?? result?.error ?? 'failed');
  const errors = Array.isArray(result?.errors)
    ? (result.errors as unknown[])
        .map((error) =>
          typeof error === 'string'
            ? error
            : String(
                (error as Record<string, unknown>)?.message ??
                  JSON.stringify(error),
              ),
        )
        .filter(Boolean)
    : [];
  return clipText(
    errors.length
      ? `${base} ${errors.slice(0, 2).join('; ')}${
          errors.length > 2 ? ` (+${errors.length - 2} more)` : ''
        }`
      : base,
    200,
  );
}

/** What the receipt needs to know about an agent's tools. */
export interface AgentReceiptVocabulary {
  isEnding: (name: string) => boolean;
  isResearch: (name: string) => boolean;
  describeAttempt: (name: string, input: Record<string, any>) => string;
  /**
   * The things a successful lookup read, by name — a guidance chunk, an item.
   * Null when the lookup is a search, which is counted instead.
   */
  describeRead?: (call: AgentReceiptCall) => string[] | null;
  /** What a successful search came back with ("4 matches"). */
  describeFound?: (call: AgentReceiptCall) => string;
  /**
   * Why a call failed, for the person. Default: the result's own message —
   * override where that message is written for the model rather than for them.
   */
  describeFailure?: (call: AgentReceiptCall) => string | null;
}

const unique = (lines: string[]): string[] => [
  ...new Set(lines.filter(Boolean)),
];

/**
 * The receipt for one turn. `changed` is the agent's to compute — from its
 * state at the start and end of the turn wherever it can, so two edits that
 * cancel out change nothing, and say so.
 */
export function buildAgentTurnReceipt(input: {
  calls: AgentReceiptCall[];
  vocabulary: AgentReceiptVocabulary;
  changed: string[];
  warnings?: string[];
  unchangedBecause?: string | null;
}): AgentTurnReceipt {
  const { vocabulary } = input;
  const read: string[] = [];
  const searched: string[] = [];
  const failed: string[] = [];

  for (const call of input.calls) {
    if (!call.name || vocabulary.isEnding(call.name)) continue;
    // A call with no result never ran to completion (an interrupted turn),
    // and one the runner refused never ran at all: neither is done or failed.
    if (!call.result || call.result.notRun) continue;
    if (call.result.ok === false) {
      failed.push(
        `${vocabulary.describeAttempt(call.name, call.input)} — ${
          vocabulary.describeFailure?.(call) ?? describeToolFailure(call.result)
        }`,
      );
      continue;
    }
    if (!vocabulary.isResearch(call.name)) continue;
    const named = vocabulary.describeRead?.(call);
    if (named) {
      read.push(...named);
    } else {
      const found = vocabulary.describeFound?.(call) ?? 'done';
      searched.push(
        `${vocabulary.describeAttempt(call.name, call.input)} — ${found}`,
      );
    }
  }

  const unchangedBecause = clipText(input.unchangedBecause ?? '', 300);
  return {
    read: unique(read),
    searched: unique(searched),
    changed: unique(input.changed),
    failed,
    warnings: unique(input.warnings ?? []),
    ...(unchangedBecause ? { unchangedBecause } : {}),
  };
}

/** A receipt-shaped object, or null — rows written before receipts have none. */
export function storedAgentReceipt(
  metadata: Record<string, any> | null | undefined,
): AgentTurnReceipt | null {
  const receipt = metadata?.receipt;
  return receipt && typeof receipt === 'object' && Array.isArray(receipt.read)
    ? (receipt as AgentTurnReceipt)
    : null;
}

/** True when a receipt says nothing — no lookups, no changes, no problems. */
export function agentReceiptIsEmpty(receipt: AgentTurnReceipt): boolean {
  return (
    !receipt.read.length &&
    !receipt.searched.length &&
    !receipt.changed.length &&
    !receipt.failed.length &&
    !receipt.warnings.length &&
    !receipt.unchangedBecause
  );
}

/**
 * One line for a history summary: what the turn read, changed and what
 * failed. Searches are counted, not listed — the summary is paid for on
 * every later turn.
 */
export function renderAgentReceiptLine(receipt: AgentTurnReceipt): string {
  const parts: string[] = [];
  if (receipt.read.length) {
    parts.push(
      `read ${receipt.read.slice(0, 6).join(', ')}${
        receipt.read.length > 6 ? ` and ${receipt.read.length - 6} more` : ''
      }`,
    );
  }
  if (receipt.searched.length) {
    parts.push(plural(receipt.searched.length, 'search', 'searches'));
  }
  if (receipt.changed.length) {
    parts.push(`changed: ${receipt.changed.join('; ')}`);
  } else if (receipt.unchangedBecause) {
    parts.push(`unchanged because ${receipt.unchangedBecause}`);
  }
  if (receipt.failed.length) parts.push(`FAILED: ${receipt.failed.join('; ')}`);
  if (receipt.warnings.length) {
    parts.push(`delivered with warnings: ${receipt.warnings.join('; ')}`);
  }
  return parts.join(' · ');
}
