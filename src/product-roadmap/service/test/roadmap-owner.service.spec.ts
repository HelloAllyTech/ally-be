import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { User } from 'src/user/entity/user.entity';
import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';

import { RoadmapOpportunityService } from '../roadmap-opportunity.service';
import { RoadmapOpportunityRepository } from '../../repository/roadmap-opportunity.repository';
import { RoadmapVectorService } from '../roadmap-vector.service';
import { RoadmapNotificationService } from '../roadmap-notification.service';
import { ListOpportunitiesQueryDto } from '../../dto/roadmap-opportunity.dto';

const OPP_ID = '11111111-1111-1111-1111-111111111111';

/**
 * An opportunity owner must be an Ally super-admin. These cover the rule itself and the two
 * representations the column pair carries — see the docblock on migration 1871000000004.
 */
describe('RoadmapOpportunityService — owners', () => {
  let service: RoadmapOpportunityService;
  let opportunityRepository: {
    findOne: jest.Mock;
    update: jest.Mock;
    findOneWithScore: jest.Mock;
  };
  let userQueryBuilder: { getMany: jest.Mock } & Record<string, jest.Mock>;
  let userRepository: { createQueryBuilder: jest.Mock; find: jest.Mock };

  /** ally-be resolves eligibility from SUPER_ADMIN / SUPER_DUPER_ADMIN group membership. */
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
        { provide: RoadmapNotificationService, useValue: { emit: jest.fn() } },
        {
          provide: getRepositoryToken(BugFinding),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(RoadmapOpportunityService);
  });

  it('lists only super-admin users as eligible owners', async () => {
    givenEligibleOwners([
      { id: 7, name: 'Ada Admin', email: 'ada@helloally.ai' },
    ]);

    await expect(service.listEligibleOwners()).resolves.toEqual([
      { id: 7, name: 'Ada Admin', email: 'ada@helloally.ai' },
    ]);
    // Group membership is the source of truth, so the query must constrain on roles rather than
    // read a hand-maintained taxonomy table.
    const [[, params]] = userQueryBuilder.where.mock.calls;
    expect(params.roles).toEqual(
      expect.arrayContaining(['SUPER_ADMIN', 'SUPER_DUPER_ADMIN']),
    );
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

  it('rejects an owner who is not a super-admin with 422', async () => {
    givenEligibleOwners([{ id: 7, name: 'Ada Admin', email: 'a@b.c' }]);

    await expect(
      service.update(1, OPP_ID, { ownerUserId: 99 }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(opportunityRepository.update).not.toHaveBeenCalled();
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
