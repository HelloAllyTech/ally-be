import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugHuntDecision } from '../entity/bug-hunt-decision.entity';
import {
  BugFindingDecisionReason,
  BugFindingStatus,
} from '../enum/bug-finding.enum';
import { BugFixVerdict } from '../type/bug-fix-verdict.type';
import {
  BUG_HUNTER_DECISION_OWNER_DEFAULTS,
  BUG_HUNTER_DECISION_POINTS_FIXED,
  BUG_HUNTER_REPLAY_FLIP_THRESHOLD,
  DecisionOwner,
} from '../type/bug-hunter-orchestrator.type';
import { DecisionPoint } from './bug-hunter-decision.service';
import { BugHunterService } from './bug-hunter.service';

export type ReplayOutcome = 'good' | 'bad' | 'open';

export interface ReplayPointReport {
  point: DecisionPoint;
  /** Who acts on this point right now: the admin's setting, else the default. */
  owner: DecisionOwner;
  fixed: boolean;
  decisions: number;
  /** Rows where the other owner answered too, so the two can be compared. */
  withShadow: number;
  agreed: number;
  disagreed: number;
  /** Disagreements where the acted pick led to a good outcome. */
  ownerWins: number;
  /** Disagreements where the acted pick led to a bad outcome — the shadow would have done otherwise. */
  shadowWins: number;
  /** Disagreements whose case is still open. */
  undecided: number;
  /** Vetoes recorded at this point. */
  vetoes: number;
  flipThreshold: number;
  verdict: 'flip' | 'keep' | 'not_enough_cases' | 'fixed';
}

export interface ReplayReport {
  days: number;
  since: string;
  generatedAt: string;
  points: ReplayPointReport[];
}

const GOOD: ReadonlySet<string> = new Set([
  BugFindingStatus.MERGED,
  BugFindingStatus.RELEASING,
  BugFindingStatus.RELEASED,
]);
const BAD: ReadonlySet<string> = new Set([
  BugFindingStatus.FAILED,
  BugFindingStatus.CANCELLED,
  BugFindingStatus.REJECTED,
]);

/**
 * The replay — OPP-0783. Reads the decision log against what happened to
 * each case and says, per point, whether the shadow owner has been right
 * more often than the owner. A point flips when the shadow has won
 * `BUG_HUNTER_REPLAY_FLIP_THRESHOLD` disagreements and more than the owner;
 * the flip itself is an admin's PATCH, never automatic.
 *
 * Outcome is the case's, read from the finding: merged or released is good,
 * failed, cancelled or rejected is bad, a dismissal is bad only when a
 * person later called it a finder error, and anything still moving is open.
 * Run-level points (D1, D2) have no single case to read, so they report
 * agreement counts and never a flip. Each row's `outcome` column is written
 * back so a later reader need not recompute it.
 */
@Injectable()
export class BugHunterDecisionReplayService {
  constructor(
    @InjectRepository(BugHuntDecision)
    private readonly decisions: Repository<BugHuntDecision>,
    @InjectRepository(BugFinding)
    private readonly findings: Repository<BugFinding>,
    private readonly bugHunterService: BugHunterService,
  ) {}

  async report(days = 90): Promise<ReplayReport> {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.decisions.find({
      where: { createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'ASC' },
    });
    const findingIds = [
      ...new Set(rows.map((r) => r.findingId).filter(Boolean)),
    ] as string[];
    const findingRows = findingIds.length
      ? await this.findings.find({
          where: { id: In(findingIds) },
          select: ['id', 'status', 'decisionReason', 'metadata'],
        })
      : [];
    const outcomeById = new Map<string, ReplayOutcome>(
      findingRows.map((f) => [f.id, outcomeOf(f)]),
    );
    const owners = await this.effectiveOwners();

    const points: ReplayPointReport[] = [];
    const writes: { id: string; outcome: 'better' | 'same' | 'worse' }[] = [];
    for (const point of Object.keys(
      BUG_HUNTER_DECISION_OWNER_DEFAULTS,
    ) as DecisionPoint[]) {
      const mine = rows.filter((r) => r.point === point);
      const fixed = BUG_HUNTER_DECISION_POINTS_FIXED.includes(point);
      const rep: ReplayPointReport = {
        point,
        owner: owners[point],
        fixed,
        decisions: mine.length,
        withShadow: 0,
        agreed: 0,
        disagreed: 0,
        ownerWins: 0,
        shadowWins: 0,
        undecided: 0,
        vetoes: mine.filter((r) => r.inputs?.veto).length,
        flipThreshold: BUG_HUNTER_REPLAY_FLIP_THRESHOLD,
        verdict: fixed ? 'fixed' : 'not_enough_cases',
      };
      for (const r of mine) {
        if (r.shadowPick === null || r.shadowPick === undefined) continue;
        rep.withShadow += 1;
        if (samePick(r.pick, r.shadowPick)) {
          rep.agreed += 1;
          if (r.outcome !== 'same') writes.push({ id: r.id, outcome: 'same' });
          continue;
        }
        rep.disagreed += 1;
        const outcome = r.findingId ? outcomeById.get(r.findingId) : undefined;
        if (outcome === 'good') {
          rep.ownerWins += 1;
          if (r.outcome !== 'better')
            writes.push({ id: r.id, outcome: 'better' });
        } else if (outcome === 'bad') {
          rep.shadowWins += 1;
          if (r.outcome !== 'worse')
            writes.push({ id: r.id, outcome: 'worse' });
        } else {
          rep.undecided += 1;
        }
      }
      if (!fixed) {
        const settled = rep.ownerWins + rep.shadowWins;
        if (settled < BUG_HUNTER_REPLAY_FLIP_THRESHOLD) {
          rep.verdict = 'not_enough_cases';
        } else if (
          rep.shadowWins >= BUG_HUNTER_REPLAY_FLIP_THRESHOLD &&
          rep.shadowWins > rep.ownerWins
        ) {
          rep.verdict = 'flip';
        } else {
          rep.verdict = 'keep';
        }
      }
      points.push(rep);
    }

    // Write the outcomes back, best-effort and in one pass per value.
    for (const value of ['better', 'same', 'worse'] as const) {
      const ids = writes.filter((w) => w.outcome === value).map((w) => w.id);
      if (ids.length) {
        await this.decisions
          .update({ id: In(ids) }, { outcome: value })
          .catch(() => undefined);
      }
    }

    return {
      days,
      since: since.toISOString(),
      generatedAt: new Date().toISOString(),
      points,
    };
  }

  /** The owner per point as it stands: the admin's setting over the default, fixed points always the rule. */
  async effectiveOwners(): Promise<Record<DecisionPoint, DecisionOwner>> {
    const settings = await this.bugHunterService
      .getSettings()
      .catch(() => null);
    const overrides = (settings?.decisionOwners ?? {}) as Partial<
      Record<DecisionPoint, DecisionOwner>
    >;
    const out = { ...BUG_HUNTER_DECISION_OWNER_DEFAULTS };
    for (const point of Object.keys(out) as DecisionPoint[]) {
      if (BUG_HUNTER_DECISION_POINTS_FIXED.includes(point)) {
        out[point] = 'rule';
        continue;
      }
      const o = overrides[point];
      if (o === 'rule' || o === 'model') out[point] = o;
    }
    return out;
  }
}

/** The case's outcome as the replay reads it. Exported for the spec. */
export function outcomeOf(
  f: Pick<BugFinding, 'status' | 'decisionReason' | 'metadata'>,
): ReplayOutcome {
  if (GOOD.has(f.status)) return 'good';
  if (BAD.has(f.status)) return 'bad';
  if (f.status === BugFindingStatus.DISMISSED) {
    // A dismissal by the independent verifier is a good outcome for a D3
    // "verify" pick that let it be checked; one a person later reversed is bad.
    if (f.metadata?.reversedAt) return 'bad';
    return f.decisionReason === BugFindingDecisionReason.NOT_A_BUG ||
      f.decisionReason === BugFindingDecisionReason.DUPLICATE ||
      f.decisionReason === BugFindingDecisionReason.WRONG_REPO
      ? 'good'
      : 'open';
  }
  const verdicts = Array.isArray(f.metadata?.fixVerdicts)
    ? (f.metadata!.fixVerdicts as BugFixVerdict[])
    : [];
  const last = verdicts[verdicts.length - 1];
  if (f.status === BugFindingStatus.PR_OPENED && last) {
    return last.verdict === 'pass' ? 'good' : 'open';
  }
  return 'open';
}

/** Picks compare by value; a D6 pick compares by engine and model, not by the free-text approach. */
export function samePick(a: unknown, b: unknown): boolean {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    if ('model' in x && 'model' in y) {
      return x.engine === y.engine && x.model === y.model;
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      [...a].sort().every((v, i) => v === [...b].sort()[i])
    );
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
