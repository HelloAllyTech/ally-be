import 'reflect-metadata';
import { ROUTE_ARGS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { getMetadataStorage } from 'class-validator';
import { AnalyticsController } from '../analytics.controller';
import { FEATURE_TOGGLE_KEY } from '../../../auth/decorators/feature-toggle.decorator';
import { ORG_SCOPED_ROUTE_KEY } from '../../../auth/decorators/org-scoped-route.decorator';
import { CALLER_SCOPED_ROUTE_KEY } from '../../../auth/decorators/caller-scoped-route.decorator';
import { FeatureToggleKey } from '../../../authorization/constants/admin-feature-toggle.constants';

/**
 * The Analytics routes an organization-restricted admin may call. Marking a
 * route @OrgScopedRoute opens it to them, so this list is pinned: a change to
 * it shows up here, in review, with the route's name on it. Only mark a route
 * whose whole response narrows to `tenantId` (see the decorator).
 */
const ORG_SCOPED_ANALYTICS_ROUTES = [
  'activation',
  'coaching-loop',
  'cohort-retention',
  'competency-map',
  'completion-rate',
  'course-impact',
  'curriculum/course-funnel',
  'curriculum/knowledge-vs-skill',
  'curriculum/progress-curve',
  'curriculum/quiz-outcomes',
  'curriculum/roleplay-gates',
  'effectiveness/funnel',
  'foundational-skills/advanced-behaviours',
  'foundational-skills/behaviours',
  'foundational-skills/benchmark',
  'foundational-skills/feedback-uptake',
  'foundational-skills/learners',
  'foundational-skills/progress',
  'foundational-skills/progress/segments',
  'foundational-skills/retention',
  'foundational-skills/self-efficacy',
  'foundational-skills/time-to-competence',
  'foundational-skills/transfer',
  'highlights',
  'language-mix',
  'learner-kpis',
  'measurement/convergence',
  'org-health',
  'org-session-distribution',
  'practice-progression',
  'practice-quality',
  'practice-stickiness',
  'qualified-sessions',
  'quality-distribution',
  'quality-sentiment',
  'roleplay-volume',
  'scenario-usage',
  'scenarios/calibration',
  'scenarios/opportunity-coverage',
  'scenarios/progression',
  'scenarios/repeat-improvement',
  'scribe-adoption',
  'scribe/overview',
  'scribe/summary-failures',
  'skill-growth',
  'skill-growth/learners',
  'skill-growth/learners/:userId',
  'track-dropoff',
  'usage-levels',
  'xp-growth',
];

/**
 * The Analytics routes that touch only the caller's own rows, open to a
 * restricted admin with no organization named. Pinned for the same reason.
 */
const CALLER_SCOPED_ANALYTICS_HANDLERS = [
  'getChartPreferences',
  'saveChartPreferences',
];

type Route = {
  method: string;
  path: string;
  orgScoped: boolean;
  callerScoped: boolean;
};

function analyticsRoutes(): Route[] {
  const proto = AnalyticsController.prototype as unknown as Record<
    string,
    unknown
  >;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => ({ name, handler: proto[name] }))
    .filter(
      ({ handler }) =>
        typeof handler === 'function' &&
        Reflect.getMetadata(FEATURE_TOGGLE_KEY, handler)?.featureKey ===
          FeatureToggleKey.ANALYTICS,
    )
    .map(({ name, handler }) => ({
      method: name,
      path: Reflect.getMetadata(PATH_METADATA, handler as object),
      orgScoped: Boolean(
        Reflect.getMetadata(ORG_SCOPED_ROUTE_KEY, handler as object),
      ),
      callerScoped: Boolean(
        Reflect.getMetadata(CALLER_SCOPED_ROUTE_KEY, handler as object),
      ),
    }));
}

describe('Analytics routes open to organization-restricted admins', () => {
  it('are exactly the pinned list', () => {
    const scoped = analyticsRoutes()
      .filter((r) => r.orgScoped)
      .map((r) => r.path)
      .sort();

    expect(scoped).toEqual([...ORG_SCOPED_ANALYTICS_ROUTES].sort());
  });

  it.each([
    'overview',
    'xp-by-tenant',
    'org-engagement',
    'effectiveness/orgs',
    'effectiveness/cost-per-improvement',
    'roleplay-session-cost/sessions/:sessionId',
    'token-consumption',
    'foundational-skills/judge-agreement',
  ])('leaves platform-wide %s closed to them', (path) => {
    const route = analyticsRoutes().find((r) => r.path === path);

    expect(route).toBeDefined();
    expect(route?.orgScoped).toBe(false);
  });

  /** Whether a handler reads `tenantId` from the query, directly or via its DTO. */
  function takesTenantId(method: string): boolean {
    const paramTypes: unknown[] =
      Reflect.getMetadata(
        'design:paramtypes',
        AnalyticsController.prototype,
        method,
      ) ?? [];
    const routeArgs: Record<string, { index: number; data?: string }> =
      Reflect.getMetadata(ROUTE_ARGS_METADATA, AnalyticsController, method) ??
      {};
    return Object.entries(routeArgs)
      .filter(([key]) => Number(key.split(':')[0]) === RouteParamtypes.QUERY)
      .some(([, arg]) => {
        if (arg.data) return arg.data === 'tenantId';
        const dto = paramTypes[arg.index] as (new () => object) | undefined;
        return Boolean(
          dto &&
          getMetadataStorage()
            .getTargetValidationMetadatas(dto, '', true, false)
            .some((m) => m.propertyName === 'tenantId'),
        );
      });
  }

  it('only marks routes that actually take a tenantId', () => {
    const marked = analyticsRoutes().filter((r) => r.orgScoped);
    const withoutTenantId = marked
      .filter((r) => !takesTenantId(r.method))
      .map((r) => r.path);

    expect(withoutTenantId).toEqual([]);
  });

  it('can tell a route that takes no tenantId (the check above is live)', () => {
    const xpGoals = analyticsRoutes().find((r) => r.path === 'xp-goals');

    expect(xpGoals).toBeDefined();
    expect(takesTenantId(xpGoals!.method)).toBe(false);
  });

  it('opens exactly the pinned caller-scoped routes without an organization', () => {
    const callerScoped = analyticsRoutes()
      .filter((r) => r.callerScoped)
      .map((r) => r.method)
      .sort();

    expect(callerScoped).toEqual([...CALLER_SCOPED_ANALYTICS_HANDLERS].sort());
  });

  it('never marks a route both org-scoped and caller-scoped', () => {
    const both = analyticsRoutes()
      .filter((r) => r.orgScoped && r.callerScoped)
      .map((r) => r.path);

    expect(both).toEqual([]);
  });

  /** Whether a handler reads anything from the query string or the path. */
  function takesQueryOrPathParam(method: string): boolean {
    const routeArgs: Record<string, unknown> =
      Reflect.getMetadata(ROUTE_ARGS_METADATA, AnalyticsController, method) ??
      {};
    return Object.keys(routeArgs).some((key) =>
      [RouteParamtypes.QUERY, RouteParamtypes.PARAM].includes(
        Number(key.split(':')[0]),
      ),
    );
  }

  it('gives caller-scoped routes no query or path parameter to name someone else by', () => {
    const named = analyticsRoutes()
      .filter((r) => r.callerScoped && takesQueryOrPathParam(r.method))
      .map((r) => r.method);

    expect(named).toEqual([]);
  });

  it('can tell a route that takes a path parameter (the check above is live)', () => {
    const learner = analyticsRoutes().find(
      (r) => r.path === 'skill-growth/learners/:userId',
    );

    expect(learner).toBeDefined();
    expect(takesQueryOrPathParam(learner!.method)).toBe(true);
  });
});
