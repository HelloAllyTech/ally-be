import {
  agentReceiptIsEmpty,
  buildAgentTurnReceipt,
  describeToolFailure,
  joinCallsToResults,
  renderAgentReceiptLine,
  storedAgentReceipt,
} from '../agent-turn-receipt.util';
import { isAcknowledgement, userWordsToApply } from '../agent-turn-words.util';

describe('agent turn receipts', () => {
  const vocabulary = {
    isEnding: (name: string) => name === 'finish_turn',
    isResearch: (name: string) => name === 'search' || name === 'read_doc',
    describeAttempt: (name: string, input: Record<string, any>) =>
      name === 'search' ? `Search "${input.query}"` : name,
    describeRead: (call: { name: string; input: Record<string, any> }) =>
      call.name === 'read_doc' ? [`Doc ${call.input.id}`] : null,
    describeFound: (call: { result?: Record<string, any> }) =>
      `${call.result?.hits?.length ?? 0} hits`,
  };

  const calls = joinCallsToResults(
    [
      { id: 'a', name: 'search', input: { query: 'cover' } },
      { id: 'b', name: 'read_doc', input: { id: 7 } },
      { id: 'c', name: 'edit', input: {} },
      { id: 'd', name: 'search', input: { query: 'never ran' } },
      { id: 'e', name: 'finish_turn', input: { message: 'hi' } },
    ],
    [
      { toolUseId: 'a', name: 'search', result: { ok: true, hits: [1, 2] } },
      { toolUseId: 'b', name: 'read_doc', result: { ok: true } },
      {
        toolUseId: 'c',
        name: 'edit',
        result: { ok: false, error: 'patch_failed', message: 'bad path' },
      },
      { toolUseId: 'e', name: 'finish_turn', result: { ok: true } },
    ],
  );

  it('lists what was read, searched and failed, and leaves out the reply and unfinished calls', () => {
    const receipt = buildAgentTurnReceipt({
      calls,
      vocabulary,
      changed: ['Brief: audience', 'Brief: audience'],
      warnings: ['w', 'w'],
      unchangedBecause: '  ',
    });

    expect(receipt).toEqual({
      read: ['Doc 7'],
      searched: ['Search "cover" — 2 hits'],
      changed: ['Brief: audience'],
      failed: ['edit — bad path'],
      warnings: ['w'],
    });
  });

  it('lets an agent say why a call failed when the result speaks to the model', () => {
    const receipt = buildAgentTurnReceipt({
      calls: joinCallsToResults(
        [{ id: 'a', name: 'search', input: { query: 'q' } }],
        [
          {
            toolUseId: 'a',
            name: 'search',
            result: { ok: false, error: 'Do not tell them.' },
          },
        ],
      ),
      vocabulary: {
        ...vocabulary,
        describeFailure: () => 'the corpus was unreachable',
      },
      changed: [],
    });
    expect(receipt.failed).toEqual(['Search "q" — the corpus was unreachable']);
  });

  it('joins a repeated id by occurrence and leaves out a call that never ran', () => {
    const receipt = buildAgentTurnReceipt({
      calls: joinCallsToResults(
        [
          { id: 'g_0', name: 'search', input: { query: 'one' } },
          { id: 'g_0', name: 'search', input: { query: 'two' } },
          { id: 'x', name: 'edit', input: {} },
        ],
        [
          { toolUseId: 'g_0', name: 'search', result: { ok: true, hits: [1] } },
          {
            toolUseId: 'g_0',
            name: 'search',
            result: { ok: false, message: 'timed out' },
          },
          {
            toolUseId: 'x',
            name: 'edit',
            result: { ok: false, error: 'not_available', notRun: true },
          },
        ],
      ),
      vocabulary,
      changed: [],
    });
    expect(receipt.searched).toEqual(['Search "one" — 1 hits']);
    expect(receipt.failed).toEqual(['Search "two" — timed out']);
  });

  it("names a validation failure's first errors", () => {
    expect(
      describeToolFailure({
        ok: false,
        message: 'Draft invalid.',
        errors: ['age: must be 1-150', 'name: required', 'gender: unknown'],
      }),
    ).toBe('Draft invalid. age: must be 1-150; name: required (+1 more)');
  });

  it('renders one history line and knows an empty receipt', () => {
    const receipt = buildAgentTurnReceipt({
      calls,
      vocabulary,
      changed: ['Course: Renamed section 2'],
    });
    expect(renderAgentReceiptLine(receipt)).toBe(
      'read Doc 7 · 1 search · changed: Course: Renamed section 2 · FAILED: edit — bad path',
    );
    expect(agentReceiptIsEmpty(receipt)).toBe(false);
    expect(
      agentReceiptIsEmpty(
        buildAgentTurnReceipt({ calls: [], vocabulary, changed: [] }),
      ),
    ).toBe(true);
    expect(storedAgentReceipt({ receipt })).toBe(receipt);
    expect(storedAgentReceipt({ receipt: 'nope' })).toBeNull();
  });
});

describe('the words a turn owes a record', () => {
  it.each(['ok', 'Thanks!', 'looks good, go ahead', 'yes and continue'])(
    '"%s" is an acknowledgement',
    (text) => expect(isAcknowledgement(text)).toBe(true),
  );

  it('reads free text, an answer card with custom text, and nothing else', () => {
    expect(
      userWordsToApply('[answers question q1] The audience is volunteers'),
    ).toBe('The audience is volunteers');
    expect(userWordsToApply('ok, thanks')).toBeNull();
    expect(
      userWordsToApply('[answers question q1] Volunteers', {
        selectedOptionIds: ['a'],
      } as any),
    ).toBeNull();
    expect(
      userWordsToApply('[answers question q1] Other', {
        customValues: ['Night-shift nurses'],
      }),
    ).toBe('Night-shift nurses');
  });
});
