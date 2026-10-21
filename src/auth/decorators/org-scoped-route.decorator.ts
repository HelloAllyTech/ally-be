import { SetMetadata } from '@nestjs/common';

export const ORG_SCOPED_ROUTE_KEY = 'org-scoped-route';

export interface OrgScopedRouteOptions {
  /** Query parameter naming the organization (id or code). Default `tenantId`. */
  queryParam?: string;
}

/**
 * Marks a route behind an `orgScopedRoutesOnly` feature toggle (Analytics) as
 * one whose whole response narrows to the organization named in the query.
 *
 * A platform admin restricted to an organization allowlist reaches such a
 * toggle's routes ONLY when they carry this marker, and only for an
 * organization on their allowlist (FeatureToggleGuard). An unmarked route —
 * anything platform-wide, or with a benchmark or per-org list beside the
 * scoped numbers — is refused to them, so a new route stays closed until
 * someone checks it and marks it.
 *
 * Mark a route only when EVERY number in its response is scoped by that
 * parameter.
 */
export const OrgScopedRoute = (options: OrgScopedRouteOptions = {}) =>
  SetMetadata(ORG_SCOPED_ROUTE_KEY, {
    queryParam: options.queryParam ?? 'tenantId',
  });
