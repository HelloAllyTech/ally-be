import { NumberedLine } from './skill-scoring.util';

/**
 * Cutting a learner's practice history into fixed amounts of their own speech,
 * and rendering one cut for the judge. Pure functions — the services around
 * them only fetch and persist.
 */

export type Speaker = 'helper' | 'client';

export interface TranscriptTurn {
  messageId: number;
  speaker: Speaker;
  text: string;
}

export interface SessionTranscript {
  sessionId: string;
  endedAt: Date;
  tenantId: string | null;
  /** In spoken order, fillers and interim replies already removed. */
  turns: TranscriptTurn[];
}

export interface PlannedCut {
  /** Every session the cut touches, in consumption order. */
  sessionIds: string[];
  startSessionId: string;
  startMessageId: number;
  endSessionId: string;
  endMessageId: number;
  /** The cut opens partway through a session (the rest is context). */
  startsMidSession: boolean;
  /** The cut closes partway through a session (the rest goes to the next cut). */
  endsMidSession: boolean;
  learnerChars: number;
  totalChars: number;
  /** Tenant of the session the cut closed in. */
  tenantId: string | null;
  /** When the session the cut closed in ended. */
  closedSessionEndedAt: Date;
}

/** Length in code points, which is what Postgres `char_length` counts. */
export function charLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Seal as many cuts as the pending speech allows.
 *
 * `carry` is the unconsumed tail of the session the previous cut closed in
 * (already trimmed to the turns after that cut's last message), or null. It is
 * consumed first, then `sessions` in the order given — the caller orders them by
 * when they ended, and only ever passes sessions no cut has touched, so a cut is
 * never re-drawn once sealed.
 *
 * A cut closes on the helper turn that takes the learner's speech to the
 * threshold, so no turn is ever split and every cut holds at least `threshold`
 * characters of learner speech. What is left over waits for more practice; only
 * sealed cuts are returned.
 */
export function planCuts(
  carry: SessionTranscript | null,
  sessions: readonly SessionTranscript[],
  threshold: number,
): PlannedCut[] {
  const segments = [
    ...(carry ? [{ session: carry, isCarry: true }] : []),
    ...sessions.map((session) => ({ session, isCarry: false })),
  ];

  const cuts: PlannedCut[] = [];
  let open: Accumulator | null = null;
  // A session with no turns still has to be marked consumed, or it is re-read
  // on every tick forever. When no cut is open it waits here and rides on the
  // next cut that opens.
  let waiting: string[] = [];

  for (const { session, isCarry } of segments) {
    if (open) addSession(open, session.sessionId);
    else if (session.turns.length === 0) waiting.push(session.sessionId);

    for (let index = 0; index < session.turns.length; index += 1) {
      const turn = session.turns[index];
      if (!open) {
        open = startAccumulator(
          waiting,
          session.sessionId,
          turn.messageId,
          isCarry || index > 0,
        );
        waiting = [];
      }
      const length = charLength(turn.text);
      open.totalChars += length;
      if (turn.speaker === 'helper') open.learnerChars += length;

      if (turn.speaker === 'helper' && open.learnerChars >= threshold) {
        cuts.push({
          sessionIds: open.sessionIds,
          startSessionId: open.startSessionId,
          startMessageId: open.startMessageId,
          endSessionId: session.sessionId,
          endMessageId: turn.messageId,
          startsMidSession: open.startsMidSession,
          endsMidSession: index < session.turns.length - 1,
          learnerChars: open.learnerChars,
          totalChars: open.totalChars,
          tenantId: session.tenantId,
          closedSessionEndedAt: session.endedAt,
        });
        open = null;
      }
    }
  }

  return cuts;
}

interface Accumulator {
  sessionIds: string[];
  startSessionId: string;
  startMessageId: number;
  startsMidSession: boolean;
  learnerChars: number;
  totalChars: number;
}

function startAccumulator(
  waiting: readonly string[],
  sessionId: string,
  messageId: number,
  startsMidSession: boolean,
): Accumulator {
  return {
    sessionIds: [...waiting.filter((id) => id !== sessionId), sessionId],
    startSessionId: sessionId,
    startMessageId: messageId,
    startsMidSession,
    learnerChars: 0,
    totalChars: 0,
  };
}

function addSession(acc: Accumulator, sessionId: string): void {
  if (!acc.sessionIds.includes(sessionId)) acc.sessionIds.push(sessionId);
}

/** The turns of `session` strictly after `messageId`; empty if it is not found. */
export function turnsAfter(
  session: SessionTranscript,
  messageId: number,
): SessionTranscript {
  const index = session.turns.findIndex((t) => t.messageId === messageId);
  return { ...session, turns: index < 0 ? [] : session.turns.slice(index + 1) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering one cut for the judge
// ─────────────────────────────────────────────────────────────────────────────

export interface CutBounds {
  sessionIds: readonly string[];
  startSessionId: string;
  startMessageId: number;
  endSessionId: string;
  endMessageId: number;
}

export interface RenderedWindow {
  text: string;
  lines: NumberedLine[];
  helperLines: number;
}

/**
 * Lay a cut out as the judge reads it.
 *
 * Scored lines get ids (`H4` = the helper's 4th line, `C4` the client's) and the
 * judge must cite one for every behaviour it ticks. Context lines — the part of
 * the first session that came before the cut, capped at `contextChars` — carry
 * no id, so they can inform a judgement but never be cited as evidence of one.
 *
 * Each session is bracketed with whether its opening and its end are inside
 * the window, because several rules depend on it: rapport is only assessable
 * at an opening, and a "did not ask" judgement is only fair when the whole
 * session is in view.
 */
export function renderWindow(
  sessions: ReadonlyMap<string, SessionTranscript>,
  bounds: CutBounds,
  contextChars: number,
): RenderedWindow {
  const lines: NumberedLine[] = [];
  const out: string[] = [];
  let helperN = 0;
  let clientN = 0;

  const first = sessions.get(bounds.startSessionId);
  const startIndex = first
    ? first.turns.findIndex((t) => t.messageId === bounds.startMessageId)
    : -1;
  if (first && startIndex > 0) {
    const context = tailWithinBudget(
      first.turns.slice(0, startIndex),
      contextChars,
    );
    if (context.length > 0) {
      out.push(
        '### CONTEXT — earlier in the first session. NOT scored; for understanding only.',
      );
      for (const turn of context)
        out.push(`${label(turn.speaker)}: ${turn.text}`);
      out.push('');
    }
  }

  out.push('### SCORED WINDOW');
  bounds.sessionIds.forEach((sessionId, position) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    const name = `Session ${sessionLetter(position)}`;

    let from = 0;
    let to = session.turns.length - 1;
    if (sessionId === bounds.startSessionId) {
      const i = session.turns.findIndex(
        (t) => t.messageId === bounds.startMessageId,
      );
      if (i >= 0) from = i;
    }
    if (sessionId === bounds.endSessionId) {
      const i = session.turns.findIndex(
        (t) => t.messageId === bounds.endMessageId,
      );
      if (i >= 0) to = i;
    }
    const turns = session.turns.slice(from, to + 1);
    if (turns.length === 0) return;

    out.push(
      from > 0
        ? `--- ${name}: continues from earlier (its opening is NOT in this window) ---`
        : `--- ${name}: starts here (its opening IS in this window) ---`,
    );
    for (const turn of turns) {
      const id = turn.speaker === 'helper' ? `H${++helperN}` : `C${++clientN}`;
      lines.push({ id, speaker: turn.speaker, text: turn.text, scored: true });
      out.push(`[${id}] ${label(turn.speaker)}: ${turn.text}`);
    }
    out.push(
      to < session.turns.length - 1
        ? `--- ${name}: continues after this window (its end is NOT shown) ---`
        : `--- ${name}: ends here ---`,
    );
  });

  return { text: out.join('\n'), lines, helperLines: helperN };
}

/**
 * Lay ONE WHOLE session out as the judge reads it — the benchmark's window.
 *
 * The same rendering as a cut ({@link renderWindow}) with bounds spanning the
 * session's first turn to its last, so the judge sees one session whose
 * opening and end are both in view and no context block: exactly the shape a
 * cut takes when it happens to hold one complete session. Null when the
 * session has no turns.
 */
export function renderSession(
  session: SessionTranscript,
): RenderedWindow | null {
  const first = session.turns[0];
  const last = session.turns[session.turns.length - 1];
  if (!first || !last) return null;
  return renderWindow(
    new Map([[session.sessionId, session]]),
    {
      sessionIds: [session.sessionId],
      startSessionId: session.sessionId,
      startMessageId: first.messageId,
      endSessionId: session.sessionId,
      endMessageId: last.messageId,
    },
    0,
  );
}

/** The learner's own speech in a session, in code points (helper turns only). */
export function learnerCharsOf(session: SessionTranscript): number {
  return session.turns
    .filter((t) => t.speaker === 'helper')
    .reduce((sum, t) => sum + charLength(t.text), 0);
}

function label(speaker: Speaker): string {
  return speaker === 'helper' ? 'HELPER' : 'CLIENT';
}

function sessionLetter(position: number): string {
  // A..Z, then AA, AB… — a cut spanning 27 sessions would need 5,000 characters
  // spread over 27 practice sessions, but the label must not break if it does.
  let n = position;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function tailWithinBudget(
  turns: readonly TranscriptTurn[],
  budget: number,
): TranscriptTurn[] {
  const kept: TranscriptTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const length = charLength(turns[i].text);
    if (kept.length > 0 && used + length > budget) break;
    kept.unshift(turns[i]);
    used += length;
  }
  return kept;
}
