import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import {
  BugFindingDecisionReason,
  BugFindingStatus,
} from '../enum/bug-finding.enum';
import { BugHunterSense, senseOfSource } from '../type/bug-hunter-finder.type';

/** One cell: what a (sense, model) produced on a repo in the window. */
export interface ScoreboardRow {
  repo: string;
  sense: BugHunterSense;
  engine: string | null;
  model: string | null;
  filed: number;
  /** Accepted by a person or the independent verifier, or taken to a fix. */
  accepted: number;
  /** Declined as the finder's error: not a bug, duplicate, wrong repo. */
  declined: number;
  /** Still open with no decision. */
  pending: number;
}

export interface Scoreboard {
  repo: string;
  days: number;
  since: string;
  rows: ScoreboardRow[];
  /** The same counts folded by sense, every model together. */
  bySense: Record<
    string,
    { filed: number; accepted: number; declined: number; pending: number }
  >;
  /** And by model, every sense together. */
  byModel: Record<
    string,
    { filed: number; accepted: number; declined: number; pending: number }
  >;
}

const ACCEPTED: ReadonlySet<string> = new Set([
  BugFindingStatus.APPROVED,
  BugFindingStatus.QUEUED,
  BugFindingStatus.FIXING,
  BugFindingStatus.NEEDS_INPUT,
  BugFindingStatus.PR_OPENED,
  BugFindingStatus.MERGED,
  BugFindingStatus.RELEASING,
  BugFindingStatus.RELEASED,
  BugFindingStatus.RELEASE_FAILED,
  BugFindingStatus.BLOCKED,
  BugFindingStatus.COORDINATING,
]);
const FINDER_ERROR: ReadonlySet<string> = new Set([
  BugFindingDecisionReason.NOT_A_BUG,
  BugFindingDecisionReason.DUPLICATE,
  BugFindingDecisionReason.WRONG_REPO,
]);

/**
 * The scoreboard (OPP-0777, shipped inside the Finder stage OPP-0781): what
 * each sense and each model has produced on a repo, so the Finder's
 * decisions are made on counts rather than opinion. Computed on read from
 * findings joined to their runs; a nightly materialisation can come when the
 * read gets slow.
 */
@Injectable()
export class BugHunterScoreboardService {
  constructor(
    @InjectRepository(BugFinding)
    private readonly findings: Repository<BugFinding>,
    @InjectRepository(BugHuntRun)
    private readonly runs: Repository<BugHuntRun>,
  ) {}

  async forRepo(repo: string, days = 90): Promise<Scoreboard> {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.findings.find({
      where: { repo, createdAt: MoreThanOrEqual(since) },
      select: [
        'id',
        'repo',
        'source',
        'status',
        'decisionReason',
        'runId',
        'metadata',
        'createdAt',
      ],
    });
    const runIds = [
      ...new Set(rows.map((r) => r.runId).filter(Boolean)),
    ] as string[];
    const runRows = runIds.length
      ? await this.runs.find({
          where: runIds.map((id) => ({ id })),
          select: ['id', 'engine', 'model'],
        })
      : [];
    const runById = new Map(runRows.map((r) => [r.id, r]));

    const cells = new Map<string, ScoreboardRow>();
    const bySense: Scoreboard['bySense'] = {};
    const byModel: Scoreboard['byModel'] = {};
    const bump = (
      target: {
        filed: number;
        accepted: number;
        declined: number;
        pending: number;
      },
      f: BugFinding,
    ) => {
      target.filed += 1;
      if (
        ACCEPTED.has(f.status) ||
        f.metadata?.independentVerification === 'confirmed'
      ) {
        target.accepted += 1;
      } else if (
        (f.status === BugFindingStatus.DISMISSED ||
          f.status === BugFindingStatus.REJECTED) &&
        f.decisionReason &&
        FINDER_ERROR.has(f.decisionReason)
      ) {
        target.declined += 1;
      } else if (
        f.status === BugFindingStatus.NEW ||
        f.status === BugFindingStatus.PENDING_APPROVAL
      ) {
        target.pending += 1;
      }
    };

    for (const f of rows) {
      const sense = senseOfSource(f.source);
      if (!sense) continue;
      const run = f.runId ? runById.get(f.runId) : undefined;
      const engine = run?.engine ?? null;
      const model = run?.model ?? null;
      const key = `${sense}|${engine ?? '-'}|${model ?? '-'}`;
      const cell =
        cells.get(key) ??
        ({
          repo,
          sense,
          engine,
          model,
          filed: 0,
          accepted: 0,
          declined: 0,
          pending: 0,
        } as ScoreboardRow);
      bump(cell, f);
      cells.set(key, cell);
      bump(
        (bySense[sense] ??= { filed: 0, accepted: 0, declined: 0, pending: 0 }),
        f,
      );
      if (model)
        bump(
          (byModel[model] ??= {
            filed: 0,
            accepted: 0,
            declined: 0,
            pending: 0,
          }),
          f,
        );
    }

    return {
      repo,
      days,
      since: since.toISOString(),
      rows: [...cells.values()].sort((a, b) => b.filed - a.filed),
      bySense,
      byModel,
    };
  }
}
