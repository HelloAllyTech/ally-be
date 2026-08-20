import { Injectable } from '@nestjs/common';
import { TenantCohortMemberRepository } from '../repository/tenant-cohort-member.repository';
import { CohortRestrictionRepository } from '../repository/cohort-restriction.repository';
import { CohortContentType } from '../constants/cohort.constants';

/**
 * The read-side half of cohorts, and the only part of this module other modules
 * depend on.
 *
 * Deliberately tiny and dependency-free (two repositories, no other service and
 * no other module) so LearnModule, TrackModule and CaseModule can import
 * CohortModule without a cycle. The filtering itself is a pure query helper —
 * `applyCohortVisibilityFilter` — that the repositories call directly; this
 * service only answers the one question a repository cannot: which cohort is
 * this user in.
 */
@Injectable()
export class CohortVisibilityService {
  constructor(
    private readonly memberRepository: TenantCohortMemberRepository,
    private readonly restrictionRepository: CohortRestrictionRepository,
  ) {}

  /**
   * The user's cohort, or `null` when they are in none — which is a real
   * audience ("Unassigned"), not an absence. Callers must pass the null straight
   * through to the query filter rather than treating it as "no filtering".
   */
  async resolveUserCohortId(userId: number): Promise<string | null> {
    const membership = await this.memberRepository.findLiveForUser(userId);
    return membership?.cohortId ?? null;
  }

  /**
   * Whether one specific item is reachable by this user — the check the detail
   * and start endpoints need, where there is no list query to filter.
   *
   * `alreadyStarted` is supplied by the caller because only it knows what
   * starting means for its content type (a live enrolment for a course, a session
   * with `startedAt` for a case). Passing `true` short-circuits the restriction
   * check entirely, which is the "finish what you started, no new starts" rule:
   * losing access should stop the next thing, not confiscate the current one.
   */
  async canAccess(options: {
    contentType: CohortContentType;
    contentId: string;
    tenantId: string;
    userId: number;
    alreadyStarted?: boolean;
  }): Promise<boolean> {
    if (options.alreadyStarted) return true;

    const rows = await this.restrictionRepository.findForTenant(
      options.contentType,
      options.tenantId,
      [options.contentId],
    );

    // No restriction at all is the common case and means tenant-wide.
    if (rows.length === 0) return true;

    const cohortId = await this.resolveUserCohortId(options.userId);
    return rows.some((row) => (row.cohortId ?? null) === cohortId);
  }
}
