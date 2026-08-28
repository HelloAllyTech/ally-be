import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { addDays, isoDate } from 'src/analytics/util/analytics-window.util';
import { BugFindingRepository } from 'src/bug-hunter/repository/bug-finding.repository';
import { BugFindingSource } from 'src/bug-hunter/enum/bug-finding.enum';
import { AnalyticsSuggestion } from 'src/analytics-suggestions/entity/analytics-suggestion.entity';
import {
  AnalyticsSuggestionSource,
  AnalyticsSuggestionStatus,
} from 'src/analytics-suggestions/enum/analytics-suggestion.enum';
import { RoadmapProductGoalRepository } from 'src/product-roadmap/repository/roadmap-taxonomy.repository';

import {
  UX_SIGNAL_CONTEXT_LIMITS,
  UX_SIGNAL_FIELD_LIMITS,
  UX_SIGNAL_LIMITS,
  UX_SIGNAL_SCHEDULE,
  UX_SIGNAL_WINDOW_DAYS,
} from '../constants/ux-signals.constants';
import { UxSignalScan } from '../entity/ux-signal-scan.entity';
import {
  UxSignalKind,
  UxSignalScanStatus,
  UxSignalScanTrigger,
} from '../enum/ux-signal.enum';
import {
  RawTriageItem,
  TriagedItem,
  UxScanOutcome,
  UxSignal,
} from '../ux-signals.types';
import { UxSignalDetectorService } from './ux-signal-detector.service';
import { UxSignalWriterService } from './ux-signal-writer.service';
import { UxSignalsAiService } from './ux-signals-ai.service';
import { BugFindingSeverity } from 'src/bug-hunter/enum/bug-finding.enum';

/**
 * Orchestrates one UX Signals scan: read PostHog, triage what crossed a
 * threshold, file it into the two human review queues, and record what happened.
 *
 * The pipeline is deliberately an *amplifier* rather than an actor. It can create
 * a bug finding at NEW and a suggestion at PENDING, and that is the end of its
 * authority — approving a fix, dispatching a session, and filing a roadmap
 * opportunity all remain human actions behind their existing gates. Automated
 * detection is good at spotting patterns and bad at knowing which ones matter to
 * a product this quarter, so the queue is where it stops.
 */
@Injectable()
export class UxSignalsService {
  private readonly logger = LoggerService.getInstance(UxSignalsService.name);

  constructor(
    private readonly configService: AppConfigService,
    private readonly detector: UxSignalDetectorService,
    private readonly ai: UxSignalsAiService,
    private readonly writer: UxSignalWriterService,
    private readonly bugFindingRepository: BugFindingRepository,
    private readonly goalRepository: RoadmapProductGoalRepository,
    @InjectRepository(AnalyticsSuggestion)
    private readonly suggestionRepository: Repository<AnalyticsSuggestion>,
    @InjectRepository(UxSignalScan)
    private readonly scanRepository: Repository<UxSignalScan>,
  ) {}

  /**
   * Run a scan end to end.
   *
   * Throws rather than returning a partial result when PostHog is unreachable or
   * the triage call comes back unparseable: a scan that half-ran must not record
   * counts that read like a clean run, because those counts are what a human uses
   * to judge whether the pipeline is working. The scan row keeps the error either
   * way, so a failure is visible after the fact and not only in logs.
   */
  async runScan(
    trigger: UxSignalScanTrigger,
    userId: number | null = null,
  ): Promise<UxScanOutcome> {
    if (!this.configService.posthog.enabled) {
      throw new ServiceUnavailableException(
        'PostHog query access is not configured, so there is nothing to scan.',
      );
    }
    await this.assertNoScanInFlight();

    const windowTo = isoDate(new Date());
    const windowFrom = isoDate(addDays(new Date(), -UX_SIGNAL_WINDOW_DAYS));
    const scan = await this.scanRepository.save(
      this.scanRepository.create({
        trigger,
        status: UxSignalScanStatus.RUNNING,
        windowFrom,
        windowTo,
        startedBy: userId,
        startedAt: new Date(),
      }),
    );

    try {
      const { signals, failedDetectors, totalDetectors } =
        await this.detector.detect(windowFrom, windowTo);

      // Every detector failing means PostHog itself could not be read, not that
      // the week was quiet — recording that as a clean, zero-signal scan is
      // exactly the half-run-looks-clean failure this method exists to prevent.
      if (failedDetectors.length === totalDetectors) {
        throw new ServiceUnavailableException(
          `All ${totalDetectors} UX signal detectors failed; PostHog appears to be unreachable. No signals could be read for this window.`,
        );
      }

      // Zero signals is a real, healthy answer — the week was quiet. Recording it
      // without calling the model keeps a quiet week from costing a triage call
      // every night, and keeps "found nothing" distinguishable from "failed".
      if (signals.length === 0) {
        return await this.finish(scan, {
          scanId: scan.id,
          signalsDetected: 0,
          findingsCreated: 0,
          suggestionsCreated: 0,
          skippedDuplicates: 0,
          failedDetectors,
        });
      }

      const goalNames = (await this.goalRepository.findAllOrdered()).map(
        (goal) => goal.name,
      );
      const raw = await this.ai.triage(
        await this.buildUserMessage(signals, goalNames),
      );
      if (!raw) {
        throw new ServiceUnavailableException(
          'The triage model returned nothing parseable; no items were filed.',
        );
      }

      const items = this.normalise(raw, goalNames);
      const written = await this.writer.write(
        items,
        { windowFrom, windowTo, model: this.ai.model },
        userId,
      );

      return await this.finish(scan, {
        scanId: scan.id,
        signalsDetected: signals.length,
        ...written,
        failedDetectors,
      });
    } catch (error) {
      await this.scanRepository.update(scan.id, {
        status: UxSignalScanStatus.FAILED,
        error: String(error instanceof Error ? error.message : error).slice(
          0,
          2000,
        ),
        finishedAt: new Date(),
      });
      throw error;
    }
  }

  /** The most recent scans, newest first — what the admin surface reads. */
  listScans(limit = 20): Promise<UxSignalScan[]> {
    return this.scanRepository.find({
      order: { startedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  /**
   * Whether enough time has passed for the scheduled scan to run again.
   *
   * The scheduler ticks hourly because the registry has no daily interval, so the
   * cadence lives here instead — gated on the newest scan row rather than an
   * in-memory marker, so a redeploy does not reset the clock and trigger an
   * immediate re-scan.
   */
  async isDueForScheduledScan(): Promise<boolean> {
    if (!this.configService.posthog.enabled) return false;

    const [latest] = await this.scanRepository.find({
      where: [
        { status: UxSignalScanStatus.COMPLETED },
        { status: UxSignalScanStatus.FAILED },
      ],
      order: { startedAt: 'DESC' },
      take: 1,
    });
    if (!latest) return true;

    const hoursSince =
      (Date.now() - new Date(latest.startedAt).getTime()) / 3_600_000;
    return hoursSince >= UX_SIGNAL_SCHEDULE.MIN_HOURS_BETWEEN_SCANS;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Refuse to start while another scan is genuinely in flight.
   *
   * A RUNNING row older than the stale window is treated as abandoned rather than
   * blocking: a crash or a redeploy mid-scan leaves one behind, and without this
   * a single dead row would wedge the pipeline until someone noticed by hand.
   */
  private async assertNoScanInFlight(): Promise<void> {
    const cutoff = new Date(
      Date.now() - UX_SIGNAL_SCHEDULE.STALE_RUNNING_MINUTES * 60_000,
    );
    const inFlight = await this.scanRepository.count({
      where: { status: UxSignalScanStatus.RUNNING },
    });
    if (inFlight === 0) return;

    const stale = await this.scanRepository.count({
      where: {
        status: UxSignalScanStatus.RUNNING,
        startedAt: LessThan(cutoff),
      },
    });
    if (stale === inFlight) {
      this.logger.warn(
        `[UX-SIGNALS] Clearing ${stale} abandoned RUNNING scan row(s) older than ` +
          `${UX_SIGNAL_SCHEDULE.STALE_RUNNING_MINUTES} minutes.`,
      );
      await this.scanRepository.update(
        { status: UxSignalScanStatus.RUNNING, startedAt: LessThan(cutoff) },
        {
          status: UxSignalScanStatus.FAILED,
          error: 'Abandoned: no result recorded before the staleness cutoff.',
          finishedAt: new Date(),
        },
      );
      return;
    }

    throw new ConflictException(
      'A UX Signals scan is already running. Wait for it to finish before starting another.',
    );
  }

  private async finish(
    scan: UxSignalScan,
    outcome: UxScanOutcome,
  ): Promise<UxScanOutcome> {
    await this.scanRepository.update(scan.id, {
      status: UxSignalScanStatus.COMPLETED,
      signalsDetected: outcome.signalsDetected,
      findingsCreated: outcome.findingsCreated,
      suggestionsCreated: outcome.suggestionsCreated,
      skippedDuplicates: outcome.skippedDuplicates,
      metadata: { failedDetectors: outcome.failedDetectors },
      finishedAt: new Date(),
    });
    return outcome;
  }

  /**
   * The triage payload: the signals, the live goal taxonomy, and everything a
   * human has already decided about UX items.
   *
   * The decision history is not optional context. Without it the same rage-click
   * cluster is re-filed every night and every rejection is re-argued, which is the
   * failure mode that makes people stop reading an automated queue. Newest-first
   * and bounded, so what falls off the end is the oldest decision — the one least
   * likely to be re-proposed anyway.
   */
  private async buildUserMessage(
    signals: UxSignal[],
    goalNames: string[],
  ): Promise<string> {
    const openFindings = await this.bugFindingRepository.find({
      where: { source: BugFindingSource.UX_SIGNAL },
      order: { createdAt: 'DESC' },
      take: UX_SIGNAL_CONTEXT_LIMITS.OPEN_FINDINGS,
    });
    const pending = await this.suggestionRepository.find({
      where: {
        source: AnalyticsSuggestionSource.UX_SIGNAL,
        status: AnalyticsSuggestionStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
      take: UX_SIGNAL_CONTEXT_LIMITS.PENDING_SUGGESTIONS,
    });
    const rejected = await this.suggestionRepository.find({
      where: {
        source: AnalyticsSuggestionSource.UX_SIGNAL,
        status: AnalyticsSuggestionStatus.REJECTED,
      },
      order: { createdAt: 'DESC' },
      take: UX_SIGNAL_CONTEXT_LIMITS.REJECTED_SUGGESTIONS,
    });

    const excerpt = (value: string) =>
      value.slice(0, UX_SIGNAL_CONTEXT_LIMITS.EXCERPT).replace(/\s+/g, ' ');

    const blocks = [
      `WINDOW: last ${UX_SIGNAL_WINDOW_DAYS} days.`,
      '',
      'SIGNALS',
      JSON.stringify(signals, null, 2),
      '',
      'LIVE PRODUCT GOALS (copy a name exactly, or use null)',
      goalNames.length ? goalNames.map((n) => `- ${n}`).join('\n') : '(none)',
      '',
      'UX FINDINGS ALREADY IN THE BUG QUEUE — do not re-file these',
      openFindings.length
        ? openFindings
            .map(
              (f) => `- [${f.status}] ${excerpt(f.title)} (${f.symbol ?? '—'})`,
            )
            .join('\n')
        : '(none)',
      '',
      'UX SUGGESTIONS AWAITING A DECISION — do not re-propose these',
      pending.length
        ? pending.map((s) => `- ${excerpt(s.title)}`).join('\n')
        : '(none)',
      '',
      'UX SUGGESTIONS PREVIOUSLY REJECTED — these are standing decisions',
      rejected.length
        ? rejected
            .map(
              (s) =>
                `- ${excerpt(s.title)}${
                  s.rejectedReason
                    ? ` — reason: ${excerpt(s.rejectedReason)}`
                    : ' — no reason given'
                }`,
            )
            .join('\n')
        : '(none)',
    ];

    return blocks.join('\n');
  }

  /**
   * Validate and clamp the model's output.
   *
   * Every field is treated as untrusted. The caps are enforced here rather than
   * relied on from the prompt, because a prompt is a request and a review queue
   * filling up is a real cost — and because an admin can edit that prompt in
   * Prompt Management, so its instructions cannot be a load-bearing guarantee.
   *
   * A goal name the taxonomy does not contain becomes null rather than being
   * stored. Unvalidated model taxonomy once polluted more than half the roadmap's
   * goal data; the same guard lives in RoadmapAiService.classifyGoal.
   */
  private normalise(raw: RawTriageItem[], goalNames: string[]): TriagedItem[] {
    const goals = new Set(goalNames);
    const items: TriagedItem[] = [];
    let bugs = 0;
    let improvements = 0;

    for (const entry of raw) {
      const title = this.str(entry.title);
      const body = this.str(entry.body);
      const route = this.str(entry.route);
      // A title-less or body-less item has nothing for a reviewer to act on, and
      // route is what the finding dedupes by — drop rather than invent.
      if (!title || !body || !route) continue;

      const kind =
        this.str(entry.kind) === UxSignalKind.BUG
          ? UxSignalKind.BUG
          : UxSignalKind.IMPROVEMENT;

      if (kind === UxSignalKind.BUG) {
        if (bugs >= UX_SIGNAL_LIMITS.MAX_BUGS_PER_SCAN) continue;
        bugs += 1;
      } else {
        if (improvements >= UX_SIGNAL_LIMITS.MAX_SUGGESTIONS_PER_SCAN) continue;
        improvements += 1;
      }

      const suggestedGoal = this.str(entry.suggestedGoal);
      items.push({
        kind,
        title: title.slice(0, UX_SIGNAL_FIELD_LIMITS.TITLE),
        body: body.slice(0, UX_SIGNAL_FIELD_LIMITS.BODY),
        severity: this.severity(entry.severity),
        rationale: this.str(entry.rationale).slice(
          0,
          UX_SIGNAL_FIELD_LIMITS.RATIONALE,
        ),
        evidence: Array.isArray(entry.evidence)
          ? entry.evidence
              .map((line) => this.str(line))
              .filter(Boolean)
              .slice(0, UX_SIGNAL_FIELD_LIMITS.EVIDENCE_ITEMS)
              .map((line) =>
                line.slice(0, UX_SIGNAL_FIELD_LIMITS.EVIDENCE_ITEM),
              )
          : [],
        route,
        target: this.str(entry.target) || undefined,
        suggestedGoal: goals.has(suggestedGoal) ? suggestedGoal : null,
        confidence: this.str(entry.confidence) || undefined,
      });
    }

    return items;
  }

  private str(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  /** Unrecognised severity becomes MEDIUM: never silently the most alarming option. */
  private severity(value: unknown): BugFindingSeverity {
    const raw = this.str(value).toLowerCase();
    return (
      Object.values(BugFindingSeverity).find((s) => s === raw) ??
      BugFindingSeverity.MEDIUM
    );
  }
}
