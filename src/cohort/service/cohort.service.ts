import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { SuccessResponse } from 'src/common/type/common.type';
import { TenantCohortRepository } from '../repository/tenant-cohort.repository';
import { TenantCohortMemberRepository } from '../repository/tenant-cohort-member.repository';
import { CohortRestrictionRepository } from '../repository/cohort-restriction.repository';
import { TenantCohort } from '../entity/tenant-cohort.entity';
import { TenantCohortMember } from '../entity/tenant-cohort-member.entity';
import {
  UNASSIGNED_COHORT_ID,
  UNASSIGNED_COHORT_NAME,
} from '../constants/cohort.constants';
import {
  CohortDto,
  CohortListResponseDto,
  CreateCohortDto,
  UpdateCohortDto,
} from '../dto/cohort.dto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CohortService {
  private static readonly logger = LoggerService.getInstance(
    CohortService.name,
  );

  constructor(
    private readonly cohortRepository: TenantCohortRepository,
    private readonly memberRepository: TenantCohortMemberRepository,
    private readonly restrictionRepository: CohortRestrictionRepository,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The tenant's cohorts, plus the synthesised Unassigned bucket.
   *
   * Unassigned is always present and always last, even at zero members. It is
   * the visible proof that the partition is total: an admin who has placed
   * everyone sees "Unassigned 0" rather than having to infer completeness from
   * counts that happen to add up. It is also targetable — a restriction can name
   * it — so hiding it when empty would remove a real choice.
   */
  async listCohorts(tenantId: string): Promise<CohortListResponseDto> {
    const [cohorts, counts, totalUsers] = await Promise.all([
      this.cohortRepository.findByTenant(tenantId),
      this.cohortRepository.countMembersByCohort(tenantId),
      this.memberRepository.countTenantUsers(tenantId),
    ]);

    const placed = cohorts.reduce(
      (sum, cohort) => sum + (counts.get(cohort.id) ?? 0),
      0,
    );

    const data: CohortDto[] = cohorts.map((cohort) => ({
      id: cohort.id,
      name: cohort.name,
      description: cohort.description ?? null,
      memberCount: counts.get(cohort.id) ?? 0,
      isUnassignedBucket: false,
    }));

    data.push({
      id: UNASSIGNED_COHORT_ID,
      name: UNASSIGNED_COHORT_NAME,
      description: null,
      // Clamped at zero: `placed` counts live memberships while `totalUsers`
      // excludes platform-role accounts, so a staff account that somehow holds a
      // membership must not drive this negative.
      memberCount: Math.max(totalUsers - placed, 0),
      isUnassignedBucket: true,
    });

    return { data, totalUsers };
  }

  async createCohort(
    tenantId: string,
    dto: CreateCohortDto,
  ): Promise<TenantCohort> {
    const name = dto.name.trim();
    const clash = await this.cohortRepository.findByNameInsensitive(
      tenantId,
      name,
    );
    if (clash) {
      throw new ConflictException(`A cohort named “${name}” already exists`);
    }
    if (name.toLowerCase() === UNASSIGNED_COHORT_NAME.toLowerCase()) {
      throw new ConflictException(
        `“${UNASSIGNED_COHORT_NAME}” is reserved for users who are in no cohort`,
      );
    }

    return this.cohortRepository.save(
      this.cohortRepository.create({
        tenantId,
        name,
        description: dto.description?.trim() || null,
      }),
    );
  }

  async updateCohort(
    id: string,
    tenantId: string,
    dto: UpdateCohortDto,
  ): Promise<TenantCohort> {
    const cohort = await this.requireOwnedCohort(id, tenantId);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const clash = await this.cohortRepository.findByNameInsensitive(
        tenantId,
        name,
      );
      if (clash && clash.id !== id) {
        throw new ConflictException(`A cohort named “${name}” already exists`);
      }
      cohort.name = name;
    }
    if (dto.description !== undefined) {
      cohort.description = dto.description.trim() || null;
    }

    return this.cohortRepository.save(cohort);
  }

  /**
   * Deletes a cohort, returning its members to the Unassigned bucket and
   * dropping every restriction that named it.
   *
   * Dropping the restrictions is the important half. A restriction naming a
   * deleted cohort would leave content targeted at an audience nobody can be in
   * — invisible to every learner, and unexplainable in the UI because the cohort
   * it points at is gone. Clearing them instead means an item whose only
   * restriction was this cohort returns to tenant-wide visibility, which is the
   * failure direction that loses nobody their access.
   *
   * All three writes share one transaction so the partition can never be left
   * with orphaned members or dangling restrictions.
   */
  async deleteCohort(id: string, tenantId: string): Promise<SuccessResponse> {
    await this.requireOwnedCohort(id, tenantId);

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(TenantCohortMember)
        .softDelete({ cohortId: id });
      await this.restrictionRepository.deleteByCohort(id, manager);
      await manager.getRepository(TenantCohort).softDelete({ id, tenantId });
    });

    CohortService.logger.info(
      `Deleted cohort ${id} for tenant ${tenantId}; members returned to ${UNASSIGNED_COHORT_NAME}`,
    );
    return { success: true };
  }

  /**
   * Resolves a cohort id from the wire into `{ id | null }`, rejecting anything
   * that is not the Unassigned sentinel or a live cohort of this tenant.
   *
   * The tenant check is not redundant with OwnTenantScopeGuard: the guard pins
   * the `tenantId` in the request, but the cohort ids in the body are separate
   * input and could name another tenant's cohort.
   */
  async resolveCohortId(
    value: string,
    tenantId: string,
  ): Promise<string | null> {
    if (value === UNASSIGNED_COHORT_ID) return null;
    await this.requireOwnedCohort(value, tenantId);
    return value;
  }

  private async requireOwnedCohort(
    id: string,
    tenantId: string,
  ): Promise<TenantCohort> {
    // Shape-check before the query: `cohortId` arrives as a plain string (it has
    // to, so the Unassigned sentinel can share the field), so a malformed value
    // would otherwise reach a uuid column and surface as a Postgres 22P02
    // instead of the 404 this is.
    if (!UUID_PATTERN.test(id)) {
      throw new NotFoundException('Cohort not found');
    }
    const cohort = await this.cohortRepository.findOwnedById(id, tenantId);
    if (!cohort) {
      throw new NotFoundException('Cohort not found');
    }
    return cohort;
  }
}
