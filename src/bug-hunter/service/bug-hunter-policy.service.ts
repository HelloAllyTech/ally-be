import { ForbiddenException, Injectable } from '@nestjs/common';

import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import {
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../enum/bug-finding.enum';
import { BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { repoCommands } from '../constants/bug-hunt-repos.constants';
import {
  BUG_HUNT_LOW_CONFIDENCE_THRESHOLD,
  BUG_HUNT_MAX_AUTO_MERGES_PER_RUN,
  BUG_HUNT_TRIVIAL_FIX_MAX_FILES,
  BUG_HUNT_TRIVIAL_LINT_FIX_MAX_FILES,
} from '../constants/bug-hunter.constants';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugFindingService } from './bug-finding.service';
import { BugHunterService } from './bug-hunter.service';

/** The PATCH fields the policy reads. Kept narrow so the DTO can grow without this file noticing. */
export interface FindingTransitionPatch {
  status?: BugFindingStatus;
  prUrl?: string;
}

/**
 * Bug Hunter's autonomy rules, enforced where the agent's writes arrive.
 *
 * ## Why this exists
 *
 * Three of Bug Hunter's safety rules lived only in the sweep prompt: merge at
 * most three fixes a night, merge only trivial diffs, and hold any finding the
 * verifiers were unsure about for a human. The agent was asked to count, to
 * judge "trivial", and to compare a number — and if it miscounted or
 * misjudged, nothing stopped the merge. This service turns each of those into
 * a refusal at `PATCH pipeline/findings/:id`, so a breach is a 403 on the
 * timeline rather than a bad diff on master. The prompt still says the rules,
 * because an agent that knows why it will be refused plans better; it just no
 * longer has to be trusted with them.
 *
 * ## What it does NOT gate
 *
 * Human routes. An admin approving a finding, pressing merge on a green PR or
 * releasing to production goes through `BugFindingService` and
 * `BugFixSessionService` directly and is never seen here — a human's decision
 * is exactly what the rules defer to. Fix sessions an admin started by name
 * are likewise exempt from the sweep's merge cap and trivial-diff rule (see
 * `buildFixSessionPrompt`'s merge-policy doc), but never from the guarded-path
 * and never-merges-here rules, which are about the change, not who asked.
 *
 * ## Fail closed
 *
 * When the policy cannot establish a fact it needs — the PR's file list from
 * GitHub, the run the finding belongs to — it refuses. A refused merge costs a
 * reviewer five minutes on a PR that is already open; a merge allowed on a
 * guess can cost a production incident.
 */
@Injectable()
export class BugHunterPolicyService {
  private readonly logger = LoggerService.getInstance(
    BugHunterPolicyService.name,
  );

  constructor(
    private readonly bugFindingService: BugFindingService,
    private readonly bugHunterService: BugHunterService,
    private readonly findingRepository: BugFindingRepository,
    private readonly github: GithubActionsService,
  ) {}

  /**
   * Refuse a transition the pipeline may not make. Resolves the finding and,
   * where a rule needs it, its run; a patch with no gated status returns
   * without touching the database.
   */
  async assertTransitionAllowed(
    findingId: string,
    patch: FindingTransitionPatch,
  ): Promise<void> {
    if (patch.status === BugFindingStatus.FIXING) {
      const finding = await this.bugFindingService.getOne(findingId);
      await this.assertMayFix(finding);
      return;
    }
    if (patch.status === BugFindingStatus.MERGED) {
      const finding = await this.bugFindingService.getOne(findingId);
      await this.assertMayMerge(finding, patch.prUrl ?? finding.prUrl ?? null);
    }
  }

  /**
   * FIXING is allowed when a human asked for it (an approved finding, or a fix
   * session an admin dispatched), or when the finding is proven, or when the
   * verifiers accepted it at or above the confidence threshold in AI mode.
   * Everything else waits for a person.
   */
  async assertMayFix(finding: BugFinding): Promise<void> {
    if (finding.status === BugFindingStatus.APPROVED) return;

    const run = await this.runOf(finding);
    if (run?.trigger === BugHuntTrigger.FIX_SESSION) return;

    const settings = await this.bugHunterService.getSettings();
    if (settings.mode === BugHunterMode.OFF) {
      throw new ForbiddenException(
        'Bug Hunter is off. Nothing may be fixed while the switch is off.',
      );
    }
    if (settings.mode === BugHunterMode.MANUAL) {
      throw new ForbiddenException(
        `Bug Hunter is in MANUAL mode: only findings an admin approved may be fixed. ` +
          `PATCH this finding to pending_approval instead.`,
      );
    }

    if (finding.proven) return;

    const confidence = finding.metadata?.confidence;
    if (finding.metadata?.verificationUnavailable === true) {
      throw new ForbiddenException(
        'This finding was never independently verified (verification was unavailable on the engine that found it). ' +
          'Unverified findings wait for a human: PATCH it to pending_approval.',
      );
    }
    if (typeof confidence !== 'number') {
      throw new ForbiddenException(
        'This finding has no verifier confidence recorded, so it has not been through the Verify phase. ' +
          'Verify it first, or PATCH it to pending_approval for a human.',
      );
    }
    if (confidence < BUG_HUNT_LOW_CONFIDENCE_THRESHOLD) {
      throw new ForbiddenException(
        `Verifier confidence ${confidence} is below ${BUG_HUNT_LOW_CONFIDENCE_THRESHOLD}: this finding is held for a human even in AI mode. ` +
          'PATCH it to pending_approval.',
      );
    }
  }

  /**
   * MERGED via the pipeline is allowed only for a change that is not on a
   * guarded path, in a repo the bot may merge to, and — for a sweep, where
   * nobody asked for the fix — within the nightly cap and genuinely small.
   */
  async assertMayMerge(
    finding: BugFinding,
    prUrl: string | null,
  ): Promise<void> {
    if (finding.touchesGuardedPath) {
      throw new ForbiddenException(
        'This fix touches a guarded path (migrations, auth/permissions, payments or another security-sensitive service). ' +
          'It never merges on its own: leave the PR open and PATCH to pr_opened for an admin to merge.',
      );
    }

    const repo = finding.repo ?? '';
    const commands = repoCommands(repo);
    if (!commands || repo === 'ally-mobile' || !commands.canBotMerge) {
      throw new ForbiddenException(
        `"${repo}" never auto-merges Bug Hunter fixes. Leave the PR open and PATCH to pr_opened; an admin merges it with one click.`,
      );
    }

    const run = await this.runOf(finding);
    if (run?.trigger === BugHuntTrigger.FIX_SESSION) return;

    const runId = finding.runId;
    if (!runId) {
      throw new ForbiddenException(
        'This finding is not attached to a run, so the nightly merge cap cannot be checked. Leave the PR open.',
      );
    }
    const mergedThisRun = await this.findingRepository.count({
      where: { runId, status: BugFindingStatus.MERGED },
    });
    if (mergedThisRun >= BUG_HUNT_MAX_AUTO_MERGES_PER_RUN) {
      throw new ForbiddenException(
        `This run has already merged ${mergedThisRun} fixes, the nightly cap. Leave the PR open for review.`,
      );
    }

    await this.assertTrivialDiff(finding, prUrl);
  }

  /**
   * "Genuinely trivial", measured rather than judged: a single file plus its
   * test, or a lint fix that may legitimately touch several files but not
   * many. Line counts are not available from the file listing, so the rule is
   * on files; a truncated listing or a GitHub failure refuses rather than
   * guessing.
   */
  private async assertTrivialDiff(
    finding: BugFinding,
    prUrl: string | null,
  ): Promise<void> {
    const prNumber = prUrl ? prNumberFrom(prUrl) : null;
    if (!prNumber) {
      throw new ForbiddenException(
        'No pull request URL on this finding, so the diff cannot be sized. PATCH pr_opened with prUrl first, then merge.',
      );
    }

    let listing: { files: string[]; truncated: boolean };
    try {
      listing = await this.github.listPullRequestFiles(
        finding.repo ?? '',
        prNumber,
      );
    } catch (error) {
      this.logger.warn(
        `Bug Hunter policy: could not size PR #${prNumber} for ${finding.repo}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ForbiddenException(
        'Could not read the pull request from GitHub to size the diff. Leave the PR open; an admin can merge it.',
      );
    }
    if (listing.truncated) {
      throw new ForbiddenException(
        'The pull request changes more files than can be listed; that is not a trivial fix. Leave the PR open.',
      );
    }

    const limit =
      finding.source === BugFindingSource.LINT_ERROR
        ? BUG_HUNT_TRIVIAL_LINT_FIX_MAX_FILES
        : BUG_HUNT_TRIVIAL_FIX_MAX_FILES;
    if (listing.files.length > limit) {
      throw new ForbiddenException(
        `The pull request changes ${listing.files.length} files; a sweep may only merge a ${
          finding.source === BugFindingSource.LINT_ERROR
            ? `lint fix touching at most ${limit}`
            : `single-file change plus its test (at most ${limit} files)`
        }. Leave the PR open for review.`,
      );
    }
  }

  private async runOf(finding: BugFinding): Promise<BugHuntRun | null> {
    if (!finding.runId) return null;
    try {
      return await this.bugHunterService.getRun(finding.runId);
    } catch {
      return null;
    }
  }
}

/** The pull-request number in a GitHub PR URL, or null when there is none. */
export function prNumberFrom(prUrl: string): number | null {
  const match = /\/pull\/(\d+)/.exec(prUrl);
  return match ? Number(match[1]) : null;
}
