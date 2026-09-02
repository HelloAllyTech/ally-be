import { DataSource } from 'typeorm';
import { RoadmapOpportunityRepository } from '../roadmap-opportunity.repository';

/**
 * findOneWithScore backs create(), update() (including the OPPORTUNITY_UPSERTED websocket
 * payload) and the GET-by-id deep link. It must project queueRank the same way projectedQuery
 * does for listOpportunities/listBoard — otherwise the queue position badge renders blank
 * until the next full list refresh, even though the opportunity has a real position.
 */
/** Neutral rank context: the ordering tests are about tiebreaks, not about the weighting. */
const TEST_RANK = {
  weights: {
    votesWeight: 1,
    votersWeight: 1,
    effortWeight: 1,
    goalImpactWeight: 1,
  },
  bases: { maxScore: 100, maxVoters: 10, totalGoals: 4 },
};

describe('RoadmapOpportunityRepository.findOneWithScore', () => {
  it('projects queueRank so the badge does not need a full list refresh to appear', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'opp-1' }]);
    const dataSource = {
      createEntityManager: jest.fn(),
      query,
    } as unknown as DataSource;

    const repository = new RoadmapOpportunityRepository(dataSource);
    await repository.findOneWithScore('opp-1', 7, '2026-08', TEST_RANK);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/"queueRank"/);
  });
});

/**
 * The list ordering must be a mirror: the last row of one direction is the first row of the
 * other. That is not automatic, because the tiebreak is a second and third ORDER BY term and an
 * earlier version left them pinned to `createdAt DESC, id ASC` whichever way the primary column
 * ran. It looked harmless and was not: QUEUE_RANK_SQL numbers the queue with
 * `score DESC, createdAt DESC, id ASC`, and most rows score 0, so an ASC sort inverted the score
 * and then re-sorted the entire tie group back into ASCENDING rank order. "Bottom rank first"
 * opened on #41 out of 159 and buried the actual bottom in the middle of the feed.
 *
 * Asserted on the ORDER BY chain rather than on rows: the bug is in the shape of the query, and
 * a fixture small enough to unit-test would not have a tie group big enough to show it.
 */
describe('RoadmapOpportunityRepository.listOpportunities ordering', () => {
  const orderChainFor = async (order: 'ASC' | 'DESC') => {
    const chain: { column: string; direction: string }[] = [];
    const qb = {
      orderBy: (column: string, direction: string) => {
        chain.push({ column, direction });
        return qb;
      },
      addOrderBy: (column: string, direction: string) => {
        chain.push({ column, direction });
        return qb;
      },
      limit: () => qb,
      offset: () => qb,
      getCount: async () => 0,
      getRawMany: async () => [],
    };

    const dataSource = {
      createEntityManager: jest.fn(),
    } as unknown as DataSource;
    const repository = new RoadmapOpportunityRepository(dataSource);
    // The query builder and the filter/aggregate helpers are not what is under test here.
    (repository as unknown as Record<string, unknown>).projectedQuery = () =>
      qb;
    (repository as unknown as Record<string, unknown>).applyFilters = () =>
      undefined;
    repository.getMaxScore = async () => 0;

    await repository.listOpportunities({
      userId: 7,
      periodKey: '2026-08',
      order,
      rank: TEST_RANK,
    });
    return chain;
  };

  it('inverts the tiebreak with the primary direction, so ASC is the exact reverse of DESC', async () => {
    const desc = await orderChainFor('DESC');
    const asc = await orderChainFor('ASC');

    expect(desc.map((o) => o.direction)).toEqual(['DESC', 'DESC', 'ASC']);
    expect(asc.map((o) => o.direction)).toEqual(['ASC', 'ASC', 'DESC']);
    // Same columns in the same positions — only the directions flip.
    expect(asc.map((o) => o.column)).toEqual(desc.map((o) => o.column));
  });

  it('keeps a total order in both directions, so an offset page cannot repeat or skip a row', async () => {
    for (const order of ['ASC', 'DESC'] as const) {
      // id is unique, so including it makes the ordering total however the scores tie.
      expect(
        (await orderChainFor(order)).some((o) => o.column === 'opp.id'),
      ).toBe(true);
    }
  });
});

/**
 * A date range is stated in whole days, so its upper bound has to INCLUDE the day named.
 * Postgres casts a bare '2026-09-02' to midnight, so the plain `<=` dropped everything filed on
 * the 2nd — a range ending today came back missing exactly the newest rows, which reads as the
 * filter being broken rather than as an off-by-one.
 */
describe('RoadmapOpportunityRepository.applyFilters date bounds', () => {
  const paramsFor = (options: Record<string, unknown>) => {
    const params: Record<string, unknown> = {};
    const qb = {
      andWhere: (_sql: string, bound?: Record<string, unknown>) => {
        Object.assign(params, bound ?? {});
        return qb;
      },
    };

    const dataSource = {
      createEntityManager: jest.fn(),
    } as unknown as DataSource;
    const repository = new RoadmapOpportunityRepository(dataSource);
    (
      repository as unknown as {
        applyFilters: (qb: unknown, o: unknown) => void;
      }
    ).applyFilters(qb, options);

    return params;
  };

  it('extends a bare-date upper bound to the end of that day', () => {
    expect(paramsFor({ dateTo: '2026-09-02' }).dateTo).toBe(
      '2026-09-02T23:59:59.999',
    );
    expect(paramsFor({ releasedTo: '2026-09-02' }).releasedTo).toBe(
      '2026-09-02T23:59:59.999',
    );
  });

  it('leaves the lower bound at midnight, which already includes the whole day', () => {
    expect(paramsFor({ dateFrom: '2026-09-01' }).dateFrom).toBe('2026-09-01');
    expect(paramsFor({ releasedFrom: '2026-09-01' }).releasedFrom).toBe(
      '2026-09-01',
    );
  });

  it('passes a full timestamp through untouched', () => {
    // @IsISO8601 accepts an instant too, and a caller who sent one has already said where the
    // bound is — widening it to end-of-day there would filter differently than asked.
    expect(paramsFor({ dateTo: '2026-09-02T10:00:00.000Z' }).dateTo).toBe(
      '2026-09-02T10:00:00.000Z',
    );
  });
});
