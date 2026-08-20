import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CohortMemberService } from '../cohort-member.service';
import { CohortService } from '../cohort.service';
import { TenantCohortMemberRepository } from '../../repository/tenant-cohort-member.repository';

const TENANT = 'f948763c-8eeb-4def-ad74-8f3ed0e4cd39';
const COHORT = '53e41638-e17a-4008-aff9-0b3eda83d4f2';

describe('CohortMemberService', () => {
  let service: CohortMemberService;
  let memberRepository: jest.Mocked<
    Pick<
      TenantCohortMemberRepository,
      'filterUserIdsInTenant' | 'findLiveForUsers' | 'listTenantUsersWithCohort'
    >
  >;
  let cohortService: { resolveCohortId: jest.Mock };
  let softDelete: jest.Mock;
  let insert: jest.Mock;

  beforeEach(async () => {
    softDelete = jest.fn();
    insert = jest.fn();

    memberRepository = {
      filterUserIdsInTenant: jest.fn(),
      findLiveForUsers: jest.fn().mockResolvedValue([]),
      listTenantUsersWithCohort: jest.fn(),
    } as any;

    cohortService = { resolveCohortId: jest.fn().mockResolvedValue(COHORT) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CohortMemberService,
        { provide: TenantCohortMemberRepository, useValue: memberRepository },
        { provide: CohortService, useValue: cohortService },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(async (cb: any) =>
              cb({ getRepository: () => ({ softDelete, insert }) }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(CohortMemberService);
  });

  describe('moveMembers', () => {
    it('soft-deletes the old membership BEFORE inserting the new one', async () => {
      memberRepository.filterUserIdsInTenant.mockResolvedValue([3]);
      const order: string[] = [];
      softDelete.mockImplementation(() => {
        order.push('softDelete');
      });
      insert.mockImplementation(() => {
        order.push('insert');
      });

      await service.moveMembers(TENANT, { userIds: [3], cohortId: COHORT });

      // Order is the whole point: the partial unique index on `userId` (live rows
      // only) would reject the insert if the old row were still live. Reversing
      // these two lines turns a safe concurrent-move failure into a constraint
      // error on the happy path.
      expect(order).toEqual(['softDelete', 'insert']);
    });

    it('only soft-deletes when the destination is Unassigned', async () => {
      memberRepository.filterUserIdsInTenant.mockResolvedValue([3]);
      cohortService.resolveCohortId.mockResolvedValue(null);
      memberRepository.findLiveForUsers.mockResolvedValue([
        { userId: 3, cohortId: COHORT } as any,
      ]);

      await service.moveMembers(TENANT, {
        userIds: [3],
        cohortId: 'unassigned',
      });

      expect(softDelete).toHaveBeenCalled();
      // No row represents "in no cohort" — that state IS the absence of a row.
      expect(insert).not.toHaveBeenCalled();
    });

    it('skips users already in the destination rather than churning their rows', async () => {
      memberRepository.filterUserIdsInTenant.mockResolvedValue([3, 4]);
      memberRepository.findLiveForUsers.mockResolvedValue([
        { userId: 3, cohortId: COHORT } as any,
        { userId: 4, cohortId: 'other-cohort' } as any,
      ]);

      await service.moveMembers(TENANT, { userIds: [3, 4], cohortId: COHORT });

      expect(insert).toHaveBeenCalledWith([
        { userId: 4, cohortId: COHORT, tenantId: TENANT },
      ]);
    });

    it('writes nothing when every named user is already in the destination', async () => {
      memberRepository.filterUserIdsInTenant.mockResolvedValue([3]);
      memberRepository.findLiveForUsers.mockResolvedValue([
        { userId: 3, cohortId: COHORT } as any,
      ]);

      await service.moveMembers(TENANT, { userIds: [3], cohortId: COHORT });

      expect(softDelete).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('rejects a user from another tenant before writing anything', async () => {
      // The scope guard pins the tenantId in the request; the user ids in the
      // body are separate input and must be checked against that tenant.
      memberRepository.filterUserIdsInTenant.mockResolvedValue([3]);

      await expect(
        service.moveMembers(TENANT, { userIds: [3, 999], cohortId: COHORT }),
      ).rejects.toThrow(BadRequestException);

      expect(softDelete).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('de-duplicates the incoming user list', async () => {
      memberRepository.filterUserIdsInTenant.mockResolvedValue([3]);

      await service.moveMembers(TENANT, {
        userIds: [3, 3, 3],
        cohortId: COHORT,
      });

      expect(memberRepository.filterUserIdsInTenant).toHaveBeenCalledWith(
        [3],
        TENANT,
      );
    });

    it('rejects an oversized batch', async () => {
      await expect(
        service.moveMembers(TENANT, {
          userIds: Array.from({ length: 501 }, (_, i) => i + 1),
          cohortId: COHORT,
        }),
      ).rejects.toThrow(/more than 500/);
    });
  });

  describe('listMembers', () => {
    it('caps the page size regardless of what the caller asks for', async () => {
      memberRepository.listTenantUsersWithCohort.mockResolvedValue({
        rows: [],
        count: 0,
      });

      await service.listMembers(TENANT, { limit: 9999 });

      expect(memberRepository.listTenantUsersWithCohort).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 200 }),
      );
    });

    it('normalises a missing membership to an explicit null', async () => {
      memberRepository.listTenantUsersWithCohort.mockResolvedValue({
        rows: [
          {
            userId: 3,
            name: 'Asha',
            email: 'asha@example.org',
            status: 'ACTIVE',
            cohortId: null,
            cohortName: null,
          },
        ],
        count: 1,
      });

      const result = await service.listMembers(TENANT, {});

      expect(result.data[0].cohortId).toBeNull();
      expect(result.count).toBe(1);
    });
  });
});
