import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import { LoggerService } from 'src/logger/logger.service';
import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import { BugFindingRepository } from 'src/bug-hunter/repository/bug-finding.repository';
import {
  BugFindingSource,
  BugFindingStatus,
} from 'src/bug-hunter/enum/bug-finding.enum';
import { AnalyticsSuggestion } from 'src/analytics-suggestions/entity/analytics-suggestion.entity';
import {
  AnalyticsSuggestionSource,
  AnalyticsSuggestionStatus,
} from 'src/analytics-suggestions/enum/analytics-suggestion.enum';
import { RoadmapOpportunityType } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import {
  UX_SIGNAL_FIELD_LIMITS,
  UX_SIGNAL_REPO,
} from '../constants/ux-signals.constants';
import { UxSignalKind } from '../enum/ux-signal.enum';
import { TriagedItem } from '../ux-signals.types';

/**
 * Advisory-lock coordinates for filing a UX-signal suggestion.
 *
 * A fixed namespace, distinct from ScheduledTaskRunnerService's 4919, so these
 * can never collide with an interval lock. One fixed key rather than a hash of the
 * title: this path files at most a handful of rows a day, so serialising all of it
 * costs nothing and needs no argument about hash collisions to be correct.
 */
const SUGGESTION_LOCK_NAMESPACE = 4920;
const SUGGESTION_LOCK_KEY = 1;

/** What one write pass filed, and what it recognised as already known. */
export interface WriteResult {
  findingsCreated: number;
  suggestionsCreated: number;
  skippedDuplicates: number;
}

/**
 * Files triaged items into the two existing human review queues.
 *
 * This service writes to `bug_findings` and `analytics_suggestions` through raw
 * repositories rather than by importing BugHunterModule or
 * AnalyticsSuggestionsModule. That is the established cross-domain pattern here
 * (see RoadmapOpportunityService.create, which inserts a bug finding the same
 * way) and it exists to avoid the circular-import DI traps that bit this codebase
 * before: a module graph where every producer of findings depends on the module
 * that consumes them does not stay acyclic for long.
 *
 * Nothing here dispatches work. A bug lands at NEW for an admin to approve, and a
 * suggestion lands PENDING for an admin to accept or reject — both queues keep
 * their existing gates, and no code path in this pipeline can start a fix session
 * or open a pull request. The scan proposes; people decide.
 */
@Injectable()
export class UxSignalWriterService {
  private readonly logger = LoggerService.getInstance(
    UxSignalWriterService.name,
  );

  constructor(
    private readonly bugFindingRepository: BugFindingRepository,
    @InjectRepository(AnalyticsSuggestion)
    private readonly suggestionRepository: Repository<AnalyticsSuggestion>,
  ) {}

  /**
   * File every item, then report what landed.
   *
   * One batch id for the whole scan, so the suggestions a single scan produced
   * can be read as one decision set — the same grouping the analytics-window runs
   * use.
   *
   * Each item is written independently and best-effort: one malformed row must not
   * discard the rest of a scan's work. There is no transaction spanning the two
   * tables on purpose — a bug finding and a suggestion are separate artefacts for
   * separate queues, and rolling one back because the other failed would lose real
   * information to preserve a consistency nobody reads.
   */
  async write(
    items: TriagedItem[],
    scan: { windowFrom: string; windowTo: string; model: string },
    userId: number | null,
  ): Promise<WriteResult> {
    const batchId = randomUUID();
    const result: WriteResult = {
      findingsCreated: 0,
      suggestionsCreated: 0,
      skippedDuplicates: 0,
    };

    for (const item of items) {
      try {
        const filed =
          item.kind === UxSignalKind.BUG
            ? await this.fileBug(item)
            : await this.fileSuggestion(item, batchId, scan, userId);

        if (!filed) {
          result.skippedDuplicates += 1;
        } else if (item.kind === UxSignalKind.BUG) {
          result.findingsCreated += 1;
        } else {
          result.suggestionsCreated += 1;
        }
      } catch (error) {
        this.logger.warn(
          `[UX-SIGNALS] Failed to file ${item.kind} "${item.title}": ${String(error)}`,
        );
      }
    }

    return result;
  }

  /**
   * One bug finding, or false when this bug is already open.
   *
   * The dedupe key is built with the route/target as `symbol`, which is the whole
   * reason UX findings dedupe reliably. A UX signal has no `file` — its coordinate
   * is a route, not a code location — and without a symbol the key would fall back
   * to a fuzzy fingerprint of LLM-written prose. That fallback is exactly what made
   * the nightly sweep manufacture duplicate rows before, and a scan that re-files
   * the same rage-click cluster every day would do it faster.
   *
   * `repo` is set outright rather than left to the repo classifier: every event a
   * detector reads is emitted by the helpline frontend, so the answer is known from
   * the provenance of the data and an LLM guess could only be wrong. It also has to
   * be present for the drawer's fix-session button to work at all.
   *
   * `proven` stays false. These findings never pass through the sweep's adversarial
   * verify phase, and claiming a verification that did not happen would misrepresent
   * them to the admin deciding whether to act.
   */
  private async fileBug(item: TriagedItem): Promise<boolean> {
    const symbol = item.target ? `${item.route}|${item.target}` : item.route;
    const description = item.body.slice(
      UX_SIGNAL_FIELD_LIMITS.DESCRIPTION * -1,
    );
    const dedupeKey = BugFindingRepository.dedupeKey(
      null,
      BugFindingSource.UX_SIGNAL,
      symbol,
      description,
    );

    const existing = await this.bugFindingRepository.findOpenByDedupeKey(
      UX_SIGNAL_REPO,
      dedupeKey,
    );
    if (existing) return false;

    await this.bugFindingRepository.save(
      this.bugFindingRepository.create({
        source: BugFindingSource.UX_SIGNAL,
        repo: UX_SIGNAL_REPO,
        title: item.title.slice(0, UX_SIGNAL_FIELD_LIMITS.TITLE),
        description,
        symbol,
        dedupeKey,
        severity: item.severity,
        evidence: this.formatEvidence(item),
        proven: false,
        status: BugFindingStatus.NEW,
      } as Partial<BugFinding>),
    );
    return true;
  }

  /**
   * One suggestion, or false when an equivalent one is already awaiting a decision.
   *
   * Written directly rather than through AnalyticsSuggestionsService.generate,
   * which is the analytics-window product: it collects its own payload from
   * platform analytics and drives its own prompt. Sharing the *table* and the
   * accept/reject flow is the point; sharing the generator would mean bending a
   * window run into something it is not.
   *
   * The title guard is a cheap backstop only. Real anti-repetition happens in the
   * prompt, which is given the open findings and the pending and rejected
   * suggestions — a rejection with a reason is a standing decision, and re-filing
   * a reworded version of it is how a review queue loses its readers.
   *
   * The check and the insert run inside one transaction that first takes a
   * transaction-level advisory lock, because on their own they are a read followed
   * by a write and two passes can interleave between them — each seeing an empty
   * pending queue, each filing the same card. Scans are serialised by a unique
   * index now, but not absolutely: a scan that outlives the staleness cutoff is
   * declared abandoned and a second one starts beside it, and that is the window
   * this closes. A lock rather than a unique index on `analytics_suggestions`,
   * because that table is the shared review queue — the analytics-window producer
   * writes to it too, historical rows may already hold repeated titles, and a
   * constraint added underneath a human queue would turn old data into a hard
   * error nobody asked for. The lock is released when the transaction ends,
   * including on rollback, so a failed filing cannot wedge the next one.
   */
  private async fileSuggestion(
    item: TriagedItem,
    batchId: string,
    scan: { windowFrom: string; windowTo: string; model: string },
    userId: number | null,
  ): Promise<boolean> {
    const title = item.title.slice(0, UX_SIGNAL_FIELD_LIMITS.TITLE);
    // A scheduled scan has no acting user. 0 is ally-be's system-write
    // convention for these audit columns.
    const actor = userId ?? 0;

    return this.suggestionRepository.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
        SUGGESTION_LOCK_NAMESPACE,
        SUGGESTION_LOCK_KEY,
      ]);

      const repository = manager.getRepository(AnalyticsSuggestion);
      const duplicate = await repository
        .createQueryBuilder('s')
        .where('s.status = :status', {
          status: AnalyticsSuggestionStatus.PENDING,
        })
        .andWhere('s.source = :source', {
          source: AnalyticsSuggestionSource.UX_SIGNAL,
        })
        .andWhere('LOWER(TRIM(s.title)) = :title', {
          title: title.toLowerCase().trim(),
        })
        .getOne();
      if (duplicate) return false;

      await repository.save(
        repository.create({
          batchId,
          source: AnalyticsSuggestionSource.UX_SIGNAL,
          title,
          body: item.body.slice(0, UX_SIGNAL_FIELD_LIMITS.BODY),
          rationale: item.rationale.slice(0, UX_SIGNAL_FIELD_LIMITS.RATIONALE),
          evidence: item.evidence,
          suggestedGoal: item.suggestedGoal,
          // Always IDEA: a signal the triage classified as bug-shaped went to the
          // bug queue instead of here, so anything reaching this method is an
          // improvement by construction.
          suggestedType: RoadmapOpportunityType.IDEA,
          status: AnalyticsSuggestionStatus.PENDING,
          windowFrom: scan.windowFrom,
          windowTo: scan.windowTo,
          windowLabel: `UX scan · ${scan.windowFrom} → ${scan.windowTo}`,
          model: scan.model,
          createdBy: actor,
          updatedBy: actor,
        }),
      );
      return true;
    });
  }

  /**
   * Evidence as text, because `bug_findings.evidence` is a text column shared with
   * finders that paste raw test output into it. The route and the model's own
   * confidence go in here too: they are provenance for the admin reading the
   * drawer, and a finding that hides how sure the pipeline was invites more trust
   * than it earned.
   */
  private formatEvidence(item: TriagedItem): string {
    const lines = [
      `Route: ${item.route}`,
      item.target ? `Target: ${item.target}` : null,
      'Source: UX Signals scan over PostHog telemetry (no code inspection).',
      item.confidence ? `Confidence: ${item.confidence}` : null,
      '',
      ...item.evidence
        .slice(0, UX_SIGNAL_FIELD_LIMITS.EVIDENCE_ITEMS)
        .map(
          (line) => `- ${line.slice(0, UX_SIGNAL_FIELD_LIMITS.EVIDENCE_ITEM)}`,
        ),
    ];
    return lines.filter((line) => line !== null).join('\n');
  }
}
