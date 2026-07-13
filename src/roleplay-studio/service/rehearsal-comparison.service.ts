import { Injectable } from '@nestjs/common';

export interface DimensionDelta {
  before: number | null;
  after: number | null;
  delta: number | null;
}

export type TestCaseFlip =
  | 'FIXED'
  | 'REGRESSED'
  | 'UNCHANGED'
  | 'NEW'
  | 'DROPPED';

export interface TestCaseComparison {
  id: string;
  title: string;
  before: string | null;
  after: string | null;
  flip: TestCaseFlip;
}

export interface RehearsalComparison {
  overall: DimensionDelta;
  dimensions: Record<string, DimensionDelta>;
  testCases: TestCaseComparison[];
  testPassRate: DimensionDelta;
  /** Any PASSED→FAILED flip, or a dimension dropping beyond the noise band. */
  regressed: boolean;
}

/** LLM-judged dimensions wobble run-to-run; ignore drops inside this band. */
export const DIMENSION_NOISE_TOLERANCE = 5;

/**
 * Pure before/after comparison of two rehearsal `results` objects (same shape
 * as RehearsalRun.results). Used by the improvement orchestrator (round
 * deltas + stop conditions + proposal verification), the rehearsal comparison
 * endpoint, and the copilot's get_rehearsal_findings tool.
 */
@Injectable()
export class RehearsalComparisonService {
  compare(
    baseResults: Record<string, any> | null | undefined,
    candidateResults: Record<string, any> | null | undefined,
  ): RehearsalComparison {
    const base = baseResults ?? {};
    const candidate = candidateResults ?? {};

    const overall = this.delta(base.overall, candidate.overall);
    const dimensionNames = new Set([
      ...Object.keys(base.dimensions ?? {}),
      ...Object.keys(candidate.dimensions ?? {}),
    ]);
    const dimensions: Record<string, DimensionDelta> = {};
    for (const name of dimensionNames) {
      dimensions[name] = this.delta(
        base.dimensions?.[name],
        candidate.dimensions?.[name],
      );
    }

    const testCases = this.compareTestCases(
      base.test_case_results ?? [],
      candidate.test_case_results ?? [],
    );

    const regressed =
      testCases.some((testCase) => testCase.flip === 'REGRESSED') ||
      Object.values(dimensions).some(
        (dimension) =>
          dimension.delta !== null &&
          dimension.delta < -DIMENSION_NOISE_TOLERANCE,
      );

    return {
      overall,
      dimensions,
      testCases,
      testPassRate: this.delta(base.test_pass_rate, candidate.test_pass_rate),
      regressed,
    };
  }

  private delta(before: unknown, after: unknown): DimensionDelta {
    const beforeNumber = typeof before === 'number' ? before : null;
    const afterNumber = typeof after === 'number' ? after : null;
    return {
      before: beforeNumber,
      after: afterNumber,
      delta:
        beforeNumber !== null && afterNumber !== null
          ? afterNumber - beforeNumber
          : null,
    };
  }

  private compareTestCases(
    baseResults: Record<string, any>[],
    candidateResults: Record<string, any>[],
  ): TestCaseComparison[] {
    const baseById = new Map(
      baseResults.map((result) => [String(result.test_case_id), result]),
    );
    const candidateById = new Map(
      candidateResults.map((result) => [String(result.test_case_id), result]),
    );
    const ids = new Set([...baseById.keys(), ...candidateById.keys()]);

    const comparisons: TestCaseComparison[] = [];
    for (const id of ids) {
      const before = baseById.get(id);
      const after = candidateById.get(id);
      const beforeVerdict = before ? String(before.verdict) : null;
      const afterVerdict = after ? String(after.verdict) : null;

      let flip: TestCaseFlip;
      if (beforeVerdict === null) flip = 'NEW';
      else if (afterVerdict === null) flip = 'DROPPED';
      else if (beforeVerdict === afterVerdict) flip = 'UNCHANGED';
      else if (afterVerdict === 'PASSED') flip = 'FIXED';
      else if (beforeVerdict === 'PASSED') flip = 'REGRESSED';
      // e.g. FAILED → INCONCLUSIVE: neither fixed nor a pass regression.
      else flip = 'UNCHANGED';

      comparisons.push({
        id,
        title: String(after?.title ?? before?.title ?? id),
        before: beforeVerdict,
        after: afterVerdict,
        flip,
      });
    }
    return comparisons;
  }
}
