import { Injectable } from '@nestjs/common';

import {
  BUG_FINDING_FINDER_ERROR_REASONS,
  BugFindingDecisionReason,
  BugFindingStatus,
} from '../enum/bug-finding.enum';
import {
  BugFindingRepository,
  FindingOutcomeCount,
  StageLatency,
} from '../repository/bug-finding.repository';
import { BugHuntRunRepository } from '../repository/bug-hunt-run.repository';

/** One source's or one repo's funnel, from filed to live. */
export interface FindingFunnel {
  /** `source` or `repo` value this row aggregates, or `null` for a repo-less finding. */
  key: string | null;
  filed: number;
  /** Refuted by the Verify phase. */
  dismissed: number;
  /** Declined by a human. */
  rejected: number;
  approved: number;
  merged: number;
  released: number;
  failed: number;
  /** Still somewhere in the pipeline — neither declined nor shipped nor failed. */
  open: number;
  /**
   * Declines attributed to the finder being wrong (not_a_bug / wrong_repo /
   * duplicate), as opposed to real-but-unwanted. The numerator of the only
   * accuracy claim this report makes.
   */
  finderErrors: number;
  /** Declines with no reason recorded — rows decided before the column existed. */
  reasonNotRecorded: number;
  /**
   * `1 - finderErrors / judged`, where `judged` is every finding somebody
   * actually ruled on. Null when nothing has been judged: 0/0 is not "0%
   * accurate", and printing 0% for a young install would be the single most
   * misleading number on the page.
   */
  accuracy: number | null;
  /** Findings a verifier scored below the low-confidence threshold. */
  lowConfidence: number;
  /** Findings carrying no verifier score at all — proven ones, plus rows predating scoring. */
  unscored: number;
}

/** Why declines happened, counted. The improvement backlog's own input. */
export interface DeclineBreakdown {
  reason: BugFindingDecisionReason | 'not_recorded';
  count: number;
  /** True when this reason means the finder was wrong. */
  finderError: boolean;
}

export interface BugHunterMetrics {
  /** Days of history. Findings are cohorted by DISCOVERY date — see `outcomeCounts`. */
  windowDays: number;
  since: string;
  /** Every finding filed in the window, child steps excluded. */
  totalFiled: number;
  bySource: FindingFunnel[];
  byRepo: FindingFunnel[];
  /** The same figures across everything, so a reader has one honest headline. */
  overall: FindingFunnel;
  declines: DeclineBreakdown[];
  latency: {
    filedToDecided: StageLatency;
    filedToMerged: StageLatency;
    mergedToReleased: StageLatency;
  };
  regressions: {
    /** New findings in the window that are a shipped fix coming back. */
    filed: number;
    /** Fixes shipped in the window that have since come back. */
    fixesThatFailed: number;
    /**
     * `fixesThatFailed / merged` over the window. Null when nothing merged.
     * This is the number that should gate any widening of the agent's
     * autonomy — see the plan's staged-autonomy step.
     */
    rate: number | null;
  };
  cost: {
    totalUsd: number;
    runs: number;
    fixSessionRuns: number;
    fixSessionUsd: number;
    /**
     * Fix-session spend divided by fixes that actually merged in the window.
     * Null when nothing merged, and deliberately NOT clamped: a figure larger
     * than a whole sweep's cost means sessions are failing before they land,
     * which is exactly what a reader should see.
     */
    perMergedFixUsd: number | null;
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * What Bug Hunter has actually got right, how fast, and at what cost.
 *
 * ## Why this is a server-side endpoint and not more arithmetic in the tab
 *
 * The admin tab already has a scorecard, and it is deliberately run-shaped:
 * `scorecard.ts` reads `GET /runs` and refuses to compute a finding-level
 * funnel, because `found` is tallied across the loaded runs while a finding's
 * status comes from the newest hundred findings — two different denominators,
 * so dividing one by the other produces a rate of nothing. That refusal was
 * right, and this is the other half of it: the funnel is computable, just not
 * in the browser, because it needs every row in the window rather than the
 * newest page of two different lists.
 *
 * The same reasoning fixes a real defect in the existing spend figure. That
 * one sums the newest 50 runs client-side, so a 30-day total silently becomes
 * a floor once the platform exceeds 50 shifts a month — five repos nightly
 * plus fix sessions passes that in under a fortnight, and it under-reports
 * exactly when the agent has been busiest. `costInWindow` aggregates in
 * Postgres with no window cap at all.
 *
 * ## The one claim this makes about accuracy, and its careful shape
 *
 * `accuracy = 1 - finderErrors / judged`. Two decisions are load-bearing:
 *
 *  - **Only finder-error declines count against it.** A team that declines
 *    nine real-but-minor findings has not been badly served; one that
 *    declines two hallucinated bugs has. Collapsing those would make good
 *    triage look like a broken agent — see BUG_FINDING_FINDER_ERROR_REASONS.
 *  - **The denominator is findings somebody RULED ON**, not findings filed.
 *    An open bug is not evidence either way, and counting it as correct would
 *    make accuracy rise simply by nobody doing any triage.
 *
 * Where a reason was never recorded (every decline predating migration
 * 1946000000000) the row is reported as `reasonNotRecorded` and excluded from
 * the denominator rather than guessed at. A metric that quietly assumes the
 * missing half is the flattering half is worse than a gap.
 *
 * ## The one bias left in it, on purpose
 *
 * `approved` is inferred from a finding having reached a fix stage, because
 * APPROVED is a status a row passes THROUGH rather than rests in — counting
 * only rows sitting there would report almost none. The consequence is that a
 * bug a human approved and the agent then failed to fix lands in `failed`, not
 * `approved`, and so drops out of `judged` even though somebody did rule on
 * it. That makes the rate very slightly pessimistic.
 *
 * Left that way deliberately: correcting it needs an `approved_at` stamp the
 * table does not have, and of the two directions to be wrong in, a figure that
 * understates how right the agent has been is the one that cannot talk anybody
 * into giving it more autonomy than it has earned.
 */
@Injectable()
export class BugHunterMetricsService {
  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly runRepository: BugHuntRunRepository,
  ) {}

  async report(windowDays: number): Promise<BugHunterMetrics> {
    const since = new Date(Date.now() - windowDays * MS_PER_DAY);

    const [rows, latency, regressionCounts, cost] = await Promise.all([
      this.findingRepository.outcomeCounts(since),
      this.findingRepository.stageLatencies(since),
      this.findingRepository.regressionCounts(since),
      this.runRepository.costInWindow(since),
    ]);

    const bySource = groupFunnels(rows, (row) => row.source);
    const byRepo = groupFunnels(rows, (row) => row.repo);
    const overall = foldFunnel('all', rows);

    return {
      windowDays,
      since: since.toISOString(),
      totalFiled: overall.filed,
      bySource,
      byRepo,
      overall,
      declines: declineBreakdown(rows),
      latency,
      regressions: {
        filed: regressionCounts.regressions,
        fixesThatFailed: regressionCounts.regressedFixes,
        rate:
          overall.merged === 0
            ? null
            : regressionCounts.regressedFixes / overall.merged,
      },
      cost: {
        totalUsd: round(cost.costUsd),
        runs: cost.runs,
        fixSessionRuns: cost.fixSessionRuns,
        fixSessionUsd: round(cost.fixSessionCostUsd),
        perMergedFixUsd:
          overall.merged === 0
            ? null
            : round(cost.fixSessionCostUsd / overall.merged),
      },
    };
  }
}

/** Two decimals. Cents matter on a per-run figure and nothing below them does. */
const round = (value: number): number => Math.round(value * 100) / 100;

const emptyFunnel = (key: string | null): FindingFunnel => ({
  key,
  filed: 0,
  dismissed: 0,
  rejected: 0,
  approved: 0,
  merged: 0,
  released: 0,
  failed: 0,
  open: 0,
  finderErrors: 0,
  reasonNotRecorded: 0,
  accuracy: null,
  lowConfidence: 0,
  unscored: 0,
});

/**
 * Statuses that mean the bug is still somewhere in the pipeline.
 *
 * Listed rather than derived as "everything else" so that a new
 * `BugFindingStatus` shows up as an uncounted row here — visibly wrong in the
 * UI — instead of being silently folded into `open` and quietly changing what
 * every rate on the page means.
 */
const OPEN_STATUSES = new Set<string>([
  BugFindingStatus.NEW,
  BugFindingStatus.PENDING_APPROVAL,
  BugFindingStatus.APPROVED,
  BugFindingStatus.QUEUED,
  BugFindingStatus.FIXING,
  BugFindingStatus.NEEDS_INPUT,
  BugFindingStatus.BLOCKED,
  BugFindingStatus.COORDINATING,
  BugFindingStatus.PR_OPENED,
  BugFindingStatus.RELEASING,
]);

const FINDER_ERROR_REASONS = new Set<string>(BUG_FINDING_FINDER_ERROR_REASONS);

const applyRow = (funnel: FindingFunnel, row: FindingOutcomeCount): void => {
  const count = Number(row.count);
  funnel.filed += count;
  funnel.lowConfidence += Number(row.lowConfidence ?? 0);
  funnel.unscored += Number(row.unscored ?? 0);

  switch (row.status) {
    case BugFindingStatus.DISMISSED:
      funnel.dismissed += count;
      break;
    case BugFindingStatus.REJECTED:
      funnel.rejected += count;
      break;
    case BugFindingStatus.MERGED:
      funnel.merged += count;
      break;
    // A released fix merged first, so it counts in both — `merged` is
    // "reached master", not "stopped at master". Without this the merge
    // figure would fall every time something shipped, and cost-per-merged-fix
    // would rise as the agent got MORE successful.
    case BugFindingStatus.RELEASED:
      funnel.merged += count;
      funnel.released += count;
      break;
    case BugFindingStatus.FAILED:
    case BugFindingStatus.RELEASE_FAILED:
    case BugFindingStatus.CANCELLED:
      funnel.failed += count;
      break;
    default:
      if (OPEN_STATUSES.has(row.status)) funnel.open += count;
      break;
  }

  // APPROVED is a status a finding passes THROUGH, so counting only rows
  // currently sitting there would report almost none. Anything that reached a
  // fix at all was approved, in AI mode implicitly.
  if (
    row.status === BugFindingStatus.APPROVED ||
    row.status === BugFindingStatus.QUEUED ||
    row.status === BugFindingStatus.FIXING ||
    row.status === BugFindingStatus.PR_OPENED ||
    row.status === BugFindingStatus.MERGED ||
    row.status === BugFindingStatus.RELEASING ||
    row.status === BugFindingStatus.RELEASED
  ) {
    funnel.approved += count;
  }

  const isDeclined =
    row.status === BugFindingStatus.DISMISSED ||
    row.status === BugFindingStatus.REJECTED;
  if (isDeclined) {
    if (row.decisionReason == null) funnel.reasonNotRecorded += count;
    else if (FINDER_ERROR_REASONS.has(row.decisionReason)) {
      funnel.finderErrors += count;
    }
  }
};

/**
 * Finishes a funnel by computing its rate.
 *
 * `judged` deliberately excludes declines whose reason was never recorded:
 * they carry no evidence about whether the finder was right, and folding them
 * in either direction would invent data. It also excludes still-open findings
 * — see the class doc.
 */
const finalise = (funnel: FindingFunnel): FindingFunnel => {
  const declinedWithReason =
    funnel.dismissed + funnel.rejected - funnel.reasonNotRecorded;
  const judged = Math.max(0, declinedWithReason) + funnel.approved;
  funnel.accuracy = judged === 0 ? null : 1 - funnel.finderErrors / judged;
  return funnel;
};

const foldFunnel = (
  key: string | null,
  rows: FindingOutcomeCount[],
): FindingFunnel => {
  const funnel = emptyFunnel(key);
  rows.forEach((row) => applyRow(funnel, row));
  return finalise(funnel);
};

const groupFunnels = (
  rows: FindingOutcomeCount[],
  keyOf: (row: FindingOutcomeCount) => string | null,
): FindingFunnel[] => {
  const byKey = new Map<string, FindingFunnel>();
  rows.forEach((row) => {
    const key = keyOf(row);
    // Map keys must be strings, but `null` is a real and meaningful value
    // here — a human-reported bug has no repo until something triages it, and
    // those are precisely the rows worth seeing as their own group.
    const mapKey = key ?? ' null';
    const funnel = byKey.get(mapKey) ?? emptyFunnel(key);
    applyRow(funnel, row);
    byKey.set(mapKey, funnel);
  });
  return [...byKey.values()]
    .map(finalise)
    .sort(
      (a, b) => b.filed - a.filed || (a.key ?? '').localeCompare(b.key ?? ''),
    );
};

const declineBreakdown = (rows: FindingOutcomeCount[]): DeclineBreakdown[] => {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    if (
      row.status !== BugFindingStatus.DISMISSED &&
      row.status !== BugFindingStatus.REJECTED
    ) {
      return;
    }
    const key = row.decisionReason ?? 'not_recorded';
    counts.set(key, (counts.get(key) ?? 0) + Number(row.count));
  });

  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason: reason as DeclineBreakdown['reason'],
      count,
      finderError: FINDER_ERROR_REASONS.has(reason),
    }))
    .sort((a, b) => b.count - a.count);
};
