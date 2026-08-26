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
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
} from '../enum/bug-finding.enum';

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
        }),
      );
      results.push(saved);
    }

    return results;
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
    },
  ): Promise<BugFinding> {
    const before = await this.getOne(id);
    await this.findingRepository.update(id, {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.prUrl !== undefined ? { prUrl: patch.prUrl } : {}),
      ...(patch.escalationQuestion !== undefined
        ? { escalationQuestion: patch.escalationQuestion }
        : {}),
    });
    const after = await this.getOne(id);

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

  /** Admin declines to fix it — valid from NEW (a reported bug never even triaged) or PENDING_APPROVAL. */
  async reject(id: string, userId: number): Promise<BugFinding> {
    const finding = await this.getOne(id);
    if (
      finding.status !== BugFindingStatus.NEW &&
      finding.status !== BugFindingStatus.PENDING_APPROVAL
    ) {
      throw new ForbiddenException(
        `Finding ${id} is ${finding.status} — can't reject from there.`,
      );
    }
    await this.findingRepository.update(id, {
      status: BugFindingStatus.REJECTED,
      decidedBy: userId,
      decidedAt: new Date(),
    });
    return this.getOne(id);
  }
}
