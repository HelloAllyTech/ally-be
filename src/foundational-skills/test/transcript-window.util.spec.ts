import {
  SessionTranscript,
  TranscriptTurn,
  charLength,
  planCuts,
  renderWindow,
  turnsAfter,
} from '../util/transcript-window.util';

let nextId = 1;
const helper = (chars: number): TranscriptTurn => ({
  messageId: nextId++,
  speaker: 'helper',
  text: 'h'.repeat(chars),
});
const client = (chars: number): TranscriptTurn => ({
  messageId: nextId++,
  speaker: 'client',
  text: 'c'.repeat(chars),
});
const session = (id: string, turns: TranscriptTurn[]): SessionTranscript => ({
  sessionId: id,
  endedAt: new Date('2026-09-01T10:00:00Z'),
  tenantId: 't1',
  turns,
});

beforeEach(() => {
  nextId = 1;
});

describe('charLength', () => {
  it('counts code points like Postgres char_length, not UTF-16 units', () => {
    expect(charLength('😀a')).toBe(2);
    expect(charLength('नमस्ते')).toBe(6);
  });
});

describe('planCuts', () => {
  it('seals nothing until the learner has said enough', () => {
    const s = session('s1', [client(900), helper(40), client(900), helper(50)]);
    expect(planCuts(null, [s], 100)).toEqual([]);
  });

  it('closes on the helper turn that crosses the threshold and never splits a turn', () => {
    const s = session('s1', [
      client(10),
      helper(60),
      client(10),
      helper(60),
      client(10),
      helper(10),
    ]);
    const [cut, ...rest] = planCuts(null, [s], 100);
    expect(rest).toEqual([]);
    expect(cut.learnerChars).toBe(120);
    expect(cut.totalChars).toBe(140);
    expect(cut.startMessageId).toBe(1);
    expect(cut.endMessageId).toBe(4);
    expect(cut.startsMidSession).toBe(false);
    expect(cut.endsMidSession).toBe(true);
  });

  it('counts only learner speech, however much the character talks', () => {
    const chatty = session('s1', [client(5000), helper(99)]);
    expect(planCuts(null, [chatty], 100)).toEqual([]);
  });

  it('spans sessions in the order given and records every session it touches', () => {
    const a = session('a', [client(5), helper(70)]);
    const b = session('b', [client(5), helper(40), client(5), helper(5)]);
    const [cut] = planCuts(null, [a, b], 100);
    expect(cut.sessionIds).toEqual(['a', 'b']);
    expect(cut.startSessionId).toBe('a');
    expect(cut.endSessionId).toBe('b');
    expect(cut.learnerChars).toBe(110);
  });

  it('seals several cuts from one long session, each starting where the last ended', () => {
    const s = session('s1', [
      helper(100),
      client(5),
      helper(100),
      client(5),
      helper(100),
    ]);
    const cuts = planCuts(null, [s], 100);
    expect(cuts).toHaveLength(3);
    expect(cuts.map((c) => c.startsMidSession)).toEqual([false, true, true]);
    expect(cuts.map((c) => c.endsMidSession)).toEqual([true, true, false]);
    expect(cuts[1].startMessageId).toBe(2);
    expect(cuts.every((c) => c.sessionIds.join() === 's1')).toBe(true);
  });

  it('continues from a carried tail first, marking it as mid-session', () => {
    const full = session('s1', [helper(100), client(5), helper(60)]);
    const carry = turnsAfter(full, 1);
    const next = session('s2', [client(5), helper(50)]);
    const [cut] = planCuts(carry, [next], 100);
    expect(cut.sessionIds).toEqual(['s1', 's2']);
    expect(cut.startMessageId).toBe(2);
    expect(cut.startsMidSession).toBe(true);
    expect(cut.learnerChars).toBe(110);
  });

  it('marks a turnless session consumed by the next cut that opens', () => {
    const empty = session('empty', []);
    const s = session('s1', [helper(120)]);
    const [cut] = planCuts(null, [empty, s], 100);
    expect(cut.sessionIds).toEqual(['empty', 's1']);
  });
});

describe('turnsAfter', () => {
  it('returns the tail after a message, or nothing if the message is gone', () => {
    const s = session('s1', [helper(1), client(1), helper(1)]);
    expect(turnsAfter(s, 1).turns.map((t) => t.messageId)).toEqual([2, 3]);
    expect(turnsAfter(s, 999).turns).toEqual([]);
  });
});

describe('renderWindow', () => {
  const a: SessionTranscript = {
    ...session('a', []),
    turns: [
      { messageId: 1, speaker: 'client', text: 'I lost my job.' },
      { messageId: 2, speaker: 'helper', text: 'That sounds hard.' },
      { messageId: 3, speaker: 'client', text: 'I cannot sleep.' },
      {
        messageId: 4,
        speaker: 'helper',
        text: 'How long has that been going on?',
      },
    ],
  };
  const b: SessionTranscript = {
    ...session('b', []),
    turns: [
      { messageId: 10, speaker: 'helper', text: 'Hello, I am Asha.' },
      { messageId: 11, speaker: 'client', text: 'Hi.' },
      {
        messageId: 12,
        speaker: 'helper',
        text: 'What would you like to talk about?',
      },
    ],
  };
  const sessions = new Map([
    ['a', a],
    ['b', b],
  ]);

  it('shows the earlier part of the first session as uncitable context', () => {
    const out = renderWindow(
      sessions,
      {
        sessionIds: ['a', 'b'],
        startSessionId: 'a',
        startMessageId: 3,
        endSessionId: 'b',
        endMessageId: 10,
      },
      1000,
    );
    expect(out.text).toContain('### CONTEXT');
    expect(out.text).toContain('HELPER: That sounds hard.');
    expect(out.lines.map((l) => l.id)).toEqual(['C1', 'H1', 'H2']);
    expect(out.lines.every((l) => l.scored)).toBe(true);
    expect(out.text).toContain('Session A: continues from earlier');
    expect(out.text).toContain('Session A: ends here');
    expect(out.text).toContain('Session B: starts here');
    expect(out.text).toContain('Session B: continues after this window');
    expect(out.helperLines).toBe(2);
  });

  it('caps context at the budget but always keeps the nearest turn', () => {
    const out = renderWindow(
      sessions,
      {
        sessionIds: ['a'],
        startSessionId: 'a',
        startMessageId: 4,
        endSessionId: 'a',
        endMessageId: 4,
      },
      5,
    );
    expect(out.text).toContain('CLIENT: I cannot sleep.');
    expect(out.text).not.toContain('I lost my job.');
  });

  it('shows no context block when the cut starts at an opening', () => {
    const out = renderWindow(
      sessions,
      {
        sessionIds: ['b'],
        startSessionId: 'b',
        startMessageId: 10,
        endSessionId: 'b',
        endMessageId: 12,
      },
      1000,
    );
    expect(out.text).not.toContain('CONTEXT');
    expect(out.text).toContain('Session A: starts here');
    expect(out.text).toContain('Session A: ends here');
  });
});
