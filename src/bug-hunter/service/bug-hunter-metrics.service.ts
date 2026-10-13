import { Injectable } from '@nestjs/common';

import {
  BUG_FINDING_FINDER_ERROR_REASONS,
  BUG_FINDING_OPEN_STATUSES,
  BugFindingStatus,
} from '../enum/bug-finding.enum';
import {
  BugFindingRepository,
  DailyFiledCount,
  FindingOutcomeCount,
} from '../repository/bug-finding.repository';
import {
  BugHuntRunRepository,
  DailyRunTokens,
} from '../repository/bug-hunt-run.repository';
import { BugHuntTrigger } from '../enum/bug-hunt-run.enum';

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
  /** Model tokens and cost spent by runs that STARTED that day, by trigger. Always every trigger. */
  tokens: Record<BugHuntTrigger, OperationsTokens>;
}

export interface OperationsTokens {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface BugHunterOperationsMetrics {
  windowDays: number;
  since: string;
  days: OperationsDay[];
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
 * Bug Hunter's volume, day by day — the one metric left on this service.
 *
 * Until 2026-10-12 this also computed `GET metrics`: the whole-window funnel
 * (accuracy, declines, latencies, regressions, cost per fix) the admin's
 * accuracy panel drew. That panel was retired on 5 October (OPP-0749) and the
 * weekly trends on Analytics → Bug Agent carry its figures, folded per week
 * by `BugAgentPerformanceAnalyticsService` with the funnel arithmetic that
 * stays exported from here (`foldFunnel`, `groupFunnels`). The operations
 * view was pruned the same day to the two cards somebody watches: bugs
 * filed per day beside where each cohort stands now, and spend over time by
 * what started the run (restored the same evening at the user's request).
 *
 * ## The one claim the funnel arithmetic makes about accuracy
 *
 * `accuracy = 1 - finderErrors / judged`. Two decisions are load-bearing:
 *
 *  - **Only finder-error declines count against it.** A team that declines
 *    nine real-but-minor findings has not been badly served; one that
 *    declines two hallucinated bugs has — see BUG_FINDING_FINDER_ERROR_REASONS.
 *  - **The denominator is findings somebody RULED ON**, not findings filed.
 *    An open bug is not evidence either way, and counting it as correct would
 *    make accuracy rise simply by nobody doing any triage.
 *
 * Where a reason was never recorded (every decline predating migration
 * 1946000000000) the row is reported as `reasonNotRecorded` and excluded from
 * the denominator rather than guessed at. `approved` is inferred from a
 * finding having reached a fix stage, which makes the rate very slightly
 * pessimistic — the direction that cannot talk anybody into widening the
 * agent's autonomy.
 */
@Injectable()
export class BugHunterMetricsService {
  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly runRepository: BugHuntRunRepository,
  ) {}

  /**
   * The volume view: what gets filed each day, beside where it stands now.
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
    const [filed, tokens] = await Promise.all([
      this.findingRepository.dailyFiledCounts(since),
      this.runRepository.dailyTokens(since),
    ]);
    return buildOperations(windowDays, since, filed, tokens);
  }
}

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

// ── operations view ───────────────────────────────────────────────────────

/** Two decimals. Cents matter on a per-run figure and nothing below them does. */
const round = (value: number): number => Math.round(value * 100) / 100;

const emptyTokens = (): OperationsTokens => ({
  runs: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
});

const emptyDay = (date: string): OperationsDay => ({
  date,
  filed: 0,
  accepted: 0,
  declined: 0,
  undecided: 0,
  tokens: {
    [BugHuntTrigger.SCHEDULED]: emptyTokens(),
    [BugHuntTrigger.MANUAL]: emptyTokens(),
    [BugHuntTrigger.FIX_SESSION]: emptyTokens(),
    [BugHuntTrigger.VERIFY_FIX]: emptyTokens(),
    [BugHuntTrigger.VERIFY_FINDINGS]: emptyTokens(),
    [BugHuntTrigger.PR_REVIEW]: emptyTokens(),
    [BugHuntTrigger.FEATURE_MAP]: emptyTokens(),
  },
});

/** `YYYY-MM-DD` in UTC, matching the repositories' `to_char` on a UTC-stored timestamp. */
const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Exported for the spec: pure arithmetic over the two repository reads, so
 * the tests exercise exactly what the endpoint returns without a database.
 */
export const buildOperations = (
  windowDays: number,
  since: Date,
  filed: DailyFiledCount[],
  tokens: DailyRunTokens[],
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
  filed.forEach((row) => {
    // The repository still returns one row per (day, source, proven) cell;
    // the view sums them. A row outside the axis (clock skew, a run stamped
    // in the future) is dropped rather than given a day the chart does not
    // draw — but it still counts in the window totals, which the takeaway
    // reads.
    const day = days.get(row.day);
    for (const target of day ? [day, totals] : [totals]) {
      target.filed += Number(row.filed);
      target.accepted += Number(row.accepted);
      target.declined += Number(row.declined);
      target.undecided += Number(row.undecided);
    }
  });

  // Spend: one cell per (day, trigger). A row outside the axis still counts
  // in the window totals — it is a real run — even though no day draws it.
  tokens.forEach((row) => {
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.costUsd += row.costUsd;
    totals.runs += row.runs;
    const day = days.get(row.day);
    if (!day) return;
    const cell = day.tokens[row.trigger] ?? emptyTokens();
    cell.runs += row.runs;
    cell.inputTokens += row.inputTokens;
    cell.outputTokens += row.outputTokens;
    cell.costUsd += row.costUsd;
    day.tokens[row.trigger] = cell;
  });
  totals.costUsd = round(totals.costUsd);
  days.forEach((day) => {
    Object.values(day.tokens).forEach((cell) => {
      cell.costUsd = round(cell.costUsd);
    });
  });

  return {
    windowDays,
    since: since.toISOString(),
    days: [...days.values()],
    totals,
  };
};
