import { Repository } from 'typeorm';

import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import { User } from 'src/user/entity/user.entity';

import { RoadmapOpportunityRepository } from '../../repository/roadmap-opportunity.repository';
import { RoadmapNotificationService } from '../roadmap-notification.service';
import { RoadmapOpportunityService } from '../roadmap-opportunity.service';
import { RoadmapVectorService } from '../roadmap-vector.service';
import { BUG_REPORT_DEFAULT_PRODUCT_GOAL } from '../../constants/product-roadmap.constants';
import { RoadmapOpportunityType } from '../../enum/roadmap-opportunity.enum';

/**
 * POST /product-roadmap/bug-reports is the single route every bug report takes — the
 * consumer apps' "Report a problem" and the admin roadmap's "Report a bug" button alike.
 *
 * What is worth pinning down here is the ATTRIBUTION. `source` decides whether Bug Hunter
 * badges a finding Staff or Consumer, and it is derived from the reporter's own roles
 * rather than from which client posted. Get it backwards and a triager goes hunting for an
 * affected customer who is actually a colleague sitting two desks away — a wrong answer
 * that looks entirely plausible on screen, which is exactly the kind a test has to catch.
 *
 * The role query itself is SQL and is verified against a real database, not here.
 */
describe('RoadmapOpportunityService.createBugReport', () => {
  const build = (isInternal: boolean) => {
    const opportunityRepository = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue({
        id: 'opp-1',
        type: RoadmapOpportunityType.BUG,
        description: 'Coin allocator saved 0 coins silently',
      }),
      findOneWithScore: jest.fn().mockResolvedValue({
        id: 'opp-1',
        type: RoadmapOpportunityType.BUG,
        description: 'Coin allocator saved 0 coins silently',
        stage: 'new',
        priorityScore: 0,
        myCoins: 0,
        commentCount: 0,
        ownerDisplay: null,
      }),
    };

    // getCount() is how isInternalReporter asks "does this user hold a super-admin role?"
    const userRepository = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(isInternal ? 1 : 0),
      }),
    };

    const service = new RoadmapOpportunityService(
      opportunityRepository as unknown as RoadmapOpportunityRepository,
      {
        indexQuietly: jest.fn().mockResolvedValue(undefined),
      } as unknown as RoadmapVectorService,
      { emit: jest.fn() } as unknown as RoadmapNotificationService,
      userRepository as unknown as Repository<User>,
      {
        create: jest.fn().mockImplementation((v) => v),
        save: jest.fn().mockResolvedValue({ id: 'finding-1' }),
      } as unknown as Repository<BugFinding>,
    );

    return { service, opportunityRepository };
  };

  it('badges a report from somebody internal as staff', async () => {
    const { service, opportunityRepository } = build(true);

    await service.createBugReport(1, 'tenant-a', {
      description: 'Coin allocator saved 0 coins silently',
    });

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'staff' }),
    );
  });

  it('badges a report from an app user as consumer', async () => {
    const { service, opportunityRepository } = build(false);

    await service.createBugReport(42, 'tenant-a', {
      description: 'Coin allocator saved 0 coins silently',
    });

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'consumer' }),
    );
  });

  it('forces the type and goal rather than trusting the client for either', async () => {
    const { service, opportunityRepository } = build(true);

    await service.createBugReport(1, null, {
      description: 'Coin allocator saved 0 coins silently',
    });

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RoadmapOpportunityType.BUG,
        productGoal: BUG_REPORT_DEFAULT_PRODUCT_GOAL,
      }),
    );
  });

  it('stores the silently-captured context and the tenant for triage', async () => {
    const { service, opportunityRepository } = build(false);
    const context = {
      screen: '/product-roadmap?tab=opportunities',
      device: 'Desktop',
      os: 'Mac OS X 10.15.7',
      clientTimestamp: '2026-08-26T12:00:00.000Z',
    };

    await service.createBugReport(42, 'tenant-a', {
      description: 'Coin allocator saved 0 coins silently',
      context,
    });

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterContext: context,
        tenantId: 'tenant-a',
      }),
    );
  });

  /**
   * A reporter with no context sends none — the column must hold null rather than an empty
   * object, so Bug Hunter's panel can say "nothing captured" instead of rendering a blank
   * evidence list that looks like the capture silently failed.
   */
  it('writes null, not an empty object, when no context was captured', async () => {
    const { service, opportunityRepository } = build(false);

    await service.createBugReport(42, null, { description: 'It broke' });

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reporterContext: null, tenantId: null }),
    );
  });
});
