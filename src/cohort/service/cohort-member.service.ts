import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { SuccessResponse } from 'src/common/type/common.type';
import { TenantCohortMemberRepository } from '../repository/tenant-cohort-member.repository';
import { TenantCohortMember } from '../entity/tenant-cohort-member.entity';
import { CohortService } from './cohort.service';
import {
  CohortMemberListResponseDto,
  GetCohortMembersQueryDto,
  MoveCohortMembersDto,
} from '../dto/cohort.dto';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/** Users moved in a single call. Bounded so one request cannot lock the table. */
const MAX_MOVE_BATCH = 500;

@Injectable()
export class CohortMemberService {
  private static readonly logger = LoggerService.getInstance(
    CohortMemberService.name,
  );

  constructor(
    private readonly memberRepository: TenantCohortMemberRepository,
    private readonly cohortService: CohortService,
    private readonly dataSource: DataSource,
  ) {}

  async listMembers(
    tenantId: string,
    query: GetCohortMembersQueryDto,
  ): Promise<CohortMemberListResponseDto> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const { rows, count } =
      await this.memberRepository.listTenantUsersWithCohort({
        tenantId,
        search: query.search,
        cohortId: query.cohortId,
        limit,
        offset: query.offset ?? 0,
      });

    return {
      data: rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        email: row.email,
        status: row.status,
        cohortId: row.cohortId ?? null,
        cohortName: row.cohortName ?? null,
      })),
      count,
    };
  }

  /**
   * Moves users into a cohort, or out of every cohort when the destination is the
   * Unassigned sentinel.
   *
   * "Move", never "add": membership is exclusive, so each user's existing
   * membership is soft-deleted before the new one is inserted, both inside one
   * transaction. Doing it in that order matters — the partial unique index on
   * `userId` (live rows only) would reject the insert if the old row were still
   * live, which is exactly the protection we want against two admins moving the
   * same person concurrently. One of them gets a constraint error and retries; a
   * user is never left in two cohorts seeing the union of two restriction sets.
   *
   * Users already in the destination cohort are skipped rather than churned, so a
   * bulk "move all 200" over a mostly-correct list does not rewrite every row.
   */
  async moveMembers(
    tenantId: string,
    dto: MoveCohortMembersDto,
  ): Promise<SuccessResponse> {
    const userIds = Array.from(new Set(dto.userIds));
    if (userIds.length > MAX_MOVE_BATCH) {
      throw new BadRequestException(
        `Cannot move more than ${MAX_MOVE_BATCH} users at once`,
      );
    }

    const targetCohortId = await this.cohortService.resolveCohortId(
      dto.cohortId,
      tenantId,
    );

    // The scope guard pins the tenant in the request; the user ids in the body
    // are separate input and must be checked against that tenant themselves.
    const owned = await this.memberRepository.filterUserIdsInTenant(
      userIds,
      tenantId,
    );
    if (owned.length !== userIds.length) {
      throw new BadRequestException(
        'One or more users do not belong to this organization',
      );
    }

    const existing = await this.memberRepository.findLiveForUsers(owned);
    const currentByUser = new Map(existing.map((m) => [m.userId, m]));

    const toMove = owned.filter(
      (userId) =>
        (currentByUser.get(userId)?.cohortId ?? null) !== targetCohortId,
    );
    if (toMove.length === 0) {
      return { success: true };
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TenantCohortMember);

      await repo.softDelete({ userId: In(toMove), deletedAt: IsNull() });

      if (targetCohortId) {
        await repo.insert(
          toMove.map((userId) => ({
            userId,
            cohortId: targetCohortId,
            tenantId,
          })),
        );
      }
    });

    CohortMemberService.logger.info(
      `Moved ${toMove.length} user(s) to cohort ${targetCohortId ?? 'Unassigned'} in tenant ${tenantId}`,
    );
    return { success: true };
  }
}
