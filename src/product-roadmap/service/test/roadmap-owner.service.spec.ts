import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { User } from 'src/user/entity/user.entity';
import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';

import { RoadmapOpportunityService } from '../roadmap-opportunity.service';
import { RoadmapOpportunityRepository } from '../../repository/roadmap-opportunity.repository';
import { RoadmapVectorService } from '../roadmap-vector.service';
import { RoadmapStrategyGoalService } from '../roadmap-strategy-goal.service';
import { RoadmapGoalImpactService } from '../roadmap-goal-impact.service';
import { RoadmapNotificationService } from '../roadmap-notification.service';
import {
  CreateOpportunityDto,
  ListOpportunitiesQueryDto,
} from '../../dto/roadmap-opportunity.dto';
import { RoadmapOpportunityType } from '../../enum/roadmap-opportunity.enum';
import { ROADMAP_OWNER_EMAILS } from '../../constants/product-roadmap.constants';

const OPP_ID = '11111111-1111-1111-1111-111111111111';

/**
 * An opportunity owner must be one of the named accounts in ROADMAP_OWNER_EMAILS. These cover
 * the rule itself and the two representations the column pair carries — see the docblock on
 * migration 1871000000004.
 */
describe('RoadmapOpportunityService — owners', () => {
  let service: RoadmapOpportunityService;
  let opportunityRepository: {
    findOne: jest.Mock;
    update: jest.Mock;
    findOneWithScore: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let userQueryBuilder: { getMany: jest.Mock } & Record<string, jest.Mock>;
  let userRepository: { createQueryBuilder: jest.Mock; find: jest.Mock };

  /** ally-be resolves eligibility by email against ROADMAP_OWNER_EMAILS. */
  const givenEligibleOwners = (users: Partial<User>[]) =>
    userQueryBuilder.getMany.mockResolvedValue(users);

  beforeEach(async () => {
    opportunityRepository = {
      findOne: jest.fn().mockResolvedValue({ id: OPP_ID, stage: 'new' }),
      update: jest.fn().mockResolvedValue(undefined),
      findOneWithScore: jest.fn().mockResolvedValue({
        id: OPP_ID,
        createdBy: 1,
        description: 'x',
        productGoal: 'Scribe',
      }),
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue({
        id: OPP_ID,
        description: 'x',
        type: RoadmapOpportunityType.IDEA,
      }),
    };

    userQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    userRepository = {
      createQueryBuilder: jest.fn(() => userQueryBuilder),
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoadmapOpportunityService,
        {
          provide: RoadmapOpportunityRepository,
          useValue: opportunityRepository,
        },
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: RoadmapVectorService,
          useValue: { indexQuietly: jest.fn(), removeQuietly: jest.fn() },
        },
        // Ranking plays no part in owner resolution; these satisfy the constructor so the
        // owner-picker assertions stay the only thing this suite is about.
        {
          provide: RoadmapStrategyGoalService,
          useValue: {
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
          },
        },
        {
          provide: RoadmapGoalImpactService,
          useValue: { assessQuietly: jest.fn() },
        },
        { provide: RoadmapNotificationService, useValue: { emit: jest.fn() } },
        {
          provide: getRepositoryToken(BugFinding),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
        // Reference images play no part in owner resolution; these satisfy the constructor.
        { provide: S3Service, useValue: { parseS3Url: jest.fn() } },
        {
          provide: AppConfigService,
          useValue: { s3: { assetsBucket: 'ally-assets' } },
        },
      ],
    }).compile();

    service = module.get(RoadmapOpportunityService);
  });

  it('lists only the named roadmap owners as eligible', async () => {
    givenEligibleOwners([
      { id: 7, name: 'Ada Admin', email: 'ada@helloally.ai' },
    ]);

    await expect(service.listEligibleOwners()).resolves.toEqual([
      { id: 7, name: 'Ada Admin', email: 'ada@helloally.ai' },
    ]);
    // The named list is the source of truth, not group membership: constraining on
    // PLATFORM_TIER_ROLES again would put every staff account back in the picker.
    const [[clause, params]] = userQueryBuilder.where.mock.calls;
    expect(clause).toContain('LOWER(user.email) IN');
    expect(params.roles).toBeUndefined();
    expect(params.emails).toEqual([...ROADMAP_OWNER_EMAILS]);
  });

  it('matches owner emails in lowercase, `+` alias included', async () => {
    // `shubham.bhoite+admin@` is a distinct account from `shubham.bhoite@`, so the constant is
    // compared verbatim apart from case — stripping or normalising the alias would either
    // match the wrong user or match nobody.
    await service.listEligibleOwners();

    const [[, params]] = userQueryBuilder.where.mock.calls;
    expect(params.emails).toEqual(
      params.emails.map((e: string) => e.toLowerCase()),
    );
    expect(params.emails).toContain('shubham.bhoite+admin@helloally.ai');
  });

  it('assigns ownerUserId and does NOT write the legacy owner column', async () => {
    // Writing the name too would violate the text FK into roadmap_opportunity_owners(name) —
    // that 500 is what forced this design. One representation, never both.
    givenEligibleOwners([{ id: 7, name: 'Ada Admin', email: 'a@b.c' }]);

    await service.update(1, OPP_ID, { ownerUserId: 7 });

    const [, patch] = opportunityRepository.update.mock.calls[0];
    expect(patch.ownerUserId).toBe(7);
    expect(patch).not.toHaveProperty('owner');
  });

  it('rejects an owner who is not a named roadmap owner with 422', async () => {
    givenEligibleOwners([{ id: 7, name: 'Ada Admin', email: 'a@b.c' }]);

    await expect(
      service.update(1, OPP_ID, { ownerUserId: 99 }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(opportunityRepository.update).not.toHaveBeenCalled();
  });

  it('lets an unrelated edit keep an owner who is no longer on the list', async () => {
    // A row assigned before ROADMAP_OWNER_EMAILS narrowed re-sends its existing owner id on every
    // save the drawer makes. Re-validating an UNCHANGED owner would make that row uneditable
    // until somebody reassigned it — a worse outcome than a grandfathered owner standing.
    opportunityRepository.findOne.mockResolvedValue({
      id: OPP_ID,
      stage: 'new',
      ownerUserId: 99,
    });
    givenEligibleOwners([{ id: 7, name: 'Ada Admin', email: 'a@b.c' }]);

    await service.update(1, OPP_ID, { ownerUserId: 99, prd: 'unrelated edit' });

    const [, patch] = opportunityRepository.update.mock.calls[0];
    expect(patch.ownerUserId).toBe(99);
  });

  it('un-assigning clears BOTH representations', async () => {
    // A legacy migrated string left behind would keep displaying an owner for an opportunity
    // that nobody owns.
    await service.update(1, OPP_ID, { ownerUserId: null });

    const [, patch] = opportunityRepository.update.mock.calls[0];
    expect(patch.ownerUserId).toBeNull();
    expect(patch.owner).toBeNull();
  });

  it('leaves the owner untouched when the field is absent', async () => {
    await service.update(1, OPP_ID, { prd: 'just a prd edit' });

    const [, patch] = opportunityRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('ownerUserId');
    expect(patch).not.toHaveProperty('owner');
  });

  // ── filing with an owner ────────────────────────────────────────────────────
  //
  // POST /opportunities sits on the VOTE tier so that anyone who can vote can file. Assigning
  // is a MANAGE action, so the same three rules the update path enforces have to hold on the
  // create path too — otherwise the field the drawer hides from a non-manager is still postable.

  const draft = (over: Partial<CreateOpportunityDto> = {}) => ({
    description: 'As a counsellor, I want x — so that y.',
    type: RoadmapOpportunityType.IDEA,
    productGoal: 'Scribe',
    ...over,
  });

  it('files with an owner when the caller can manage the roadmap', async () => {
    givenEligibleOwners([{ id: 7, name: 'Ada Admin', email: 'a@b.c' }]);

    await service.create(1, draft({ ownerUserId: 7 }), { canManage: true });

    const [row] = opportunityRepository.create.mock.calls[0];
    expect(row.ownerUserId).toBe(7);
    // Same one-representation rule as the update path: the legacy text column is a FK into
    // roadmap_opportunity_owners(name) and must stay null on a newly filed row.
    expect(row.owner).toBeUndefined();
  });

  it('refuses to assign an owner when the caller cannot manage the roadmap', async () => {
    givenEligibleOwners([{ id: 7, name: 'Ada Admin', email: 'a@b.c' }]);

    await expect(
      service.create(1, draft({ ownerUserId: 7 }), { canManage: false }),
    ).rejects.toThrow(ForbiddenException);
    // Refused outright rather than filed unassigned — a silently dropped assignment reads to
    // the filer as a successful one.
    expect(opportunityRepository.save).not.toHaveBeenCalled();
  });

  it('rejects filing against an owner who is not a named roadmap owner with 422', async () => {
    givenEligibleOwners([{ id: 7, name: 'Ada Admin', email: 'a@b.c' }]);

    await expect(
      service.create(1, draft({ ownerUserId: 99 }), { canManage: true }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(opportunityRepository.save).not.toHaveBeenCalled();
  });

  it('files unassigned when no owner is sent, without consulting the manage flag', async () => {
    await service.create(1, draft());

    const [row] = opportunityRepository.create.mock.calls[0];
    expect(row.ownerUserId).toBeNull();
  });
});

/**
 * `?createdBy=1` used to 400: toArray produced strings and @Type(() => Number) does not apply when
 * @Transform is also present, so @IsInt({ each: true }) rejected every value. The creator filter
 * was unusable from the day it was added.
 */
describe('ListOpportunitiesQueryDto — createdBy coercion', () => {
  const parse = (query: Record<string, unknown>) => {
    const dto = plainToInstance(ListOpportunitiesQueryDto, query);
    return { dto, errors: validateSync(dto) };
  };

  it('accepts a single numeric value', () => {
    const { dto, errors } = parse({ createdBy: '1' });
    expect(errors).toHaveLength(0);
    expect(dto.createdBy).toEqual([1]);
  });

  it('accepts a comma-separated list', () => {
    const { dto, errors } = parse({ createdBy: '1,2,3' });
    expect(errors).toHaveLength(0);
    expect(dto.createdBy).toEqual([1, 2, 3]);
  });

  it('accepts a repeated query parameter', () => {
    const { dto, errors } = parse({ createdBy: ['4', '5'] });
    expect(errors).toHaveLength(0);
    expect(dto.createdBy).toEqual([4, 5]);
  });

  it('still rejects non-numeric input', () => {
    // Passed through rather than coerced to NaN, so @IsInt produces the message.
    const { errors } = parse({ createdBy: 'abc' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('leaves createdBy undefined when absent', () => {
    const { dto, errors } = parse({ search: 'x' });
    expect(errors).toHaveLength(0);
    expect(dto.createdBy).toBeUndefined();
  });
});
