import { TrackMemoryService } from '../track-memory.service';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: (...args: any[]) => mockCreate(...args) },
  })),
}));

describe('TrackMemoryService', () => {
  const configService = {
    anthropic: { apiKey: 'test-key', autofillModel: 'claude-test' },
  };
  const promptSharedService = {
    getPromptByCode: jest
      .fn()
      .mockResolvedValue('Fold these:\n{{sessionMemories}}'),
  };
  const llmUsage = { record: jest.fn() };
  const trackEnrollmentRepository = { findOne: jest.fn(), update: jest.fn() };
  const trackItemProgressRepository = { findOne: jest.fn() };
  const trackItemRepository = { find: jest.fn() };
  const trackSectionRepository = { find: jest.fn() };

  const service = new TrackMemoryService(
    configService as any,
    promptSharedService as any,
    llmUsage as any,
    trackEnrollmentRepository as any,
    trackItemProgressRepository as any,
    trackItemRepository as any,
    trackSectionRepository as any,
  );

  const progress = {
    id: 'tip-2',
    trackItemId: 'item-2',
    trackEnrollmentId: 'enr-1',
  };
  const track = {
    sections: [{ id: 's1', order: 1 }],
    items: [
      { id: 'item-1', trackSectionId: 's1', order: 1 },
      { id: 'item-2', trackSectionId: 's1', order: 2 },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    trackItemProgressRepository.findOne.mockResolvedValue(progress);
    trackSectionRepository.find.mockResolvedValue(track.sections);
    trackItemRepository.find.mockResolvedValue(track.items);
    promptSharedService.getPromptByCode.mockResolvedValue(
      'Fold these:\n{{sessionMemories}}',
    );
  });

  it('first fold stores the item entry and uses the memory verbatim (no LLM)', async () => {
    trackEnrollmentRepository.findOne.mockResolvedValue({
      id: 'enr-1',
      trackId: 't1',
      memory: null,
    });

    await service.foldSessionMemory({
      trackItemProgressId: 'tip-2',
      scenarioSessionId: 'sess-1',
      summary: 'first session memory',
    });

    expect(mockCreate).not.toHaveBeenCalled();
    const [, patch] = trackEnrollmentRepository.update.mock.calls[0];
    expect(patch.memory.summary).toBe('first session memory');
    expect(patch.memory.items['item-2'].sessionId).toBe('sess-1');
  });

  it('multi-item fold merges via the LLM in track order and records usage', async () => {
    trackEnrollmentRepository.findOne.mockResolvedValue({
      id: 'enr-1',
      trackId: 't1',
      memory: {
        items: {
          'item-1': {
            sessionId: 'sess-0',
            summary: 'memory of item one',
            updatedAt: 'x',
          },
        },
      },
    });
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'consolidated memory' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await service.foldSessionMemory({
      trackItemProgressId: 'tip-2',
      scenarioSessionId: 'sess-1',
      summary: 'memory of item two',
    });

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt.indexOf('memory of item one')).toBeLessThan(
      prompt.indexOf('memory of item two'),
    );
    expect(llmUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'track_memory_fold', totalTokens: 150 }),
    );
    const [, patch] = trackEnrollmentRepository.update.mock.calls[0];
    expect(patch.memory.summary).toBe('consolidated memory');
    expect(Object.keys(patch.memory.items)).toHaveLength(2);
  });

  it('falls back to a deterministic join when the LLM fails', async () => {
    trackEnrollmentRepository.findOne.mockResolvedValue({
      id: 'enr-1',
      trackId: 't1',
      memory: {
        items: {
          'item-1': {
            sessionId: 's0',
            summary: 'older memory',
            updatedAt: 'x',
          },
        },
      },
    });
    mockCreate.mockRejectedValue(new Error('llm down'));

    await service.foldSessionMemory({
      trackItemProgressId: 'tip-2',
      scenarioSessionId: 'sess-1',
      summary: 'newer memory',
    });

    const [, patch] = trackEnrollmentRepository.update.mock.calls[0];
    expect(patch.memory.summary).toContain('older memory');
    expect(patch.memory.summary).toContain('newer memory');
  });

  it('a replay replaces its own item entry instead of double-counting', async () => {
    trackEnrollmentRepository.findOne.mockResolvedValue({
      id: 'enr-1',
      trackId: 't1',
      memory: {
        items: {
          'item-2': {
            sessionId: 'sess-old',
            summary: 'old attempt',
            updatedAt: 'x',
          },
        },
      },
    });

    await service.foldSessionMemory({
      trackItemProgressId: 'tip-2',
      scenarioSessionId: 'sess-new',
      summary: 'new attempt',
    });

    expect(mockCreate).not.toHaveBeenCalled(); // still a single item
    const [, patch] = trackEnrollmentRepository.update.mock.calls[0];
    expect(patch.memory.items['item-2'].sessionId).toBe('sess-new');
    expect(patch.memory.summary).toBe('new attempt');
  });

  it('never throws: missing progress or enrollment is a silent no-op', async () => {
    trackItemProgressRepository.findOne.mockResolvedValue(null);
    await expect(
      service.foldSessionMemory({
        trackItemProgressId: 'missing',
        scenarioSessionId: 's',
        summary: 'm',
      }),
    ).resolves.toBeUndefined();
    expect(trackEnrollmentRepository.update).not.toHaveBeenCalled();
  });

  describe('getConsolidatedMemory', () => {
    it('returns the stored summary', async () => {
      trackEnrollmentRepository.findOne.mockResolvedValue({
        id: 'enr-1',
        memory: { summary: ' the fold ', items: {} },
      });
      await expect(service.getConsolidatedMemory('tip-2')).resolves.toBe(
        'the fold',
      );
    });

    it('returns null when absent', async () => {
      trackEnrollmentRepository.findOne.mockResolvedValue({
        id: 'enr-1',
        memory: null,
      });
      await expect(service.getConsolidatedMemory('tip-2')).resolves.toBeNull();
    });

    it('appends active learned facts only — neither superseded nor retired', async () => {
      trackEnrollmentRepository.findOne.mockResolvedValue({
        id: 'enr-1',
        memory: {
          summary: 'the fold',
          items: {},
          facts: [
            { id: 'f1', fact: 'Works night shifts', status: 'active' },
            { id: 'f2', fact: 'Feared losing job', status: 'superseded' },
            { id: 'f3', fact: 'Son is 7 years old', status: 'active' },
            { id: 'f4', fact: 'Cycles to work', status: 'retired' },
          ],
        },
      });
      const composed = await service.getConsolidatedMemory('tip-2');
      expect(composed).toContain('the fold');
      expect(composed).toContain('- Works night shifts');
      expect(composed).toContain('- Son is 7 years old');
      expect(composed).not.toContain('Feared losing job');
      // Still true, but evicted for space — it must not reach the persona.
      expect(composed).not.toContain('Cycles to work');
    });
  });

  describe('learned facts consolidation', () => {
    const foldWith = async (existingFacts: any[], disclosures: string[]) => {
      trackEnrollmentRepository.findOne.mockResolvedValue({
        id: 'enr-1',
        trackId: 't1',
        memory: { items: {}, facts: existingFacts },
      });
      await service.foldSessionMemory({
        trackItemProgressId: 'tip-2',
        scenarioSessionId: 'sess-9',
        summary: 'session summary',
        disclosures,
      });
      const [, patch] = trackEnrollmentRepository.update.mock.calls[0];
      return patch.memory.facts as any[];
    };

    it('LLM merge: keeps ids, supersedes, adds new facts with real ids', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { id: 'f1', fact: 'Works day shifts now', status: 'active' },
              { id: 'f2', fact: 'Feared losing job', status: 'superseded' },
              { id: 'new-1', fact: 'Son is 7 years old', status: 'active' },
            ]),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
      const facts = await foldWith(
        [
          { id: 'f1', fact: 'Works night shifts', status: 'active' },
          { id: 'f2', fact: 'Feared losing job', status: 'active' },
        ],
        ['Son is 7 years old', 'Works day shifts now'],
      );
      const byFact = Object.fromEntries(facts.map((f) => [f.fact, f]));
      expect(byFact['Works day shifts now'].id).toBe('f1'); // id preserved
      expect(byFact['Feared losing job'].status).toBe('superseded');
      const added = byFact['Son is 7 years old'];
      expect(added.status).toBe('active');
      expect(added.id).not.toBe('new-1'); // real uuid assigned
      expect(added.sourceSessionId).toBe('sess-9');
    });

    it('reconciliation: facts the LLM omits are kept, never deleted', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { id: 'new-1', fact: 'A new fact', status: 'active' },
            ]),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
      const facts = await foldWith(
        [{ id: 'f1', fact: 'Original fact', status: 'active' }],
        ['A new fact'],
      );
      expect(facts.map((f) => f.fact)).toEqual(
        expect.arrayContaining(['A new fact', 'Original fact']),
      );
    });

    it('fallback on LLM failure: appends non-duplicate disclosures as active', async () => {
      mockCreate.mockRejectedValue(new Error('llm down'));
      const facts = await foldWith(
        [{ id: 'f1', fact: 'Works night shifts', status: 'active' }],
        ['works   NIGHT shifts', 'Son is 7 years old'],
      );
      expect(facts).toHaveLength(2); // duplicate skipped
      expect(facts[1].fact).toBe('Son is 7 years old');
      expect(facts[1].status).toBe('active');
    });

    it('no disclosures: facts untouched and no facts LLM call', async () => {
      const existing = [{ id: 'f1', fact: 'A fact', status: 'active' }];
      const facts = await foldWith(existing, []);
      expect(facts).toEqual(existing);
      expect(mockCreate).not.toHaveBeenCalled(); // single-item fold + no facts
    });

    it("supersession keeps the ORIGINAL fact's id and provenance, and gives the replacement its own", async () => {
      // The golden-record property: one stable identity per fact. A superseded
      // entry is the audit trail of when something STOPPED being true, so it
      // has to keep pointing at the session it came FROM, not the one that
      // retired it.
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { id: 'g1', fact: 'Works night shifts', status: 'superseded' },
              {
                id: 'new-1',
                fact: 'Moved to days last month',
                status: 'active',
              },
            ]),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
      const facts = await foldWith(
        [
          {
            id: 'g1',
            fact: 'Works night shifts',
            status: 'active',
            sourceSessionId: 'sess-1',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        ['I moved to the day shift last month'],
      );

      const retired = facts.find((f) => f.fact === 'Works night shifts');
      expect(retired.id).toBe('g1');
      expect(retired.status).toBe('superseded');
      expect(retired.sourceSessionId).toBe('sess-1'); // NOT the retiring session
      expect(retired.createdAt).toBe('2026-01-01T00:00:00Z');

      const replacement = facts.find(
        (f) => f.fact === 'Moved to days last month',
      );
      expect(replacement.id).not.toBe('g1');
      expect(replacement.status).toBe('active');
      expect(replacement.sourceSessionId).toBe('sess-9');
    });

    it('survives the model putting the ids the wrong way round', async () => {
      // Observed against the live model before the prompt spelled the
      // convention out: it treats an id as belonging to the TOPIC, reassigning
      // it to the new fact and inventing `old-<id>` for the original. Resolving
      // by id alone inverts the bookkeeping — the original is overwritten in
      // place and a fresh uuid stamped with today's session is minted for it.
      // Binding by text first makes the outcome identical to the correct form
      // above, so a model regression cannot corrupt the trail.
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { id: 'g1', fact: 'Moved to days last month', status: 'active' },
              {
                id: 'old-g1',
                fact: 'Works night shifts',
                status: 'superseded',
              },
            ]),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
      const facts = await foldWith(
        [
          {
            id: 'g1',
            fact: 'Works night shifts',
            status: 'active',
            sourceSessionId: 'sess-1',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        ['I moved to the day shift last month'],
      );

      const retired = facts.find((f) => f.fact === 'Works night shifts');
      expect(retired.id).toBe('g1'); // identity followed the text, not the slot
      expect(retired.status).toBe('superseded');
      expect(retired.sourceSessionId).toBe('sess-1');
      expect(retired.createdAt).toBe('2026-01-01T00:00:00Z');

      const replacement = facts.find(
        (f) => f.fact === 'Moved to days last month',
      );
      expect(replacement.id).not.toBe('g1');
      expect(replacement.status).toBe('active');
      expect(replacement.sourceSessionId).toBe('sess-9');
      expect(facts).toHaveLength(2);
    });

    it('re-delivery of the same session does not duplicate what it already contributed', async () => {
      // Every track session folds TWICE (the two-phase session_memory
      // upgrade), re-submitting its own disclosures. items/summary are
      // idempotent by construction; facts are not, so this pins the seam we
      // actually depend on.
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                id: 'f1',
                fact: 'Works night shifts at the factory',
                status: 'active',
              },
              { id: 'f2', fact: 'Music helps him calm down', status: 'active' },
              {
                id: 'new-1',
                fact: 'Mother has been unwell since January',
                status: 'active',
              },
            ]),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
      const facts = await foldWith(
        [
          {
            id: 'f1',
            fact: 'Works night shifts at the factory',
            status: 'active',
            sourceSessionId: 'sess-9',
          },
          {
            id: 'f2',
            fact: 'Music helps him calm down',
            status: 'active',
            sourceSessionId: 'sess-9',
          },
        ],
        [
          'I work nights at the factory',
          'Music helps me feel calm',
          'My mother has been unwell since January',
        ],
      );
      expect(facts).toHaveLength(3); // 2 kept + 1 genuinely new, nothing doubled
      expect(facts.filter((f) => f.id === 'f1')).toHaveLength(1);
      expect(facts.find((f) => f.id === 'f1').fact).toBe(
        'Works night shifts at the factory',
      );
    });

    it('a retired fact is withheld from the merge model but survives the fold intact', async () => {
      // The model only reasons in active/superseded. Showing it a third state
      // it was never taught invites it to echo one back, so retired entries
      // are kept out of the payload — and the reconciliation loop preserves
      // anything the model never claimed.
      promptSharedService.getPromptByCode.mockImplementation((code: string) =>
        Promise.resolve(
          code === 'track_memory_facts'
            ? 'EXISTING: {{existingFacts}}\nNEW: {{newDisclosures}}'
            : 'Fold these:\n{{sessionMemories}}',
        ),
      );
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { id: 'f1', fact: 'Works night shifts', status: 'active' },
              { id: 'new-1', fact: 'Son is 7 years old', status: 'active' },
            ]),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
      const facts = await foldWith(
        [
          { id: 'f1', fact: 'Works night shifts', status: 'active' },
          {
            id: 'f2',
            fact: 'Cycles to work',
            status: 'retired',
            sourceSessionId: 'sess-1',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        ['Son is 7 years old'],
      );

      const calls = mockCreate.mock.calls;
      const factsCall = calls[calls.length - 1][0].messages[0].content;
      expect(factsCall).toContain('EXISTING:'); // the facts template rendered
      expect(factsCall).toContain('Works night shifts');
      expect(factsCall).not.toContain('Cycles to work'); // withheld

      const survivor = facts.find((f) => f.id === 'f2');
      expect(survivor.status).toBe('retired'); // preserved verbatim
      expect(survivor.sourceSessionId).toBe('sess-1');
      expect(survivor.createdAt).toBe('2026-01-01T00:00:00Z');
    });

    it('a retired fact disclosed again is resurrected, keeping its original id', async () => {
      // The point of separating "evicted for space" from "no longer true": an
      // evicted fact is still TRUE, so if it comes up again it should come back
      // as itself rather than as a duplicate with fresh provenance. It binds by
      // text even though the model never saw it and invented a new-N id.
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { id: 'new-1', fact: 'Cycles to work', status: 'active' },
            ]),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
      const facts = await foldWith(
        [
          {
            id: 'f2',
            fact: 'Cycles to work',
            status: 'retired',
            sourceSessionId: 'sess-1',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        ['I cycle to work'],
      );

      expect(facts).toHaveLength(1); // resurrected, not duplicated
      expect(facts[0].id).toBe('f2');
      expect(facts[0].status).toBe('active');
      expect(facts[0].sourceSessionId).toBe('sess-1'); // original provenance
      expect(facts[0].createdAt).toBe('2026-01-01T00:00:00Z');
    });

    it('caps active facts by RETIRING the oldest, not superseding them', async () => {
      mockCreate.mockRejectedValue(new Error('llm down')); // use fallback path
      const existing = Array.from({ length: 40 }, (_, i) => ({
        id: `f${i}`,
        fact: `Fact number ${i}`,
        status: 'active',
        createdAt: `2026-01-0${(i % 8) + 1}T00:00:00Z`,
      }));
      const facts = await foldWith(existing, ['Brand new fact 41']);
      const actives = facts.filter((f) => f.status === 'active');
      expect(actives).toHaveLength(40);
      expect(facts.find((f) => f.fact === 'Brand new fact 41')?.status).toBe(
        'active',
      );
      // Evicted for space, so `retired` — NOT `superseded`, which would claim
      // the client contradicted it.
      expect(facts.filter((f) => f.status === 'retired')).toHaveLength(1);
      expect(facts.filter((f) => f.status === 'superseded')).toHaveLength(0);
    });
  });
});
