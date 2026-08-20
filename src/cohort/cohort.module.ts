import { Module } from '@nestjs/common';
import { AuthorizationModule } from 'src/authorization/authorization.module';
import { CohortController } from './controller/cohort.controller';
import { CohortService } from './service/cohort.service';
import { CohortMemberService } from './service/cohort-member.service';
import { CohortRestrictionService } from './service/cohort-restriction.service';
import { CohortVisibilityService } from './service/cohort-visibility.service';
import { TenantCohortRepository } from './repository/tenant-cohort.repository';
import { TenantCohortMemberRepository } from './repository/tenant-cohort-member.repository';
import { CohortRestrictionRepository } from './repository/cohort-restriction.repository';

/**
 * Cohorts: a tenant's own MECE grouping of its users, plus the per-cohort
 * narrowing of content already assigned to that tenant.
 *
 * Imports only AuthorizationModule (for the permission guards behind
 * @TenantScopedPermissions) and nothing else from the domain. That is a
 * constraint, not a coincidence: LearnModule, TrackModule and CaseModule all
 * import THIS module for CohortVisibilityService, so any import back into them
 * would be a cycle. It is why the restriction service validates cohort ids and
 * content-id *shape* but never asks whether a scenario/track/case actually
 * exists — checking that would require exactly those imports.
 *
 * Only CohortVisibilityService is exported. The management services stay private
 * to the controller so a future caller cannot reach cohort writes from inside a
 * learner request path.
 */
@Module({
  imports: [AuthorizationModule],
  controllers: [CohortController],
  providers: [
    CohortService,
    CohortMemberService,
    CohortRestrictionService,
    CohortVisibilityService,
    TenantCohortRepository,
    TenantCohortMemberRepository,
    CohortRestrictionRepository,
  ],
  exports: [CohortVisibilityService],
})
export class CohortModule {}
