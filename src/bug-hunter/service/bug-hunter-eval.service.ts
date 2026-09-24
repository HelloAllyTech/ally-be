import { Injectable } from '@nestjs/common';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugHunterEvalRun } from '../entity/bug-hunter-eval-run.entity';
import {
  BugFindingDecisionReason,
  BugFindingStatus,
} from '../enum/bug-finding.enum';
import {
  BugHunterEvalLabel,
  BugHunterEvalLabelSource,
} from '../enum/bug-hunter-eval.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHunterEvalRunRepository } from '../repository/bug-hunter-eval-run.repository';
import {
  BugHunterEvalItemDto,
  BugHunterEvalRunDto,
  BugHunterEvalSetDto,
  RecordBugHunterEvalRunDto,
} from '../dto/bug-hunter-eval.dto';
import { BUG_FINDING_DECLINE_SUPPRESSION_MS } from '../constants/bug-hunter.constants';

/** Default size of a served eval set — enough for a rate to mean something, small enough to replay in one sitting. */
export const BUG_HUNTER_EVAL_SET_DEFAULT_LIMIT = 60;

/** How many candidate rows to read per item wanted, since labelling drops the ungradeable reasons. */
const CANDIDATE_OVERSAMPLE = 3;

/**
 * The labelled eval set behind Bug Hunter's replayable verifier evaluation,
 * and the store of replay results.
 *
 * ## What counts as truth
 *
 * A finding is in the set when something later settled whether it was real:
 *
 *  - a human rejected it as `not_a_bug` — NOT_A_BUG, strong;
 *  - a dismissal was reversed by a shipped fix under the same key — REAL, strong;
 *  - its fix merged or released — REAL, strong (and REGRESSED where the fix
 *    did not hold, which is the same truth with a harder bug behind it);
 *  - the Verify phase refuted it as `not_a_bug` and the decline-suppression
 *    window has passed with no reversal — NOT_A_BUG, **weak**, and excluded
 *    unless asked for, because the only judge was the thing being evaluated.
 *
 * Declines for `wont_fix`, `too_risky`, `duplicate`, `wrong_repo` and `other`
 * are left out: each is a true statement about priority or ownership, not
 * about whether the code is wrong, and the verifier answers only the latter.
 *
 * ## Why the ORIGINAL description
 *
 * An admin may have rewritten the description before starting a fix. The
 * verifier being graded saw the finder's words, so the eval hands those back,
 * or the replay would be scoring a brief the finder never wrote.
 */
@Injectable()
export class BugHunterEvalService {
  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly evalRunRepository: BugHunterEvalRunRepository,
  ) {}

  async buildSet(params: {
    repo?: string;
    limit?: number;
    includeWeak?: boolean;
    now?: Date;
  }): Promise<BugHunterEvalSetDto> {
    const limit = params.limit ?? BUG_HUNTER_EVAL_SET_DEFAULT_LIMIT;
    const rows = await this.findingRepository.listSettledForEval(
      params.repo,
      limit * CANDIDATE_OVERSAMPLE,
    );
    const now = params.now ?? new Date();

    const items: BugHunterEvalItemDto[] = [];
    for (const row of rows) {
      const labelled = labelFinding(row, now);
      if (!labelled) continue;
      if (labelled.labelStrength === 'weak' && !params.includeWeak) continue;
      items.push(labelled);
      if (items.length >= limit) break;
    }

    const counts = {
      [BugHunterEvalLabel.REAL]: items.filter(
        (i) => i.label === BugHunterEvalLabel.REAL,
      ).length,
      [BugHunterEvalLabel.NOT_A_BUG]: items.filter(
        (i) => i.label === BugHunterEvalLabel.NOT_A_BUG,
      ).length,
    };
    return { items, counts, generatedAt: now.toISOString() };
  }

  async recordRun(dto: RecordBugHunterEvalRunDto): Promise<BugHunterEvalRun> {
    const toNumeric = (value: number | null | undefined, scale: number) =>
      value === null || value === undefined ? null : value.toFixed(scale);
    return this.evalRunRepository.save(
      this.evalRunRepository.create({
        repo: dto.repo ?? null,
        promptKind: dto.promptKind,
        promptHash: dto.promptHash,
        model: dto.model,
        setHash: dto.setHash ?? null,
        itemCount: dto.itemCount,
        answeredCount: dto.answeredCount,
        agreement: toNumeric(dto.agreement, 4),
        realRecall: toNumeric(dto.realRecall, 4),
        notABugRecall: toNumeric(dto.notABugRecall, 4),
        perSource: dto.perSource ?? null,
        perLabelSource: dto.perLabelSource ?? null,
        calibration: dto.calibration ?? null,
        costUsd: toNumeric(dto.costUsd, 4),
        durationMs: dto.durationMs ?? null,
        notes: dto.notes ?? null,
      }),
    );
  }

  async listRuns(limit: number, repo?: string): Promise<BugHunterEvalRunDto[]> {
    const rows = await this.evalRunRepository.listRecent(limit, repo);
    return rows.map(toEvalRunDto);
  }
}

/**
 * The one place the truth rules live. Exported for the spec, and so a later
 * finder eval can reuse the same labels rather than inventing a second set.
 * Returns null for a finding the set cannot grade.
 */
export function labelFinding(
  row: BugFinding,
  now: Date,
): BugHunterEvalItemDto | null {
  const base = (
    label: BugHunterEvalLabel,
    labelSource: BugHunterEvalLabelSource,
    labelStrength: 'strong' | 'weak',
  ): BugHunterEvalItemDto => ({
    findingId: row.id,
    repo: row.repo ?? '',
    source: row.source,
    file: row.file ?? null,
    symbol: row.symbol ?? null,
    description: row.originalDescription ?? row.description,
    evidence: row.evidence ?? null,
    label,
    labelSource,
    labelStrength,
    discoveredAt: row.createdAt,
    settledAt: row.decidedAt ?? row.updatedAt ?? null,
    originalConfidence:
      typeof row.metadata?.confidence === 'number'
        ? row.metadata.confidence
        : null,
  });

  if (!row.repo) return null;

  // A dismissal a later shipped fix contradicted: the verifier was wrong, the
  // bug was real. Checked before the decline branches because the row's
  // status is still DISMISSED/REJECTED.
  if (row.reversedAt) {
    return base(
      BugHunterEvalLabel.REAL,
      BugHunterEvalLabelSource.REVERSED,
      'strong',
    );
  }

  if (
    row.status === BugFindingStatus.MERGED ||
    row.status === BugFindingStatus.RELEASED
  ) {
    return base(
      BugHunterEvalLabel.REAL,
      row.metadata?.regressed === true
        ? BugHunterEvalLabelSource.REGRESSED
        : BugHunterEvalLabelSource.MERGED_HELD,
      'strong',
    );
  }

  if (row.decisionReason !== BugFindingDecisionReason.NOT_A_BUG) {
    // wont_fix, too_risky, duplicate, wrong_repo, other, or nothing recorded:
    // none of these say whether the code was wrong.
    return null;
  }

  if (row.status === BugFindingStatus.REJECTED) {
    return base(
      BugHunterEvalLabel.NOT_A_BUG,
      BugHunterEvalLabelSource.HUMAN_DECLINED,
      'strong',
    );
  }

  if (row.status === BugFindingStatus.DISMISSED) {
    // Only once the suppression window has passed: inside it a reversal is
    // still possible, and a dismissal that young has not really been tested.
    const decidedAt = row.decidedAt ?? row.updatedAt;
    if (
      !decidedAt ||
      now.getTime() - decidedAt.getTime() < BUG_FINDING_DECLINE_SUPPRESSION_MS
    ) {
      return null;
    }
    return base(
      BugHunterEvalLabel.NOT_A_BUG,
      BugHunterEvalLabelSource.VERIFIER_DISMISSED,
      'weak',
    );
  }

  return null;
}

export function toEvalRunDto(row: BugHunterEvalRun): BugHunterEvalRunDto {
  const num = (value: string | null | undefined): number | null =>
    value === null || value === undefined ? null : Number(value);
  return {
    id: row.id,
    repo: row.repo ?? null,
    promptKind: row.promptKind,
    promptHash: row.promptHash,
    model: row.model,
    setHash: row.setHash ?? null,
    itemCount: row.itemCount,
    answeredCount: row.answeredCount,
    agreement: num(row.agreement),
    realRecall: num(row.realRecall),
    notABugRecall: num(row.notABugRecall),
    perSource: row.perSource ?? null,
    perLabelSource: row.perLabelSource ?? null,
    calibration: row.calibration ?? null,
    costUsd: num(row.costUsd),
    durationMs: row.durationMs ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
  };
}
