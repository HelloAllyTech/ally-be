import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { RoadmapSplitMergeService } from '../roadmap-split-merge.service';
import { RoadmapVectorService } from '../roadmap-vector.service';
import { RoadmapNotificationService } from '../roadmap-notification.service';
import { RoadmapAllocation } from '../../entity/roadmap-allocation.entity';
import { RoadmapOpportunity } from '../../entity/roadmap-opportunity.entity';
import { RoadmapOpportunityStage } from '../../enum/roadmap-opportunity.enum';

const SRC = '11111111-1111-1111-1111-111111111111';
const ACTOR = 9;

describe('RoadmapSplitMergeService', () => {
  let service: RoadmapSplitMergeService;
  let manager: Record<string, jest.Mock>;
  let vectorService: { indexQuietly: jest.Mock; removeQuietly: jest.Mock };
  let notifications: { emit: jest.Mock };
  /** Ordered log of the mutations, so ordering-sensitive rules can be asserted. */
  let calls: string[];
  let savedAllocations: Partial<RoadmapAllocation>[];
  let createdOpportunities: Partial<RoadmapOpportunity>[];

  const queryBuilder = (rows: unknown[]) => ({
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => rows),
  });

  const setup = (opts: {
    source?: Partial<RoadmapOpportunity>;
    allocations?: Partial<RoadmapAllocation>[];
  }) => {
    const source = {
      id: SRC,
      type: 'idea',
      stage: RoadmapOpportunityStage.NEW,
      productGoal: 'Scribe',
      owner: null,
      createdBy: 3,
      releasedAt: null,
      ...opts.source,
    };
    manager.findOne.mockResolvedValue(source);
    manager.createQueryBuilder.mockReturnValue(
      queryBuilder(opts.allocations ?? []),
    );
    return source;
  };

  beforeEach(async () => {
    calls = [];
    savedAllocations = [];
    createdOpportunities = [];

    manager = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      update: jest.fn(async () => {
        calls.push('update-opportunity');
      }),
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        if (entity === RoadmapOpportunity) createdOpportunities.push(data);
        return { ...data };
      }),
      save: jest.fn(async (entityOrData: unknown, maybeData?: unknown) => {
        const data = (maybeData ?? entityOrData) as Record<string, unknown>;
        if (data && 'votes' in data) {
          calls.push('insert-allocation');
          savedAllocations.push(data as Partial<RoadmapAllocation>);
          return data;
        }
        calls.push('insert-opportunity');
        return {
          id: `new-${createdOpportunities.length}`,
          ...(data as object),
        };
      }),
      delete: jest.fn(async () => {
        calls.push('delete-allocations');
      }),
      softDelete: jest.fn(async () => {
        calls.push('soft-delete-sources');
      }),
      query: jest.fn(async (sql: string) => {
        if (sql.includes('DELETE FROM roadmap_allocations'))
          calls.push('delete-allocations');
        if (sql.includes('UPDATE roadmap_opportunity_comments'))
          calls.push('move-comments');
        return [];
      }),
    };

    const dataSource = {
      transaction: jest.fn(async (cb: (m: typeof manager) => unknown) =>
        cb(manager),
      ),
    } as unknown as DataSource;

    vectorService = {
      indexQuietly: jest.fn(async () => undefined),
      removeQuietly: jest.fn(async () => undefined),
    };
    notifications = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoadmapSplitMergeService,
        { provide: DataSource, useValue: dataSource },
        { provide: RoadmapVectorService, useValue: vectorService },
        { provide: RoadmapNotificationService, useValue: notifications },
      ],
    }).compile();

    service = module.get(RoadmapSplitMergeService);
  });

  afterEach(() => jest.clearAllMocks());

  const parts = (weights: number[]) =>
    weights.map((weight, i) => ({
      ...(i === 0 ? { id: SRC } : {}),
      description: `part ${i}`,
      weight,
    }));

  describe('split', () => {
    it('redistributes each contributor’s votes by weight, conserving the total', async () => {
      setup({
        allocations: [
          { userId: 1, opportunityId: SRC, periodKey: '2026-07', votes: 100 },
          { userId: 2, opportunityId: SRC, periodKey: '2026-06', votes: 43 },
        ],
      });

      await service.split(ACTOR, SRC, parts([50, 30, 20]));

      const total = savedAllocations.reduce((a, r) => a + (r.votes ?? 0), 0);
      expect(total).toBe(143);

      // Per (user, period) totals are preserved exactly — nobody's monthly spend changes.
      const byUserPeriod = savedAllocations.reduce<Record<string, number>>(
        (acc, r) => {
          const key = `${r.userId}|${r.periodKey}`;
          acc[key] = (acc[key] ?? 0) + (r.votes ?? 0);
          return acc;
        },
        {},
      );
      expect(byUserPeriod).toEqual({ '1|2026-07': 100, '2|2026-06': 43 });
    });

    /**
     * ORDERING. Every original allocation row must be deleted BEFORE any part's row is
     * inserted. Otherwise the cap trigger briefly sees a user holding their original votes AND
     * their new shares — over 100 — and rejects a legitimate split. The source dodged this with
     * set_config('app.bypass_stage_check'); we simply never create the invalid state.
     */
    it('deletes the original allocations before inserting any new ones', async () => {
      setup({
        allocations: [
          { userId: 1, opportunityId: SRC, periodKey: '2026-07', votes: 90 },
        ],
      });

      await service.split(ACTOR, SRC, parts([50, 50]));

      expect(calls.indexOf('delete-allocations')).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf('delete-allocations')).toBeLessThan(
        calls.indexOf('insert-allocation'),
      );
    });

    it('skips zero-vote shares rather than storing them', async () => {
      setup({
        allocations: [
          { userId: 1, opportunityId: SRC, periodKey: '2026-07', votes: 1 },
        ],
      });

      await service.split(ACTOR, SRC, parts([100, 0, 0]));

      // 1 vote across [100,0,0] is [1,0,0] — only one row should be written.
      expect(savedAllocations).toHaveLength(1);
      expect(savedAllocations[0].votes).toBe(1);
    });

    it.each([
      RoadmapOpportunityStage.RELEASED,
      RoadmapOpportunityStage.ARCHIVED,
    ])('refuses to split a %s source, writing nothing', async (stage) => {
      setup({
        source: { stage, releasedAt: new Date('2026-03-04T05:06:07Z') },
        allocations: [
          { userId: 1, opportunityId: SRC, periodKey: '2026-07', votes: 10 },
        ],
      });

      await expect(service.split(ACTOR, SRC, parts([50, 50]))).rejects.toThrow(
        ConflictException,
      );

      // The transaction must abort before any of it happens: no parts created, no allocations
      // moved, and nothing broadcast to a board that did not change.
      expect(createdOpportunities).toHaveLength(0);
      expect(savedAllocations).toHaveLength(0);
      expect(calls).not.toContain('delete-allocations');
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('names the offender and its stage in the refusal', async () => {
      setup({ source: { stage: RoadmapOpportunityStage.ARCHIVED } });

      // The manager must not have to go back to the board to work out which row blocked it.
      await expect(service.split(ACTOR, SRC, parts([50, 50]))).rejects.toThrow(
        new RegExp(`${SRC}.*archived`, 's'),
      );
    });

    it('leaves releasedAt null on parts of a reshapeable source', async () => {
      setup({
        source: { stage: RoadmapOpportunityStage.NEW, releasedAt: null },
      });
      await service.split(ACTOR, SRC, parts([50, 50]));
      expect(createdOpportunities[0].releasedAt).toBeNull();
    });

    it('preserves the original author on new parts', async () => {
      setup({ source: { createdBy: 42 } });
      await service.split(ACTOR, SRC, parts([50, 50]));
      // The person whose idea it was keeps authorship of what it became.
      expect(createdOpportunities[0].createdBy).toBe(42);
      expect(createdOpportunities[0].updatedBy).toBe(ACTOR);
    });

    it('splits a source that has already left the "new" stage', async () => {
      // Leaving "new" only stops VOTES, not reshaping — the allocation stage rule and the
      // reshape rule are different rules with different stage sets, and prioritised /
      // under development sit between them.
      setup({
        source: { stage: RoadmapOpportunityStage.PRIORITISED },
        allocations: [
          { userId: 1, opportunityId: SRC, periodKey: '2026-07', votes: 10 },
        ],
      });

      await expect(
        service.split(ACTOR, SRC, parts([50, 50])),
      ).resolves.toBeDefined();
      expect(savedAllocations.reduce((a, r) => a + (r.votes ?? 0), 0)).toBe(10);
    });

    it('re-indexes every part and broadcasts one invalidation', async () => {
      setup({});
      const { partIds } = await service.split(ACTOR, SRC, parts([50, 50]));

      expect(vectorService.indexQuietly).toHaveBeenCalledTimes(partIds.length);
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'ROADMAP_INVALIDATED',
          reason: 'split',
          actorId: ACTOR,
        }),
      );
    });

    describe('validation, before a transaction is opened', () => {
      it.each([
        ['fewer than 2 parts', [{ id: SRC, description: 'only', weight: 1 }]],
        [
          'no part carrying the source id',
          [
            { description: 'a', weight: 1 },
            { description: 'b', weight: 1 },
          ],
        ],
        [
          'two parts claiming the source id',
          [
            { id: SRC, description: 'a', weight: 1 },
            { id: SRC, description: 'b', weight: 1 },
          ],
        ],
        [
          'a part carrying a foreign id',
          [
            { id: SRC, description: 'a', weight: 1 },
            {
              id: '22222222-2222-2222-2222-222222222222',
              description: 'b',
              weight: 1,
            },
          ],
        ],
        [
          'all weights zero',
          [
            { id: SRC, description: 'a', weight: 0 },
            { description: 'b', weight: 0 },
          ],
        ],
        [
          'a negative weight',
          [
            { id: SRC, description: 'a', weight: -1 },
            { description: 'b', weight: 1 },
          ],
        ],
      ])('rejects %s', async (_label, badParts) => {
        await expect(
          service.split(ACTOR, SRC, badParts as never),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(manager.save).not.toHaveBeenCalled();
      });
    });

    it('404s for an unknown source', async () => {
      manager.findOne.mockResolvedValue(null);
      manager.createQueryBuilder.mockReturnValue(queryBuilder([]));
      await expect(
        service.split(ACTOR, SRC, parts([50, 50])),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('merge', () => {
    const A = '22222222-2222-2222-2222-222222222222';
    const B = '33333333-3333-3333-3333-333333333333';

    /** `sourceIds` must match what the test passes to merge(), or the "already merged" guard fires. */
    const setupMerge = (
      allocations: Partial<RoadmapAllocation>[],
      sourceIds: string[] = [A, B],
      stages?: {
        primary?: RoadmapOpportunityStage;
        sources?: Record<string, RoadmapOpportunityStage>;
      },
    ) => {
      const sourceStages = stages?.sources;
      manager.findOne.mockResolvedValue({
        id: SRC,
        stage: stages?.primary ?? RoadmapOpportunityStage.NEW,
      });
      manager.createQueryBuilder
        .mockReturnValueOnce(
          queryBuilder(
            sourceIds.map((id) => ({
              id,
              stage: sourceStages?.[id] ?? RoadmapOpportunityStage.NEW,
            })),
          ),
        ) // the sources
        .mockReturnValueOnce(queryBuilder(allocations)); // their allocations
    };

    it('rolls votes up per (user, period) and conserves the total', async () => {
      setupMerge([
        { userId: 1, opportunityId: SRC, periodKey: '2026-07', votes: 20 },
        { userId: 1, opportunityId: A, periodKey: '2026-07', votes: 30 },
        { userId: 2, opportunityId: B, periodKey: '2026-06', votes: 15 },
      ]);

      await service.merge(ACTOR, { primaryId: SRC, sourceIds: [A, B] });

      const byUserPeriod = savedAllocations.reduce<Record<string, number>>(
        (acc, r) => {
          acc[`${r.userId}|${r.periodKey}`] =
            (acc[`${r.userId}|${r.periodKey}`] ?? 0) + (r.votes ?? 0);
          return acc;
        },
        {},
      );
      expect(byUserPeriod).toEqual({ '1|2026-07': 50, '2|2026-06': 15 });
      expect(savedAllocations.every((r) => r.opportunityId === SRC)).toBe(true);
    });

    it('deletes the old allocations before inserting the rollup', async () => {
      setupMerge(
        [{ userId: 1, opportunityId: A, periodKey: '2026-07', votes: 10 }],
        [A],
      );
      await service.merge(ACTOR, { primaryId: SRC, sourceIds: [A] });
      expect(calls.indexOf('delete-allocations')).toBeLessThan(
        calls.indexOf('insert-allocation'),
      );
    });

    it('throws rather than clamping when a rollup would exceed the cap', async () => {
      // Impossible with sane data (a user's monthly total is already capped), so it means the
      // allocation data is corrupt. Clamping would silently destroy votes and break the
      // conservation invariant with nobody noticing.
      setupMerge(
        [
          { userId: 1, opportunityId: SRC, periodKey: '2026-07', votes: 80 },
          { userId: 1, opportunityId: A, periodKey: '2026-07', votes: 40 },
        ],
        [A],
      );

      await expect(
        service.merge(ACTOR, { primaryId: SRC, sourceIds: [A] }),
      ).rejects.toThrow(/above the 100-vote cap/);
    });

    it('removes every source from the vector index', async () => {
      setupMerge([]);
      await service.merge(ACTOR, { primaryId: SRC, sourceIds: [A, B] });
      // Skip this and duplicate detection proposes merged-away opportunities forever.
      expect(vectorService.removeQuietly).toHaveBeenCalledWith(A);
      expect(vectorService.removeQuietly).toHaveBeenCalledWith(B);
    });

    it('moves comments to the survivor and soft-deletes the sources', async () => {
      setupMerge([]);
      await service.merge(ACTOR, { primaryId: SRC, sourceIds: [A, B] });
      expect(calls).toContain('move-comments');
      expect(calls).toContain('soft-delete-sources');
    });

    it('dedupes sourceIds and ignores the primary appearing among them', async () => {
      setupMerge([]);
      await service.merge(ACTOR, { primaryId: SRC, sourceIds: [A, A, B, SRC] });
      expect(vectorService.removeQuietly).toHaveBeenCalledTimes(2);
    });

    it('rejects a merge with no source other than the primary', async () => {
      await expect(
        service.merge(ACTOR, { primaryId: SRC, sourceIds: [SRC] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      RoadmapOpportunityStage.RELEASED,
      RoadmapOpportunityStage.ARCHIVED,
    ])('refuses a merge whose PRIMARY is %s', async (stage) => {
      setupMerge(
        [{ userId: 1, opportunityId: A, periodKey: '2026-07', votes: 30 }],
        [A, B],
        { primary: stage },
      );

      await expect(
        service.merge(ACTOR, { primaryId: SRC, sourceIds: [A, B] }),
      ).rejects.toThrow(ConflictException);
      expect(savedAllocations).toHaveLength(0);
      expect(calls).not.toContain('soft-delete-sources');
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it.each([
      RoadmapOpportunityStage.RELEASED,
      RoadmapOpportunityStage.ARCHIVED,
    ])('refuses a merge when any SOURCE is %s', async (stage) => {
      // The worse of the two cases: a merge soft-deletes its sources, so allowing this would
      // retire a shipped record and move its votes somewhere else.
      setupMerge(
        [{ userId: 1, opportunityId: A, periodKey: '2026-07', votes: 30 }],
        [A, B],
        { sources: { [B]: stage } },
      );

      await expect(
        service.merge(ACTOR, { primaryId: SRC, sourceIds: [A, B] }),
      ).rejects.toThrow(ConflictException);
      expect(calls).not.toContain('soft-delete-sources');
    });

    it('names every offender, not just the first', async () => {
      setupMerge([], [A, B], {
        sources: {
          [A]: RoadmapOpportunityStage.RELEASED,
          [B]: RoadmapOpportunityStage.ARCHIVED,
        },
      });

      const error: Error = await service
        .merge(ACTOR, { primaryId: SRC, sourceIds: [A, B] })
        .then(() => new Error('merge resolved but should have thrown'))
        .catch((e: Error) => e);

      // "2 of these cannot be merged" would send the manager back to the board to work out which.
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toContain(A);
      expect(error.message).toContain(B);
    });

    it('404s when a source is missing or already merged', async () => {
      manager.findOne.mockResolvedValue({ id: SRC });
      manager.createQueryBuilder.mockReturnValueOnce(queryBuilder([{ id: A }]));
      await expect(
        service.merge(ACTOR, { primaryId: SRC, sourceIds: [A, B] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
