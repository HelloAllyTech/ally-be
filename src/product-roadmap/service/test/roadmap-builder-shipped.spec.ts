import { RoadmapOpportunityStage } from '../../enum/roadmap-opportunity.enum';
import { RoadmapBuilderService } from '../roadmap-builder.service';

/**
 * The board telling the truth about work Builder has finished.
 *
 * An opportunity handed to Builder sat at whatever stage it was in while the
 * build ran, merged and deployed. The roadmap row for "Automatically generate
 * versions for simulation drafts" still read `new` the morning after the code
 * was live in production, because nothing ever told it otherwise.
 */
describe('RoadmapBuilderService.reconcileShippedOpportunities', () => {
  const build = (
    opportunities: any[],
    delivery: any,
  ): { service: any; repo: any } => {
    const repo = {
      find: jest.fn().mockResolvedValue(opportunities),
      update: jest.fn(),
    };
    const service = Object.create(
      RoadmapBuilderService.prototype,
    ) as RoadmapBuilderService;
    Object.assign(service, {
      opportunityRepository: repo,
      builderSessionService: {
        getDeliveryState: jest.fn().mockResolvedValue(delivery),
      },
      logger: { info: jest.fn(), warn: jest.fn() },
    });
    return { service: service as any, repo };
  };

  const opp = { id: 'o-1', builderSessionId: 's-1' };

  it('releases an opportunity whose pull requests merged and deployed', async () => {
    const { service, repo } = build([opp], {
      shipped: true,
      pullRequestCount: 2,
    });

    await service.reconcileShippedOpportunities();

    expect(repo.update).toHaveBeenCalledWith(
      { id: 'o-1' },
      expect.objectContaining({ stage: RoadmapOpportunityStage.RELEASED }),
    );
    // The transition is the only time releasedAt is written.
    expect(repo.update.mock.calls[0][1].releasedAt).toBeInstanceOf(Date);
  });

  /**
   * Merged but not deployed is the state a person most needs to see. Calling
   * it released would hide exactly the case the roadmap exists to surface.
   */
  it('leaves work that has merged but not shipped', async () => {
    const { service, repo } = build([opp], {
      shipped: false,
      pullRequestCount: 2,
    });

    await service.reconcileShippedOpportunities();

    expect(repo.update).not.toHaveBeenCalled();
  });

  /** A build can finish having written nothing. That is not a release. */
  it('leaves a session that opened no pull requests', async () => {
    const { service, repo } = build([opp], {
      shipped: false,
      pullRequestCount: 0,
    });

    await service.reconcileShippedOpportunities();

    expect(repo.update).not.toHaveBeenCalled();
  });

  it('leaves an opportunity whose session has vanished', async () => {
    const { service, repo } = build([opp], null);

    await service.reconcileShippedOpportunities();

    expect(repo.update).not.toHaveBeenCalled();
  });

  /** One unreadable session must not stop the rest of the sweep. */
  it('carries on past a session it cannot read', async () => {
    const { service, repo } = build(
      [opp, { id: 'o-2', builderSessionId: 's-2' }],
      { shipped: true, pullRequestCount: 1 },
    );
    service.builderSessionService.getDeliveryState = jest
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValue({ shipped: true, pullRequestCount: 1 });

    await service.reconcileShippedOpportunities();

    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'o-2' },
      expect.objectContaining({ stage: RoadmapOpportunityStage.RELEASED }),
    );
  });

  /**
   * Only rows still in flight are candidates. A stage a person set by hand —
   * released already, or archived — is theirs, and this must never reopen or
   * re-stamp one.
   */
  it('only considers rows that have not concluded', async () => {
    const { service, repo } = build([], { shipped: true });

    await service.reconcileShippedOpportunities();

    const where = repo.find.mock.calls[0][0].where;
    expect(where.stage._value ?? where.stage).toEqual(
      expect.arrayContaining([
        RoadmapOpportunityStage.NEW,
        RoadmapOpportunityStage.PRIORITISED,
        RoadmapOpportunityStage.UNDER_DEVELOPMENT,
      ]),
    );
  });
});
