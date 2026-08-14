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
  BugFindingStatus.FIXING,
  BugFindingStatus.NEEDS_INPUT,
  BugFindingStatus.PR_OPENED,
];

export interface ListBugFindingsFilter {
  status?: BugFindingStatus;
  source?: string;
  repo?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class BugFindingRepository extends Repository<BugFinding> {
  constructor(dataSource: DataSource) {
    super(BugFinding, dataSource.createEntityManager());
  }

  /** `repo::normalized(file+description)`, hashed — stable across runs so a still-open bug never gets a second row. */
  static dedupeKey(file: string, description: string): string {
    const normalized = `${file}::${description}`
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    return createHash('sha256').update(normalized).digest('hex');
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

  async listPaginated(
    filter: ListBugFindingsFilter,
  ): Promise<{ items: BugFinding[]; count: number }> {
    const qb = this.createQueryBuilder('f').orderBy('f."createdAt"', 'DESC');
    if (filter.status)
      qb.andWhere('f.status = :status', { status: filter.status });
    if (filter.source)
      qb.andWhere('f.source = :source', { source: filter.source });
    if (filter.repo) qb.andWhere('f.repo = :repo', { repo: filter.repo });

    const [items, count] = await qb
      .take(filter.limit)
      .skip(filter.offset)
      .getManyAndCount();
    return { items, count };
  }
}
