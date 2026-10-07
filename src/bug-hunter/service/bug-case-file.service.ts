import { Injectable } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';

import { BugCaseFile, BugCaseVerdict } from '../constants/bug-case-file';
import { BugFinding } from '../entity/bug-finding.entity';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';
import { BugFindingSource } from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHuntEventRepository } from '../repository/bug-hunt-event.repository';
import { BugFindingMiss } from '../type/bug-finding-miss.type';
import { BugCaseBudgetService } from './bug-case-budget.service';
import { BugFindingService } from './bug-finding.service';
import { groupSessions } from '../util/bug-case-sessions.util';
import { BugFixVerdict, namedFailures } from '../type/bug-fix-verdict.type';
import { BugFindingVerdict } from '../type/bug-finding-verdict.type';

/**
 * Assembles the case file for one bug — see `BugCaseFile` for what it is and
 * who reads it. Only the finding is required; the timeline and the reporter
 * lookup are best-effort, so a case file is always returned.
 */
@Injectable()
export class BugCaseFileService {
  private readonly logger = LoggerService.getInstance(BugCaseFileService.name);

  constructor(
    private readonly eventRepository: BugHuntEventRepository,
    private readonly bugFindingService: BugFindingService,
    private readonly budgetService: BugCaseBudgetService,
  ) {}

  async build(
    finding: BugFinding,
    options: { currentRunId?: string; events?: BugHuntEvent[] } = {},
  ): Promise<BugCaseFile> {
    const metadata = finding.metadata ?? {};
    const [enriched, events] = await Promise.all([
      this.safely('reporter', () =>
        this.bugFindingService.enrich([finding]).then((rows) => rows[0]),
      ),
      options.events
        ? Promise.resolve(options.events)
        : this.safely('events', () =>
            this.eventRepository.listForFinding(finding.id),
          ),
    ]);
    const timeline = events ?? [];
    const report = enriched?.report ?? null;
    const sessions = groupSessions(timeline, options.currentRunId);
    const verdicts = collectVerdicts(finding, timeline);

    return {
      finding: {
        id: finding.id,
        repo: finding.repo ?? null,
        title: finding.title,
        description: finding.description,
        originalDescription: finding.originalDescription ?? null,
        file: finding.file ?? null,
        symbol: finding.symbol ?? null,
        source: finding.source,
        severity: finding.severity ?? null,
        proven: finding.proven,
        evidence: finding.evidence ?? null,
        touchesGuardedPath: finding.touchesGuardedPath,
        status: finding.status,
        prUrl: finding.prUrl ?? null,
        createdAt: finding.createdAt,
      },
      reporter:
        finding.source === BugFindingSource.REPORTED_BUG && report
          ? {
              source: report.reporterSource,
              name: report.reportedByName,
              reportedAt: report.reportedAt,
              context: report.reporterContext,
            }
          : null,
      miss: readMiss(metadata),
      verdicts,
      sessions,
      postmortem:
        metadata.postmortem && typeof metadata.postmortem === 'object'
          ? (metadata.postmortem as Record<string, unknown>)
          : null,
      lineage: {
        regressionOf:
          typeof metadata.regressionOf === 'string'
            ? metadata.regressionOf
            : null,
        regressed: metadata.regressed === true,
        rediscoveredCount: Number(metadata.rediscoveredCount ?? 0) || 0,
      },
      budget: this.budgetService.read(finding),
      decisions: [],
      totals: {
        sessions: sessions.length,
        attempts: sessions.reduce((n, s) => n + s.attempts.length, 0),
        verdicts: verdicts.length,
      },
    };
  }

  private async safely<T>(
    what: string,
    fetch: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await fetch();
    } catch (error) {
      this.logger.warn(
        `Case file: could not load ${what}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

/**
 * Every judgement on this bug, from the two places the sweep records them:
 * the verifier votes stored on the finding by the Verify phase, and `verify`
 * events on the timeline (one per finding per sweep, which also carry the
 * engine's "verification unavailable" admission). A `decision_recorded` by
 * verification is a refutation with the reason the decline carried.
 */
export const collectVerdicts = (
  finding: BugFinding,
  events: BugHuntEvent[],
): BugCaseVerdict[] => {
  const metadata = finding.metadata ?? {};
  const out: BugCaseVerdict[] = [];

  const verifyEvents = events.filter(
    (e) => e.stage === BugHuntEventStage.VERIFY,
  );
  const votes = Array.isArray(metadata.verifierVotes)
    ? (metadata.verifierVotes as Record<string, unknown>[])
    : [];
  const verifyAt = verifyEvents[0]?.createdAt ?? null;
  const verifyRun = verifyEvents[0]?.runId ?? null;
  for (const v of votes) {
    out.push({
      kind: 'finding',
      verdict: v.refuted ? 'refuted' : 'confirmed',
      confidence: typeof v.certainty === 'number' ? v.certainty : null,
      reason: typeof v.reason === 'string' ? v.reason : null,
      checks: [],
      by: typeof v.by === 'string' ? v.by : null,
      runId: verifyRun,
      at: verifyAt,
    });
  }
  if (!votes.length && metadata.verificationUnavailable === true) {
    out.push({
      kind: 'finding',
      verdict: 'unavailable',
      confidence: null,
      reason: verifyEvents[0]?.summary ?? null,
      checks: [],
      by: null,
      runId: verifyRun,
      at: verifyAt,
    });
  }
  for (const e of events) {
    if (e.stage !== BugHuntEventStage.DECISION_RECORDED) continue;
    const byVerification =
      /by verification/i.test(e.summary) ||
      e.payload?.decidedBy === null ||
      e.payload?.byVerification === true;
    if (!byVerification) continue;
    out.push({
      kind: 'finding',
      verdict: 'refuted',
      confidence:
        typeof e.payload?.confidence === 'number' ? e.payload.confidence : null,
      reason:
        typeof e.payload?.decisionNote === 'string'
          ? e.payload.decisionNote
          : e.summary,
      checks: [],
      by: null,
      runId: e.runId ?? null,
      at: e.createdAt,
    });
  }
  // The independent verifier's verdicts on the finding itself (OPP-0780).
  const findingVerdicts = Array.isArray(metadata.findingVerdicts)
    ? (metadata.findingVerdicts as BugFindingVerdict[])
    : [];
  for (const v of findingVerdicts) {
    out.push({
      kind: 'finding',
      verdict: v.verdict,
      confidence: v.confidence,
      reason:
        v.verdict === 'refuted'
          ? v.refutation
          : (v.reproduction ?? v.wouldBeWrongIf),
      checks: [],
      by: v.by.engine
        ? `${v.by.engine}${v.by.model ? ` (${v.by.model})` : ''}`
        : null,
      runId: v.runId,
      at: new Date(v.at),
    });
  }
  // The Verifier's verdicts on fixes (OPP-0779).
  const fixVerdicts = Array.isArray(metadata.fixVerdicts)
    ? (metadata.fixVerdicts as BugFixVerdict[])
    : [];
  for (const v of fixVerdicts) {
    const failures = namedFailures(v);
    out.push({
      kind: 'fix',
      verdict: v.verdict,
      confidence: v.confidence,
      reason: v.summary ?? (failures.length ? failures.join('; ') : null),
      checks: v.checks.map((c) => ({
        name: c.name,
        ok: c.ok === true,
        evidence: c.skipped ? `skipped: ${c.skipped}` : c.evidence,
      })),
      by: v.by.engine
        ? `${v.by.engine}${v.by.model ? ` (${v.by.model})` : ''}`
        : null,
      runId: v.runId,
      at: new Date(v.at),
    });
  }
  return out.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
};

const readMiss = (metadata: Record<string, any>): BugFindingMiss | null => {
  const miss = metadata.miss;
  if (!miss || typeof miss !== 'object' || typeof miss.reason !== 'string')
    return null;
  return miss as BugFindingMiss;
};
