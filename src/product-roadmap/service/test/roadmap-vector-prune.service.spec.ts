import { Test, TestingModule } from '@nestjs/testing';

import { AiService } from 'src/ai/service/ai.service';

import { RoadmapVectorService } from '../roadmap-vector.service';
import { RoadmapOpportunityRepository } from '../../repository/roadmap-opportunity.repository';

const uuid = (n: number) =>
  `${String(n).padStart(8, '0')}-0000-0000-0000-000000000000`;

/** ids 1..n. Fixtures have to be big enough that ONE orphan stays under the 20% ceiling. */
const uuids = (n: number) => Array.from({ length: n }, (_, i) => uuid(i + 1));

/**
 * pruneOrphanedVectors deletes vectors on the basis of ABSENCE from Postgres, which makes it the
 * one operation here that can destroy good data by acting on a bad read. These tests are mostly
 * about the refusals, not the happy path.
 */
describe('RoadmapVectorService.pruneOrphanedVectors', () => {
  let service: RoadmapVectorService;
  let aiService: {
    listRoadmapOpportunityIds: jest.Mock;
    deleteRoadmapOpportunity: jest.Mock;
  };
  let opportunityRepository: { find: jest.Mock };

  /** ally-ai returns `ids` in pages; a null next_cursor ends the walk. */
  const givenIndexedIds = (pages: string[][]) => {
    let call = 0;
    aiService.listRoadmapOpportunityIds.mockImplementation(async () => {
      const ids = pages[call] ?? [];
      call += 1;
      return {
        ids,
        next_cursor: call < pages.length ? ids[ids.length - 1] : null,
      };
    });
  };

  const givenPostgresIds = (ids: string[]) =>
    opportunityRepository.find.mockResolvedValue(ids.map((id) => ({ id })));

  beforeEach(async () => {
    aiService = {
      listRoadmapOpportunityIds: jest.fn(),
      deleteRoadmapOpportunity: jest.fn().mockResolvedValue({ deleted: true }),
    };
    opportunityRepository = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoadmapVectorService,
        { provide: AiService, useValue: aiService },
        {
          provide: RoadmapOpportunityRepository,
          useValue: opportunityRepository,
        },
      ],
    }).compile();

    service = module.get(RoadmapVectorService);
  });

  it('deletes only vectors with no Postgres row at all', async () => {
    givenIndexedIds([uuids(10)]);
    givenPostgresIds(uuids(9)); // uuid(10) is the only orphan — 10%, under the ceiling

    const result = await service.pruneOrphanedVectors();

    expect(result).toEqual({
      scanned: 10,
      orphansDeleted: 1,
      failed: 0,
      abortedReason: null,
    });
    expect(aiService.deleteRoadmapOpportunity).toHaveBeenCalledTimes(1);
    expect(aiService.deleteRoadmapOpportunity).toHaveBeenCalledWith(uuid(10));
  });

  it('counts SOFT-DELETED rows as known and leaves their vectors alone', async () => {
    // Soft deletes are the write path's job (removeQuietly). Pruning them here would delete on a
    // path that already has an owner and churn the index.
    givenIndexedIds([[uuid(1), uuid(2)]]);
    givenPostgresIds([uuid(1), uuid(2)]); // find() was called withDeleted

    const result = await service.pruneOrphanedVectors();

    expect(result.orphansDeleted).toBe(0);
    expect(aiService.deleteRoadmapOpportunity).not.toHaveBeenCalled();
    expect(opportunityRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
  });

  it('REFUSES to delete anything when Postgres returns no rows', async () => {
    // An empty table against a populated index is what a broken read looks like. Deleting the
    // whole index on that basis is the worst available outcome.
    givenIndexedIds([[uuid(1), uuid(2)]]);
    givenPostgresIds([]);

    const result = await service.pruneOrphanedVectors();

    expect(result.orphansDeleted).toBe(0);
    expect(result.abortedReason).toMatch(/zero opportunities/i);
    expect(aiService.deleteRoadmapOpportunity).not.toHaveBeenCalled();
  });

  it('REFUSES to delete when the orphan ratio exceeds the ceiling', async () => {
    // 3 of 5 = 60%, far above 20%. A real orphan population is small drift; a large one means our
    // own id set is probably incomplete.
    givenIndexedIds([[uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)]]);
    givenPostgresIds([uuid(1), uuid(2)]);

    const result = await service.pruneOrphanedVectors();

    expect(result.scanned).toBe(5);
    expect(result.orphansDeleted).toBe(0);
    expect(result.abortedReason).toMatch(/60\.0%/);
    expect(aiService.deleteRoadmapOpportunity).not.toHaveBeenCalled();
  });

  it('reports the ratio to one decimal so "20% above the 20% ceiling" cannot appear', async () => {
    // 21 of 100 = 21%, but a ratio just over the line (e.g. 20.5%) rounds to "20%" and reads as a
    // bug in the guard rather than the reason it stopped.
    givenIndexedIds([uuids(100)]);
    givenPostgresIds(uuids(79));

    const result = await service.pruneOrphanedVectors();

    expect(result.abortedReason).toContain('21.0%');
    expect(result.abortedReason).toContain('20% ceiling');
  });

  it('prunes right up to the ceiling without tripping it', async () => {
    // Exactly 20% must still run: the guard is "more than", not "at least".
    givenIndexedIds([[uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)]]);
    givenPostgresIds([uuid(1), uuid(2), uuid(3), uuid(4)]);

    const result = await service.pruneOrphanedVectors();

    expect(result.orphansDeleted).toBe(1);
    expect(result.abortedReason).toBeNull();
  });

  it('follows the cursor across pages and diffs the whole index', async () => {
    givenIndexedIds([uuids(10).slice(0, 5), uuids(10).slice(5, 9), [uuid(10)]]);
    givenPostgresIds(uuids(9));

    const result = await service.pruneOrphanedVectors();

    expect(aiService.listRoadmapOpportunityIds).toHaveBeenCalledTimes(3);
    expect(result.scanned).toBe(10);
    // The orphan is on the LAST page — a sweep that stopped early would report 0 and look clean.
    expect(aiService.deleteRoadmapOpportunity).toHaveBeenCalledWith(uuid(10));
  });

  it('counts a failed delete rather than reporting it as pruned', async () => {
    givenIndexedIds([uuids(10)]);
    givenPostgresIds(uuids(9));
    aiService.deleteRoadmapOpportunity.mockRejectedValue(
      new Error('ally-ai down'),
    );

    const result = await service.pruneOrphanedVectors();

    expect(result).toEqual({
      scanned: 10,
      orphansDeleted: 0,
      failed: 1,
      abortedReason: null,
    });
  });

  it('propagates an enumeration failure instead of pruning against a partial list', async () => {
    // Half the index unread would make every unseen id invisible; the ones we DID see that are
    // absent from Postgres are still orphans, but silently reporting a clean sweep would be worse
    // than surfacing the outage.
    givenPostgresIds([uuid(1)]);
    aiService.listRoadmapOpportunityIds.mockRejectedValue(
      new Error('vector index unavailable'),
    );

    await expect(service.pruneOrphanedVectors()).rejects.toThrow(
      'vector index unavailable',
    );
    expect(aiService.deleteRoadmapOpportunity).not.toHaveBeenCalled();
  });
});
