import { Injectable } from '@nestjs/common';

import {
  BUG_FINDING_FINDER_ERROR_REASONS,
  BUG_FINDING_OPEN_STATUSES,
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
} from '../enum/bug-finding.enum';
import {
  BugFindingRepository,
  DailyFiledCount,
  FindingOutcomeCount,
  ReporterCount,
  StageLatency,
} from '../repository/bug-finding.repository';
import {
  BugHuntRunRepository,
  DailyRunTokens,
  ModelTokens,
} from '../repository/bug-hunt-run.repository';
import { BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import {
  BugHuntEventRepository,
  EscalationBreakdown,
} from '../repository/bug-hunt-event.repository';

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
  /** Finder-error dismissals later proven wrong by a same-dedupe-key finding shipping — see `reversed_at`. */
  reversed: number;
  /**
   * `reversed / finderErrors` — the correction to the raw error rate. Null
   * when nothing was ever dismissed as a finder error: 0/0 is not "0%
   * reversed", it is "nothing to reverse yet".
   */
  reversalRate: number | null;
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
  /**
   * Escalations in the window, grouped by their exact summary text — see
   * BugHuntEventRepository.escalationBreakdown's own doc for why the raw
   * string is already a clean-enough grouping for 3 of the 4 escalation
   * paths today.
   */
  escalations: EscalationBreakdown[];
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

/** One calendar day of the operations view. Dense: every day in the window is present. */
export interface OperationsDay {
  /** `YYYY-MM-DD` in the database's clock (UTC). */
  date: string;
  /** New findings filed that day, child steps excluded. Re-discoveries touch an existing row and so do not count. */
  filed: number;
  /** Of `filed`, how many have since reached a fix stage or beyond. */
  accepted: number;
  /** Of `filed`, how many a verifier or a human has since declined. */
  declined: number;
  /** Of `filed`, how many are still new or pending approval. */
  undecided: number;
  /** `filed` split by finding source. Sources with nothing that day are absent. */
  bySource: Record<string, number>;
  /** `filed` split by how hard the bug was to spot — see `difficultyOf`. Always all three keys. */
  byDifficulty: Record<OperationsDifficulty, OperationsOutcomes>;
  /** Model tokens spent by runs that STARTED that day, by trigger. */
  tokens: Record<BugHuntTrigger, OperationsTokens>;
  /**
   * How much code the sweeps that started that day were shown. Null when no
   * run that day reported breadth — telemetry shipped 2026-09-23 and fix
   * sessions never post it — which is "not recorded", not zero.
   */
  breadth: OperationsBreadth | null;
}

/**
 * How hard a bug was to spot, derived rather than stored.
 *
 * Nothing on a finding says "easy" or "hard", and asking the agent to rate
 * its own findings would be unreliable. Two columns it does carry settle it:
 *
 *  - `easy`: `proven` — a failing test, a lint error, a recurring log or
 *    browser error. The tool output IS the bug; no judgement was needed.
 *  - `hard`: unproven and agent-found — a code-review read, a UX signal. The
 *    agent inferred it and two verifiers had to be convinced.
 *  - `reported`: a person filed it. The agent did not spot it at all, so it
 *    belongs in neither bucket and would distort both.
 */
export type OperationsDifficulty = 'easy' | 'hard' | 'reported';

export interface OperationsOutcomes {
  filed: number;
  accepted: number;
  declined: number;
  undecided: number;
}

export interface OperationsBreadth {
  /** Runs that day that reported breadth at all. */
  runs: number;
  linesInScope: number;
  filesInScope: number;
  commits: number;
  /** Runs that read the whole repo rather than the day's diff. */
  deepRuns: number;
}

export interface OperationsTokens {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface OperationsSourceTotal {
  source: string;
  filed: number;
  accepted: number;
  declined: number;
  undecided: number;
}

export interface OperationsDifficultyTotal extends OperationsOutcomes {
  difficulty: OperationsDifficulty;
}

export interface BugHunterOperationsMetrics {
  windowDays: number;
  since: string;
  days: OperationsDay[];
  /** Window totals per source, most filed first. */
  bySource: OperationsSourceTotal[];
  /** Window totals by difficulty. Always easy, hard, reported, in that order. */
  byDifficulty: OperationsDifficultyTotal[];
  /** Window breadth over every run that reported it, or null when none did. */
  breadth: OperationsBreadth | null;
  /** Window totals by who raised the bug. Always all three parties, zeros included. */
  byReporter: ReporterCount[];
  /** Window totals per model, most tokens first. Empty until the CI runner has reported usage. */
  tokensByModel: ModelTokens[];
  totals: {
    filed: number;
    accepted: number;
    declined: number;
    undecided: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    runs: number;
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
    private readonly eventRepository: BugHuntEventRepository,
  ) {}

  /**
   * The volume view: what gets filed each day, where it comes from, who
   * raised it, and what the models cost — the operational counterpart to
   * `report`, which judges outcomes.
   *
   * Every volume figure is paired with where that cohort stands now
   * (`accepted` / `declined` / `undecided`). A bar of "12 bugs found" says
   * nothing on its own: twelve that were all dismissed is a noisy finder,
   * twelve that mostly shipped is a good night. The panel is asked to draw
   * the second number beside the first, and this returns them together so it
   * cannot draw one without the other.
   *
   * Days are dense — every calendar day in the window is present, zeros
   * included — for the reason `scorecard.ts` gives: a day Bug Hunter did
   * nothing is a real observation, and a chart that omits it draws four busy
   * days as a straight line.
   */
  async operations(windowDays: number): Promise<BugHunterOperationsMetrics> {
    const since = new Date(Date.now() - windowDays * MS_PER_DAY);

    const [filed, reporters, tokens, models] = await Promise.all([
      this.findingRepository.dailyFiledCounts(since),
      this.findingRepository.reporterCounts(since),
      this.runRepository.dailyTokens(since),
      this.runRepository.tokensByModel(since),
    ]);

    return buildOperations(windowDays, since, filed, reporters, tokens, models);
  }

  async report(windowDays: number): Promise<BugHunterMetrics> {
    const since = new Date(Date.now() - windowDays * MS_PER_DAY);

    const [rows, latency, regressionCounts, cost, escalations] =
      await Promise.all([
        this.findingRepository.outcomeCounts(since),
        this.findingRepository.stageLatencies(since),
        this.findingRepository.regressionCounts(since),
        this.runRepository.costInWindow(since),
        this.eventRepository.escalationBreakdown(since),
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
      escalations,
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
  reversed: 0,
  reversalRate: null,
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
  ...BUG_FINDING_OPEN_STATUSES,
  // Open for THIS question — "does the user have the fix yet" — though not
  // for the repository's dedupe question, where a fix already on master
  // makes a re-discovery a regression. See BUG_FINDING_OPEN_STATUSES.
  BugFindingStatus.RELEASING,
]);

const FINDER_ERROR_REASONS = new Set<string>(BUG_FINDING_FINDER_ERROR_REASONS);

const applyRow = (funnel: FindingFunnel, row: FindingOutcomeCount): void => {
  const count = Number(row.count);
  funnel.filed += count;
  funnel.lowConfidence += Number(row.lowConfidence ?? 0);
  funnel.unscored += Number(row.unscored ?? 0);
  funnel.reversed += Number(row.reversed ?? 0);

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
  funnel.reversalRate =
    funnel.finderErrors === 0 ? null : funnel.reversed / funnel.finderErrors;
  return funnel;
};

/**
 * Exported for `BugAgentPerformanceAnalyticsService`: folding one week's
 * `WeeklyFindingOutcomeCount` rows into a funnel is the exact same arithmetic
 * as folding one window's `FindingOutcomeCount` rows — the row shapes only
 * differ by an extra `week` field this function never reads. Kept as one
 * definition rather than a second copy of `applyRow`/`finalise` for a
 * trend chart to drift out of sync with.
 */
export const foldFunnel = (
  key: string | null,
  rows: FindingOutcomeCount[],
): FindingFunnel => {
  const funnel = emptyFunnel(key);
  rows.forEach((row) => applyRow(funnel, row));
  return finalise(funnel);
};

export const groupFunnels = (
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

// ── operations view ───────────────────────────────────────────────────────

const REPORTERS: ReporterCount['reporter'][] = ['agent', 'staff', 'consumer'];

const emptyTokens = (): OperationsTokens => ({
  runs: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
});

const DIFFICULTIES: OperationsDifficulty[] = ['easy', 'hard', 'reported'];

const emptyOutcomes = (): OperationsOutcomes => ({
  filed: 0,
  accepted: 0,
  declined: 0,
  undecided: 0,
});

const emptyDay = (date: string): OperationsDay => ({
  date,
  filed: 0,
  accepted: 0,
  declined: 0,
  undecided: 0,
  bySource: {},
  byDifficulty: {
    easy: emptyOutcomes(),
    hard: emptyOutcomes(),
    reported: emptyOutcomes(),
  },
  tokens: {
    [BugHuntTrigger.SCHEDULED]: emptyTokens(),
    [BugHuntTrigger.MANUAL]: emptyTokens(),
    [BugHuntTrigger.FIX_SESSION]: emptyTokens(),
    [BugHuntTrigger.VERIFY_FIX]: emptyTokens(),
    [BugHuntTrigger.VERIFY_FINDINGS]: emptyTokens(),
    [BugHuntTrigger.PR_REVIEW]: emptyTokens(),
  },
  breadth: null,
});

/** See `OperationsDifficulty`. Exported for the spec. */
export const difficultyOf = (
  source: string,
  proven: boolean,
): OperationsDifficulty => {
  if (source === BugFindingSource.REPORTED_BUG) return 'reported';
  return proven ? 'easy' : 'hard';
};

const addOutcomes = (
  into: OperationsOutcomes,
  row: {
    filed: unknown;
    accepted: unknown;
    declined: unknown;
    undecided: unknown;
  },
): void => {
  into.filed += Number(row.filed);
  into.accepted += Number(row.accepted);
  into.declined += Number(row.declined);
  into.undecided += Number(row.undecided);
};

const addBreadth = (
  into: OperationsBreadth | null,
  row: DailyRunTokens,
): OperationsBreadth | null => {
  if (row.breadthRuns === 0) return into;
  const target = into ?? {
    runs: 0,
    linesInScope: 0,
    filesInScope: 0,
    commits: 0,
    deepRuns: 0,
  };
  target.runs += row.breadthRuns;
  target.linesInScope += row.linesInScope;
  target.filesInScope += row.filesInScope;
  target.commits += row.commits;
  target.deepRuns += row.deepRuns;
  return target;
};

/** `YYYY-MM-DD` in UTC, matching the repositories' `to_char` on a UTC-stored timestamp. */
const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Exported for the spec: pure arithmetic over the four repository results,
 * so the tests exercise exactly what the endpoint returns without a database.
 */
export const buildOperations = (
  windowDays: number,
  since: Date,
  filed: DailyFiledCount[],
  reporters: ReporterCount[],
  tokens: DailyRunTokens[],
  models: ModelTokens[],
  now: Date = new Date(),
): BugHunterOperationsMetrics => {
  // Dense day axis, oldest first, from the window's first day through today.
  const days = new Map<string, OperationsDay>();
  const start = Date.UTC(
    since.getUTCFullYear(),
    since.getUTCMonth(),
    since.getUTCDate(),
  );
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  for (let time = start; time <= end; time += MS_PER_DAY) {
    const key = utcDay(new Date(time));
    days.set(key, emptyDay(key));
  }
  // A row outside the axis (clock skew, a run stamped in the future) is
  // dropped rather than given a day the chart does not draw.
  const dayFor = (key: string): OperationsDay | undefined => days.get(key);

  const sourceTotals = new Map<string, OperationsSourceTotal>();
  const difficultyTotals: Record<OperationsDifficulty, OperationsOutcomes> = {
    easy: emptyOutcomes(),
    hard: emptyOutcomes(),
    reported: emptyOutcomes(),
  };
  filed.forEach((row) => {
    const day = dayFor(row.day);
    const count = Number(row.filed);
    // Postgres hands a boolean column back as a boolean, but a raw row from a
    // mock or a driver quirk can carry the string — accept both.
    const proven = row.proven === true || String(row.proven) === 'true';
    const difficulty = difficultyOf(row.source, proven);
    addOutcomes(difficultyTotals[difficulty], row);
    if (day) {
      addOutcomes(day, row);
      day.bySource[row.source] = (day.bySource[row.source] ?? 0) + count;
      addOutcomes(day.byDifficulty[difficulty], row);
    }
    const total = sourceTotals.get(row.source) ?? {
      source: row.source,
      filed: 0,
      accepted: 0,
      declined: 0,
      undecided: 0,
    };
    total.filed += count;
    total.accepted += Number(row.accepted);
    total.declined += Number(row.declined);
    total.undecided += Number(row.undecided);
    sourceTotals.set(row.source, total);
  });

  let breadth: OperationsBreadth | null = null;
  tokens.forEach((row) => {
    breadth = addBreadth(breadth, row);
    const day = dayFor(row.day);
    if (!day) return;
    const cell = day.tokens[row.trigger] ?? emptyTokens();
    cell.runs += row.runs;
    cell.inputTokens += row.inputTokens;
    cell.outputTokens += row.outputTokens;
    cell.costUsd += row.costUsd;
    day.tokens[row.trigger] = cell;
    day.breadth = addBreadth(day.breadth, row);
  });

  const totals = {
    filed: 0,
    accepted: 0,
    declined: 0,
    undecided: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    runs: 0,
  };
  sourceTotals.forEach((total) => {
    totals.filed += total.filed;
    totals.accepted += total.accepted;
    totals.declined += total.declined;
    totals.undecided += total.undecided;
  });
  tokens.forEach((row) => {
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.costUsd += row.costUsd;
    totals.runs += row.runs;
  });
  totals.costUsd = round(totals.costUsd);
  days.forEach((day) => {
    Object.values(day.tokens).forEach((cell) => {
      cell.costUsd = round(cell.costUsd);
    });
  });

  // All three parties, always, so the chart never silently drops "consumer"
  // on an install where nobody has used the report form yet — a zero there
  // is a fact worth seeing.
  const byReporter = REPORTERS.map(
    (reporter) =>
      reporters.find((row) => row.reporter === reporter) ?? {
        reporter,
        filed: 0,
        accepted: 0,
        declined: 0,
      },
  );

  return {
    windowDays,
    since: since.toISOString(),
    days: [...days.values()],
    bySource: [...sourceTotals.values()].sort(
      (a, b) => b.filed - a.filed || a.source.localeCompare(b.source),
    ),
    byDifficulty: DIFFICULTIES.map((difficulty) => ({
      difficulty,
      ...difficultyTotals[difficulty],
    })),
    breadth,
    byReporter,
    tokensByModel: [...models].sort(
      (a, b) =>
        b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
    ),
    totals,
  };
};
