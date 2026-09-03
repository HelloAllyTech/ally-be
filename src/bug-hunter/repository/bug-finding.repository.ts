import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';

import { BugFinding } from '../entity/bug-finding.entity';
import {
  BUG_FINDING_FINDER_ERROR_REASONS,
  BugFindingDecisionReason,
  BugFindingStatus,
} from '../enum/bug-finding.enum';
import { BUG_HUNT_LOW_CONFIDENCE_THRESHOLD } from '../constants/bug-hunter.constants';

/** Statuses that mean "still open" — a matching dedupe key under one of these is the same bug, not a new one. */
const OPEN_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.NEW,
  BugFindingStatus.PENDING_APPROVAL,
  BugFindingStatus.APPROVED,
  // A dispatched-but-not-yet-started fix session is as open as one already
  // running — a sweep that rediscovers the bug in the meantime must touch that
  // row, not open a second one alongside it.
  BugFindingStatus.QUEUED,
  BugFindingStatus.FIXING,
  BugFindingStatus.NEEDS_INPUT,
  BugFindingStatus.PR_OPENED,
];

/**
 * Statuses that mean "somebody already said no to this".
 *
 * The counterpart to OPEN_STATUSES, and deliberately a separate set rather
 * than "everything not open": MERGED and RELEASED are also not open, and a
 * dedupe hit against one of THOSE means something completely different — a
 * regression, not a settled argument (see SHIPPED_STATUSES).
 */
const DECLINED_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.REJECTED,
  BugFindingStatus.DISMISSED,
];

/**
 * Statuses that mean "we fixed this".
 *
 * MERGED as well as RELEASED, because a bug reappearing between merge and
 * release is still the fix having failed to hold — for the frontends a merge
 * to master is often what a developer would call shipped, and ally-mobile
 * never reaches RELEASED at all.
 */
const SHIPPED_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.MERGED,
  BugFindingStatus.RELEASED,
];

/** One previously-declined bug, condensed for the sweep prompt's "known non-bugs" block. */
export interface DeclinedFindingSummary {
  title: string;
  file: string | null;
  symbol: string | null;
  reason: BugFindingDecisionReason;
  note: string | null;
}

/** Counts for one (source, repo) cell of the metrics report. */
export interface FindingOutcomeCount {
  source: string;
  repo: string | null;
  status: string;
  decisionReason: string | null;
  /** Findings whose stored confidence is below the low-confidence threshold. */
  lowConfidence: number;
  /** Findings carrying no confidence at all — proven ones, and rows predating verifier scoring. */
  unscored: number;
  count: number;
}

/** How long findings sat between two lifecycle stamps, in hours. */
export interface StageLatency {
  /** Median, not mean: one bug that sat for three weeks should not describe the other twenty. */
  medianHours: number | null;
  p90Hours: number | null;
  /** Rows the median is computed from — a median over two findings is not a latency. */
  sampled: number;
}

export interface ListBugFindingsFilter {
  status?: BugFindingStatus;
  source?: string;
  repo?: string;
  /**
   * Only the findings one sweep touched — the shift log's "Found N" made
   * clickable.
   *
   * Server-side rather than client-side on the loaded window, and that is the
   * whole point of it. `runId` is stamped on a row every time a run touches it,
   * INCLUDING a re-triage of a human-reported bug that was filed weeks ago (see
   * BugFindingService.persistFindings), so a run's findings are scattered
   * arbitrarily far down a table ordered by `createdAt`. Filtering the newest-N
   * window in the browser would have shown 2 of a run's 10 and called it 2.
   */
  runId?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class BugFindingRepository extends Repository<BugFinding> {
  constructor(dataSource: DataSource) {
    super(BugFinding, dataSource.createEntityManager());
  }

  /**
   * Hashed identity for "this is the same bug" — stable across runs so a
   * still-open finding never gets a second row.
   *
   * Keyed on the code coordinate plus the finder class, NOT on the finder's
   * prose. `description` is LLM-generated: it used to be hashed directly, so
   * the same bug described differently on a later night produced a different
   * key and a duplicate row. The sweep was manufacturing its own noise.
   *
   * `symbol` (function/class/route/component) is the stable discriminator.
   * When a finder does not supply one we fall back to a normalised
   * *fingerprint* of the description rather than its raw text — that still
   * collapses rewordings, while keeping two genuinely different bugs in the
   * same file apart. Dropping description entirely would collapse every
   * code-review finding in a large file into one row, which is worse than the
   * bug being fixed here.
   *
   * `repo` is deliberately not hashed in: it stays a separate, indexed WHERE
   * clause in findOpenByDedupeKey, so the same bug in two repos reads as two
   * findings without needing two hashes.
   */
  static dedupeKey(
    file: string | null | undefined,
    source: string,
    symbol?: string | null,
    description?: string | null,
  ): string {
    const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
    const discriminator = symbol?.trim()
      ? norm(symbol)
      : BugFindingRepository.descriptionFingerprint(description ?? '');
    const normalized = `${norm(file ?? '')}::${norm(source)}::${discriminator}`;
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * A prose-insensitive fingerprint of a finding description, used only when
   * the finder gave us no `symbol`.
   *
   * Strips the parts an LLM varies between runs while describing the same
   * defect — digits (line numbers, counts), quoted literals, punctuation and
   * common filler words — then sorts the surviving tokens so word order stops
   * mattering. Two descriptions of one bug converge; descriptions of two
   * different bugs keep different token sets.
   *
   * Not exact, and not meant to be: this is the fallback path. Finders that
   * emit `symbol` bypass it entirely and dedupe precisely.
   */
  static descriptionFingerprint(description: string): string {
    const STOPWORDS = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'and',
      'or',
      'but',
      'if',
      'then',
      'than',
      'that',
      'this',
      'these',
      'those',
      'it',
      'its',
      'as',
      'by',
      'from',
      'not',
      'no',
      'never',
      'always',
      'should',
      'would',
      'will',
      'can',
      'could',
      'may',
      'might',
      'must',
      'does',
      'do',
      'did',
      'has',
      'have',
      'had',
      'when',
      'which',
      'while',
      'because',
      'so',
      'there',
      // Structural filler: once digits are stripped, "line 88" and "at file
      // foo" leave behind words that say nothing about WHICH bug this is.
      'line',
      'lines',
      'file',
      'column',
      'col',
      'code',
      'method',
      'function',
      'here',
      'also',
      'currently',
      'instead',
      'rather',
      'actually',
    ]);

    /**
     * Crude suffix stripping, not real stemming. Exists for one reason: the
     * commonest way two descriptions of one bug differ is verb form —
     * "retries"/"retry", "resets"/"reset", "leaking"/"leaks". A full stemmer
     * would be a dependency and far more aggression than this needs.
     */
    const stem = (t: string): string => {
      if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
      for (const suffix of ['ing', 'ed', 'es', 's']) {
        if (t.length > suffix.length + 2 && t.endsWith(suffix)) {
          return t.slice(0, -suffix.length);
        }
      }
      return t;
    };

    const tokens = description
      .toLowerCase()
      // Quoted literals vary in quoting style between runs; keep the words.
      .replace(/["'`]/g, ' ')
      // Line/column numbers and counts are the single most-varied part.
      .replace(/\d+/g, ' ')
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
      .map(stem);

    // Sorted + de-duplicated: word order and repetition must not change identity.
    const unique = Array.from(new Set(tokens)).sort();
    return unique.join(' ');
  }

  /** The open row for this exact bug in this repo, if one already exists — see class-level OPEN_STATUSES. */
  findOpenByDedupeKey(
    repo: string,
    dedupeKey: string,
  ): Promise<BugFinding | null> {
    return this.createQueryBuilder('f')
      .where('f.repo = :repo', { repo })
      .andWhere('f.dedupeKey = :dedupeKey', { dedupeKey })
      .andWhere('f.status IN (:...statuses)', { statuses: OPEN_STATUSES })
      .getOne();
  }

  /**
   * The most recently DECLINED row for this exact bug in this repo, if one was
   * declined since `since`.
   *
   * The sibling of `findOpenByDedupeKey` for the other half of the dedupe
   * question. Without it a sweep re-filed every refuted or rejected finding
   * the moment it re-read the same code, so the reviewer's own decision had a
   * lifetime of one night and the queue filled with arguments already settled.
   *
   * Ordered by decision date, newest first: a bug may have been declined more
   * than once over months, and the standing decision is the last one.
   */
  findRecentlyDeclinedByDedupeKey(
    repo: string,
    dedupeKey: string,
    since: Date,
  ): Promise<BugFinding | null> {
    return (
      this.createQueryBuilder('f')
        .where('f.repo = :repo', { repo })
        .andWhere('f.dedupeKey = :dedupeKey', { dedupeKey })
        .andWhere('f.status IN (:...statuses)', { statuses: DECLINED_STATUSES })
        // `decidedAt` is null on a verifier dismissal (no human decided it), so
        // fall back to the row's own update stamp rather than dropping those —
        // a refuted finding is exactly the kind that gets re-filed nightly.
        .andWhere('COALESCE(f.decidedAt, f."updatedAt") >= :since', { since })
        .orderBy('COALESCE(f.decidedAt, f."updatedAt")', 'DESC')
        .getOne()
    );
  }

  /**
   * The most recent row for this bug that was already FIXED, if it shipped
   * since `since` — i.e. this "new" finding is the fix coming undone.
   *
   * Seen live and the reason this exists: a shutdown race in ally-ai-learn was
   * fixed and released on 28 August, kept firing in production, and the 2
   * September sweep filed it again as an ordinary new bug. Both rows were
   * correct in isolation and neither said the thing that mattered.
   */
  findRecentlyShippedByDedupeKey(
    repo: string,
    dedupeKey: string,
    since: Date,
  ): Promise<BugFinding | null> {
    return (
      this.createQueryBuilder('f')
        .where('f.repo = :repo', { repo })
        .andWhere('f.dedupeKey = :dedupeKey', { dedupeKey })
        .andWhere('f.status IN (:...statuses)', { statuses: SHIPPED_STATUSES })
        // releasedAt is null for a MERGED-but-unreleased fix, so the update
        // stamp stands in — same reasoning as the decline lookup above.
        .andWhere('COALESCE(f.releasedAt, f."updatedAt") >= :since', { since })
        .orderBy('COALESCE(f.releasedAt, f."updatedAt")', 'DESC')
        .getOne()
    );
  }

  /**
   * Recent declines for one repo where the FINDER was judged wrong, newest
   * first — the sweep prompt's "known non-bugs" block.
   *
   * Filtered to `BUG_FINDING_FINDER_ERROR_REASONS` on purpose. Telling a sweep
   * "you were wrong about this" only helps when somebody actually concluded
   * that; showing it a list of real bugs the team chose not to fix would teach
   * it to stop reporting real bugs, which is the opposite of the intent. See
   * that constant's doc.
   */
  listRecentFinderErrors(
    repo: string,
    since: Date,
    limit: number,
  ): Promise<BugFinding[]> {
    return (
      this.createQueryBuilder('f')
        .where('f.repo = :repo', { repo })
        .andWhere('f.status IN (:...statuses)', { statuses: DECLINED_STATUSES })
        // `f.decision_reason`, not `f.decisionReason`: the metrics query below
        // has to name the raw column (TypeORM's `select()` cannot resolve a
        // property there), and having the two spellings side by side in one file
        // is how somebody later "fixes" the working one. Both forms compile —
        // this is about them agreeing.
        .andWhere('f.decision_reason IN (:...reasons)', {
          reasons: BUG_FINDING_FINDER_ERROR_REASONS,
        })
        .andWhere('COALESCE(f.decidedAt, f."updatedAt") >= :since', { since })
        .orderBy('COALESCE(f.decidedAt, f."updatedAt")', 'DESC')
        .take(limit)
        .getMany()
    );
  }

  /** The NEW, not-yet-triaged row for a human-reported bug — see RoadmapOpportunityService.create. */
  findByReportedBugId(reportedBugId: string): Promise<BugFinding | null> {
    return this.findOne({ where: { reportedBugId } });
  }

  /**
   * Findings stuck at NEEDS_INPUT with a question nobody has answered, last
   * touched before `before`.
   *
   * Drives the stale-question digest. The `before` cutoff is what stops a
   * question asked ten minutes ago being reported as neglected — an admin may
   * simply not have looked yet.
   */
  listStaleNeedsInput(before: Date): Promise<BugFinding[]> {
    return this.createQueryBuilder('f')
      .where('f.status = :status', { status: BugFindingStatus.NEEDS_INPUT })
      .andWhere('f.escalationQuestion IS NOT NULL')
      .andWhere('f.escalationAnswer IS NULL')
      .andWhere('f."updatedAt" < :before', { before })
      .orderBy('f."updatedAt"', 'ASC')
      .getMany();
  }

  /** Human-reported bugs still at NEW — the reported-bugs finder's read queue (see BugHunterFinderDataService). */
  listNewReportedBugs(limit = 50): Promise<BugFinding[]> {
    return this.find({
      where: {
        source: 'reported_bug' as BugFinding['source'],
        status: BugFindingStatus.NEW,
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Manual-mode findings an admin has approved for this repo, waiting for the Fix phase to pick them up. */
  listApprovedForRepo(repo: string): Promise<BugFinding[]> {
    return this.find({
      where: { repo, status: BugFindingStatus.APPROVED },
      order: { decidedAt: 'ASC' },
    });
  }

  /** A coordinated fix's steps, always in plan order — the order IS the contract. */
  listChildren(parentFindingId: string): Promise<BugFinding[]> {
    return this.find({
      where: { parentFindingId },
      order: { stepIndex: 'ASC' },
    });
  }

  /** Every parent whose plan is still being worked through — the orchestrator's queue. */
  listCoordinatingParents(): Promise<BugFinding[]> {
    return this.find({
      where: { status: BugFindingStatus.COORDINATING },
      order: { createdAt: 'ASC' },
    });
  }

  /** Parents mid-release, whose steps are being deployed one at a time. */
  listReleasingParents(): Promise<BugFinding[]> {
    return this.createQueryBuilder('f')
      .where('f.status = :status', { status: BugFindingStatus.RELEASING })
      .andWhere(
        'EXISTS (SELECT 1 FROM bug_findings c WHERE c.parent_finding_id = f.id)',
      )
      .orderBy('f."createdAt"', 'ASC')
      .getMany();
  }

  // ── metrics (see BugHunterMetricsService) ────────────────────────────────

  /**
   * Every finding created in the window, tallied by source, repo, status and
   * decision reason, with the low-confidence split alongside.
   *
   * ONE grouped query rather than a count per cell. The alternative — a
   * `count()` per (source × repo × status) — is 7 × 6 × 17 round trips to
   * render one panel, and every one of them would have to agree on the same
   * window boundary to be addable.
   *
   * Windowed on `createdAt`, i.e. cohorted by DISCOVERY rather than by
   * decision, and that choice is the whole honesty of the report: a bug found
   * on the 1st and rejected on the 20th belongs to the 1st's cohort, so
   * "filed" and "of those, declined" share a denominator and a rate over them
   * means something. Grouping by decision date instead would divide this
   * month's decisions by this month's discoveries, which are different bugs.
   */
  outcomeCounts(since: Date): Promise<FindingOutcomeCount[]> {
    return (
      this.createQueryBuilder('f')
        .select('f.source', 'source')
        .addSelect('f.repo', 'repo')
        .addSelect('f.status', 'status')
        .addSelect('f.decision_reason', 'decisionReason')
        .addSelect('COUNT(*)::int', 'count')
        // `metadata->>'confidence'` is text; NULLIF guards a stored empty string
        // and the ::numeric cast is safe only because the writer is our own
        // PATCH handler, which validates it as a number first.
        .addSelect(
          `COUNT(*) FILTER (
           WHERE NULLIF(f.metadata->>'confidence', '') IS NOT NULL
             AND (f.metadata->>'confidence')::numeric < :threshold
         )::int`,
          'lowConfidence',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE NULLIF(f.metadata->>'confidence', '') IS NULL)::int`,
          'unscored',
        )
        // Child steps excluded for the same reason the table hides them: a
        // coordinated three-repo fix is ONE bug, and counting its steps would
        // inflate both the numerator and the denominator unevenly.
        .where('f.parentFindingId IS NULL')
        .andWhere('f."createdAt" >= :since', { since })
        .setParameter('threshold', BUG_HUNT_LOW_CONFIDENCE_THRESHOLD)
        .groupBy('f.source')
        .addGroupBy('f.repo')
        .addGroupBy('f.status')
        .addGroupBy('f.decision_reason')
        .getRawMany<FindingOutcomeCount>()
    );
  }

  /**
   * How long findings took to go from filed to merged, and from merged to
   * released.
   *
   * The merge moment is read from the finding's own event timeline
   * (`bug_hunt_events`, stage `merged`) because there is no `merged_at`
   * column — the row records `releasedAt` and `decidedAt` and nothing in
   * between. Using the event rather than adding a column keeps this a read of
   * data the pipeline already writes on every merge path, including the ones
   * that never touch a status handler.
   *
   * Median and p90 rather than a mean: a single bug that sat unmerged over a
   * holiday weekend would otherwise describe the whole month.
   */
  async stageLatencies(since: Date): Promise<{
    filedToMerged: StageLatency;
    mergedToReleased: StageLatency;
    filedToDecided: StageLatency;
  }> {
    const rows = await this.manager.query<
      Array<{
        filed_to_merged_median: string | null;
        filed_to_merged_p90: string | null;
        filed_to_merged_n: string;
        merged_to_released_median: string | null;
        merged_to_released_p90: string | null;
        merged_to_released_n: string;
        filed_to_decided_median: string | null;
        filed_to_decided_p90: string | null;
        filed_to_decided_n: string;
      }>
    >(
      `
      WITH scoped AS (
        SELECT
          f.id,
          f."createdAt"      AS filed_at,
          f.decided_at       AS decided_at,
          f.released_at      AS released_at,
          (
            SELECT MIN(e."createdAt")
            FROM bug_hunt_events e
            WHERE e.finding_id = f.id AND e.stage = 'merged'
          ) AS merged_at
        FROM bug_findings f
        WHERE f.parent_finding_id IS NULL
          AND f."createdAt" >= $1
      ),
      hours AS (
        SELECT
          EXTRACT(EPOCH FROM (merged_at - filed_at)) / 3600      AS filed_to_merged,
          EXTRACT(EPOCH FROM (released_at - merged_at)) / 3600   AS merged_to_released,
          EXTRACT(EPOCH FROM (decided_at - filed_at)) / 3600     AS filed_to_decided
        FROM scoped
      )
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY filed_to_merged)
          FILTER (WHERE filed_to_merged IS NOT NULL AND filed_to_merged >= 0)   AS filed_to_merged_median,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY filed_to_merged)
          FILTER (WHERE filed_to_merged IS NOT NULL AND filed_to_merged >= 0)   AS filed_to_merged_p90,
        COUNT(*) FILTER (WHERE filed_to_merged IS NOT NULL AND filed_to_merged >= 0) AS filed_to_merged_n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY merged_to_released)
          FILTER (WHERE merged_to_released IS NOT NULL AND merged_to_released >= 0) AS merged_to_released_median,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY merged_to_released)
          FILTER (WHERE merged_to_released IS NOT NULL AND merged_to_released >= 0) AS merged_to_released_p90,
        COUNT(*) FILTER (WHERE merged_to_released IS NOT NULL AND merged_to_released >= 0) AS merged_to_released_n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY filed_to_decided)
          FILTER (WHERE filed_to_decided IS NOT NULL AND filed_to_decided >= 0)  AS filed_to_decided_median,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY filed_to_decided)
          FILTER (WHERE filed_to_decided IS NOT NULL AND filed_to_decided >= 0)  AS filed_to_decided_p90,
        COUNT(*) FILTER (WHERE filed_to_decided IS NOT NULL AND filed_to_decided >= 0) AS filed_to_decided_n
      FROM hours
      `,
      [since],
    );

    // A negative interval would mean a merge event stamped before the finding
    // it belongs to, which is clock skew rather than a fast fix — filtered out
    // in SQL above rather than clamped here, so it lowers `sampled` visibly
    // instead of silently reporting zero hours.
    const row = rows[0];
    const latency = (
      median: string | null,
      p90: string | null,
      n: string | undefined,
    ): StageLatency => ({
      medianHours: median == null ? null : Number(median),
      p90Hours: p90 == null ? null : Number(p90),
      sampled: Number(n ?? 0),
    });

    return {
      filedToMerged: latency(
        row?.filed_to_merged_median ?? null,
        row?.filed_to_merged_p90 ?? null,
        row?.filed_to_merged_n,
      ),
      mergedToReleased: latency(
        row?.merged_to_released_median ?? null,
        row?.merged_to_released_p90 ?? null,
        row?.merged_to_released_n,
      ),
      filedToDecided: latency(
        row?.filed_to_decided_median ?? null,
        row?.filed_to_decided_p90 ?? null,
        row?.filed_to_decided_n,
      ),
    };
  }

  /**
   * Findings in the window that are a shipped fix coming undone, and the ones
   * whose own fix later failed.
   *
   * Two numbers rather than one because they answer different questions and
   * sit in different cohorts: `regressions` counts NEW findings that turned
   * out to be returns (this month's bad news), `regressedFixes` counts fixes
   * SHIPPED in the window that have since come back (this month's work that
   * did not hold). Dividing the second by merges in the same window is the
   * only honest regression rate.
   */
  async regressionCounts(
    since: Date,
  ): Promise<{ regressions: number; regressedFixes: number }> {
    const [row] = await this.manager.query<
      Array<{ regressions: string; regressed_fixes: string }>
    >(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE f.metadata ? 'regressionOf' AND f."createdAt" >= $1
        ) AS regressions,
        COUNT(*) FILTER (
          WHERE (f.metadata->>'regressed')::boolean IS TRUE
            AND COALESCE(f.released_at, f."updatedAt") >= $1
        ) AS regressed_fixes
      FROM bug_findings f
      WHERE f.parent_finding_id IS NULL
      `,
      [since],
    );
    return {
      regressions: Number(row?.regressions ?? 0),
      regressedFixes: Number(row?.regressed_fixes ?? 0),
    };
  }

  async listPaginated(
    filter: ListBugFindingsFilter,
  ): Promise<{ items: BugFinding[]; count: number }> {
    // Child steps are deliberately absent from the main table: a coordinated
    // fix should read as ONE bug there, and its steps belong in that bug's own
    // drawer rather than as three near-identical rows next to it.
    const qb = this.createQueryBuilder('f')
      .where('f.parentFindingId IS NULL')
      .orderBy('f."createdAt"', 'DESC');
    if (filter.status)
      qb.andWhere('f.status = :status', { status: filter.status });
    if (filter.source)
      qb.andWhere('f.source = :source', { source: filter.source });
    if (filter.repo) qb.andWhere('f.repo = :repo', { repo: filter.repo });
    if (filter.runId) qb.andWhere('f.runId = :runId', { runId: filter.runId });

    const [items, count] = await qb
      .take(filter.limit)
      .skip(filter.offset)
      .getManyAndCount();
    return { items, count };
  }
}
