import { Repository } from 'typeorm';

import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import { User } from 'src/user/entity/user.entity';

import { RoadmapOpportunityRepository } from '../../repository/roadmap-opportunity.repository';
import { RoadmapNotificationService } from '../roadmap-notification.service';
import { RoadmapOpportunityService } from '../roadmap-opportunity.service';
import { RoadmapVectorService } from '../roadmap-vector.service';
import {
  RoadmapOpportunitySource,
  RoadmapOpportunityType,
} from '../../enum/roadmap-opportunity.enum';

/**
 * Bugs still WRITE a roadmap row — it is the record of who reported what, and
 * what `bug_findings.reported_bug_id` points at. What they no longer do is show
 * up on the board.
 *
 * The reads are excluded in SQL (see EXCLUDE_BUGS_SQL in
 * RoadmapOpportunityRepository) and are covered against a real database rather
 * than here. What IS unit-testable, and is the half most likely to be forgotten,
 * is the realtime push: a filed bug that still broadcasts would flash a card onto
 * the very board it is meant to have left, and no query filter can stop it.
 */
describe('RoadmapOpportunityService — bugs stay off the board', () => {
  const saved = (type: RoadmapOpportunityType) => ({
    id: 'opp-1',
    type,
    description: 'Search returns nothing after login',
  });

  const build = (type: RoadmapOpportunityType) => {
    const emit = jest.fn();
    const opportunityRepository = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue(saved(type)),
      findOneWithScore: jest.fn().mockResolvedValue({
        ...saved(type),
        priorityScore: 0,
        myCoins: 0,
        commentCount: 0,
        ownerDisplay: null,
      }),
    };
    const bugFindingRepository = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue({ id: 'finding-1' }),
    };

    const service = new RoadmapOpportunityService(
      opportunityRepository as unknown as RoadmapOpportunityRepository,
      {
        indexQuietly: jest.fn().mockResolvedValue(undefined),
      } as unknown as RoadmapVectorService,
      { emit } as unknown as RoadmapNotificationService,
      { find: jest.fn().mockResolvedValue([]) } as unknown as Repository<User>,
      bugFindingRepository as unknown as Repository<BugFinding>,
    );

    return { service, emit, bugFindingRepository };
  };

  it('does not broadcast a filed bug to the roadmap board', async () => {
    const { service, emit } = build(RoadmapOpportunityType.BUG);

    await service.create(
      1,
      {
        description: 'Search returns nothing after login',
        type: RoadmapOpportunityType.BUG,
        productGoal: 'Reported bugs',
      },
      { source: RoadmapOpportunitySource.CONSUMER },
    );

    expect(emit).not.toHaveBeenCalled();
  });

  it('still broadcasts an idea, which the board does list', async () => {
    const { service, emit } = build(RoadmapOpportunityType.IDEA);

    await service.create(1, {
      description: 'Let counsellors pin a case',
      type: RoadmapOpportunityType.IDEA,
      productGoal: 'Scribe',
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'OPPORTUNITY_UPSERTED' }),
    );
  });

  /**
   * The half that must NOT change. Suppressing the broadcast is a display
   * decision; the Bug Hunter inbox row is the entire point of filing a bug, and
   * it is now the only place the bug will ever be seen.
   */
  it('still opens the Bug Hunter finding, which is where the bug now lives', async () => {
    const { service, bugFindingRepository } = build(RoadmapOpportunityType.BUG);

    await service.create(1, {
      description: 'Search returns nothing after login',
      type: RoadmapOpportunityType.BUG,
      productGoal: 'Reported bugs',
    });

    expect(bugFindingRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'reported_bug',
        reportedBugId: 'opp-1',
        status: 'new',
      }),
    );
  });
});
