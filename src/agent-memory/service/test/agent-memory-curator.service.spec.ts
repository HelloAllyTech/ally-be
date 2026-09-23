import {
  AgentMemoryCuratorService,
  parseOperations,
  scoreEntry,
} from '../agent-memory-curator.service';
import { AgentMemory } from '../../entity/agent-memory.entity';
import {
  AgentMemoryAgent,
  AgentMemoryStatus,
} from '../../enum/agent-memory.enum';
import {
  AGENT_MEMORY_ACTIVE_CAP,
  AGENT_MEMORY_CANDIDATE_TRIGGER,
} from '../../constants/agent-memory.constants';

const entry = (overrides: Partial<AgentMemory> = {}): AgentMemory =>
  ({
    id: 'e-1',
    agent: AgentMemoryAgent.BUG_HUNTER,
    body: 'A lesson.',
    repos: ['ally-be'],
    tags: null,
    status: AgentMemoryStatus.ACTIVE,
    pinned: false,
    sourceCount: 1,
    timesApplied: 0,
    timesContradicted: 0,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    ...overrides,
  }) as AgentMemory;

const candidates = (n: number): AgentMemory[] =>
  Array.from({ length: n }, (_, i) =>
    entry({ id: `c-${i}`, status: AgentMemoryStatus.CANDIDATE }),
  );

describe('AgentMemoryCuratorService', () => {
  let service: AgentMemoryCuratorService;
  let repository: { listByStatus: jest.Mock; update: jest.Mock };
  let txRepo: { update: jest.Mock };
  let memoryService: { resyncVectors: jest.Mock };
  let llm: { complete: jest.Mock };
  let redis: { acquireLock: jest.Mock; releaseLock: jest.Mock };

  const byStatus = (rows: {
    candidate?: AgentMemory[];
    active?: AgentMemory[];
  }) =>
    repository.listByStatus.mockImplementation(
      async (_agent: AgentMemoryAgent, status: AgentMemoryStatus) =>
        status === AgentMemoryStatus.CANDIDATE
          ? (rows.candidate ?? [])
          : (rows.active ?? []),
    );

  beforeEach(() => {
    repository = {
      listByStatus: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    };
    txRepo = { update: jest.fn().mockResolvedValue(undefined) };
    memoryService = { resyncVectors: jest.fn().mockResolvedValue(undefined) };
    llm = { complete: jest.fn() };
    redis = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: jest.fn(async (fn: (em: unknown) => Promise<void>) =>
        fn({ getRepository: () => txRepo }),
      ),
    };
    service = new AgentMemoryCuratorService(
      dataSource as never,
      repository as never,
      memoryService as never,
      llm as never,
      redis as never,
    );
  });

  it('does nothing but enforce the cap when there are no candidates', async () => {
    byStatus({ active: [entry()] });
    const result = await service.consolidate(AgentMemoryAgent.BUG_HUNTER);
    expect(result.skipped).toBe('nothing new');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('waits for a batch before spending a model call, unless forced', async () => {
    byStatus({ candidate: candidates(AGENT_MEMORY_CANDIDATE_TRIGGER - 1) });
    llm.complete.mockResolvedValue({ text: '[]' });

    const waited = await service.consolidate(AgentMemoryAgent.BUG_HUNTER);
    expect(waited.skipped).toBe('below the batch threshold');
    expect(llm.complete).not.toHaveBeenCalled();

    await service.consolidate(AgentMemoryAgent.BUG_HUNTER, true);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('does not run when another pod holds the lock', async () => {
    redis.acquireLock.mockResolvedValue(false);
    byStatus({ candidate: candidates(10) });
    const result = await service.consolidate(AgentMemoryAgent.BUG_HUNTER);
    expect(result.skipped).toBe('another pod is curating');
    expect(repository.listByStatus).not.toHaveBeenCalled();
  });

  it('scopes the lock and the rows to one agent', async () => {
    byStatus({ candidate: [] });
    await service.consolidate(AgentMemoryAgent.BUILDER);
    expect(redis.acquireLock).toHaveBeenCalledWith(
      'agent-memory-curate:builder',
      expect.any(Number),
    );
    expect(repository.listByStatus).toHaveBeenCalledWith(
      AgentMemoryAgent.BUILDER,
      AgentMemoryStatus.CANDIDATE,
    );
  });

  it('promotes every candidate uncurated when the model is unavailable — an untidy notebook beats a lost lesson', async () => {
    const cands = candidates(AGENT_MEMORY_CANDIDATE_TRIGGER);
    byStatus({ candidate: cands });
    llm.complete.mockRejectedValue(new Error('provider down'));

    const result = await service.consolidate(AgentMemoryAgent.BUG_HUNTER);

    expect(result.skipped).toMatch(/promoted uncurated/);
    expect(repository.update).toHaveBeenCalledTimes(cands.length);
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'c-0' },
      { status: AgentMemoryStatus.ACTIVE },
    );
  });

  describe('applying operations', () => {
    it('AGREE folds a candidate into an active entry and tombstones the candidate', async () => {
      const active = entry({ id: 'a-1', sourceCount: 2, tags: ['flaky-test'] });
      const cand = entry({
        id: 'c-1',
        status: AgentMemoryStatus.CANDIDATE,
        repos: ['ally-web'],
        tags: ['jest'],
      });
      byStatus({ candidate: [cand], active: [active] });
      llm.complete.mockResolvedValue({
        text: '[{"op":"AGREE","id":"a-1","candidateId":"c-1"}]',
      });

      const result = await service.consolidate(
        AgentMemoryAgent.BUG_HUNTER,
        true,
      );

      expect(result.applied).toBe(1);
      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'a-1' },
        {
          sourceCount: 3,
          repos: ['ally-be', 'ally-web'],
          tags: ['flaky-test', 'jest'],
        },
      );
      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'c-1' },
        { status: AgentMemoryStatus.MERGED, mergedIntoId: 'a-1' },
      );
    });

    it('never edits or removes a pinned entry, whatever the model says', async () => {
      const pinned = entry({ id: 'p-1', pinned: true });
      const cand = entry({ id: 'c-1', status: AgentMemoryStatus.CANDIDATE });
      byStatus({ candidate: [cand], active: [pinned] });
      llm.complete.mockResolvedValue({
        text: JSON.stringify([
          { op: 'EDIT', id: 'p-1', body: 'rewritten' },
          { op: 'REMOVE', id: 'p-1' },
          { op: 'ADD', id: 'c-1' },
        ]),
      });

      const result = await service.consolidate(
        AgentMemoryAgent.BUG_HUNTER,
        true,
      );

      expect(result.applied).toBe(1);
      const touchedPinned = txRepo.update.mock.calls.filter(
        ([where]) => where.id === 'p-1',
      );
      expect(touchedPinned).toHaveLength(0);
    });

    it('refuses a rewrite over the 600-character cap and promotes the candidate untouched', async () => {
      const cand = entry({ id: 'c-1', status: AgentMemoryStatus.CANDIDATE });
      byStatus({ candidate: [cand], active: [] });
      llm.complete.mockResolvedValue({
        text: JSON.stringify([{ op: 'ADD', id: 'c-1', body: 'x'.repeat(601) }]),
      });

      await service.consolidate(AgentMemoryAgent.BUG_HUNTER, true);

      // The ADD was refused, so the unmentioned-candidate rule promotes it as written.
      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'c-1' },
        { status: AgentMemoryStatus.ACTIVE },
      );
      expect(txRepo.update).not.toHaveBeenCalledWith(
        { id: 'c-1' },
        expect.objectContaining({ body: 'x'.repeat(601) }),
      );
    });

    it('promotes a candidate the model said nothing about — silence is not a decision', async () => {
      const cands = [
        entry({ id: 'c-1', status: AgentMemoryStatus.CANDIDATE }),
        entry({ id: 'c-2', status: AgentMemoryStatus.CANDIDATE }),
      ];
      byStatus({ candidate: cands, active: [] });
      llm.complete.mockResolvedValue({
        text: '[{"op":"ADD","id":"c-1","tags":["Fix-Gotcha"]}]',
      });

      await service.consolidate(AgentMemoryAgent.BUG_HUNTER, true);

      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'c-1' },
        { status: AgentMemoryStatus.ACTIVE, tags: ['fix-gotcha'] },
      );
      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'c-2' },
        { status: AgentMemoryStatus.ACTIVE },
      );
    });

    it('re-syncs vectors for entries it rewrote or retired', async () => {
      const a1 = entry({ id: 'a-1' });
      const a2 = entry({ id: 'a-2' });
      const cand = entry({ id: 'c-1', status: AgentMemoryStatus.CANDIDATE });
      byStatus({ candidate: [cand], active: [a1, a2] });
      llm.complete.mockResolvedValue({
        text: JSON.stringify([
          { op: 'EDIT', id: 'a-1', body: 'sharper' },
          { op: 'REMOVE', id: 'a-2' },
        ]),
      });

      await service.consolidate(AgentMemoryAgent.BUG_HUNTER, true);

      expect(memoryService.resyncVectors).toHaveBeenCalledWith(
        expect.arrayContaining(['a-1', 'a-2']),
      );
    });

    it("ignores an operation that names another agent's entry", async () => {
      const foreign = entry({ id: 'b-1', agent: AgentMemoryAgent.BUILDER });
      const cand = entry({ id: 'c-1', status: AgentMemoryStatus.CANDIDATE });
      byStatus({ candidate: [cand], active: [foreign] });
      llm.complete.mockResolvedValue({
        text: '[{"op":"REMOVE","id":"b-1"}]',
      });

      const result = await service.consolidate(
        AgentMemoryAgent.BUG_HUNTER,
        true,
      );
      expect(result.applied).toBe(0);
      expect(txRepo.update).not.toHaveBeenCalledWith(
        { id: 'b-1' },
        expect.anything(),
      );
    });
  });

  describe('the active cap', () => {
    it('retires the weakest unpinned entries to stay inside it', async () => {
      const active = Array.from(
        { length: AGENT_MEMORY_ACTIVE_CAP + 2 },
        (_, i) => entry({ id: `a-${i}`, sourceCount: i + 1 }),
      );
      active[0].pinned = true; // weakest by score, but pinned
      byStatus({ candidate: [], active });

      await service.consolidate(AgentMemoryAgent.BUG_HUNTER);

      const retired = repository.update.mock.calls
        .filter(([, patch]) => patch.status === AgentMemoryStatus.RETIRED)
        .map(([where]) => where.id);
      expect(retired).toEqual(['a-1', 'a-2']);
    });
  });
});

describe('parseOperations', () => {
  it('reads a fenced array, an object wrapper, or a bare array, and drops junk', () => {
    expect(parseOperations('```json\n[{"op":"add","id":"x"}]\n```')).toEqual([
      {
        op: 'ADD',
        id: 'x',
        candidateId: undefined,
        body: undefined,
        tags: undefined,
      },
    ]);
    expect(
      parseOperations(
        '{"operations":[{"op":"REMOVE","id":"y"},{"op":"NOPE"}]}',
      ),
    ).toHaveLength(1);
    expect(parseOperations('no json here')).toEqual([]);
  });

  it("accepts Builder's older `lesson` field name as the body", () => {
    expect(
      parseOperations('[{"op":"EDIT","id":"a","lesson":"text"}]')[0].body,
    ).toBe('text');
  });
});

describe('scoreEntry', () => {
  it('rewards agreement and use, and penalises contradiction twice as hard', () => {
    expect(
      scoreEntry(
        entry({ sourceCount: 3, timesApplied: 2, timesContradicted: 1 }),
      ),
    ).toBe(3);
  });
});
