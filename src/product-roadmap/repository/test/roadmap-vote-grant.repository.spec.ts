import { DataSource, EntityManager } from 'typeorm';
import { RoadmapVoteGrantRepository } from '../roadmap-vote-grant.repository';

describe('RoadmapVoteGrantRepository', () => {
  const dataSource = {
    createEntityManager: jest.fn(),
  } as unknown as DataSource;

  describe('consume', () => {
    it('spends the soonest-expiring grant first, leaving later ones untouched', async () => {
      const grants = [
        { id: 'soon', amount: 5, consumed: 0 },
        { id: 'later', amount: 5, consumed: 0 },
      ];
      const query = jest
        .fn()
        // The SELECT of eligible grants, already ordered by expiresAt ASC by the SQL.
        .mockResolvedValueOnce(grants)
        .mockResolvedValue(undefined);
      const manager = { query } as unknown as EntityManager;

      const repository = new RoadmapVoteGrantRepository(dataSource);
      await repository.consume(manager, 7, 3);

      // Only ONE UPDATE — the first (soonest-expiring) grant covers the whole amount.
      const updateCalls = query.mock.calls.filter(([sql]) =>
        String(sql).includes('UPDATE roadmap_vote_grants'),
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][1]).toEqual([3, 'soon']);
    });

    it('spills over into the next grant when the first cannot cover the full amount', async () => {
      const grants = [
        { id: 'soon', amount: 2, consumed: 0 },
        { id: 'later', amount: 5, consumed: 0 },
      ];
      const query = jest
        .fn()
        .mockResolvedValueOnce(grants)
        .mockResolvedValue(undefined);
      const manager = { query } as unknown as EntityManager;

      const repository = new RoadmapVoteGrantRepository(dataSource);
      await repository.consume(manager, 7, 5);

      const updateCalls = query.mock.calls.filter(([sql]) =>
        String(sql).includes('UPDATE roadmap_vote_grants'),
      );
      expect(updateCalls).toHaveLength(2);
      expect(updateCalls[0][1]).toEqual([2, 'soon']); // drains it fully
      expect(updateCalls[1][1]).toEqual([3, 'later']); // takes the remainder
    });

    it('skips a partially-consumed grant correctly, taking only what remains on it', async () => {
      const grants = [{ id: 'g1', amount: 5, consumed: 3 }];
      const query = jest
        .fn()
        .mockResolvedValueOnce(grants)
        .mockResolvedValue(undefined);
      const manager = { query } as unknown as EntityManager;

      const repository = new RoadmapVoteGrantRepository(dataSource);
      await repository.consume(manager, 7, 2);

      const [updateSql, updateArgs] = query.mock.calls[1];
      expect(String(updateSql)).toContain('UPDATE roadmap_vote_grants');
      expect(updateArgs).toEqual([2, 'g1']);
    });
  });

  describe('availableBalance', () => {
    it('sums amount minus consumed across live grants', async () => {
      const query = jest.fn().mockResolvedValue([{ total: '17' }]);
      const manager = { query } as unknown as EntityManager;

      const repository = new RoadmapVoteGrantRepository(dataSource);
      const balance = await repository.availableBalance(manager, 7);

      expect(balance).toBe(17);
      const [sql, args] = query.mock.calls[0];
      expect(String(sql)).toMatch(/"expiresAt" > now\(\)/);
      expect(args).toEqual([7]);
    });
  });

  describe('refund', () => {
    it('inserts a fresh grant with no grantKey', async () => {
      const query = jest.fn().mockResolvedValue(undefined);
      const manager = { query } as unknown as EntityManager;

      const repository = new RoadmapVoteGrantRepository(dataSource);
      await repository.refund(manager, 7, 4);

      const [sql, args] = query.mock.calls[0];
      expect(String(sql)).toContain("'refund'");
      expect(args[0]).toBe(7);
      expect(args[1]).toBe(4);
    });
  });
});
