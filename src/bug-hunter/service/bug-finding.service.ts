import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BugHunterNotificationService } from './bug-hunter-notification.service';
import { needsYourAnswer } from '../constants/bug-hunter-voice';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';
import { BugFinding } from '../entity/bug-finding.entity';
import {
  BugFindingRepository,
  ListBugFindingsFilter,
} from '../repository/bug-finding.repository';
import {
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
} from '../enum/bug-finding.enum';

/** One finder's raw output for one bug — the shape `.claude/workflows/bug-hunt.mjs` reports. */
export interface RawFinding {
  source: BugFindingSource;
  file: string;
  description: string;
  evidence?: string;
  severity?: BugFindingSeverity;
  proven: boolean;
  touchesGuardedPath: boolean;
  /** Present only for source=reported_bug — the pre-existing NEW row created at roadmap-intake time. */
  reportedBugId?: string;
}

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
  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly notificationService: BugHunterNotificationService,
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
        finding.description,
      );
      const existingOpen = await this.findingRepository.findOpenByDedupeKey(
        repo,
        dedupeKey,
      );
      if (existingOpen) {
        await this.findingRepository.update(existingOpen.id, { runId });
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
          file: finding.file,
          evidence: finding.evidence ?? null,
          severity: finding.severity ?? null,
          proven: finding.proven,
          touchesGuardedPath: finding.touchesGuardedPath,
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
   * Generic status/field transition, used throughout Verify/Fix: dismiss on
   * refute, fixing on fix-start, pr_opened/merged/failed on fix-finish, and
   * needs_input + a question on genuine escalation.
   *
   * Escalating raises the same action-needed notification in the Bug Hunter
   * inbox as a run-level escalation (see BugHunterService.appendEvent) — only
   * once per distinct question, so a later run re-polling an already-asked
   * finding doesn't re-notify.
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
