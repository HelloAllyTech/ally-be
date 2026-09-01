import { Repository } from 'typeorm';

import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import { User } from 'src/user/entity/user.entity';
import { UserRole } from 'src/common/constants/user.constants';

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
        description: 'Vote button saved 0 votes silently',
      }),
      findOneWithScore: jest.fn().mockResolvedValue({
        id: 'opp-1',
        type: RoadmapOpportunityType.BUG,
        description: 'Vote button saved 0 votes silently',
        stage: 'new',
        priorityScore: 0,
        myVotes: 0,
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
      // Ranking is not what these tests are about; countGoals feeds the response mapper and
      // getRankContext feeds the read paths.
      {
        countGoals: jest.fn().mockResolvedValue(0),
        getRankContext: jest.fn().mockResolvedValue({
          weights: {
            votesWeight: 1,
            votersWeight: 1,
            effortWeight: 1,
            goalImpactWeight: 1,
          },
          bases: { maxScore: 0, maxVoters: 0, totalGoals: 0 },
        }),
      } as never,
      { assessQuietly: jest.fn().mockResolvedValue(undefined) } as never,
      {
        indexQuietly: jest.fn().mockResolvedValue(undefined),
      } as unknown as RoadmapVectorService,
      { emit: jest.fn() } as unknown as RoadmapNotificationService,
      userRepository as unknown as Repository<User>,
      {
        create: jest.fn().mockImplementation((v) => v),
        save: jest.fn().mockResolvedValue({ id: 'finding-1' }),
      } as unknown as Repository<BugFinding>,
      // Images play no part in a bug report; these satisfy the constructor.
      { parseS3Url: jest.fn() } as never,
      { s3: { assetsBucket: 'ally-assets' } } as never,
    );

    return { service, opportunityRepository };
  };

  it('badges a report from somebody internal as staff', async () => {
    const { service, opportunityRepository } = build(true);

    await service.createBugReport(1, 'tenant-a', {
      description: 'Vote button saved 0 votes silently',
    });

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'staff' }),
    );
  });

  /**
   * A current-generation platform admin (created via /v1/platform-admins) holds ONLY the
   * PLATFORM_ADMIN group — CreatePlatformAdminRole1895000000001 collapsed SUPER_ADMIN /
   * SUPER_DUPER_ADMIN / MULTI_TENANT_ADMIN into it, and assignRole grants nothing else.
   * isInternalReporter has to name PLATFORM_ADMIN (PLATFORM_TIER_ROLES), not just the two
   * retired super-admin tiers (SUPER_ADMIN_ROLES) — otherwise every admin created since the
   * collapse gets badged Consumer instead of Staff.
   */
  it('badges a report from a present-day platform admin as staff', async () => {
    const opportunityRepository = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue({
        id: 'opp-1',
        type: RoadmapOpportunityType.BUG,
        description: 'Vote button saved 0 votes silently',
      }),
      findOneWithScore: jest.fn().mockResolvedValue({
        id: 'opp-1',
        type: RoadmapOpportunityType.BUG,
        description: 'Vote button saved 0 votes silently',
        stage: 'new',
        priorityScore: 0,
        myVotes: 0,
        commentCount: 0,
        ownerDisplay: null,
      }),
    };

    // Simulates the real SQL: this account's only group is PLATFORM_ADMIN, so the query
    // only matches if the roles list passed in actually includes it.
    const userRepository = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockImplementation(function (
          this: { _roles?: UserRole[] },
          _sql: string,
          params: { roles: UserRole[] },
        ) {
          this._roles = params.roles;
          return this;
        }),
        getCount: jest.fn().mockImplementation(function (this: {
          _roles?: UserRole[];
        }) {
          return Promise.resolve(
            this._roles?.includes(UserRole.PLATFORM_ADMIN) ? 1 : 0,
          );
        }),
      }),
    };

    const service = new RoadmapOpportunityService(
      opportunityRepository as unknown as RoadmapOpportunityRepository,
      // Ranking is not what these tests are about; countGoals feeds the response mapper and
      // getRankContext feeds the read paths.
      {
        countGoals: jest.fn().mockResolvedValue(0),
        getRankContext: jest.fn().mockResolvedValue({
          weights: {
            votesWeight: 1,
            votersWeight: 1,
            effortWeight: 1,
            goalImpactWeight: 1,
          },
          bases: { maxScore: 0, maxVoters: 0, totalGoals: 0 },
        }),
      } as never,
      { assessQuietly: jest.fn().mockResolvedValue(undefined) } as never,
      {
        indexQuietly: jest.fn().mockResolvedValue(undefined),
      } as unknown as RoadmapVectorService,
      { emit: jest.fn() } as unknown as RoadmapNotificationService,
      userRepository as unknown as Repository<User>,
      {
        create: jest.fn().mockImplementation((v) => v),
        save: jest.fn().mockResolvedValue({ id: 'finding-1' }),
      } as unknown as Repository<BugFinding>,
      // Images play no part in a bug report; these satisfy the constructor.
      { parseS3Url: jest.fn() } as never,
      { s3: { assetsBucket: 'ally-assets' } } as never,
    );

    await service.createBugReport(7, 'tenant-a', {
      description: 'Vote button saved 0 votes silently',
    });

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'staff' }),
    );
  });

  it('badges a report from an app user as consumer', async () => {
    const { service, opportunityRepository } = build(false);

    await service.createBugReport(42, 'tenant-a', {
      description: 'Vote button saved 0 votes silently',
    });

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'consumer' }),
    );
  });

  it('forces the type and goal rather than trusting the client for either', async () => {
    const { service, opportunityRepository } = build(true);

    await service.createBugReport(1, null, {
      description: 'Vote button saved 0 votes silently',
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
      description: 'Vote button saved 0 votes silently',
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
