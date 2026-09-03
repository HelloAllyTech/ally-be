import {
  BUILDER_SIZE_PROFILES,
  BuilderBuildSize,
  classifyBuildSize,
  prdTechnicalPlanLength,
} from '../builder.constants';

/**
 * Sizing decides what a build's planning pass is worth. It is worth testing
 * because the failure is silent in both directions: undersize a cross-repo
 * build and the coder gets a thin plan for work that needed one; oversize a
 * two-route change and every run pays Opus prices to be told what the PRD
 * already said.
 */
describe('prdTechnicalPlanLength', () => {
  it('measures the plan a PRD actually carries', () => {
    const length = prdTechnicalPlanLength({
      technicalPlan: {
        repos: [
          { repo: 'ally-be', changesMd: 'a'.repeat(500) },
          { repo: 'ally-web', changesMd: 'b'.repeat(300) },
        ],
        dataModelMd: 'c'.repeat(100),
        apiMd: 'd'.repeat(50),
      },
    });
    expect(length).toBe(950);
  });

  it('does not stringify the object', () => {
    // `String({})` is "[object Object]" — 15 characters however detailed the
    // plan is, which made every PRD look small no matter its scope.
    const length = prdTechnicalPlanLength({
      technicalPlan: {
        repos: [{ repo: 'ally-be', changesMd: 'x'.repeat(9000) }],
      },
    });
    expect(length).toBe(9000);
    expect(length).not.toBe('[object Object]'.length);
  });

  it('survives a PRD with no plan at all', () => {
    expect(prdTechnicalPlanLength({})).toBe(0);
    expect(prdTechnicalPlanLength({ technicalPlan: null })).toBe(0);
    // The interview writes a string here early on, before the shape settles.
    expect(prdTechnicalPlanLength({ technicalPlan: 'draft notes' })).toBe(11);
  });
});

describe('classifyBuildSize', () => {
  it('sizes the first real build small', () => {
    // "Archive cards from the Builder feed": two routes and a checkbox across
    // one repo. It got a $7.85, 19-minute Opus plan.
    expect(
      classifyBuildSize({
        requirementCount: 4,
        repoCount: 1,
        technicalPlanLength: 1200,
      }),
    ).toBe(BuilderBuildSize.SMALL);
  });

  it('sizes a cross-repo contract at least medium', () => {
    // Where planning genuinely earns its price: a DTO both repos must agree on.
    expect(
      classifyBuildSize({
        requirementCount: 6,
        repoCount: 2,
        technicalPlanLength: 4000,
      }),
    ).toBe(BuilderBuildSize.MEDIUM);
  });

  it('sizes a broad or deeply specified change large', () => {
    expect(
      classifyBuildSize({
        requirementCount: 12,
        repoCount: 2,
        technicalPlanLength: 3000,
      }),
    ).toBe(BuilderBuildSize.LARGE);
    expect(
      classifyBuildSize({
        requirementCount: 3,
        repoCount: 1,
        technicalPlanLength: 9000,
      }),
    ).toBe(BuilderBuildSize.LARGE);
  });

  it('always sizes an epic large', () => {
    // It was decomposed precisely because it was too big to hold at once, so
    // its per-milestone counts say nothing about the whole.
    expect(
      classifyBuildSize({
        requirementCount: 1,
        repoCount: 1,
        technicalPlanLength: 0,
        isEpic: true,
      }),
    ).toBe(BuilderBuildSize.LARGE);
  });

  it('never returns something without a profile', () => {
    const inputs = [
      { requirementCount: 0, repoCount: 0, technicalPlanLength: 0 },
      { requirementCount: 999, repoCount: 9, technicalPlanLength: 99999 },
      { requirementCount: 5, repoCount: 3, technicalPlanLength: 2500 },
    ];
    for (const input of inputs) {
      expect(BUILDER_SIZE_PROFILES[classifyBuildSize(input)]).toBeDefined();
    }
  });
});

describe('BUILDER_SIZE_PROFILES', () => {
  it('spends strictly more on a bigger build', () => {
    const small = BUILDER_SIZE_PROFILES[BuilderBuildSize.SMALL];
    const medium = BUILDER_SIZE_PROFILES[BuilderBuildSize.MEDIUM];
    const large = BUILDER_SIZE_PROFILES[BuilderBuildSize.LARGE];

    expect(small.maxTurns).toBeLessThan(medium.maxTurns);
    expect(medium.maxTurns).toBeLessThan(large.maxTurns);
    expect(small.maxBudgetUsd.plan).toBeLessThan(medium.maxBudgetUsd.plan);
    expect(medium.maxBudgetUsd.plan).toBeLessThan(large.maxBudgetUsd.plan);
    expect(small.planWords).toBeLessThan(large.planWords);
  });

  it('only plans on the coder tier for a small build', () => {
    expect(BUILDER_SIZE_PROFILES[BuilderBuildSize.SMALL].plannerTier).toBe(
      'coder',
    );
    expect(BUILDER_SIZE_PROFILES[BuilderBuildSize.MEDIUM].plannerTier).toBe(
      'planner',
    );
    expect(BUILDER_SIZE_PROFILES[BuilderBuildSize.LARGE].plannerTier).toBe(
      'planner',
    );
  });

  it('gives every phase a ceiling', () => {
    for (const size of Object.values(BuilderBuildSize)) {
      const budgets = BUILDER_SIZE_PROFILES[size].maxBudgetUsd;
      for (const phase of ['plan', 'code', 'verify', 'finalise'] as const) {
        expect(budgets[phase]).toBeGreaterThan(0);
      }
    }
  });
});
