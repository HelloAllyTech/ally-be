import { BadRequestException } from '@nestjs/common';

import {
  AGENT_MEMORY_DEFAULT_MIN_SIMILARITY,
  AgentMemoryService,
} from '../agent-memory.service';
import { AgentMemory } from '../../entity/agent-memory.entity';
import {
  AgentMemoryAgent,
  AgentMemoryEmbeddingStatus,
  AgentMemoryStatus,
} from '../../enum/agent-memory.enum';

const row = (overrides: Partial<AgentMemory> = {}): AgentMemory =>
  ({
    id: 'mem-1',
    agent: AgentMemoryAgent.BUG_HUNTER,
    body: 'ally-web tests need NX_DAEMON=false or they collide.',
    repos: ['ally-web'],
    tags: ['flaky-test'],
    status: AgentMemoryStatus.ACTIVE,
    pinned: false,
    sourceCount: 1,
    timesApplied: 0,
    timesContradicted: 0,
    embeddingStatus: AgentMemoryEmbeddingStatus.SUCCESS,
    embeddingAttempts: 0,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    ...overrides,
  }) as AgentMemory;

describe('AgentMemoryService', () => {
  let service: AgentMemoryService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    findByIds: jest.Mock;
    listActiveForRepo: jest.Mock;
    listActiveUnpinned: jest.Mock;
    listRetiredByAgent: jest.Mock;
    recordApplied: jest.Mock;
    recordContradicted: jest.Mock;
    listNeedingEmbedding: jest.Mock;
  };
  let aiService: {
    upsertAgentMemory: jest.Mock;
    deleteAgentMemory: jest.Mock;
    findSimilarAgentMemories: jest.Mock;
  };

  beforeEach(() => {
    repository = {
      create: jest.fn((r) => r),
      save: jest.fn(async (r) => ({ id: 'mem-1', embeddingAttempts: 0, ...r })),
      update: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(async () => row()),
      findByIds: jest.fn().mockResolvedValue([]),
      listActiveForRepo: jest.fn().mockResolvedValue([]),
      listActiveUnpinned: jest.fn().mockResolvedValue([]),
      listRetiredByAgent: jest.fn().mockResolvedValue([]),
      recordApplied: jest.fn().mockResolvedValue(0),
      recordContradicted: jest.fn().mockResolvedValue(0),
      listNeedingEmbedding: jest.fn().mockResolvedValue([]),
    };
    aiService = {
      upsertAgentMemory: jest.fn().mockResolvedValue({
        memory_id: 'mem-1',
        text_hash: 'h',
        embedding_model: 'text-embedding-3-small',
      }),
      deleteAgentMemory: jest.fn().mockResolvedValue({ deleted: true }),
      findSimilarAgentMemories: jest.fn().mockResolvedValue({ matches: [] }),
    };
    service = new AgentMemoryService(repository as never, aiService as never);
  });

  describe('write', () => {
    it('saves to Postgres first, then indexes and records success on the row', async () => {
      await service.write({
        agent: AgentMemoryAgent.BUG_HUNTER,
        body: '  A lesson.  ',
        repos: ['ally-be', 'ALLY-BE', ''],
        tags: ['Flaky-Test'],
        runId: 'run-1',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'A lesson.',
          repos: ['ally-be'],
          tags: ['flaky-test'],
          // The agent's notes wait for the curator.
          status: AgentMemoryStatus.CANDIDATE,
          embeddingStatus: AgentMemoryEmbeddingStatus.PENDING,
          runId: 'run-1',
        }),
      );
      expect(aiService.upsertAgentMemory).toHaveBeenCalledWith({
        memory_id: 'mem-1',
        body: 'A lesson.',
        agent: AgentMemoryAgent.BUG_HUNTER,
      });
      expect(repository.update).toHaveBeenCalledWith(
        'mem-1',
        expect.objectContaining({
          embeddingStatus: AgentMemoryEmbeddingStatus.SUCCESS,
          textHash: 'h',
        }),
      );
    });

    it('keeps the entry when the index is down, and records the failed attempt', async () => {
      aiService.upsertAgentMemory.mockRejectedValue(new Error('ally-ai 503'));

      await expect(
        service.write({ agent: AgentMemoryAgent.BUG_HUNTER, body: 'kept' }),
      ).resolves.toBeDefined();

      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(repository.update).toHaveBeenCalledWith(
        'mem-1',
        expect.objectContaining({
          embeddingStatus: AgentMemoryEmbeddingStatus.FAILED,
          embeddingAttempts: 1,
        }),
      );
    });

    it("lands a human entry ACTIVE at once — a person's note is already curated", async () => {
      await service.write({
        agent: AgentMemoryAgent.BUG_HUNTER,
        body: 'by hand',
        createdBy: 42,
        curated: true,
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AgentMemoryStatus.ACTIVE,
          createdBy: 42,
        }),
      );
    });

    it('stores a platform-wide entry with repos null, not an empty list', async () => {
      await service.write({
        agent: AgentMemoryAgent.BUG_HUNTER,
        body: 'everywhere',
        repos: [],
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ repos: null, tags: null }),
      );
    });

    it('refuses an empty body and a body over 600 characters', async () => {
      await expect(
        service.write({ agent: AgentMemoryAgent.BUG_HUNTER, body: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.write({
          agent: AgentMemoryAgent.BUG_HUNTER,
          body: 'x'.repeat(601),
        }),
      ).rejects.toThrow(/at most 600 characters/);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('asks the index for more than it shows, then narrows to active rows in scope and ranks by similarity', async () => {
      aiService.findSimilarAgentMemories.mockResolvedValue({
        matches: [
          { memory_id: 'web', agent: 'bug_hunter', similarity: 0.9 },
          { memory_id: 'platform', agent: 'bug_hunter', similarity: 0.6 },
          { memory_id: 'be', agent: 'bug_hunter', similarity: 0.8 },
          { memory_id: 'retired', agent: 'bug_hunter', similarity: 0.95 },
        ],
      });
      repository.findByIds.mockResolvedValue([
        row({ id: 'web', repos: ['ally-web'] }),
        row({ id: 'platform', repos: null, body: 'applies everywhere' }),
        row({ id: 'be', repos: ['ally-be'] }),
        row({ id: 'retired', repos: null, status: AgentMemoryStatus.RETIRED }),
      ]);

      const hits = await service.search({
        agent: AgentMemoryAgent.BUG_HUNTER,
        query: 'why do web tests collide',
        repo: 'ally-web',
        limit: 3,
      });

      expect(aiService.findSimilarAgentMemories).toHaveBeenCalledWith({
        query: 'why do web tests collide',
        agent: AgentMemoryAgent.BUG_HUNTER,
        limit: 9,
        threshold: AGENT_MEMORY_DEFAULT_MIN_SIMILARITY,
      });
      expect(hits.map((h) => h.id)).toEqual(['web', 'platform']);
      expect(hits[0].similarity).toBe(0.9);
      expect(hits[0].body).toContain('NX_DAEMON');
    });

    it('returns nothing for an empty query without calling the index', async () => {
      await expect(
        service.search({ agent: AgentMemoryAgent.BUG_HUNTER, query: '  ' }),
      ).resolves.toEqual([]);
      expect(aiService.findSimilarAgentMemories).not.toHaveBeenCalled();
    });

    it('with no repo, returns only platform-wide entries', async () => {
      aiService.findSimilarAgentMemories.mockResolvedValue({
        matches: [
          { memory_id: 'web', agent: 'bug_hunter', similarity: 0.9 },
          { memory_id: 'platform', agent: 'bug_hunter', similarity: 0.5 },
        ],
      });
      repository.findByIds.mockResolvedValue([
        row({ id: 'web', repos: ['ally-web'] }),
        row({ id: 'platform', repos: null }),
      ]);

      const hits = await service.search({
        agent: AgentMemoryAgent.BUG_HUNTER,
        query: 'anything',
      });
      expect(hits.map((h) => h.id)).toEqual(['platform']);
    });
  });

  describe('retire — provenance (OPP-0752)', () => {
    it('records who retired it and why, and no longer overwrites who wrote it', async () => {
      repository.findOne.mockResolvedValue(row({ createdBy: null }));

      await service.retire('mem-1', 42);
      expect(repository.update).toHaveBeenCalledWith(
        'mem-1',
        expect.objectContaining({
          status: AgentMemoryStatus.RETIRED,
          retiredBy: 42,
          retiredReason: null,
          retiredAt: expect.any(Date),
        }),
      );
      expect(repository.update).not.toHaveBeenCalledWith(
        'mem-1',
        expect.objectContaining({ createdBy: 42 }),
      );

      await service.retire(
        'mem-1',
        null,
        'No run applied it in the last 30 runs that reported what they used.',
      );
      expect(repository.update).toHaveBeenCalledWith(
        'mem-1',
        expect.objectContaining({
          retiredBy: null,
          retiredReason: expect.stringMatching(/No run applied it/),
        }),
      );
    });
  });

  describe('restore', () => {
    it('puts a retired entry back, clears the retirement, and re-embeds it', async () => {
      repository.findOne.mockResolvedValue(
        row({
          status: AgentMemoryStatus.RETIRED,
          retiredBy: null,
          retiredReason: 'stale',
        }),
      );
      repository.findOneOrFail.mockResolvedValue(
        row({ status: AgentMemoryStatus.ACTIVE }),
      );

      await service.restore('mem-1', 7);

      expect(repository.update).toHaveBeenCalledWith('mem-1', {
        status: AgentMemoryStatus.ACTIVE,
        retiredAt: null,
        retiredBy: null,
        retiredReason: null,
        embeddingStatus: AgentMemoryEmbeddingStatus.PENDING,
      });
      expect(aiService.upsertAgentMemory).toHaveBeenCalledWith(
        expect.objectContaining({ memory_id: 'mem-1' }),
      );
    });

    it('refuses an entry that is not retired', async () => {
      repository.findOne.mockResolvedValue(
        row({ status: AgentMemoryStatus.MERGED }),
      );
      await expect(service.restore('mem-1', 7)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('recordFeedback', () => {
    it('counts applied and contradicted once each, and an id in both lists counts as applied', async () => {
      repository.recordApplied.mockResolvedValue(2);
      repository.recordContradicted.mockResolvedValue(1);

      const result = await service.recordFeedback({
        applied: ['a', 'b', 'a'],
        contradicted: ['b', 'c', 'c'],
      });

      expect(repository.recordApplied).toHaveBeenCalledWith(
        ['a', 'b'],
        expect.any(Date),
      );
      expect(repository.recordContradicted).toHaveBeenCalledWith(['c']);
      expect(result).toEqual({ applied: 2, contradicted: 1 });
    });
  });

  describe('retire', () => {
    it('retires the row and removes the vector, surviving an index failure', async () => {
      repository.findOne.mockResolvedValue(row());
      aiService.deleteAgentMemory.mockRejectedValue(new Error('503'));

      await service.retire('mem-1', 42);

      expect(repository.update).toHaveBeenCalledWith(
        'mem-1',
        expect.objectContaining({ status: AgentMemoryStatus.RETIRED }),
      );
    });
  });

  describe('reindexPending', () => {
    it('re-pushes failed rows and gives up on ones past the attempt cap', async () => {
      repository.listNeedingEmbedding.mockResolvedValue([
        row({ id: 'a', embeddingAttempts: 1 }),
        row({ id: 'b', embeddingAttempts: 5 }),
      ]);

      const result = await service.reindexPending();

      expect(result).toEqual({ attempted: 2, succeeded: 1 });
      expect(aiService.upsertAgentMemory).toHaveBeenCalledTimes(1);
      expect(aiService.upsertAgentMemory.mock.calls[0][0].memory_id).toBe('a');
    });
  });
});
