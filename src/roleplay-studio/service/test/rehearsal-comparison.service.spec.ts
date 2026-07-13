import { RehearsalComparisonService } from '../rehearsal-comparison.service';

describe('RehearsalComparisonService', () => {
  const service = new RehearsalComparisonService();

  const results = (overrides: Record<string, any> = {}) => ({
    overall: 60,
    dimensions: {
      persona_consistency: 80,
      disclosure_discipline: 50,
      difficulty_calibration: 65,
      rubric_coverage: 70,
    },
    test_case_results: [
      { test_case_id: 'tc-1', title: 'Leak check', verdict: 'FAILED' },
      { test_case_id: 'tc-2', title: 'Escalation', verdict: 'PASSED' },
    ],
    test_pass_rate: 50,
    ...overrides,
  });

  it('computes per-dimension and overall deltas', () => {
    const comparison = service.compare(
      results(),
      results({
        overall: 75,
        dimensions: {
          persona_consistency: 82,
          disclosure_discipline: 85,
          difficulty_calibration: 60,
          rubric_coverage: 70,
        },
      }),
    );

    expect(comparison.overall).toEqual({ before: 60, after: 75, delta: 15 });
    expect(comparison.dimensions.disclosure_discipline.delta).toBe(35);
    expect(comparison.dimensions.difficulty_calibration.delta).toBe(-5);
    expect(comparison.dimensions.rubric_coverage.delta).toBe(0);
  });

  it('classifies test-case verdict flips', () => {
    const comparison = service.compare(
      results(),
      results({
        test_case_results: [
          { test_case_id: 'tc-1', title: 'Leak check', verdict: 'PASSED' },
          { test_case_id: 'tc-2', title: 'Escalation', verdict: 'FAILED' },
          { test_case_id: 'tc-3', title: 'New case', verdict: 'PASSED' },
        ],
      }),
    );

    const byId = new Map(comparison.testCases.map((t) => [t.id, t.flip]));
    expect(byId.get('tc-1')).toBe('FIXED');
    expect(byId.get('tc-2')).toBe('REGRESSED');
    expect(byId.get('tc-3')).toBe('NEW');
  });

  it('flags regression on a PASSED→FAILED flip', () => {
    const comparison = service.compare(
      results(),
      results({
        test_case_results: [
          { test_case_id: 'tc-2', title: 'Escalation', verdict: 'FAILED' },
        ],
      }),
    );
    expect(comparison.regressed).toBe(true);
  });

  it('tolerates small dimension drops (noise band) but flags big ones', () => {
    const withinBand = service.compare(
      results(),
      results({
        dimensions: { ...results().dimensions, persona_consistency: 76 },
        test_case_results: results().test_case_results,
      }),
    );
    expect(withinBand.regressed).toBe(false);

    const beyondBand = service.compare(
      results(),
      results({
        dimensions: { ...results().dimensions, persona_consistency: 70 },
      }),
    );
    expect(beyondBand.regressed).toBe(true);
  });

  it('handles missing/null results with null deltas', () => {
    const comparison = service.compare(null, results());
    expect(comparison.overall).toEqual({
      before: null,
      after: 60,
      delta: null,
    });
    expect(comparison.regressed).toBe(false);
    expect(comparison.testCases.every((t) => t.flip === 'NEW')).toBe(true);
  });

  it('FAILED→INCONCLUSIVE is neither fixed nor regressed', () => {
    const comparison = service.compare(
      results(),
      results({
        test_case_results: [
          {
            test_case_id: 'tc-1',
            title: 'Leak check',
            verdict: 'INCONCLUSIVE',
          },
          { test_case_id: 'tc-2', title: 'Escalation', verdict: 'PASSED' },
        ],
      }),
    );
    const tc1 = comparison.testCases.find((t) => t.id === 'tc-1');
    expect(tc1?.flip).toBe('UNCHANGED');
    expect(comparison.regressed).toBe(false);
  });
});
