import { SelectQueryBuilder } from 'typeorm';
import {
  applyCohortVisibilityFilter,
  TRACK_ENROLMENT_GRACE_SQL,
} from '../cohort-restriction.query';
import { CohortContentType } from '../../constants/cohort.constants';

/**
 * These tests pin the SHAPE of the visibility predicate rather than running SQL,
 * because the shape is where the product rule lives and where a regression would
 * be silent. In particular: the `NOT EXISTS` branch is what makes unrestricted
 * content visible to everyone, so losing it would quietly hide every item that
 * has no restriction — a total outage of the default case that no type error and
 * no integration test on restricted content would catch.
 */
describe('applyCohortVisibilityFilter', () => {
  const makeQuery = () => {
    const calls: { where: string[]; params: Record<string, unknown> } = {
      where: [],
      params: {},
    };
    // Annotated explicitly: the mock's methods return the mock, which TypeScript
    // cannot infer from a self-referential initializer.
    const query: { andWhere: jest.Mock; setParameter: jest.Mock } = {
      andWhere: jest.fn((clause: string) => {
        calls.where.push(clause);
        return query;
      }),
      setParameter: jest.fn((key: string, value: unknown) => {
        calls.params[key] = value;
        return query;
      }),
    };
    return { query: query as unknown as SelectQueryBuilder<any>, calls };
  };

  it('admits unrestricted content via a NOT EXISTS branch — the tenant-wide default', () => {
    const { query, calls } = makeQuery();

    applyCohortVisibilityFilter(query, {
      alias: 'scenario',
      contentType: CohortContentType.SCENARIO,
      tenantId: 'tenant-1',
      cohortId: 'cohort-1',
    });

    expect(calls.where).toHaveLength(1);
    expect(calls.where[0]).toContain('NOT EXISTS');
    expect(calls.where[0]).toContain('scenario_cohort_restrictions');
    // Two branches OR'd together: "nobody restricted it" OR "one is mine".
    expect(calls.where[0]).toContain(' OR ');
  });

  it('matches the caller’s own cohort by equality when they are in one', () => {
    const { query, calls } = makeQuery();

    applyCohortVisibilityFilter(query, {
      alias: 'scenario',
      contentType: CohortContentType.SCENARIO,
      tenantId: 'tenant-1',
      cohortId: 'cohort-1',
    });

    expect(calls.where[0]).toContain('"cohortId" = :cohortId');
    expect(calls.params).toEqual({
      cohortTenantId: 'tenant-1',
      cohortId: 'cohort-1',
    });
  });

  it('matches the Unassigned audience with IS NULL, binding no cohort parameter', () => {
    const { query, calls } = makeQuery();

    applyCohortVisibilityFilter(query, {
      alias: 'track',
      contentType: CohortContentType.TRACK,
      tenantId: 'tenant-1',
      cohortId: null,
    });

    expect(calls.where[0]).toContain('"cohortId" IS NULL');
    expect(calls.where[0]).not.toContain(':cohortId');
    // No cohort parameter at all — binding SQL NULL through the driver to a uuid
    // column is the fragility this branch exists to avoid.
    expect(calls.params).toEqual({ cohortTenantId: 'tenant-1' });
  });

  it('adds the grace branch as a third OR when one is supplied', () => {
    const { query, calls } = makeQuery();

    applyCohortVisibilityFilter(query, {
      alias: 'track',
      contentType: CohortContentType.TRACK,
      tenantId: 'tenant-1',
      cohortId: 'cohort-1',
      graceExistsSql: TRACK_ENROLMENT_GRACE_SQL,
    });

    expect(calls.where[0]).toContain('track_enrollments');
    expect(calls.where[0].split(' OR ')).toHaveLength(3);
  });

  it('omits the grace branch when none is supplied — roleplays have nothing to resume', () => {
    const { query, calls } = makeQuery();

    applyCohortVisibilityFilter(query, {
      alias: 'scenario',
      contentType: CohortContentType.SCENARIO,
      tenantId: 'tenant-1',
      cohortId: 'cohort-1',
    });

    expect(calls.where[0].split(' OR ')).toHaveLength(2);
  });

  it('scopes every restriction lookup to the tenant', () => {
    const { query, calls } = makeQuery();

    applyCohortVisibilityFilter(query, {
      alias: 'case',
      contentType: CohortContentType.CASE,
      tenantId: 'tenant-1',
      cohortId: null,
    });

    // Both branches must carry the tenant predicate, or one tenant's
    // restrictions could suppress another tenant's content.
    const occurrences =
      calls.where[0].split('"tenantId" = :cohortTenantId').length - 1;
    expect(occurrences).toBe(2);
  });

  it('keeps parameters distinct when applied twice via paramSuffix', () => {
    const { query, calls } = makeQuery();

    applyCohortVisibilityFilter(query, {
      alias: 'scenario',
      contentType: CohortContentType.SCENARIO,
      tenantId: 'tenant-1',
      cohortId: 'cohort-1',
      paramSuffix: 'a',
    });
    applyCohortVisibilityFilter(query, {
      alias: 'scenario',
      contentType: CohortContentType.SCENARIO,
      tenantId: 'tenant-2',
      cohortId: 'cohort-2',
      paramSuffix: 'b',
    });

    expect(calls.params).toEqual({
      cohortTenantIda: 'tenant-1',
      cohortIda: 'cohort-1',
      cohortTenantIdb: 'tenant-2',
      cohortIdb: 'cohort-2',
    });
  });

  it('rejects a non-alphanumeric paramSuffix rather than interpolating it', () => {
    const { query } = makeQuery();

    expect(() =>
      applyCohortVisibilityFilter(query, {
        alias: 'scenario',
        contentType: CohortContentType.SCENARIO,
        tenantId: 'tenant-1',
        cohortId: null,
        paramSuffix: 'a; DROP TABLE users',
      }),
    ).toThrow(/alphanumeric/);
  });

  it('targets the right table per content type', () => {
    const cases: Array<[CohortContentType, string, string]> = [
      [
        CohortContentType.SCENARIO,
        'scenario_cohort_restrictions',
        'scenarioId',
      ],
      [CohortContentType.TRACK, 'track_cohort_restrictions', 'trackId'],
      [CohortContentType.CASE, 'case_cohort_restrictions', 'caseId'],
    ];

    cases.forEach(([contentType, table, column]) => {
      const { query, calls } = makeQuery();
      applyCohortVisibilityFilter(query, {
        alias: 'item',
        contentType,
        tenantId: 'tenant-1',
        cohortId: null,
      });
      expect(calls.where[0]).toContain(table);
      expect(calls.where[0]).toContain(column);
    });
  });
});
