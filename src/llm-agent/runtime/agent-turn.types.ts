import { IAgentLlmProvider } from '../provider/agent-llm-provider.interface';
import {
  AgentMessage,
  AgentSystemBlock,
  AgentToolDefinition,
  AgentUsage,
} from '../type/agent-llm.type';

/**
 * The shared validated-turn runtime (`runValidatedTurn`): the loop Builder's
 * interview proved out in W2a, for the agents that talk to a person and change
 * something on their behalf — Course Copilot and the character interview.
 *
 * Everything an agent differs in arrives through `ValidatedTurnAgent`: its tool
 * belt and which tools end a turn, which ones read and which ones write, what
 * "something changed" means for it, the claims it can check, and how it
 * persists a turn. The runner owns the rest — the order calls run in, when a
 * reply is held back, and the retries for truncated, unreadable and empty
 * passes, which every agent needs and each used to carry its own copy of.
 */

/** One SSE frame. Each agent narrows `event` to its own contract. */
export interface AgentTurnFrame {
  event: string;
  data: Record<string, any>;
}

/** What one tool call hands back to the loop — the shape every agent's tools already return. */
export interface AgentToolOutcome {
  /** JSON-serialised into the tool_result block returned to the model. */
  modelResult: Record<string, any>;
  /** One-line human summary for the tool_result frame. */
  summary: string;
  /** Extra frames emitted before the tool_result frame. */
  events?: AgentTurnFrame[];
  /**
   * The tool wants the turn over: it raised a confirmation question, or
   * handed the person something to review. In a validated turn that does not
   * end the loop by itself — the reply still has to come through the closing
   * tool, so the person reads a message the runner could check.
   */
  endTurn?: boolean;
}

/** A reason a reply is not shown yet, phrased for each reader. */
export interface AgentReplyProblem {
  /** Stable for the turn, so one problem holds a reply back only once. */
  key: string;
  toModel: string;
  /** On the receipt, when the reply goes out anyway. */
  toUser: string;
}

/** A call as the transcript stores it. */
export interface AgentTurnCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

/** A result as the transcript stores it, keyed back to its call. */
export interface AgentTurnResultRecord {
  toolUseId: string;
  name: string;
  result: Record<string, any>;
}

/**
 * What one turn did, built by the server from the tool results and the
 * agent's own state — never from the model's account of its turn. Persisted on
 * the assistant row as `metadata.receipt` and streamed as a `receipt` frame
 * just before `done`.
 */
export interface AgentTurnReceipt {
  read: string[];
  searched: string[];
  changed: string[];
  failed: string[];
  warnings: string[];
  /** Why the person's own words changed nothing, when the agent said. */
  unchangedBecause?: string;
}

/** Everything a validated turn accumulates. The agent persists it. */
export interface ValidatedTurnState {
  /** What the model wrote outside the reply. Kept, never shown. */
  workingNotes: string[];
  /** The reply the person was shown. */
  reply: string | null;
  toolCalls: AgentTurnCall[];
  toolResults: AgentTurnResultRecord[];
  /** Question cards delivered this turn, for a reload to rebuild. */
  questions: Record<string, any>[];
  iterations: number;
  stopReason: string | null;
  errored: boolean;
  error: string | null;
  errorCode: string | null;
  truncations: number;
  invalidToolCalls: number;
  emptyPasses: number;
  /** Replies sent back to the model this turn. */
  rejections: number;
  /** Problems already held against a reply once; raised again, they only warn. */
  raised: Set<string>;
  /** What the reply was delivered with anyway, for the receipt. */
  warnings: string[];
  unchangedBecause: string | null;
  /** A tool asked for the turn to end (a confirmation, a proposal, a saved draft). */
  endRequestedBy: string | null;
  /** Frames held back until the reply is delivered — a tool's confirmation question. */
  held: AgentTurnFrame[];
  delivered: boolean;
}

export function createValidatedTurnState(): ValidatedTurnState {
  return {
    workingNotes: [],
    reply: null,
    toolCalls: [],
    toolResults: [],
    questions: [],
    iterations: 0,
    stopReason: null,
    errored: false,
    error: null,
    errorCode: null,
    truncations: 0,
    invalidToolCalls: 0,
    emptyPasses: 0,
    rejections: 0,
    raised: new Set(),
    warnings: [],
    unchangedBecause: null,
    endRequestedBy: null,
    held: [],
    delivered: false,
  };
}

/** The ending call a reply arrived in, as the domain checks see it. */
export interface AgentTurnEnding {
  name: string;
  input: Record<string, any>;
  message: string;
}

/** An agent, as the validated runner needs to know it. Fixed for one turn. */
export interface ValidatedTurnAgent {
  /** Who the agent is, in the person's words ("Course Copilot"). Receipt warnings use it. */
  agentName: string;
  /** Who it talks to ("trainer", "admin"). Messages to the model use it. */
  userNoun: string;
  /** Log prefix, e.g. `[COURSE_COPILOT] session=…`. */
  logTag: string;

  provider: IAgentLlmProvider;
  model: string;
  /** The prompt as the agent sends it. */
  system: string | AgentSystemBlock[];
  /** The conversation so far; the runner appends to it. */
  messages: AgentMessage[];
  /** The belt for the next pass. Read every pass: a tool can move the agent's state mid-turn. */
  tools: () => AgentToolDefinition[];
  maxIterations: number;
  maxTokens: number;
  /** Bound on each of the three retries (truncated, unreadable, empty). */
  maxRetries: number;

  /** The tool that ends a turn without a question (`finish_turn`). */
  closingTool: string;
  /** The tool that ends a turn with a question card (`ask_trainer`, `ask_question`). */
  askingTool: string;
  /** Tools that change what the agent is building. */
  isEdit: (name: string) => boolean;
  /** Lookups: a result the model must read before what it says can rest on it. */
  isResearch: (name: string) => boolean;

  /**
   * The person's own words this turn, when the agent owes them a record —
   * null for an option pick, a plain "ok", or an agent that keeps nothing to
   * record them in. With `unchangedField`, a reply over words that changed
   * nothing must say why.
   */
  userWordsToApply: string | null;
  /** The ending tools' field for "why your words changed nothing". */
  unchangedField?: string;
  /** Whether what the agent builds has moved since the turn started. */
  stateMoved: () => boolean;
  /** The reply says something changed. Checked against `stateMoved`. */
  claimsChange: (message: string) => boolean;
  /** The agent's own checks on a reply (a claim it can verify against its state). */
  extraProblems?: (ending: AgentTurnEnding) => Promise<AgentReplyProblem[]>;

  /** Run one tool. A throw becomes a failed result the model can repair from. */
  execute: (
    name: string,
    input: Record<string, any>,
  ) => Promise<AgentToolOutcome>;
  /** What a call set out to do, in the person's terms ("Searched the library for…"). */
  describeAttempt: (name: string, input: Record<string, any>) => string;
  /** A tool frame to hold until the reply is shown. Default: question cards. */
  holdUntilDelivered?: (frame: AgentTurnFrame) => boolean;
  /** Every frame a tool produced, delivered or held — for the agent's own accumulators. */
  onToolFrame?: (frame: AgentTurnFrame) => void;
  /** The input shown on a `tool_call` frame (big patches are clipped). */
  displayInput?: (
    name: string,
    input: Record<string, any>,
  ) => Record<string, any>;
  /** The `tool_result` frame's data. Default `{ name, summary }`. */
  toolResultData?: (
    name: string,
    outcome: AgentToolOutcome,
  ) => Record<string, any>;

  recordUsage: (usage: AgentUsage | undefined, iteration: number) => void;
  /** Save the turn so far. Called after every pass and every tool; failures are the agent's to swallow. */
  checkpoint: (final: boolean) => Promise<void>;

  /** Told to the model after a pass was cut off at the output cap. */
  truncationNudge: string;
  /** Shown to the person when a retry budget runs out. */
  errors: {
    truncated: { code: string; message: string };
    invalidToolCall: { code: string; message: string };
  };
}
