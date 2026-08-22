import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingStatus } from '../enum/bug-finding.enum';

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
