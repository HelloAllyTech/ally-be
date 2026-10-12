import { Injectable } from '@nestjs/common';
import { Between, IsNull, Not } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';

import { BUG_HUNT_REPOS } from '../constants/bug-hunt-repos.constants';
import { fixReverted } from '../constants/bug-hunter-voice';
import { BugFindingSource, BugFindingStatus } from '../enum/bug-finding.enum';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHunterNotificationService } from './bug-hunter-notification.service';
import { BugHunterWrongFixService } from './bug-hunter-wrong-fix.service';
import { BugVerifyFindingsService } from './bug-verify-findings.service';

/** How far back the revert watch reads master, and how long after release the held check waits and stops. */
export const BUG_HUNT_REVERT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const BUG_HUNT_HELD_CHECK_AFTER_MS = 60 * 60 * 1000;
export const BUG_HUNT_HELD_CHECK_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;
export const BUG_HUNT_HELD_WATCH_TASK = 'bug-hunter-held-watch';

/** `Revert "fix: … (#812)"` — GitHub's own revert title, with the PR number the original carried. */
export const REVERT_TITLE = /^Revert\s+"(.+?)"/;
export const PR_IN_TITLE = /\(#(\d+)\)/;

/**
 * Link six of the case chain — held after release — watched two ways:
 *
 *  - a person reverting a Bug Hunter PR on master is the clearest signal a
 *    fix was wrong, and until now it was invisible: the bug stayed Released,
 *    nothing reopened, nothing was learned (that is how #792 went);
 *  - a released fix for a human report is re-checked against production an
 *    hour after release by the Verifier, re-running the reporter's steps, so
 *    "the test is green" is not the last word.
 *
 * Both write the wrong-fix record and put the bug back on the board.
 */
@Injectable()
export class BugHunterHeldWatchService {
  private readonly logger = LoggerService.getInstance(
    BugHunterHeldWatchService.name,
  );

  constructor(
    private readonly github: GithubActionsService,
    private readonly findingRepository: BugFindingRepository,
    private readonly wrongFix: BugHunterWrongFixService,
    private readonly verifyFindings: BugVerifyFindingsService,
    private readonly notificationService: BugHunterNotificationService,
  ) {}

  async run(): Promise<void> {
    await this.watchReverts();
    await this.checkHeld();
  }

  /** Every revert of a Bug Hunter PR on master in the lookback, once each. */
  async watchReverts(now: Date = new Date()): Promise<number> {
    let found = 0;
    const since = new Date(now.getTime() - BUG_HUNT_REVERT_LOOKBACK_MS);
    for (const [repo, config] of Object.entries(BUG_HUNT_REPOS)) {
      if (!config.fixable) continue;
      let commits: Awaited<
        ReturnType<GithubActionsService['listCommitsSince']>
      >;
      try {
        commits = await this.github.listCommitsSince(repo, since);
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] Revert watch could not read ${repo}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      for (const commit of commits) {
        const title = commit.message.split('\n')[0];
        const reverted = REVERT_TITLE.exec(title)?.[1];
        const prNumber = reverted ? PR_IN_TITLE.exec(reverted)?.[1] : null;
        if (!prNumber) continue;
        const finding = await this.wrongFix.findShippedByPr(
          repo,
          Number(prNumber),
        );
        if (!finding || finding.metadata?.wrongFix?.sha === commit.sha)
          continue;
        await this.wrongFix.record(
          finding,
          {
            link: 'held',
            source: 'revert',
            reason: `Reverted on master in ${commit.sha.slice(0, 7)}: "${title.slice(0, 160)}".`,
            prUrl: finding.prUrl ?? null,
            sha: commit.sha,
            by: commit.authorLogin,
          },
          { reopen: true },
        );
        await this.notificationService.notify({
          level: BugHunterNotificationLevel.ACTION_NEEDED,
          ...fixReverted(finding.title, repo, commit.authorLogin, prNumber),
          findingId: finding.id,
          repo,
        });
        found += 1;
      }
    }
    return found;
  }

  /** Released fixes for human reports, an hour on, not yet re-checked: send the Verifier to production. */
  async checkHeld(now: Date = new Date()): Promise<number> {
    const due = await this.findingRepository.find({
      where: {
        status: BugFindingStatus.RELEASED,
        source: BugFindingSource.REPORTED_BUG,
        releasedAt: Between(
          new Date(now.getTime() - BUG_HUNT_HELD_CHECK_WITHIN_MS),
          new Date(now.getTime() - BUG_HUNT_HELD_CHECK_AFTER_MS),
        ),
        repo: Not(IsNull()),
      },
      take: 10,
    });
    let dispatched = 0;
    for (const finding of due) {
      if (
        finding.metadata?.heldInProduction ||
        finding.metadata?.heldCheckRunId
      ) {
        continue;
      }
      try {
        if (await this.verifyFindings.dispatchHeldCheck(finding.id)) {
          dispatched += 1;
        }
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] Could not dispatch the held check for ${finding.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return dispatched;
  }
}
