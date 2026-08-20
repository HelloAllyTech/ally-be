import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CohortVisibilityService } from '../cohort-visibility.service';
import { CohortRestrictionService } from '../cohort-restriction.service';
import { CohortService } from '../cohort.service';
import { TenantCohortMemberRepository } from '../../repository/tenant-cohort-member.repository';
import { CohortRestrictionRepository } from '../../repository/cohort-restriction.repository';
import { CohortContentType } from '../../constants/cohort.constants';

const TENANT = 'f948763c-8eeb-4def-ad74-8f3ed0e4cd39';
const COHORT = '53e41638-e17a-4008-aff9-0b3eda83d4f2';
const OTHER_COHORT = '95a13abe-f298-4c1e-acb1-7a556d0018d3';

describe('CohortVisibilityService', () => {
  let service: CohortVisibilityService;
  let memberRepository: { findLiveForUser: jest.Mock };
  let restrictionRepository: { findForTenant: jest.Mock };

  beforeEach(async () => {
    memberRepository = { findLiveForUser: jest.fn().mockResolvedValue(null) };
    restrictionRepository = { findForTenant: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CohortVisibilityService,
        { provide: TenantCohortMemberRepository, useValue: memberRepository },
        {
          provide: CohortRestrictionRepository,
          useValue: restrictionRepository,
        },
      ],
    }).compile();

    service = module.get(CohortVisibilityService);
  });

  describe('resolveUserCohortId', () => {
    it('returns null for a user in no cohort — the Unassigned audience', async () => {
      await expect(service.resolveUserCohortId(3)).resolves.toBeNull();
    });

    it('returns the cohort id when the user has a live membership', async () => {
      memberRepository.findLiveForUser.mockResolvedValue({ cohortId: COHORT });
      await expect(service.resolveUserCohortId(3)).resolves.toBe(COHORT);
    });
  });

  describe('canAccess', () => {
    const base = {
      contentType: CohortContentType.TRACK,
      contentId: 'track-1',
      tenantId: TENANT,
      userId: 3,
    };

    it('allows unrestricted content without even resolving the cohort', async () => {
      await expect(service.canAccess(base)).resolves.toBe(true);
      // The common case must stay cheap: no restriction rows means tenant-wide,
      // and asking who the user is would be a wasted query on every open.
      expect(memberRepository.findLiveForUser).not.toHaveBeenCalled();
    });

    it('allows content restricted to the user’s own cohort', async () => {
      restrictionRepository.findForTenant.mockResolvedValue([
        { contentId: 'track-1', cohortId: COHORT },
      ]);
      memberRepository.findLiveForUser.mockResolvedValue({ cohortId: COHORT });

      await expect(service.canAccess(base)).resolves.toBe(true);
    });

    it('denies content restricted to a different cohort', async () => {
      restrictionRepository.findForTenant.mockResolvedValue([
        { contentId: 'track-1', cohortId: OTHER_COHORT },
      ]);
      memberRepository.findLiveForUser.mockResolvedValue({ cohortId: COHORT });

      await expect(service.canAccess(base)).resolves.toBe(false);
    });

    it('admits an unplaced user when the restriction targets Unassigned', async () => {
      restrictionRepository.findForTenant.mockResolvedValue([
        { contentId: 'track-1', cohortId: null },
      ]);
      memberRepository.findLiveForUser.mockResolvedValue(null);

      await expect(service.canAccess(base)).resolves.toBe(true);
    });

    it('denies an unplaced user when the restriction targets a real cohort', async () => {
      restrictionRepository.findForTenant.mockResolvedValue([
        { contentId: 'track-1', cohortId: COHORT },
      ]);
      memberRepository.findLiveForUser.mockResolvedValue(null);

      await expect(service.canAccess(base)).resolves.toBe(false);
    });

    it('short-circuits to allowed when the learner already started it', async () => {
      restrictionRepository.findForTenant.mockResolvedValue([
        { contentId: 'track-1', cohortId: OTHER_COHORT },
      ]);

      await expect(
        service.canAccess({ ...base, alreadyStarted: true }),
      ).resolves.toBe(true);
      // "Finish what you started": losing access stops the next thing, it does
      // not confiscate work in progress — so no lookup happens at all.
      expect(restrictionRepository.findForTenant).not.toHaveBeenCalled();
    });
  });
});

describe('CohortRestrictionService', () => {
  let service: CohortRestrictionService;
  let restrictionRepository: {
    findForTenant: jest.Mock;
    replaceForContent: jest.Mock;
  };
  let cohortService: { resolveCohortId: jest.Mock };

  beforeEach(async () => {
    restrictionRepository = {
      findForTenant: jest.fn().mockResolvedValue([]),
      replaceForContent: jest.fn(),
    };
    cohortService = {
      resolveCohortId: jest.fn(async (value: string) =>
        value === 'unassigned' ? null : value,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CohortRestrictionService,
        {
          provide: CohortRestrictionRepository,
          useValue: restrictionRepository,
        },
        { provide: CohortService, useValue: cohortService },
      ],
    }).compile();

    service = module.get(CohortRestrictionService);
  });

  it('clears every restriction on an empty cohortIds array', async () => {
    await service.setRestrictions(TENANT, {
      contentType: CohortContentType.SCENARIO,
      contentId: '42',
      cohortIds: [],
    });

    // Not a no-op and not an error: this is how an admin says "back to
    // everyone", and it must reach the repository as an empty replacement.
    expect(restrictionRepository.replaceForContent).toHaveBeenCalledWith(
      CohortContentType.SCENARIO,
      TENANT,
      '42',
      [],
    );
  });

  it('maps the Unassigned sentinel to a null cohort id', async () => {
    await service.setRestrictions(TENANT, {
      contentType: CohortContentType.SCENARIO,
      contentId: '42',
      cohortIds: ['unassigned'],
    });

    expect(restrictionRepository.replaceForContent).toHaveBeenCalledWith(
      CohortContentType.SCENARIO,
      TENANT,
      '42',
      [null],
    );
  });

  it('rejects a uuid content id for scenarios, whose ids are integers', async () => {
    await expect(
      service.setRestrictions(TENANT, {
        contentType: CohortContentType.SCENARIO,
        contentId: '53e41638-e17a-4008-aff9-0b3eda83d4f2',
        cohortIds: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an integer content id for courses, whose ids are uuids', async () => {
    await expect(
      service.setRestrictions(TENANT, {
        contentType: CohortContentType.TRACK,
        contentId: '42',
        cohortIds: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a content id that is not an id at all', async () => {
    // This is the one untrusted value that reaches SQL as a cast.
    await expect(
      service.setRestrictions(TENANT, {
        contentType: CohortContentType.SCENARIO,
        contentId: '1; DROP TABLE users',
        cohortIds: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('omits unrestricted items from the map rather than listing them empty', async () => {
    restrictionRepository.findForTenant.mockResolvedValue([
      { contentId: '2', cohortId: COHORT },
      { contentId: '2', cohortId: null },
    ]);

    const result = await service.getRestrictions(TENANT, {
      contentType: CohortContentType.SCENARIO,
    });

    // Item 2 is restricted to one cohort plus the Unassigned bucket. Item 1,
    // having no rows, is simply absent — which the UI renders as "Everyone".
    expect(result).toEqual([
      { contentId: '2', cohortIds: [COHORT, 'unassigned'] },
    ]);
  });
});
