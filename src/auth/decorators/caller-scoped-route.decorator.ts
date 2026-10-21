import { SetMetadata } from '@nestjs/common';

export const CALLER_SCOPED_ROUTE_KEY = 'caller-scoped-route';

/**
 * Marks a route behind an `orgScopedRoutesOnly` feature toggle (Analytics) as
 * one that reads or writes only the CALLER's own rows — a saved preference,
 * say — so it carries no organization at all.
 *
 * An organization-restricted admin reaches such a toggle's routes only when
 * they are marked (FeatureToggleGuard). @OrgScopedRoute is wrong for these:
 * there is no organization to name, so they would answer 400 to every
 * restricted admin. This marker lets them through without one.
 *
 * Mark a route only when its handler is keyed on the authenticated user's id
 * and nothing else — never on an id the request supplies.
 */
export const CallerScopedRoute = () =>
  SetMetadata(CALLER_SCOPED_ROUTE_KEY, true);
