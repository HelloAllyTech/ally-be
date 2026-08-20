import { BadRequestException, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { SuccessResponse } from 'src/common/type/common.type';
import { CohortRestrictionRepository } from '../repository/cohort-restriction.repository';
import { CohortService } from './cohort.service';
import {
  CohortContentType,
  COHORT_CONTENT_CONFIG,
  UNASSIGNED_COHORT_ID,
} from '../constants/cohort.constants';
import {
  ContentCohortRestrictionDto,
  GetCohortRestrictionsQueryDto,
  SetCohortRestrictionsDto,
} from '../dto/cohort.dto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CohortRestrictionService {
  private static readonly logger = LoggerService.getInstance(
    CohortRestrictionService.name,
  );

  constructor(
    private readonly restrictionRepository: CohortRestrictionRepository,
    private readonly cohortService: CohortService,
  ) {}

  /**
   * Restrictions for a tenant's content of one type, as one entry per
   * *restricted* item.
   *
   * Unrestricted items are simply absent rather than present with an empty list.
   * That is the same asymmetry the data model has — no rows means tenant-wide —
   * and it keeps the response small for the common case where an admin has
   * restricted a handful of items out of hundreds.
   */
  async getRestrictions(
    tenantId: string,
    query: GetCohortRestrictionsQueryDto,
  ): Promise<ContentCohortRestrictionDto[]> {
    const contentIds = query.contentIds
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    contentIds?.forEach((id) =>
      this.assertValidContentId(query.contentType, id),
    );

    const rows = await this.restrictionRepository.findForTenant(
      query.contentType,
      tenantId,
      contentIds,
    );

    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const list = grouped.get(row.contentId) ?? [];
      list.push(row.cohortId ?? UNASSIGNED_COHORT_ID);
      grouped.set(row.contentId, list);
    }

    return Array.from(grouped.entries()).map(([contentId, cohortIds]) => ({
      contentId,
      cohortIds,
    }));
  }

  /**
   * Replaces one item's restriction set.
   *
   * An empty `cohortIds` is not an error and not a no-op — it is how an admin
   * says "back to everyone". Being able to undo a restriction with the same call
   * that made it is what keeps the control a toggle rather than a trapdoor.
   *
   * Note what this does NOT check: whether the content is assigned to the tenant
   * at all. Layer 1 (`*_tenants`) already decides that, and the learner read path
   * applies both, so a restriction on unassigned content is inert rather than
   * wrong. Validating it here would mean this module importing the learn, track
   * and case modules and taking on three circular dependencies to prevent
   * nothing.
   */
  async setRestrictions(
    tenantId: string,
    dto: SetCohortRestrictionsDto,
  ): Promise<SuccessResponse> {
    this.assertValidContentId(dto.contentType, dto.contentId);

    const resolved = await Promise.all(
      Array.from(new Set(dto.cohortIds)).map((cohortId) =>
        this.cohortService.resolveCohortId(cohortId, tenantId),
      ),
    );

    await this.restrictionRepository.replaceForContent(
      dto.contentType,
      tenantId,
      dto.contentId,
      resolved,
    );

    CohortRestrictionService.logger.info(
      resolved.length === 0
        ? `Cleared cohort restrictions on ${dto.contentType} ${dto.contentId} for tenant ${tenantId}`
        : `Restricted ${dto.contentType} ${dto.contentId} to ${resolved.length} cohort(s) for tenant ${tenantId}`,
    );
    return { success: true };
  }

  /**
   * Guards the one untrusted value that reaches SQL as a cast. Scenario ids are
   * integers and course/case ids are uuids; both travel as strings, so the type
   * decides which shape is acceptable.
   */
  private assertValidContentId(
    contentType: CohortContentType,
    contentId: string,
  ): void {
    const { idIsUuid } = COHORT_CONTENT_CONFIG[contentType];
    const valid = idIsUuid
      ? UUID_PATTERN.test(contentId)
      : /^\d+$/.test(contentId);

    if (!valid) {
      throw new BadRequestException(
        `“${contentId}” is not a valid ${contentType} id`,
      );
    }
  }
}
