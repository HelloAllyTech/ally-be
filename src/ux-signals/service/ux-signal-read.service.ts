import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BugFindingRepository } from 'src/bug-hunter/repository/bug-finding.repository';
import { BugFindingSource } from 'src/bug-hunter/enum/bug-finding.enum';
import { AnalyticsSuggestion } from 'src/analytics-suggestions/entity/analytics-suggestion.entity';
import {
  AnalyticsSuggestionSource,
  AnalyticsSuggestionStatus,
} from 'src/analytics-suggestions/enum/analytics-suggestion.enum';

import { UxSignalScan } from '../entity/ux-signal-scan.entity';
import { UxSignalScanStatus } from '../enum/ux-signal.enum';
import { UX_SIGNAL_EVIDENCE_LIMITS } from '../constants/ux-signals.constants';
import { UxSignalFrictionEvidence } from '../ux-signals.types';

/**
 * The read side of UX Signals — "what is friction, according to telemetry".
 *
 * The module was written as a pipeline with no read path of its own, and that
 * was right for its own audience: a scan files into the two review queues that
 * already exist, and a human reads them there. But nothing could ask the
 * *question* the scans answer. Builder's interview wants to ground a PRD in
 * what users are actually struggling with, and the only way to get it was to
 * list `bug_findings` unfiltered and hope a UX-sourced row floated up among
 * static-analysis findings from an unrelated repo.
 *
 * So this is a query surface, not a second queue. It owns no state, changes
 * nothing, and returns the same rows the two review tabs show — filtered to
 * the ones a scan produced.
 *
 * ## What it omits, and why
 *
 * **Rejected suggestions.** A rejection with a reason is a standing decision,
 * and the writer's own anti-repetition rule exists because re-proposing one is
 * how a review queue loses its readers. A PRD that cites a card the team
 * already said no to is the same failure with a longer feedback loop.
 *
 * **Closed findings.** Open means someone still thinks it is real; the open
 * set is the repository's, not a second list maintained here.
 *
 * **The evidence bodies.** Findings carry pasted detector output running to
 * dozens of lines; a caller that wants it has the id and the drawer. What
 * travels here is the claim, where it happened and how bad it is.
 *
 * ## Why the window travels with the evidence
 *
 * A caller handed a list of friction with no dates will state it in the
 * present tense. Scans are hourly-gated and can be days stale behind a failed
 * PostHog credential, so every answer carries the window the newest completed
 * scan actually read, and carries `null` when there has never been one. "No
 * friction found" and "nothing has looked" are different answers and must not
 * render the same.
 */
@Injectable()
export class UxSignalReadService {
  constructor(
    @InjectRepository(UxSignalScan)
    private readonly scanRepository: Repository<UxSignalScan>,
    private readonly findingRepository: BugFindingRepository,
    @InjectRepository(AnalyticsSuggestion)
    private readonly suggestionRepository: Repository<AnalyticsSuggestion>,
  ) {}

  /**
   * Open UX-sourced findings and undecided or accepted suggestions, newest
   * first, with the window the last completed scan covered.
   *
   * `query` narrows by a case-insensitive substring so a caller asking about
   * one area of the product is not handed the whole backlog. Unset means
   * everything, capped.
   */
  async frictionEvidence(
    query?: string,
    limit: number = UX_SIGNAL_EVIDENCE_LIMITS.DEFAULT,
  ): Promise<UxSignalFrictionEvidence> {
    const take = Math.min(Math.max(1, limit), UX_SIGNAL_EVIDENCE_LIMITS.MAX);
    const term = query?.trim() || undefined;

    const [scan, findings, suggestions] = await Promise.all([
      this.scanRepository.findOne({
        where: { status: UxSignalScanStatus.COMPLETED },
        order: { startedAt: 'DESC' },
      }),
      this.findingRepository.listOpenBySource(
        BugFindingSource.UX_SIGNAL,
        term,
        take,
      ),
      this.liveSuggestions(term, take),
    ]);

    return {
      scan: scan
        ? {
            windowFrom: scan.windowFrom,
            windowTo: scan.windowTo,
            // `startedAt` rather than a finish time: it is the column the
            // scheduler's own daily gate reads, so a caller comparing
            // freshness here against the cadence compares the same number.
            startedAt: scan.startedAt?.toISOString() ?? null,
          }
        : null,
      findings: findings.map((finding) => ({
        id: finding.id,
        title: finding.title,
        // `symbol` is written as `route|target`, which is how a signal is
        // addressed; splitting it back out saves every caller the same parse.
        route: (finding.symbol ?? '').split('|')[0] || null,
        severity: finding.severity ?? null,
        status: finding.status,
        detectedAt: finding.createdAt?.toISOString() ?? null,
      })),
      suggestions: suggestions.map((suggestion) => ({
        id: suggestion.id,
        title: suggestion.title,
        rationale: suggestion.rationale,
        suggestedGoal: suggestion.suggestedGoal ?? null,
        status: suggestion.status,
        window: suggestion.windowLabel,
      })),
    };
  }

  /**
   * Pending and accepted, never rejected — see the class docstring. Accepted
   * stays in because it is the team's own answer to the same friction, and a
   * PRD that re-proposes something already on the roadmap is duplicated work
   * rather than a settled argument.
   */
  private liveSuggestions(
    term: string | undefined,
    take: number,
  ): Promise<AnalyticsSuggestion[]> {
    const builder = this.suggestionRepository
      .createQueryBuilder('s')
      .where('s.source = :source', {
        source: AnalyticsSuggestionSource.UX_SIGNAL,
      })
      .andWhere('s.status IN (:...statuses)', {
        statuses: [
          AnalyticsSuggestionStatus.PENDING,
          AnalyticsSuggestionStatus.ACCEPTED,
        ],
      })
      .orderBy('s.createdAt', 'DESC')
      .take(take);
    if (term) {
      builder.andWhere(
        '(LOWER(s.title) LIKE :term OR LOWER(s.rationale) LIKE :term)',
        { term: `%${term.toLowerCase()}%` },
      );
    }
    return builder.getMany();
  }
}
