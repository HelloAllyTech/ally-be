import { countableSessionPredicate } from 'src/analytics/util/session-eligibility.util';
import { excludeTestTenants } from 'src/analytics/util/test-tenant.util';
import { FHS_SESSION_SETTLE_MINUTES } from '../constants/helping-skills-rubric.constants';

/**
 * Which sessions feed the foundational-skills measure — the cut pipeline and
 * the benchmark alike: real, completed learner practice.
 *
 * - completed, and settled for `FHS_SESSION_SETTLE_MINUTES` (late turns and
 *   timestamp rewrites land after the end signal, and cuts are append-only);
 * - countable (no preview or seed rooms) and not an AI-vs-AI test run;
 * - not in a test organisation.
 *
 * One definition, so the benchmark's "pending" count on the analytics side can
 * never disagree with what the scheduler will actually pick up.
 */
export function fhsEligibleSession(alias: string): string {
  return [
    `${alias}.status = 'ENDED'`,
    `${alias}."eventStatus" = 'COMPLETED'`,
    `${alias}."endedAt" IS NOT NULL`,
    `${alias}."endedAt" < now() - make_interval(mins => ${FHS_SESSION_SETTLE_MINUTES})`,
    `${alias}."counselorId" IS NOT NULL`,
    countableSessionPredicate(alias),
    `COALESCE((${alias}.metadata->>'v2vTest')::boolean, false) = false`,
    excludeTestTenants(`${alias}."tenant_id"`),
  ].join(' AND ');
}
