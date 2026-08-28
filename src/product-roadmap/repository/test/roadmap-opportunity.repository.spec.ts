import { DataSource } from 'typeorm';
import { RoadmapOpportunityRepository } from '../roadmap-opportunity.repository';

/**
 * findOneWithScore backs create(), update() (including the OPPORTUNITY_UPSERTED websocket
 * payload) and the GET-by-id deep link. It must project queueRank the same way projectedQuery
 * does for listOpportunities/listBoard — otherwise the queue position badge renders blank
 * until the next full list refresh, even though the opportunity has a real position.
 */
describe('RoadmapOpportunityRepository.findOneWithScore', () => {
  it('projects queueRank so the badge does not need a full list refresh to appear', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'opp-1' }]);
    const dataSource = {
      createEntityManager: jest.fn(),
      query,
    } as unknown as DataSource;

    const repository = new RoadmapOpportunityRepository(dataSource);
    await repository.findOneWithScore('opp-1', 7, '2026-08');

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/"queueRank"/);
  });
});
