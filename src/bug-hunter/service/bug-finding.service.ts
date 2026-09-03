import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { User } from 'src/user/entity/user.entity';
import { RoadmapOpportunity } from 'src/product-roadmap/entity/roadmap-opportunity.entity';
import {
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
} from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import { BugHunterNotificationService } from './bug-hunter-notification.service';
import { BugHunterService } from './bug-hunter.service';
import { releaseLinkedRoadmapOpportunity } from '../util/release-linked-roadmap-opportunity.util';
import { effectiveStage } from '../util/bug-finding-stage.util';
import {
  fixDidNotHold,
  needsYourAnswer,
  STALE_ESCALATION_DIGEST_TITLE,
  stillWaitingOnAnswers,
} from '../constants/bug-hunter-voice';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugFinding } from '../entity/bug-finding.entity';
import {
  BugFindingRepository,
  ListBugFindingsFilter,
} from '../repository/bug-finding.repository';
import {
  BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES,
  BugFindingDecisionReason,
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
} from '../enum/bug-finding.enum';
import {
  BUG_FINDING_DECLINE_SUPPRESSION_MS,
  BUG_FINDING_REGRESSION_WINDOW_MS,
  BUG_HUNT_KNOWN_NON_BUGS_LIMIT,
} from '../constants/bug-hunter.constants';

/** One finder's raw output for one bug — the shape `.claude/workflows/bug-hunt.mjs` reports. */
export interface RawFinding {
  source: BugFindingSource;
  /**
   * Optional because the column is nullable and `dedupeKey` takes null: a
   * production-log cluster often spans no single file. Declared required here
   * until RawBugFindingDto was written, which was optimism rather than a
   * contract — an omitted `file` has always inserted fine.
   */
  file?: string;
  description: string;
  evidence?: string;
  severity?: BugFindingSeverity;
  /** Optional: the column defaults to false, so an omitted value has always meant false. */
  proven?: boolean;
  /** Optional: as `proven`. */
  touchesGuardedPath?: boolean;
  /**
   * The function, class, route, component or endpoint the bug sits on. Optional
   * because not every finder can name one (a prod-log cluster often cannot), but
   * supplying it is what makes dedup precise rather than prose-dependent.
   */
  symbol?: string;
  /** Present only for source=reported_bug — the pre-existing NEW row created at roadmap-intake time. */
  reportedBugId?: string;
}

/**
 * Who reported a bug and what their client silently captured at the time —
 * read from the linked `roadmap_opportunities` row.
 *
 * Bugs no longer render on the roadmap board, so this is no longer reachable
 * anywhere else: without it a real user's report and an agent-found lint error
 * are indistinguishable rows.
 */
export interface ReportedBugContext {
  opportunityId: string;
  reporterSource: RoadmapOpportunitySource;
  reportedBy: number | null;
  reportedByName: string | null;
  tenantId: string | null;
  reporterContext: Record<string, any> | null;
  reportedAt: Date;
}

/** What `enrich` adds to a row: things that live in other tables and are resolved at read time. */
export interface BugFindingEnrichment {
  report: ReportedBugContext | null;
  stageOverriddenByName: string | null;
}

export type EnrichedBugFinding = BugFinding & BugFindingEnrichment;

/**
 * Statuses a pipeline PATCH may still set on an already-declined finding.
 *
 * Both are terminal declines, so re-stating one is a retry rather than a
 * revival — a runner whose PATCH timed out and retried must not get a 403 for
 * asking twice. Everything else is refused; see `setStatus`.
 */
const DECLINED_TARGET_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.DISMISSED,
  BugFindingStatus.REJECTED,
];

/**
 * Owns the `bug_findings` lifecycle: persisting what the finders discover,
 * every status transition from NEW through to a terminal state, and the
 * escalation ask/answer exchange.
 *
 * Deliberately separate from BugHunterService (which owns the kill switch and
 * the run/event transcript) — findings are the comprehensive table's data,
 * runs are "one sweep happened"; a run's totals are recomputed from its
 * findings by the controller layer, not the other way around.
 */
@Injectable()
export class BugFindingService {
  private readonly logger = LoggerService.getInstance(BugFindingService.name);

  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly notificationService: BugHunterNotificationService,
    @InjectRepository(RoadmapOpportunity)
    private readonly roadmapOpportunityRepository: Repository<RoadmapOpportunity>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    // Appended last, and safe to inject: BugHunterService depends on
    // repositories and the notification service only, never back on this —
    // the module's one-way edge that keeps `editDescription` able to write to
    // the shared event timeline without a circular provider.
    private readonly bugHunterService: BugHunterService,
  ) {}

  async getOne(id: string): Promise<BugFinding> {
    const finding = await this.findingRepository.findOne({ where: { id } });
    if (!finding) throw new NotFoundException(`Bug finding ${id} not found`);
    return finding;
  }

  list(
    filter: ListBugFindingsFilter,
  ): Promise<{ items: BugFinding[]; count: number }> {
    return this.findingRepository.listPaginated(filter);
  }

  /**
   * Resolves the cross-table bits of a page of findings in TWO queries total,
   * regardless of page size — the reporter behind each human-filed bug, and the
   * name of whoever pinned a stage.
   *
   * Batched deliberately. The obvious shape is a per-row lookup inside the DTO
   * mapper, which on a 50-row page is 100 round trips to render one table.
   *
   * Enrichment is additive and never throws: a finding whose roadmap row was
   * hard-deleted, or whose reporter's account is gone, comes back with `report`
   * null or `reportedByName` null rather than failing the whole list. The bug
   * table has to render for bugs whose provenance we have partly lost — that is
   * exactly the row someone is trying to look at.
   */
  async enrich(findings: BugFinding[]): Promise<EnrichedBugFinding[]> {
    if (findings.length === 0) return [];

    const reportedBugIds = [
      ...new Set(
        findings
          .map((f) => f.reportedBugId)
          .filter((id): id is string => id != null),
      ),
    ];
    const opportunities = reportedBugIds.length
      ? await this.roadmapOpportunityRepository.find({
          where: { id: In(reportedBugIds) },
          // withDeleted: a soft-deleted roadmap row is still the record of who
          // reported this bug, and the bug itself is very much still open.
          withDeleted: true,
        })
      : [];
    const byOpportunityId = new Map(opportunities.map((o) => [o.id, o]));

    // One name lookup covering both the reporters and the stage-pinners.
    const userIds = [
      ...new Set(
        [
          ...opportunities.map((o) => o.createdBy),
          ...findings.map((f) => f.stageOverriddenBy),
        ].filter((id): id is number => id != null),
      ),
    ];
    const users = userIds.length
      ? await this.userRepository.find({
          where: { id: In(userIds) },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name ?? null]));

    return findings.map((finding) => {
      const opportunity = finding.reportedBugId
        ? byOpportunityId.get(finding.reportedBugId)
        : undefined;

      return Object.assign(finding, {
        report: opportunity
          ? {
              opportunityId: opportunity.id,
              reporterSource: opportunity.source,
              reportedBy: opportunity.createdBy ?? null,
              reportedByName: nameById.get(opportunity.createdBy) ?? null,
              tenantId: opportunity.tenantId ?? null,
              reporterContext: opportunity.reporterContext ?? null,
              reportedAt: opportunity.createdAt,
            }
          : null,
        stageOverriddenByName:
          finding.stageOverriddenBy != null
            ? (nameById.get(finding.stageOverriddenBy) ?? null)
            : null,
      });
    });
  }

  /** `enrich` for a single row — the shape every one-finding endpoint returns. */
  async enrichOne(finding: BugFinding): Promise<EnrichedBugFinding> {
    const [enriched] = await this.enrich([finding]);
    return enriched;
  }

  /**
   * Pins the coarse roadmap stage by hand, or (with `stage: null`) hands the row
   * back to derivation.
   *
   * Why a manual stage exists at all: the derived one reads `status`, which only
   * moves when BUG HUNTER moves it. A bug someone fixed with an ordinary
   * hand-written PR leaves the pipeline untouched, so its status sits at NEW
   * forever while the bug is in fact shipped — and since bugs no longer appear on
   * the roadmap board, there is no other screen on which anyone would correct it.
   *
   * Why the pin then STICKS rather than yielding to the next transition: the
   * admin who set it is the only party who knows about the out-of-band fix. A
   * later sweep re-finding the same bug and dragging the stage back to New would
   * overwrite the one accurate value on the row with a guess.
   *
   * Setting the stage to exactly what it already derives to is still recorded as
   * an override, on purpose — "I checked this and it is right" is a claim worth
   * keeping, and it stops a later transition from silently moving it.
   */
  async setStage(
    id: string,
    stage: RoadmapOpportunityStage | null,
    userId: number,
  ): Promise<BugFinding> {
    const finding = await this.getOne(id);
    const before = effectiveStage(finding);

    await this.findingRepository.update(id, {
      stageOverride: stage,
      // Cleared together with the override: "pinned by nobody at no time" is the
      // only honest reading of a derived stage, and leaving the old stamps behind
      // would make the drawer claim a pin that is no longer in force.
      stageOverriddenBy: stage ? userId : null,
      stageOverriddenAt: stage ? new Date() : null,
    });
    const after = await this.getOne(id);
    const now = effectiveStage(after);

    // Written to the shared event timeline, not just the row: the drawer's
    // timeline is where an admin reconstructs why a bug says what it says, and a
    // stage that changed with no entry beside it reads as the pipeline having
    // done it.
    // Runless, for the same reason editDescription's event is: an admin corrects
    // a stage long after the run that found the bug has closed, and `appendEvent`
    // rightly refuses to write into a closed run.
    await this.bugHunterService.appendFindingEvent({
      findingId: id,
      repo: after.repo,
      stage: BugHuntEventStage.STAGE_CHANGED,
      summary: stage
        ? `User ${userId} set the stage to ${now} by hand` +
          (before === now ? ' (unchanged, now pinned).' : ` (was ${before}).`)
        : `User ${userId} returned the stage to automatic (now ${now}).`,
      payload: {
        changedBy: userId,
        from: before,
        to: now,
        pinned: stage != null,
      },
    });

    return after;
  }

  /** The finding opened for a given roadmap bug report, if one ever was. */
  findByReportedBugId(reportedBugId: string): Promise<BugFinding | null> {
    return this.findingRepository.findByReportedBugId(reportedBugId);
  }

  listNewReportedBugs(): Promise<BugFinding[]> {
    return this.findingRepository.listNewReportedBugs();
  }

  listApprovedForRepo(repo: string): Promise<BugFinding[]> {
    return this.findingRepository.listApprovedForRepo(repo);
  }

  /**
   * What this repo's reviewers already ruled were not bugs — the sweep
   * prompt's "already settled" block.
   *
   * Restricted to finder-error declines by the repository query, and the
   * reason for that restriction is worth restating at the call site: showing a
   * sweep a list of real bugs the team chose not to fix would teach it to stop
   * reporting real bugs, which is a far more expensive failure than the
   * duplicate filing this is meant to prevent.
   */
  async listKnownNonBugs(repo: string): Promise<
    Array<{
      title: string;
      file: string | null;
      symbol: string | null;
      reason: string;
      note: string | null;
    }>
  > {
    const rows = await this.findingRepository.listRecentFinderErrors(
      repo,
      new Date(Date.now() - BUG_FINDING_DECLINE_SUPPRESSION_MS),
      BUG_HUNT_KNOWN_NON_BUGS_LIMIT,
    );
    return rows.map((row) => ({
      title: row.title,
      file: row.file ?? null,
      symbol: row.symbol ?? null,
      // Non-null in practice — the query filters on it — but the column is
      // nullable, and a `null` reaching the prompt as "judged null" would read
      // as a defect to whoever saw it.
      reason: row.decisionReason ?? 'declined',
      note: row.decisionNote ?? null,
    }));
  }

  /** A coordinated fix's ordered steps — empty for an ordinary single-repo bug. */
  listSteps(parentFindingId: string): Promise<BugFinding[]> {
    return this.findingRepository.listChildren(parentFindingId);
  }

  /**
   * Upserts one Discover round's findings against `bug_findings`. Three cases:
   *
   *  - source=reported_bug: the row already exists (created the moment the
   *    bug was filed — see RoadmapOpportunityService.create) and is only ever
   *    updated here, never re-inserted.
   *  - a dedupe key match against an OPEN row for this repo: the same bug
   *    surfaced again on a later run — touch it, don't duplicate it.
   *  - otherwise: a genuinely new finding.
   *
   * Returns the persisted rows in the same order as the input, so the caller
   * can zip each one back to the finder's own in-memory object and reference
   * `.id` in later report/fix calls.
   */
  async persistFindings(
    runId: string,
    repo: string,
    findings: RawFinding[],
  ): Promise<BugFinding[]> {
    const results: BugFinding[] = [];

    for (const finding of findings) {
      if (finding.reportedBugId) {
        const existing = await this.findingRepository.findByReportedBugId(
          finding.reportedBugId,
        );
        if (existing) {
          await this.findingRepository.update(existing.id, {
            runId,
            repo,
            proven: finding.proven,
            touchesGuardedPath: finding.touchesGuardedPath,
            evidence: finding.evidence ?? existing.evidence,
            severity: finding.severity ?? existing.severity,
          });
          results.push(await this.getOne(existing.id));
          continue;
        }
      }

      const dedupeKey = BugFindingRepository.dedupeKey(
        finding.file,
        finding.source,
        finding.symbol,
        finding.description,
      );
      let existingOpen = await this.findingRepository.findOpenByDedupeKey(
        repo,
        dedupeKey,
      );

      // Transition path. A row stored before its finder learned to emit
      // `symbol` is keyed on the description fingerprint, so once the finder
      // DOES supply one the precise key above cannot match it — and we would
      // open a second row for a bug we already have. That is the very
      // duplication this key was reworked to stop, so when a symbol is present
      // and missed, fall back to the symbol-less key before inserting.
      //
      // Only ever in this direction: a finding that supplies no symbol must not
      // adopt a symbol-keyed row, because the fingerprint is the fuzzy half and
      // letting it claim precise rows would merge distinct bugs.
      if (!existingOpen && finding.symbol?.trim()) {
        existingOpen = await this.findingRepository.findOpenByDedupeKey(
          repo,
          BugFindingRepository.dedupeKey(
            finding.file,
            finding.source,
            null,
            finding.description,
          ),
        );
      }

      if (existingOpen) {
        // Adopt the sharper identity when this run supplied one: record the
        // symbol and re-key the row, so the next sweep matches on the first
        // lookup instead of re-walking this transition every night. Never
        // overwrite a symbol we already have with nothing.
        const adoptSymbol = Boolean(finding.symbol?.trim());
        await this.findingRepository.update(existingOpen.id, {
          runId,
          ...(adoptSymbol && !existingOpen.symbol
            ? { symbol: finding.symbol, dedupeKey }
            : {}),
        });
        results.push(await this.getOne(existingOpen.id));
        continue;
      }

      // Already answered. A sweep re-reads the same code every night, so
      // without this a refuted or rejected finding came back as a fresh row
      // the next time a finder noticed it — the reviewer's decision lasted one
      // night, and the queue's oldest entries were the ones already dealt
      // with. The declined row is touched and returned rather than a new one
      // inserted, so the sweep sees a `rejected`/`dismissed` status come back
      // and knows not to work on it (the protocol says so explicitly, and
      // `setStatus` refuses the transition anyway).
      const declined =
        await this.findingRepository.findRecentlyDeclinedByDedupeKey(
          repo,
          dedupeKey,
          new Date(Date.now() - BUG_FINDING_DECLINE_SUPPRESSION_MS),
        );
      if (declined) {
        const rediscoveredCount =
          Number(declined.metadata?.rediscoveredCount ?? 0) + 1;
        await this.findingRepository.update(declined.id, {
          metadata: {
            ...declined.metadata,
            rediscoveredCount,
            lastRediscoveredAt: new Date().toISOString(),
          } as Record<string, any>,
        });
        // Said out loud on the timeline: silently dropping a finder's output
        // is indistinguishable, later, from the finder having missed it.
        await this.bugHunterService.appendFindingEvent({
          findingId: declined.id,
          repo,
          stage: BugHuntEventStage.RECURRENCE_SUPPRESSED,
          summary:
            `A sweep found this again (${rediscoveredCount} time${rediscoveredCount === 1 ? '' : 's'} since it was ` +
            `${declined.status}${declined.decisionReason ? ` as ${declined.decisionReason}` : ''}). ` +
            `Not re-filed — the existing decision stands.`,
          payload: {
            runId,
            rediscoveredCount,
            decisionReason: declined.decisionReason ?? null,
          },
        });
        results.push(await this.getOne(declined.id));
        continue;
      }

      // A fix that did not hold. Both rows are marked, because the two
      // drawers are read by different people at different times: whoever
      // triages the new bug needs to know a fix was already attempted, and
      // whoever reviews the shipped fix needs to know it failed. Only linked
      // on an exact dedupe-key match, never on the fuzzy description
      // fingerprint alone — see the guard below.
      const shipped =
        await this.findingRepository.findRecentlyShippedByDedupeKey(
          repo,
          dedupeKey,
          new Date(Date.now() - BUG_FINDING_REGRESSION_WINDOW_MS),
        );
      // The fingerprint fallback collapses rewordings, which is right for
      // dedupe and too loose for this: telling someone their fix regressed
      // when it did not is worse than not telling them, so a regression is
      // only claimed when the finder named a `symbol` (or a `file`, for a log
      // cluster) and the key is therefore a real code coordinate.
      const regressionOf =
        shipped && (finding.symbol?.trim() || finding.file?.trim())
          ? shipped
          : null;

      const saved = await this.findingRepository.save(
        this.findingRepository.create({
          runId,
          repo,
          source: finding.source,
          title: finding.description.slice(0, 200),
          description: finding.description,
          file: finding.file ?? null,
          symbol: finding.symbol ?? null,
          evidence: finding.evidence ?? null,
          severity: finding.severity ?? null,
          // Same rows as before — the column defaults these to false, so an
          // omitted value already landed as false. Naming it just stops the
          // insert depending on TypeORM skipping an undefined.
          proven: finding.proven ?? false,
          touchesGuardedPath: finding.touchesGuardedPath ?? false,
          reportedBugId: finding.reportedBugId ?? null,
          dedupeKey,
          status: BugFindingStatus.NEW,
          ...(regressionOf
            ? { metadata: { regressionOf: regressionOf.id } }
            : {}),
        }),
      );

      if (regressionOf) {
        await this.markRegression(saved, regressionOf, runId);
      }

      results.push(saved);
    }

    return results;
  }

  /**
   * Records that a shipped fix has come undone: marks the old row, annotates
   * both timelines, and tells an admin.
   *
   * Best-effort by construction — every write here is an annotation on a
   * finding that has already been inserted, and a failed annotation must not
   * lose the finding. That is the same contract `BugHunterNotificationService`
   * itself keeps.
   */
  private async markRegression(
    regression: BugFinding,
    original: BugFinding,
    runId: string,
  ): Promise<void> {
    try {
      await this.findingRepository.update(original.id, {
        metadata: {
          ...original.metadata,
          regressed: true,
          regressedByFindingId: regression.id,
          regressedAt: new Date().toISOString(),
        } as Record<string, any>,
      });

      const shippedAt = original.releasedAt ?? original.updatedAt;
      const daysSinceFix = shippedAt
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(shippedAt).getTime()) / 86_400_000,
            ),
          )
        : 0;

      await this.bugHunterService.appendFindingEvent({
        findingId: regression.id,
        repo: regression.repo,
        stage: BugHuntEventStage.REGRESSED,
        summary:
          `This is a bug I already fixed ${daysSinceFix} day${daysSinceFix === 1 ? '' : 's'} ago — it is back. ` +
          `The earlier finding is ${original.id}${original.prUrl ? ` (${original.prUrl})` : ''}.`,
        payload: { regressionOf: original.id, runId, daysSinceFix },
      });
      await this.bugHunterService.appendFindingEvent({
        findingId: original.id,
        repo: original.repo,
        stage: BugHuntEventStage.REGRESSED,
        summary: `The fix for this did not hold — the same bug was found again as ${regression.id}.`,
        payload: { regressedByFindingId: regression.id, runId },
      });

      await this.notificationService.notify({
        level: BugHunterNotificationLevel.ACTION_NEEDED,
        ...fixDidNotHold(regression.title, regression.repo, daysSinceFix),
        findingId: regression.id,
        runId,
        repo: regression.repo,
      });
    } catch (error) {
      this.logger.warn(
        `Could not link finding ${regression.id} as a regression of ${original.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Raises one notification when questions have gone unanswered long enough
   * that nothing is moving on those bugs.
   *
   * ## Why this is needed at all
   *
   * The inbox is pull-only by design: no email, no push, and Slack was removed
   * deliberately. That is fine for a question asked during an on-demand fix
   * session, where an admin has just pressed a button and is probably still
   * looking at the tab — that path waits for an answer. It is not fine for an
   * unattended sweep at 2am, which asks and moves on. Without this, such a
   * question sits at NEEDS_INPUT unread indefinitely, and the bug silently
   * stops progressing with nobody aware that it is waiting on them.
   *
   * Runs hourly but speaks at most once a day (see `existsWithTitleSince`), and
   * says nothing at all when there is nothing waiting — the inbox's own rule is
   * that a quiet, successful night produces no message.
   */
  async raiseStaleEscalationDigest(
    staleAfterMs: number,
    quietPeriodMs: number,
    now = new Date(),
  ): Promise<{ notified: boolean; staleCount: number }> {
    const stale = await this.findingRepository.listStaleNeedsInput(
      new Date(now.getTime() - staleAfterMs),
    );
    if (stale.length === 0) return { notified: false, staleCount: 0 };

    // Already said this today. Repeating it daily is a nudge; repeating it
    // hourly is what turns an inbox into wallpaper.
    const alreadySaid = await this.notificationService.wasRaisedSince(
      STALE_ESCALATION_DIGEST_TITLE,
      new Date(now.getTime() - quietPeriodMs),
    );
    if (alreadySaid) return { notified: false, staleCount: stale.length };

    // listStaleNeedsInput orders oldest-first, so the head is the worst case.
    const oldest = stale[0].updatedAt ?? now;
    const oldestDays = Math.floor(
      (now.getTime() - new Date(oldest).getTime()) / 86_400_000,
    );

    await this.notificationService.notify({
      level: BugHunterNotificationLevel.ACTION_NEEDED,
      // No findingId: this is about several bugs at once, and pinning it to one
      // of them would make the inbox row open the wrong drawer.
      findingId: null,
      ...stillWaitingOnAnswers(
        stale.map((finding) => finding.title),
        oldestDays,
      ),
    });
    return { notified: true, staleCount: stale.length };
  }

  /**
   * Generic status/field transition, used throughout Verify/Fix: dismiss on
   * refute, fixing on fix-start, pr_opened/merged/failed on fix-finish, and
   * needs_input + a question on genuine escalation.
   *
   * Escalating raises the same action-needed notification in the Bug Hunter
   * inbox as a run-level escalation (see BugHunterService.appendEvent) — only
   * once per distinct question, so a later run re-polling an already-asked
   * finding doesn't re-notify.
   *
   * Merging also closes the reporter's roadmap card. This is the merge path
   * that actually runs most of the time: a green non-guarded fix merges its own
   * PR with `gh pr merge --admin` and then PATCHes here (see `bug-fix-prompt`),
   * and the nightly sweep's auto-merges land here too. The reconcile pass only
   * ever sees the PRs a human merged by hand, so without this a reported bug
   * could ship with its card still sitting at the stage it was filed in.
   */
  async setStatus(
    id: string,
    patch: {
      status?: BugFindingStatus;
      prUrl?: string;
      escalationQuestion?: string;
      decisionReason?: BugFindingDecisionReason;
      decisionNote?: string;
      /** The Verify phase's lowest verifier certainty, 0-1. Stored on `metadata`. */
      confidence?: number;
      /** The individual refute verdicts behind that number, for the drawer. */
      verifierVotes?: Record<string, any>[];
    },
  ): Promise<BugFinding> {
    const before = await this.getOne(id);

    // A bug somebody already declined must not be walked back into the
    // pipeline. This is the enforcement half of the dedupe suppression above:
    // a sweep that re-finds a rejected bug gets that row back and is told in
    // its protocol to leave it alone, and if it ignores that, this refuses
    // rather than quietly re-opening a decision a human made. Only ACTIVE
    // targets are blocked — re-stating `dismissed` on a dismissed row is a
    // harmless retry, and blocking it would turn an idempotent call into an
    // error.
    const isDeclined =
      before.status === BugFindingStatus.REJECTED ||
      before.status === BugFindingStatus.DISMISSED;
    const revives =
      patch.status != null &&
      patch.status !== before.status &&
      !DECLINED_TARGET_STATUSES.includes(patch.status);
    if (isDeclined && revives) {
      throw new ForbiddenException(
        `Finding ${id} was already ${before.status}` +
          (before.decisionReason ? ` (${before.decisionReason})` : '') +
          `. A declined bug can't be moved back into the pipeline — start a fresh fix session if the decision has changed.`,
      );
    }

    // A verifier's certainty is only meaningful in [0,1]; a model that
    // reports 95 rather than 0.95 would otherwise make every finding look
    // maximally confident, which is the failure direction that matters.
    const confidence =
      patch.confidence != null &&
      Number.isFinite(patch.confidence) &&
      patch.confidence >= 0 &&
      patch.confidence <= 1
        ? patch.confidence
        : undefined;
    const hasMetadataPatch =
      confidence !== undefined || patch.verifierVotes !== undefined;

    await this.findingRepository.update(id, {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.prUrl !== undefined ? { prUrl: patch.prUrl } : {}),
      ...(patch.escalationQuestion !== undefined
        ? { escalationQuestion: patch.escalationQuestion }
        : {}),
      // Recorded for a pipeline dismissal exactly as for a human rejection:
      // the Verify phase refuting a finding is the same kind of claim as an
      // admin rejecting one, and the metrics endpoint counts them together.
      ...(patch.decisionReason !== undefined
        ? { decisionReason: patch.decisionReason }
        : {}),
      ...(patch.decisionNote !== undefined
        ? { decisionNote: patch.decisionNote?.trim() || null }
        : {}),
      // Stamped on a dismissal so the decline lookup and the metrics window
      // have a decision date to work from. `decidedBy` stays null: no human
      // decided this one, and that absence is what distinguishes the two.
      ...(patch.status === BugFindingStatus.DISMISSED && !before.decidedAt
        ? { decidedAt: new Date() }
        : {}),
      ...(hasMetadataPatch
        ? {
            metadata: {
              ...before.metadata,
              ...(confidence !== undefined ? { confidence } : {}),
              ...(patch.verifierVotes !== undefined
                ? { verifierVotes: patch.verifierVotes }
                : {}),
            } as Record<string, any>,
          }
        : {}),
    });
    const after = await this.getOne(id);

    if (
      patch.status === BugFindingStatus.DISMISSED &&
      before.status !== BugFindingStatus.DISMISSED
    ) {
      await this.bugHunterService.appendFindingEvent({
        findingId: id,
        repo: after.repo,
        stage: BugHuntEventStage.DECISION_RECORDED,
        summary:
          `Dismissed by verification${patch.decisionReason ? ` (${patch.decisionReason})` : ''}` +
          (patch.decisionNote?.trim() ? `: ${patch.decisionNote.trim()}` : '.'),
        payload: {
          reason: patch.decisionReason ?? null,
          note: patch.decisionNote?.trim() ?? null,
          confidence: confidence ?? null,
        },
      });
    }

    const isNewEscalation =
      patch.status === BugFindingStatus.NEEDS_INPUT &&
      patch.escalationQuestion &&
      patch.escalationQuestion !== before.escalationQuestion;
    if (isNewEscalation) {
      await this.notificationService.notify({
        level: BugHunterNotificationLevel.ACTION_NEEDED,
        ...needsYourAnswer(after.title, patch.escalationQuestion),
        findingId: after.id,
        runId: after.runId,
        repo: after.repo,
      });
    }

    if (patch.status === BugFindingStatus.MERGED) {
      await releaseLinkedRoadmapOpportunity(
        this.roadmapOpportunityRepository,
        after,
        this.logger,
      );
    }

    return after;
  }

  /** The pipeline's bounded poll target — see the fix agent's escalation-wait loop. */
  async getAnswerIfReady(
    id: string,
  ): Promise<{ answered: boolean; answer: string | null }> {
    const finding = await this.getOne(id);
    return {
      answered: finding.escalationAnswer != null,
      answer: finding.escalationAnswer ?? null,
    };
  }

  /** An admin answering an open escalation. Status stays NEEDS_INPUT — the pipeline transitions it once it consumes the answer. */
  async recordAnswer(
    id: string,
    answer: string,
    userId: number,
  ): Promise<BugFinding> {
    const finding = await this.getOne(id);
    if (finding.status !== BugFindingStatus.NEEDS_INPUT) {
      throw new ForbiddenException(
        `Finding ${id} is ${finding.status}, not waiting on input.`,
      );
    }
    await this.findingRepository.update(id, {
      escalationAnswer: answer,
      escalationAnsweredBy: userId,
      escalationAnsweredAt: new Date(),
    });
    return this.getOne(id);
  }

  /** Manual mode: admin approves a verified finding for the next Fix phase to pick up. */
  async approve(id: string, userId: number): Promise<BugFinding> {
    const finding = await this.getOne(id);
    if (finding.status !== BugFindingStatus.PENDING_APPROVAL) {
      throw new ForbiddenException(
        `Finding ${id} is ${finding.status}, not pending approval.`,
      );
    }
    await this.findingRepository.update(id, {
      status: BugFindingStatus.APPROVED,
      decidedBy: userId,
      decidedAt: new Date(),
    });
    return this.getOne(id);
  }

  /**
   * An admin rewrites the bug's description before putting Bug Hunter on it.
   *
   * This is an input-quality edit, not a status change: `description` is the
   * entire statement of the problem in the fix agent's prompt (see
   * `buildFixSessionPrompt`) and the text the repo classifier reads to decide
   * which codebase the bug even belongs to. A one-line human report — "search
   * is broken" — and a nine-paragraph finder essay fail the same fix session
   * for the same reason, and before this the only remedy was to reject the bug
   * and file a better one.
   *
   * Three things it deliberately does NOT do:
   *
   *  - **Move the status.** Editing is not approving. The admin still presses
   *    "Put me on it" afterwards, and a Manual-mode finding still needs its
   *    approval.
   *  - **Touch the linked `roadmap_opportunities` row** for a reported bug.
   *    That is the reporter's own account of what they saw, and it stays their
   *    words — this rewrites the brief Bug Hunter works from, not the report
   *    of record.
   *  - **Recompute `dedupeKey`.** It is derived from the FINDER's text, so
   *    leaving it alone is what lets tonight's sweep re-find this same bug and
   *    touch this row rather than opening a duplicate beside it.
   */
  async editDescription(
    id: string,
    description: string,
    userId: number,
  ): Promise<BugFinding> {
    const finding = await this.getOne(id);
    if (!BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES.includes(finding.status)) {
      throw new ForbiddenException(
        `Finding ${id} is ${finding.status} — its description can't be changed from there.`,
      );
    }

    const next = description.trim();
    // The invariant, not just DTO hygiene: `bug_findings.description` is NOT
    // NULL and every fix prompt states the bug as nothing but this text, so a
    // blank one is a fix session asked to fix "". `@IsNotEmpty` alone does not
    // catch it — it accepts "   " — which is how a whitespace-only PATCH
    // stored an empty brief the first time this endpoint was exercised.
    if (!next) {
      throw new BadRequestException(
        'A bug description cannot be blank — it is the only statement of the problem the fix agent gets.',
      );
    }
    // A no-op save would put a "description edited" row on the work log that
    // says nothing happened, which is worse than silence on a timeline whose
    // whole job is explaining why a fix session went the way it did.
    if (next === finding.description) return finding;

    await this.findingRepository.update(id, {
      description: next,
      // Captured on the FIRST edit only — a later edit must not overwrite the
      // finder's original words with the previous admin's rewrite.
      originalDescription: finding.originalDescription ?? finding.description,
      descriptionEditedBy: userId,
      descriptionEditedAt: new Date(),
    });

    // Runless, like the release lifecycle's events: an admin edits a bug long
    // after the run that found it has closed, and `appendEvent` rightly
    // refuses to write into a closed run.
    await this.bugHunterService.appendFindingEvent({
      findingId: id,
      repo: finding.repo,
      stage: BugHuntEventStage.DESCRIPTION_EDITED,
      summary: `User ${userId} rewrote this bug's description.`,
      // The before/after both go in the payload, not just the new text: the
      // question a reviewer brings to this row is what changed, and
      // `original_description` alone can't answer it after a second edit.
      payload: { editedBy: userId, from: finding.description, to: next },
    });

    return this.getOne(id);
  }

  /**
   * Admin declines to fix it — valid from NEW (a reported bug never even
   * triaged) or PENDING_APPROVAL.
   *
   * `reason` is required, and that is a deliberate cost imposed on the
   * commonest action on this page. It buys two things nothing else can:
   *
   *  - the next sweep is told what it got wrong, so it stops re-filing this
   *    same non-bug every night (see `buildSweepPrompt`'s known-non-bugs
   *    block and `persistFindings`' suppression);
   *  - `BugHunterMetricsService` can finally answer how often Bug Hunter is
   *    right, which is the number that decides whether it may fix things
   *    unattended.
   *
   * The friction is kept small in the UI rather than here — a pick-list, one
   * reason for a whole bulk batch — because the alternative (an optional
   * field) is a field that is empty exactly when the reviewer was in a hurry,
   * which is most of the time.
   */
  async reject(
    id: string,
    userId: number,
    reason: BugFindingDecisionReason,
    note?: string | null,
  ): Promise<BugFinding> {
    const finding = await this.getOne(id);
    if (
      finding.status !== BugFindingStatus.NEW &&
      finding.status !== BugFindingStatus.PENDING_APPROVAL
    ) {
      throw new ForbiddenException(
        `Finding ${id} is ${finding.status} — can't reject from there.`,
      );
    }
    const trimmedNote = note?.trim() || null;
    await this.findingRepository.update(id, {
      status: BugFindingStatus.REJECTED,
      decidedBy: userId,
      decidedAt: new Date(),
      decisionReason: reason,
      decisionNote: trimmedNote,
    });

    // On the finding's own timeline, not only on the row. The drawer's work
    // log is where anyone reconstructs why a bug reads the way it does, and a
    // rejection that appeared there as a bare status change was the one event
    // on that timeline with no explanation beside it.
    await this.bugHunterService.appendFindingEvent({
      findingId: id,
      repo: finding.repo,
      stage: BugHuntEventStage.DECISION_RECORDED,
      summary:
        `User ${userId} rejected this bug (${reason})` +
        (trimmedNote ? `: ${trimmedNote}` : '.'),
      payload: { decidedBy: userId, reason, note: trimmedNote },
    });

    return this.getOne(id);
  }
}
