import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { In, IsNull, Like, MoreThan } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  CheckRollup,
  GithubActionsService,
  PullRequestInfo,
} from 'src/github/service/github-actions.service';
import { AppConfigService } from 'src/config/config.service';
import { BuilderRunStatus } from '../enum/builder.enum';
import { BuilderPullRequest } from '../entity/builder-pull-request.entity';
import { BuilderPrFeedback } from '../entity/builder-pr-feedback.entity';
import {
  BuilderPrFeedbackRepository,
  BuilderPullRequestRepository,
} from '../repository/builder-build.repository';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import { BuilderNotificationService } from './builder-notification.service';
import { BuilderSettingsService } from './builder-settings.service';
import { BuilderBuildService } from './builder-build.service';
import {
  BuilderPrFeedbackKind,
  BuilderPrFeedbackStatus,
  BuilderSessionStatus,
  BuilderStage,
} from '../enum/builder.enum';
import {
  findBuilderRepo,
  isBuilderRepo,
} from '../constants/builder-repos.constants';
import {
  BUILDER_AUTH_FAILURE_ALERT_THRESHOLD,
  BUILDER_MAX_REPO_REVIEWS_PER_PR,
  BUILDER_PR_AUTOMATION_TIMEBOX_MS,
  BUILDER_OWN_ACTORS,
  BUILDER_RELEASE_TIMEOUT_MS,
  BUILDER_WORKFLOW_REF,
  isUnfixableCheck,
  BUILDER_RELEASE_SETTLE_MS,
  BUILDER_HEALTH_RETRY_MS,
  BUILDER_UNHEALTHY_HOLD_MS,
  BUILDER_TRACK_RECORD_WINDOW,
} from '../constants/builder.constants';
import { resolveReleaseTargets } from 'src/release/constants/release-targets.constants';
import { ProductionReleaseService } from 'src/release/service/production-release.service';

/**
 * The pull requests a session opened, and keeping them current.
 *
 * Builder's job ends at "opened" — a human reviews and merges — but the
 * session view is where someone comes back to see how it went, so the PR rows
 * have to keep learning about CI and merges that happen after the agent is
 * gone.
 */
/** The workflow in a target repo that works a Builder issue into a PR. */
const ISSUE_BUILD_WORKFLOW = 'builder.yml';
/** How long an issue may go without a pull request before the build fails. */
const ISSUE_BUILD_TIMEOUT_MS = 60 * 60_000;
/** `/oc` fix requests Builder makes on red CI before failing the build. */
const ISSUE_FIX_REQUESTS = 2;
/** How long a `/oc` request on feedback may go unanswered before it is retried. */
const OC_FIX_TIMEOUT_MS = 60 * 60_000;
/** A branch opencode made (`opencode github run`), so its fixes go by `/oc`. */
const isOpencodeBranch = (branch?: string | null): boolean =>
  Boolean(branch?.startsWith('opencode/'));

@Injectable()
export class BuilderPullRequestService {
  private readonly logger = LoggerService.getInstance(
    BuilderPullRequestService.name,
  );

  constructor(
    private readonly repository: BuilderPullRequestRepository,
    private readonly feedbackRepository: BuilderPrFeedbackRepository,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly notificationService: BuilderNotificationService,
    private readonly settingsService: BuilderSettingsService,
    private readonly github: GithubActionsService,
    private readonly releaseService: ProductionReleaseService,
    private readonly configService: AppConfigService,
    // Forward-ref'd: the build service reaches PRs through repositories only,
    // so this edge is one-way rather than a cycle.
    @Inject(forwardRef(() => BuilderBuildService))
    private readonly buildService: BuilderBuildService,
  ) {}

  /**
   * Merge one of this session's pull requests, at an admin's explicit request.
   *
   * ## Why this exists
   *
   * Builder opens pull requests and stops — `builder-pull-request.entity.ts`
   * says so plainly: "runs, a human reviews, someone merges". On ally-be,
   * ally-web and ally-ai it could not do otherwise even if it should: `master`
   * wants an approving review and the bot holds only `write`, so there is
   * nothing for it to bypass.
   *
   * Bug Hunter measured what that costs. Of 122 bot pull requests, 89 were
   * merged by hand, nearly all within the hour of opening. The judgement was
   * never the bottleneck; leaving the tool to go and press a button somewhere
   * else was. This removes the errand and nothing else.
   *
   * ## What it deliberately does not do
   *
   * It does not force. Checks are read first and anything that is not green is
   * refused here rather than merged past, and when GitHub itself says no — a
   * required review, a stale base — that refusal is passed straight through
   * rather than retried with `--admin`. Both gates survive; only the walk to
   * another tab is gone.
   */
  async mergePullRequest(
    sessionId: string,
    pullRequestId: string,
    userId: number,
    // Only changes what the log line says. Every gate below applies either
    // way — an automatic merge is not a privileged one, it is the same merge
    // with nobody standing at the button.
    automatic = false,
  ): Promise<BuilderPullRequest> {
    const row = await this.repository.findOne({
      where: { id: pullRequestId },
    });
    if (!row || row.sessionId !== sessionId) {
      throw new NotFoundException(
        `Pull request ${pullRequestId} is not part of session ${sessionId}.`,
      );
    }
    if (row.merged) {
      return row;
    }
    if (row.state === 'closed') {
      throw new ForbiddenException(
        `${row.prUrl} is closed without being merged. Nothing to merge here — ` +
          'start a fresh run if the work is still wanted.',
      );
    }

    const remote = await this.github.getPullRequest(row.repo, row.prNumber);
    if (!remote) {
      throw new BadRequestException(
        `Could not read ${row.prUrl} from GitHub. Try again, or merge it there.`,
      );
    }
    if (remote.merged) {
      // Somebody merged it between the page loading and the click. Settle the
      // row rather than erroring: the outcome they wanted already happened.
      await this.repository.update(
        { id: row.id },
        { merged: true, mergedAt: new Date(), state: 'closed' },
      );
      return (await this.repository.findOne({ where: { id: row.id } })) ?? row;
    }
    if (remote.state === 'closed') {
      throw new ForbiddenException(
        `${row.prUrl} is closed without being merged.`,
      );
    }

    // A null rollup means GitHub could not be read, which is NOT the same as
    // green. `none` and `pending` are refused for the same reason: a merge is
    // the one action here that cannot be undone from this tab.
    const rollup = remote.headSha
      ? await this.github.getCheckRollup(row.repo, remote.headSha)
      : null;
    if (!rollup) {
      throw new BadRequestException(
        "Couldn't read this pull request's checks from GitHub, so I won't " +
          'merge it blind. Try again in a moment.',
      );
    }
    if (rollup.state === 'failure') {
      throw new ForbiddenException(
        `This pull request's checks are red (${rollup.failed
          .slice(0, 3)
          .join(', ')}). Fix them before merging.`,
      );
    }
    if (rollup.state === 'pending') {
      throw new ForbiddenException(
        "This pull request's checks are still running. Give them a minute.",
      );
    }
    if (rollup.state === 'none') {
      throw new ForbiddenException(
        'This pull request has no checks at all, so nothing has verified it. ' +
          'Merge it on GitHub if that is really what you want.',
      );
    }

    const result = await this.github.mergePullRequest(
      row.repo,
      row.prNumber,
      row.title ?? undefined,
    );
    if (!result.merged) {
      // GitHub's own refusal, relayed rather than worked around. A required
      // review or a moved base is exactly the case this button must not force.
      throw new ForbiddenException(
        result.message ??
          'GitHub would not merge this pull request, and did not say why.',
      );
    }

    await this.repository.update(
      { id: row.id },
      {
        merged: true,
        mergedAt: new Date(),
        state: 'closed',
        decidedBy: userId,
      },
    );
    this.logger.info(
      automatic
        ? `[BUILDER] ${row.repo}#${row.prNumber} merged automatically on a clean review.`
        : `[BUILDER] ${row.repo}#${row.prNumber} merged from the drawer by user ${userId}.`,
    );
    // Feedback on a merged pull request is no longer anyone's to act on.
    await this.staleFeedback(row.id);
    return (await this.repository.findOne({ where: { id: row.id } })) ?? row;
  }

  /**
   * Record what the runner opened. Upserted per repo: a resume run pushes
   * more commits to the same branch, which updates the existing PR rather
   * than opening another, and a second row would make the session look like
   * it opened twice as much as it did.
   */
  async recordFromRunner(
    sessionId: string,
    runId: string,
    incoming: {
      repo?: string;
      branch?: string;
      prNumber?: number;
      prUrl?: string;
      title?: string;
    }[],
  ): Promise<BuilderPullRequest[]> {
    const results: BuilderPullRequest[] = [];
    const opened: BuilderPullRequest[] = [];

    for (const entry of incoming) {
      const repo = String(entry.repo ?? '');
      if (!isBuilderRepo(repo) || !entry.prUrl || !entry.prNumber) {
        this.logger.warn(
          `Builder run ${runId} reported an unusable pull request for "${repo}" — skipping.`,
        );
        continue;
      }

      // Keyed on the branch too: an epic opens one PR per repo per milestone,
      // and keying on (session, repo) alone would have milestone 2 overwrite
      // milestone 1's row — the first pull request vanishing from the session
      // view while staying open on GitHub.
      const branch = String(entry.branch ?? '');
      const existing = await this.repository.findOne({
        where: { sessionId, repo, branch },
      });
      const payload = {
        sessionId,
        runId,
        repo,
        branch,
        prNumber: Number(entry.prNumber),
        prUrl: String(entry.prUrl),
        title: entry.title ? String(entry.title) : null,
      };

      if (existing) {
        await this.repository.update({ id: existing.id }, payload);
        results.push(
          await this.repository.findOneOrFail({ where: { id: existing.id } }),
        );
      } else {
        const created = await this.repository.save(
          this.repository.create(payload),
        );
        results.push(created);
        opened.push(created);
      }
    }

    if (results.length) {
      const session = await this.sessionRepository.findOne({
        where: { id: sessionId },
      });
      if (session) {
        await this.notificationService.prsOpened(session, results.length);
      }
    }
    return results;
  }

  /**
   * Refresh every open PR: merge state, CI, and human feedback — then decide
   * whether any of it is worth a fix run.
   *
   * This is the pass that turns Builder from "opens PRs" into something that
   * finishes them. Before it, `ciStatus` was never written despite the entity
   * documenting it, review comments were never read at all, and a merged PR, a
   * rejected PR and a red PR were indistinguishable to everything downstream.
   *
   * Best-effort throughout: a GitHub hiccup should cost a stale chip, never an
   * error anyone sees, and never a half-applied state.
   */
  async reconcileOpenPullRequests(): Promise<void> {
    // First, and deliberately before the GitHub guard.
    //
    // This sweep is pure database work, and it is the only path that can reach
    // a session whose pull requests have all MERGED — `listReconcilable`
    // filters on `merged: false`, so the loop below iterates nothing for them.
    // Putting the outcome reconciliation inside that loop meant it could never
    // run for the one case it was written for: a session left saying FAILED
    // above work that had already shipped.
    await this.reconcileSessionOutcomes();

    if (!this.github.isConfigured) return;

    await this.reconcileIssueRuns();

    for (const pullRequest of await this.repository.listReconcilable()) {
      try {
        await this.reconcileOne(pullRequest);
      } catch (error) {
        this.logger.warn(
          `Could not refresh ${pullRequest.repo}#${pullRequest.prNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * Follow each issue-dispatched build to its pull
   * request.
   *
   * The repo's `builder.yml` workflow runs opencode on the issue Builder
   * raised; `opencode github run` works on a branch named
   * `opencode/issue<N>-<time>` and opens a PR that closes the issue. Here:
   *   - the PR, once it exists, is recorded like a runner-opened one, so the
   *     PR panel, CI status, review and release flows all apply to it;
   *   - CI green on its head settles the run SUCCEEDED, which advances a
   *     one-repo-per-build chain to the next repo's issue (advanceEpic);
   *   - CI red asks opencode to fix it, once per head commit, with a `/oc`
   *     comment naming the failing checks — up to ISSUE_FIX_REQUESTS times;
   *   - the workflow finishing with no PR, or no PR within the timeout, fails
   *     the run with the issue linked.
   */
  private async reconcileIssueRuns(): Promise<void> {
    for (const run of await this.buildService.listActiveIssueRuns()) {
      try {
        await this.reconcileIssueRun(run);
      } catch (error) {
        this.logger.warn(
          `Could not follow issue build ${run.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async reconcileIssueRun(run: BuilderBuildRun): Promise<void> {
    const repo = run.repos?.[0];
    if (!repo || !run.issueNumber) return;
    const prefix = `opencode/issue${run.issueNumber}-`;
    const pr = ((await this.github.listPullRequests(repo)) ?? []).find(
      (candidate) => candidate.headRef?.startsWith(prefix),
    );

    if (!pr?.number) {
      const workflowRun = await this.github.findRunSince({
        repo,
        workflow: ISSUE_BUILD_WORKFLOW,
        since: run.dispatchedAt,
        event: 'issues',
      });
      if (workflowRun && workflowRun.status !== 'completed') {
        await this.buildService.recordIssueMilestone(
          run,
          `working:${workflowRun.id}`,
          `opencode is working on ${repo}#${run.issueNumber}. Live log: ${workflowRun.htmlUrl}`,
          BuilderStage.CODING,
          { workflowRunUrl: workflowRun.htmlUrl },
        );
      }
      if (workflowRun?.status === 'completed') {
        await this.buildService.settleRun(
          run,
          BuilderRunStatus.FAILED,
          `opencode finished without opening a pull request (${workflowRun.htmlUrl}). Its reply is on ${run.issueUrl}.`,
        );
      } else if (
        Date.now() - run.dispatchedAt.getTime() >
        ISSUE_BUILD_TIMEOUT_MS
      ) {
        await this.buildService.settleRun(
          run,
          BuilderRunStatus.FAILED,
          `No pull request for ${run.issueUrl} within ${ISSUE_BUILD_TIMEOUT_MS / 60_000} minutes.`,
        );
      }
      return;
    }

    await this.recordFromRunner(run.sessionId, run.id, [
      {
        repo,
        branch: pr.headRef ?? undefined,
        prNumber: pr.number,
        prUrl: pr.htmlUrl,
        title: pr.title ?? undefined,
      },
    ]);
    await this.buildService.recordIssueMilestone(
      run,
      `pr:${pr.number}`,
      `opencode opened ${pr.htmlUrl}${pr.title ? ` — "${pr.title}"` : ''}. CI checks it next.`,
      BuilderStage.GATE,
    );
    if (!pr.headSha) return;
    const sha = pr.headSha.slice(0, 7);
    const rollup = await this.github.getCheckRollup(repo, pr.headSha);
    const ci = (state: 'success' | 'failure' | 'pending') => ({
      ci: {
        repo,
        prNumber: pr.number as number,
        prUrl: pr.htmlUrl,
        sha: pr.headSha as string,
        state,
        failed: rollup?.failed ?? [],
      },
    });
    if (rollup?.state === 'success') {
      await this.buildService.recordIssueMilestone(
        run,
        `ci-pass:${pr.headSha}`,
        `CI passed on ${sha}. The build is done; ${pr.htmlUrl} is ready for review.`,
        undefined,
        ci('success'),
      );
      await this.buildService.settleRun(run, BuilderRunStatus.SUCCEEDED, null);
      return;
    }
    if (rollup?.state !== 'failure') {
      await this.buildService.recordIssueMilestone(
        run,
        `ci-pending:${pr.headSha}`,
        `CI is running on ${sha}.`,
        undefined,
        ci('pending'),
      );
      return;
    }
    await this.buildService.recordIssueMilestone(
      run,
      `ci-fail:${pr.headSha}`,
      `CI failed on ${sha}: ${rollup.failed.join(', ') || 'see the checks'}.`,
      undefined,
      ci('failure'),
    );

    // Once per head commit: a new commit after the request means opencode
    // answered it, and CI is judging the answer.
    const asked = ((run.cost as any)?.issueFixRequests ?? []) as string[];
    if (asked.includes(pr.headSha)) return;
    if (asked.length >= ISSUE_FIX_REQUESTS) {
      await this.buildService.settleRun(
        run,
        BuilderRunStatus.FAILED,
        `CI still fails on ${pr.htmlUrl} after ${asked.length} fix request(s): ${rollup.failed.join(', ')}.`,
      );
      return;
    }
    await this.github.createIssueComment(
      repo,
      pr.number,
      `/oc CI failed on this pull request: ${rollup.failed.join(', ') || 'see the checks'}. ` +
        'Read the failing checks, fix the cause on this branch, and keep every check passing. ' +
        'Do not change a test to make it pass unless the test itself is wrong, and say so if it is.',
    );
    await this.buildService.recordIssueFixRequest(run, pr.headSha);
    await this.buildService.recordIssueMilestone(
      run,
      `fix:${pr.headSha}`,
      `Asked opencode to fix the failing checks on ${pr.htmlUrl} (request ${asked.length + 1} of ${ISSUE_FIX_REQUESTS}).`,
      BuilderStage.REMEDIATING,
    );
  }

  /**
   * Re-test the FAILED sessions against what their pull requests actually did.
   *
   * Runs over sessions rather than over open pull requests, because the
   * evidence that matters most — a merge — is exactly what removes a pull
   * request from the open set.
   */
  private async reconcileSessionOutcomes(): Promise<void> {
    for (const session of await this.sessionRepository.listRecentlyFailed()) {
      try {
        await this.clearStaleSessionError(session.id);
      } catch (error) {
        this.logger.warn(
          `Could not settle session ${session.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async reconcileOne(pullRequest: BuilderPullRequest): Promise<void> {
    const remote = await this.github.getPullRequest(
      pullRequest.repo,
      pullRequest.prNumber,
    );
    if (!remote) return;

    const closedWithoutMerging = remote.state === 'closed' && !remote.merged;
    const rollup = remote.headSha
      ? await this.github.getCheckRollup(pullRequest.repo, remote.headSha)
      : null;

    await this.repository.update(
      { id: pullRequest.id },
      {
        state: remote.state,
        headSha: remote.headSha,
        ciStatus: rollup?.state ?? pullRequest.ciStatus ?? null,
        lastCheckedAt: new Date(),
        ...(remote.merged && !pullRequest.merged
          ? { merged: true, mergedAt: remote.mergedAt ?? new Date() }
          : {}),
      },
    );
    // What the steps below read is the head just fetched, not the one the row
    // was loaded with: a `/oc` request records it, and settles on it moving.
    pullRequest.headSha = remote.headSha ?? null;

    // A PR that is gone has nothing left to act on. Marked rather than
    // deleted: "we saw this and it stopped mattering" is the useful record,
    // and the flywheel reads closed-unmerged as its strongest signal.
    if (remote.merged || closedWithoutMerging) {
      await this.staleFeedback(pullRequest.id);
      if (pullRequest.needsHumanAt && !pullRequest.escalationResolution) {
        await this.repository.update(
          { id: pullRequest.id },
          {
            escalationResolution: remote.merged ? 'merged' : 'closed',
            escalationResolvedAt: new Date(),
          },
        );
      }
      if (remote.merged) await this.considerRelease(pullRequest);
      return;
    }

    await this.ingestFeedback(pullRequest, remote.headSha, rollup);

    // Handed to a person: nothing automatic happens here until they resume
    // it. The merge prompt still applies — merging is theirs to decide.
    if (
      pullRequest.needsHumanAt ||
      (isOpencodeBranch(pullRequest.branch) &&
        ((await this.timeBoxSpent(pullRequest)) ||
          (await this.budgetSpent(pullRequest))))
    ) {
      await this.considerMergePrompt(pullRequest, remote);
      return;
    }
    if (rollup?.state === 'success') await this.staleCiFeedback(pullRequest.id);
    await this.considerBranchUpdate(pullRequest, remote);
    // A conflicted PR gets no CI at all, so nothing below can make progress.
    if (await this.considerConflict(pullRequest, remote)) return;

    // Review before fix, and only one of them per tick. A review that
    // dispatches leaves an active run behind, which a fix refuses to race
    // (hasRunInFlight) — so asking for both here would reliably get the second
    // refused and look like a bug from the outside.
    if (await this.considerReviewRun(pullRequest, remote.headSha, rollup))
      return;
    await this.considerFixRun(pullRequest);

    // Reconsidered every tick, not only when a review has just finished.
    // Approval is a policy applied to a durable fact ("this commit was
    // reviewed clean"), and firing it only on the event meant any pull request
    // reviewed while `autoApproveEnabled` was off could never be approved —
    // the review cap stops a second review, and nothing else looked again.
    await this.considerApproval(pullRequest, { remote, rollup });
    // Tries to merge, and says whether it did. A decline is not an error and
    // not the end of the road — the prompt below still offers the button, so
    // the work stops in front of a person rather than stopping silently.
    if (!(await this.considerAutoMerge(pullRequest, remote)))
      await this.considerMergePrompt(pullRequest, remote);
    await this.clearStaleSessionError(pullRequest.sessionId);
  }

  /**
   * Merge it ourselves, when a clean review is the only thing it was waiting
   * on.
   *
   * The last click in the chain, and the only step here that cannot be undone
   * from inside this module — so it is gated on its own switch rather than on
   * `autoApproveEnabled`, and every fact it rests on is re-established against
   * THIS commit rather than inherited from whenever the review ran:
   *
   *  - **the switch**, off by default like the rest, and the point of it being
   *    separate is that it can be turned back off without a deploy;
   *  - **a review that PASSED on this exact head**, not merely one that was
   *    dispatched. `reviewPassedSha` is the outcome; `reviewedSha` is only the
   *    attempt, and a run that failed stamps the second without earning the
   *    first;
   *  - **nothing actionable outstanding**, because a finding a fix run has not
   *    finished with means the diff is about to change;
   *  - **`mergeable_state === 'clean'`**, which is GitHub's own answer to "is
   *    anything still in the way" — every required check green, every required
   *    review in, base not stale. Recomputing that here would be a second,
   *    worse implementation of a question already answered.
   *
   * `mergePullRequest` then re-reads the checks and refuses anything that is
   * not green, so the rollup is verified twice on this path. That is on
   * purpose: the tick's rollup was fetched before the approval, and a merge is
   * the one action here that cannot be taken back.
   *
   * Returns whether it merged, so the caller knows whether the human prompt is
   * still owed. A refusal is logged and swallowed rather than thrown —
   * `mergePullRequest`'s errors are written for a person reading a drawer, and
   * on a five-minute tick an exception would abort the rest of the pass for
   * every other pull request behind this one.
   */
  private async considerAutoMerge(
    pullRequest: BuilderPullRequest,
    remote: {
      state: string;
      merged: boolean;
      mergeableState: string | null;
      headSha?: string | null;
    },
  ): Promise<boolean> {
    const settings = await this.settingsService.get();
    if (!settings.enabled || !settings.autoMergeEnabled) return false;
    if (await this.releaseIsUnhealthy()) return false;

    if (remote.merged || remote.state !== 'open') return false;
    if (remote.mergeableState !== 'clean') return false;

    // Against the head GitHub just reported, not the row's cached copy: the
    // row is written by this same pass and a stale value would be the one way
    // this could merge a commit no review ever read.
    if (!remote.headSha) return false;
    if (pullRequest.reviewPassedSha !== remote.headSha) return false;

    const outstanding = await this.feedbackRepository.countActionable(
      pullRequest.id,
    );
    if (outstanding) return false;

    const session = await this.sessionRepository.findOne({
      where: { id: pullRequest.sessionId },
    });
    if (!session) return false;

    try {
      // userId 0: the platform, not a person. Nobody clicked, and recording a
      // user who did not act would be the wrong answer to "who merged this".
      const merged = await this.mergePullRequest(
        pullRequest.sessionId,
        pullRequest.id,
        0,
        true,
      );
      if (!merged.merged) return false;

      await this.notificationService.prMergedAutomatically(
        session,
        {
          id: pullRequest.id,
          repo: pullRequest.repo,
          prNumber: pullRequest.prNumber,
          prUrl: pullRequest.prUrl,
          title: pullRequest.title ?? null,
        },
        settings.autoReleaseEnabled,
      );
      return true;
    } catch (error) {
      // Refusals are expected traffic here, not incidents: a check that went
      // red between the rollup and the merge, a base that moved. The next tick
      // re-tests all of it.
      this.logger.info(
        `Not merging ${pullRequest.repo}#${pullRequest.prNumber} automatically: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Offer the merge button, once, at the moment it is the only thing left.
   *
   * `mergeable_state === 'clean'` is GitHub's own answer to "is anything still
   * standing in the way" — every required check green, every required review
   * in, base not stale. Recomputing that from rollups and review lists would be
   * a second, worse implementation of a question already answered.
   *
   * Announced once and never again: reconcile is polled, so a pull request that
   * sits mergeable for an afternoon would otherwise post a fresh button every
   * tick, and a channel with one useful message becomes a channel nobody reads.
   *
   * Nothing outstanding, because a clean mergeable state says nothing about a
   * finding a fix run has not finished with — the diff is about to change.
   */
  /**
   * Drop a session-level error that the pull requests have since disproved.
   *
   * `settleRun` writes a failed run's error onto the run AND onto the session,
   * and only a new dispatch clears the session copy. That is fine while runs
   * keep coming. It is not fine when they cannot: a session that is over budget,
   * or parked on a question, or blocked on a dead credential, has no next
   * dispatch — so the banner stays forever.
   *
   * Which would be merely untidy if the text were vague. It is not. The gate
   * error says "nothing proves the change works", and it sits above pull
   * requests whose every required check is green. The page is telling the
   * reader the opposite of what the evidence says, and pointing at the wrong
   * thing to go and fix.
   *
   * So the claim is re-tested against the evidence rather than left standing:
   * every open pull request green, nothing actionable outstanding, and the
   * session's headline error has been overtaken by events.
   *
   * Only the error. The status is a separate question — a parked run or a spent
   * budget still means this session is not finished, and saying otherwise would
   * trade one false statement for another.
   */
  private async clearStaleSessionError(sessionId: string): Promise<void> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) return;

    const pullRequests = await this.repository.listBySession(sessionId);
    if (!pullRequests.length) return;

    // Closed without merging is a rejection, and not ours to reinterpret: the
    // work was looked at and turned down, so whatever the session says about
    // itself stands.
    if (pullRequests.some((row) => !row.merged && row.state === 'closed'))
      return;

    // Merged is the strongest evidence there is — green checks plus a person
    // explicitly choosing to take the change. Only the still-open ones have
    // anything left to prove, so they are what the checks below examine; a
    // session whose pull requests have all merged passes on the merges alone.
    const open = pullRequests.filter(
      (row) => !row.merged && row.state !== 'closed',
    );
    if (!open.every((row) => row.ciStatus === 'success')) return;

    for (const row of open) {
      if (await this.feedbackRepository.countActionable(row.id)) return;
    }

    if (session.error) {
      await this.sessionRepository.update({ id: sessionId }, { error: null });
      this.logger.info(
        `Cleared a stale error on session ${sessionId}: every open pull request is green.`,
      );
    }

    // And the status and stage, which are the same lie in a different place.
    //
    // A session's status is written from the fate of its last RUN. A run can
    // fail at the protocol and still succeed at the work — push a fix, go
    // green, then end its turn without reporting — and the page is then left
    // saying FAILED above two mergeable pull requests, with a phase rail
    // frozen wherever the agent stopped and a banner advising a retry that
    // would redo finished work.
    //
    // `DONE` was reachable only through a successful run, so an outcome that
    // arrived through a failed one could never be shown. It is reached here
    // instead, from the evidence: every open pull request green, nothing
    // actionable outstanding, and nothing still running.
    if (session.status !== BuilderSessionStatus.FAILED) return;
    if (await this.buildService.hasBlockingRuns(sessionId)) return;

    await this.sessionRepository.update(
      { id: sessionId },
      {
        status: BuilderSessionStatus.COMPLETED,
        currentStage: BuilderStage.DONE,
      },
    );
    this.logger.info(
      `[BUILDER] Session ${sessionId} settled COMPLETED: its run failed but every open pull request is green.`,
    );
  }

  /**
   * Retire CI failures that the current head has disproved.
   *
   * These rows are keyed `sha:check`, so a failure recorded against a commit
   * that has since been superseded stays PENDING for ever. Three of them
   * survived on ally-be#494 after the very fix that made it green — and
   * pending feedback is what `considerFixRun` acts on, so the loop kept
   * dispatching at a pull request with nothing wrong with it, and
   * `considerReviewRun` kept standing down because it waits for feedback to
   * settle first.
   *
   * Only called when the rollup is green, which is the whole argument: a check
   * cannot be both failing and passing on the same head, so every CI complaint
   * on this pull request is now about code that is no longer there.
   */
  private async staleCiFeedback(pullRequestId: string): Promise<void> {
    const affected = await this.feedbackRepository.update(
      {
        pullRequestId,
        kind: BuilderPrFeedbackKind.CI_FAILURE,
        status: In([
          BuilderPrFeedbackStatus.PENDING,
          BuilderPrFeedbackStatus.IN_FIX,
        ]),
      },
      { status: BuilderPrFeedbackStatus.STALE },
    );
    // Optional-chained: an update result is not guaranteed to carry a count,
    // and throwing here would abort the rest of the tick — the reconcile pass
    // catches per-pull-request, so a stray TypeError would silently cost the
    // review and merge-prompt steps below it.
    if (affected?.affected) {
      this.logger.info(
        `Retired ${affected.affected} CI failure(s) on ${pullRequestId}: checks are green on the current head.`,
      );
    }
  }

  private async considerMergePrompt(
    pullRequest: BuilderPullRequest,
    remote: { state: string; merged: boolean; mergeableState: string | null },
  ): Promise<void> {
    if (pullRequest.mergePromptedAt) return;
    if (remote.merged || remote.state !== 'open') return;
    if (remote.mergeableState !== 'clean') return;

    const outstanding = await this.feedbackRepository.countActionable(
      pullRequest.id,
    );
    if (outstanding) return;

    const session = await this.sessionRepository.findOne({
      where: { id: pullRequest.sessionId },
    });
    if (!session) return;

    // Stamped before the announcement, not after: a Slack outage must not make
    // this retry on every tick for the rest of the day.
    await this.repository.update(
      { id: pullRequest.id },
      { mergePromptedAt: new Date() },
    );
    await this.notificationService.prReadyToMerge(session, {
      id: pullRequest.id,
      repo: pullRequest.repo,
      prNumber: pullRequest.prNumber,
      prUrl: pullRequest.prUrl,
      title: pullRequest.title ?? null,
    });
  }

  /**
   * Release a merged pull request to production.
   *
   * The last step of the loop, and the only one that changes what real users
   * are running — which is why it is gated harder than anything above it.
   *
   *  - **`autoReleaseEnabled`**, its own switch, off by default.
   *  - **once per pull request.** `releaseState` is set before the dispatch, so
   *    a reconcile tick landing mid-flight cannot fire a second release.
   *  - **a known deployable.** ally-mobile ships through the app stores, not a
   *    dispatchable pipeline, so its pull requests are recorded `skipped`
   *    rather than retried forever.
   *  - **unambiguous attribution.** For ally-web this is the real constraint: a
   *    change under `libs/` ships inside all three frontends, so releasing only
   *    the apps whose paths happened to match would silently under-deploy it.
   *    Ambiguity stops and says so; it does not release the subset it
   *    understood.
   *
   * Multiple targets are dispatched together rather than in sequence. Builder's
   * pull requests are per-repo, so a single one cannot span backend and
   * frontend — the ordering hazard Bug Hunter's release plans exist to prevent
   * does not arise here, and two ally-web apps have no ordering between them.
   */
  private async considerRelease(
    pullRequest: BuilderPullRequest,
  ): Promise<void> {
    if (pullRequest.releaseState) return;

    const settings = await this.settingsService.get();
    if (!settings.enabled || !settings.autoReleaseEnabled) return;
    if (await this.releaseIsUnhealthy()) return;

    const { files, truncated } = await this.github.listPullRequestFiles(
      pullRequest.repo,
      pullRequest.prNumber,
    );
    const resolved = resolveReleaseTargets(pullRequest.repo, files);

    // A truncated listing is "we do not know what changed", not "nothing did".
    const blocked = truncated || resolved.ambiguous;
    if (blocked || !resolved.targets.length) {
      const why = truncated
        ? 'its file list was too large to read in full'
        : resolved.targets.length
          ? `it also changes ${resolved.unresolved.length} file(s) outside those apps`
          : 'no release pipeline covers it';
      await this.repository.update(
        { id: pullRequest.id },
        { releaseState: 'skipped' },
      );
      this.logger.info(
        `Not releasing ${pullRequest.repo}#${pullRequest.prNumber}: ${why}. Left for a person.`,
      );
      const session = await this.sessionRepository.findOne({
        where: { id: pullRequest.sessionId },
      });
      if (session) {
        await this.notificationService.releaseSkipped(
          session,
          pullRequest.repo,
          pullRequest.prNumber,
          why,
        );
      }
      return;
    }

    // Claimed before the first dispatch, not after the last: with two targets,
    // a tick landing between them would otherwise see no state and start both
    // again.
    await this.repository.update(
      { id: pullRequest.id },
      { releaseState: 'releasing' },
    );

    const tags: string[] = [];
    let dispatchedAt: Date | null = null;
    const runUrl: string | null = null;
    for (const target of resolved.targets) {
      const result = await this.releaseService.dispatch(
        target,
        BUILDER_WORKFLOW_REF,
      );
      tags.push(result.tag);
      // The earliest dispatch, so `findRunSince` cannot miss a run that started
      // before a later sibling was fired.
      if (!dispatchedAt || result.dispatchedAt < dispatchedAt)
        dispatchedAt = result.dispatchedAt;
    }

    await this.repository.update(
      { id: pullRequest.id },
      {
        releaseTag: tags.join(', ').slice(0, 40),
        releaseDispatchedAt: dispatchedAt,
        releaseRunUrl: runUrl,
      },
    );
    this.logger.info(
      `[BUILDER] Released ${pullRequest.repo}#${pullRequest.prNumber} as ${tags.join(', ')}.`,
    );
  }

  /**
   * Watch dispatched releases to a verdict.
   *
   * This is the half that makes releasing automatically defensible rather than
   * reckless. On 2026-09-15 an ally-be release passed every check, failed to
   * boot, and was rolled back by the ECS circuit breaker — and nothing noticed
   * for the better part of an hour, because a dispatched release with nobody
   * watching it is indistinguishable from a successful one.
   *
   * A failure here is not a quiet log line. **Merged but not deployed** is a
   * worse state than never having released, because master has moved on and
   * everyone assumes the change is live, so it notifies.
   */
  /**
   * Correct a `failed` release that has since been shipped by other means.
   *
   * `failed` was terminal: nothing re-read it, ever. So a pull request whose
   * automatic release failed stayed marked "merged but NOT deployed" for the
   * rest of the deployment's life, even after a person cut the release by hand
   * an hour later. ally-web#658 is the case — Builder proposed `admin-v0.0.1`
   * for an app on 1.88 (see `nextPatchTag`), the workflow rightly refused it,
   * and the code shipped in admin-v1.88.0 twenty minutes afterwards with the
   * row still claiming otherwise.
   *
   * That is not only untidy. The roadmap now reads these rows to decide whether
   * an opportunity has been delivered, so a stuck `failed` keeps shipped work
   * looking unshipped on the board — and refuses to be fixed by the very act of
   * releasing it properly.
   *
   * The evidence is a SUCCESSFUL run of that target's release workflow started
   * after this pull request merged. Releases are cut from master, so a release
   * that began after the merge landed necessarily carries it. Not the tag we
   * attempted — that one failed, and comparing version numbers would happily
   * "prove" delivery from the `0.0.1` that caused the problem.
   *
   * `releaseTag` is cleared rather than kept. The tag recorded here is the one
   * we tried and failed with; leaving it beside a `released` state would state
   * something untrue, and the run URL says where it actually shipped.
   */
  private async reconcileFailedReleases(): Promise<void> {
    const failed = await this.repository.find({
      where: { releaseState: 'failed', merged: true },
    });

    for (const pullRequest of failed) {
      try {
        if (!pullRequest.mergedAt) continue;

        const files = await this.github.listPullRequestFiles(
          pullRequest.repo,
          pullRequest.prNumber,
        );
        // A truncated file list cannot attribute the work to one deployable,
        // and guessing which app shipped is exactly the wrong place to guess.
        if (files.truncated) continue;

        const { targets, ambiguous } = resolveReleaseTargets(
          pullRequest.repo,
          files.files,
        );
        if (ambiguous || targets.length !== 1) continue;

        const run = await this.github.findSuccessfulRunSince({
          repo: targets[0].repo,
          workflow: targets[0].workflow,
          since: pullRequest.mergedAt,
        });
        if (!run) continue;

        await this.repository.update(
          { id: pullRequest.id },
          {
            releaseState: 'released',
            releaseTag: null,
            releaseRunId: run.id,
            releaseRunUrl: run.htmlUrl,
          },
        );
        this.logger.info(
          `[BUILDER] ${pullRequest.repo}#${pullRequest.prNumber} was released after all — a successful ${targets[0].workflow} run started after it merged.`,
        );
      } catch (error) {
        this.logger.warn(
          `Could not re-check the failed release for ${pullRequest.repo}#${pullRequest.prNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * Say out loud when the GitHub credential has stopped working.
   *
   * A token that expires does not announce itself: every call starts coming
   * back unauthorised, each caller catches its own failure and logs a warning,
   * and the scheduled tasks above them keep reporting that they completed. The
   * platform goes quiet while looking healthy, and the only trace is a `warn`
   * in a log nobody is reading. One expiry cost most of a day that way.
   *
   * A single rejection is not news — a fine-grained token can legitimately be
   * refused one repository. A run of them across different endpoints is the
   * credential, not a permission, so this waits for a threshold.
   *
   * Attached to the most recent session only because a notification needs an
   * owner to reach; the condition is not about that session, and the wording
   * says so. Dedup is the notification service's, keyed on when the run of
   * failures began — the loops here would otherwise repeat it every tick for
   * as long as the outage lasted.
   */
  private async reportCredentialHealth(): Promise<void> {
    const { failures, since } = this.github.credentialHealth;
    if (failures < BUILDER_AUTH_FAILURE_ALERT_THRESHOLD || !since) return;

    const session = await this.sessionRepository.findOne({
      where: {},
      order: { updatedAt: 'DESC' },
    });
    if (!session) return;

    await this.notificationService.credentialRejected(session, failures, since);
    this.logger.error(
      `[BUILDER] GitHub has rejected ${failures} consecutive calls since ${since.toISOString()}. Everything downstream is blind until the credential is replaced.`,
    );
  }

  async reconcileReleases(): Promise<void> {
    if (!this.github.isConfigured) return;

    await this.reportCredentialHealth();
    await this.reconcileFailedReleases();
    await this.checkReleaseHealth().catch((error) =>
      this.logger.warn(
        `Could not check release health: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );

    const releasing = await this.repository.find({
      where: { releaseState: 'releasing' },
    });

    for (const pullRequest of releasing) {
      try {
        const files = await this.github.listPullRequestFiles(
          pullRequest.repo,
          pullRequest.prNumber,
        );
        const target = resolveReleaseTargets(pullRequest.repo, files.files)
          .targets[0];
        if (!target) continue;

        let runId = pullRequest.releaseRunId;
        if (!runId && pullRequest.releaseDispatchedAt) {
          const found = await this.releaseService.resolveRun(
            target,
            pullRequest.releaseDispatchedAt,
          );
          if (found) {
            runId = found.id;
            await this.repository.update(
              { id: pullRequest.id },
              { releaseRunId: found.id, releaseRunUrl: found.htmlUrl },
            );
          }
        }

        const verdict = await this.releaseService.poll({
          target,
          runId,
          dispatchedAt: pullRequest.releaseDispatchedAt,
          timeoutMs: BUILDER_RELEASE_TIMEOUT_MS,
        });
        if (verdict.state === 'running') continue;

        await this.repository.update(
          { id: pullRequest.id },
          {
            releaseState: verdict.state === 'succeeded' ? 'released' : 'failed',
            ...(verdict.state === 'succeeded'
              ? { releasedAt: new Date() }
              : {}),
            ...(verdict.runUrl ? { releaseRunUrl: verdict.runUrl } : {}),
          },
        );

        if (verdict.state === 'succeeded') {
          this.logger.info(
            `[BUILDER] ${pullRequest.repo}#${pullRequest.prNumber} is live as ${pullRequest.releaseTag}.`,
          );
          continue;
        }

        this.logger.warn(
          `[BUILDER] Release of ${pullRequest.repo}#${pullRequest.prNumber} FAILED (${verdict.detail ?? 'unknown'}). Merged to master but NOT deployed.`,
        );
        const session = await this.sessionRepository.findOne({
          where: { id: pullRequest.sessionId },
        });
        if (session) {
          await this.notificationService.releaseFailed(
            session,
            pullRequest.repo,
            pullRequest.prNumber,
            pullRequest.releaseTag ?? null,
            verdict.detail ?? null,
            verdict.runUrl ?? pullRequest.releaseRunUrl ?? null,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Could not reconcile the release of ${pullRequest.repo}#${pullRequest.prNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * After a release lands, check the service it went to is answering.
   *
   * Stacks, "Canary Deployments for Safe Agent Iteration": an automatic
   * release is only safe with a check after it and a stop when it fails. A
   * pipeline that went green is not the same as a service that works.
   *
   * Runs once per released pull request, a few minutes after it went live,
   * against each of its release targets that has a health URL
   * (AppConfigService.builderHealthUrls); three tries, half a minute apart.
   * A failure marks the PR `unhealthy`, which stops every automatic merge and
   * release (releaseIsUnhealthy) and tells the admin. Rolling back is a
   * person's call: this stops the line, it does not undo the release.
   */
  async checkReleaseHealth(): Promise<void> {
    const due = await this.repository.find({
      where: { releaseState: 'released', releaseHealthCheckedAt: IsNull() },
    });
    for (const pullRequest of due) {
      const releasedAt = pullRequest.releasedAt?.getTime() ?? 0;
      if (!releasedAt || Date.now() - releasedAt < BUILDER_RELEASE_SETTLE_MS)
        continue;
      const urls = this.healthUrlsFor(pullRequest.repo);
      const failing: string[] = [];
      for (const url of urls) {
        if (!(await this.answersHealthy(url))) failing.push(url);
      }
      await this.repository.update(
        { id: pullRequest.id },
        {
          releaseHealthCheckedAt: new Date(),
          ...(failing.length ? { releaseState: 'unhealthy' } : {}),
        },
      );
      if (!urls.length) {
        this.logger.info(
          `[BUILDER] ${pullRequest.repo}#${pullRequest.prNumber} released; no health URL for it, so not checked.`,
        );
        continue;
      }
      if (!failing.length) continue;
      this.logger.warn(
        `[BUILDER] ${pullRequest.repo}#${pullRequest.prNumber} released but unhealthy: ${failing.join(', ')}. Automatic merges and releases stopped.`,
      );
      const session = await this.sessionRepository.findOne({
        where: { id: pullRequest.sessionId },
      });
      if (session) {
        await this.notificationService.releaseFailed(
          session,
          pullRequest.repo,
          pullRequest.prNumber,
          pullRequest.releaseTag ?? null,
          `Deployed, but the health check is failing (${failing.join(', ')}). I've stopped automatic merges and releases until someone checks the service.`,
          pullRequest.releaseRunUrl ?? null,
        );
      }
    }
  }

  /** The health URLs for a repo's release targets; empty when none is known. */
  private healthUrlsFor(repo: string): string[] {
    const urls = this.configService.builderHealthUrls;
    return Object.entries(urls)
      .filter(([target]) => target === repo || target.startsWith(`${repo}:`))
      .map(([, url]) => url);
  }

  private async answersHealthy(url: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt)
        await new Promise((resolve) =>
          setTimeout(resolve, BUILDER_HEALTH_RETRY_MS),
        );
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) return true;
      } catch {
        // retried below
      }
    }
    return false;
  }

  /**
   * Whether a recent release failed its health check. While one has, Builder
   * merges and releases nothing on its own — the line stops until a person
   * has looked (and cleared it by fixing forward or rolling back).
   */
  async releaseIsUnhealthy(): Promise<boolean> {
    const since = new Date(Date.now() - BUILDER_UNHEALTHY_HOLD_MS);
    return (
      (await this.repository.count({
        where: {
          releaseState: 'unhealthy',
          releaseHealthCheckedAt: MoreThan(since),
        },
      })) > 0
    );
  }

  /**
   * How Builder's recent opencode pull requests went, for deciding whether
   * it has earned more autonomy. Stacks, "Progressive Delegation: Staged
   * Autonomy Growth": widen autonomy as the agent proves reliable.
   *
   * Over the last `window` opencode PRs that got at least one review verdict:
   * how many were approved clean, how many a person then merged exactly as
   * reviewed (the merged head is the head the clean review read), how many
   * needed a person, and how many releases failed their health check.
   */
  async trackRecord(window = BUILDER_TRACK_RECORD_WINDOW): Promise<{
    window: number;
    cleanReviewed: number;
    mergedAsReviewed: number;
    escalated: number;
    unhealthyReleases: number;
  }> {
    const recent = (
      await this.repository.find({
        where: { branch: Like('opencode/%') },
        order: { createdAt: 'DESC' },
        take: window * 3,
      })
    )
      .filter((pr) => (pr.reviewHistory?.length ?? 0) > 0)
      .slice(0, window);
    return {
      window,
      cleanReviewed: recent.filter((pr) => Boolean(pr.reviewPassedSha)).length,
      mergedAsReviewed: recent.filter(
        (pr) =>
          pr.merged && pr.reviewPassedSha && pr.headSha === pr.reviewPassedSha,
      ).length,
      escalated: recent.filter(
        (pr) => pr.needsHumanAt || pr.escalationResolution,
      ).length,
      unhealthyReleases: recent.filter((pr) => pr.releaseState === 'unhealthy')
        .length,
    };
  }

  /**
   * Keep the branch current with master.
   *
   * A pull request that has fallen behind cannot be merged — GitHub says
   * `behind` and the merge button refuses — and Builder had no way to fix that
   * itself. Both of today's builder pull requests went stale this way and each
   * needed a hand rebase before it could land; one needed two.
   *
   * ## Why this does not rebase
   *
   * It merges master in, via `update-branch`. `builder-fix-prompt.ts` forbids
   * the agent from rebasing or force-pushing for a reason that applies just as
   * much here: rewriting the branch destroys a reviewer's place in the diff and
   * orphans every comment anchored to a line, without telling them why. A merge
   * commit is one extra node in the history and breaks nothing.
   *
   * ## The guards
   *
   *  - **`autoFixEnabled`**, reused rather than given a fourth switch. This
   *    pushes a commit to an open pull request, which is exactly what that
   *    switch is about, and an admin who has said no to that has said no to
   *    this.
   *  - **the head author**, the same rule `ingestFeedback` applies: once
   *    somebody else has pushed to the branch they are mid-work on it, and
   *    dropping a merge commit underneath them is how an agent becomes the
   *    reason nobody reviews its pull requests. "Could not tell" is not "ours",
   *    so the tick is skipped and the next one retries.
   *  - **`behind` only.** `dirty` is a real conflict that needs a person or a
   *    fix run, and `blocked` is a missing approval — neither is fixed by
   *    merging master in, and trying would burn an API call per tick forever.
   */
  private async considerBranchUpdate(
    pullRequest: BuilderPullRequest,
    remote: { headSha: string | null; mergeableState: string | null },
  ): Promise<void> {
    if (remote.mergeableState !== 'behind' || !remote.headSha) return;

    // Deliberately not gated on `autoFixEnabled`. Bringing a branch up to date
    // with master is bookkeeping, not a fix: no agent, no model, no runner, one
    // GitHub API call. `autoFixEnabled` is the switch for spending money on
    // runs, and tying this to it meant that turning off expensive work also
    // turned off the free work — leaving green, approved pull requests stuck at
    // `behind`, which is not `clean`, which is what the merge prompt waits for.
    // So the loop went quiet with nothing to show and nothing to click.
    const settings = await this.settingsService.get();
    if (!settings.enabled) return;

    const author = await this.github.getCommitAuthor(
      pullRequest.repo,
      remote.headSha,
    );
    if (!author) return;
    if (!this.isOwnActor(author.login ?? author.name ?? '')) return;

    const { updated, message } = await this.github.updatePullRequestBranch(
      pullRequest.repo,
      pullRequest.prNumber,
      remote.headSha,
    );
    if (updated) {
      this.logger.info(
        `Brought ${pullRequest.repo}#${pullRequest.prNumber} up to date with master.`,
      );
      return;
    }
    this.logger.warn(
      `Could not update ${pullRequest.repo}#${pullRequest.prNumber}: ${message ?? 'no reason given'}.`,
    );
  }

  /**
   * A pull request that conflicts with master, and what to do about it.
   *
   * GitHub does not start `pull_request` workflows on a conflicting PR, so
   * the head sits with no check runs and the rollup reads as "still running"
   * for as long as the conflict stands: on ally-be#664 a fix request waited a
   * day for CI that could never start. `considerBranchUpdate` leaves `dirty`
   * alone because merging master in cannot fix it; this is the other half.
   *
   *  - **opencode's own branch, ours at the head:** ask opencode to merge
   *    master in and resolve it, as a `/oc` comment. It counts as a fix round,
   *    so `maxFixRunsPerPr` bounds it, and past the ceiling a person is told.
   *  - **anything else** (automatic fixes off, a `builder/*` branch, a person's
   *    commit at the head): a person is told. Nobody was going to resolve it.
   *
   * Returns true when the conflict held this tick back, so the caller does not
   * review or fix a head that has no checks. One request at a time, settled by
   * `settleOpencodeFix`; the tick that settles one does not ask again, because
   * GitHub reports `dirty` for a few seconds after the push that cleared it.
   */
  private async considerConflict(
    pullRequest: BuilderPullRequest,
    remote: { headSha: string | null; mergeableState: string | null },
  ): Promise<boolean> {
    if (remote.mergeableState !== 'dirty') return false;
    const settings = await this.settingsService.get();
    if (!settings.enabled) return false;

    if (pullRequest.fixRequestedAt) {
      await this.settleOpencodeFix(pullRequest);
      return true;
    }

    const conflict = 'It conflicts with master, so CI cannot run on it.';
    if (!settings.autoFixEnabled || !isOpencodeBranch(pullRequest.branch)) {
      await this.escalate(pullRequest, conflict);
      return true;
    }
    const ceiling = settings.maxFixRunsPerPr ?? 0;
    if (ceiling && pullRequest.fixRunCount >= ceiling) {
      await this.escalate(
        pullRequest,
        `${conflict} ${pullRequest.fixRunCount} fix rounds are spent.`,
      );
      return true;
    }
    if (!remote.headSha) return true;
    const author = await this.github.getCommitAuthor(
      pullRequest.repo,
      remote.headSha,
    );
    // Could not tell, or somebody else is mid-work on the branch.
    if (!author) return true;
    if (!this.isOwnActor(author.login ?? author.name ?? '')) {
      await this.escalate(pullRequest, conflict);
      return true;
    }
    if (await this.buildService.hasRunInFlight(pullRequest.sessionId)) {
      return true;
    }

    const commentUrl = await this.github.createIssueComment(
      pullRequest.repo,
      pullRequest.prNumber,
      '/oc This pull request conflicts with master, so CI cannot run on it. ' +
        'Merge the latest master into this branch, resolve every conflict ' +
        'keeping the intent of both sides, make sure the checks pass, and ' +
        'push. Do not reformat files you did not change.',
    );
    if (!commentUrl) return true;

    await this.repository.update(
      { id: pullRequest.id },
      {
        fixRunCount: pullRequest.fixRunCount + 1,
        fixRequestedSha: remote.headSha,
        fixRequestedAt: new Date(),
      },
    );
    this.logger.info(
      `[BUILDER] Asked opencode to resolve the conflict on ${pullRequest.repo}#${pullRequest.prNumber}: ${commentUrl}`,
    );
    return true;
  }

  /**
   * Whether to send a review run at this PR.
   *
   * This is the caller that did not exist. Builder verified its own work before
   * opening a pull request and then nothing read the result again — so an
   * independent review was a thing a human did by hand, on every PR, and the
   * fix loop underneath it sat idle for want of anything to act on.
   *
   * The guards, and the failure each one prevents:
   *
   *  - **the kill switch**, same as fixes: autonomy on an open pull request is
   *    opt-in. Separate from `autoFixEnabled` because review is the safer half
   *    and deserves to be turnable on alone — findings land, nothing pushes.
   *  - **the ceiling**, because review → fix → new head sha → review is a loop
   *    with no natural end.
   *  - **the head sha**, because re-reading an unchanged diff every few minutes
   *    is money spent to reach the same conclusion.
   *  - **green CI only.** A reviewer reading a diff that does not compile
   *    spends its findings restating the compiler's, and the fix loop already
   *    owns red CI. Pending checks wait for the next tick rather than race.
   *  - **nothing already pending**, because work a fix run is about to do is
   *    not yet worth reviewing.
   *
   * Returns whether a run was dispatched, so the caller can leave fixes alone
   * this tick.
   */
  private async considerReviewRun(
    pullRequest: BuilderPullRequest,
    headSha: string | null,
    rollup: CheckRollup | null,
  ): Promise<boolean> {
    const settings = await this.settingsService.get();
    if (!settings.enabled || !settings.autoReviewEnabled) return false;

    // Only opencode pull requests are reviewed, in their own repo's Actions.
    // A `builder/*` pull request from Builder's old runner build has no
    // review left to send it to.
    if (!isOpencodeBranch(pullRequest.branch)) return false;
    if (pullRequest.reviewRunCount >= BUILDER_MAX_REPO_REVIEWS_PER_PR) {
      return false;
    }
    const recent = await this.buildService.recentReviewOutcomes(
      pullRequest.id,
      2,
    );
    if (
      recent.length === 2 &&
      recent.every(
        (status) =>
          status === BuilderRunStatus.FAILED ||
          status === BuilderRunStatus.TIMED_OUT,
      )
    ) {
      await this.escalate(
        pullRequest,
        'The last two reviews ended without a verdict, so I cannot tell whether this is safe.',
      );
      return false;
    }
    if (!headSha || pullRequest.reviewedSha === headSha) return false;
    if (rollup?.state !== 'success') return false;

    const pending = await this.feedbackRepository.countPending(pullRequest.id);
    if (pending) return false;

    const run = await this.buildService.dispatchReviewRun(pullRequest, headSha);
    return Boolean(run);
  }

  /**
   * What a review run found.
   *
   * Written straight into feedback rather than posted to GitHub and read back:
   * `isOwnActor` drops comments authored by our own bot, and it has to — a
   * Builder that treated its own replies as feedback would argue with itself
   * forever. Routing an agent review through the same door would make it
   * invisible the moment it was posted.
   *
   * So the findings land as PENDING `AGENT_REVIEW` items, which is exactly what
   * `considerFixRun` already looks for. The fix loop needs no changes to act on
   * them; it was only ever missing something to act on.
   *
   * Zero findings is a real and expected answer, and the caller records it the
   * same way — an empty list is what a clean review looks like, not a failure.
   */
  async recordReviewFindings(
    runId: string,
    sessionId: string,
    pullRequestId: string,
    findings: {
      key?: string;
      body?: string;
      path?: string;
      line?: number;
    }[],
  ): Promise<number> {
    const pullRequest = await this.repository.findOne({
      where: { id: pullRequestId, sessionId },
    });
    if (!pullRequest) {
      this.logger.warn(
        `Builder run ${runId} reported a review for ${pullRequestId}, which is not this session's — ignoring.`,
      );
      return 0;
    }

    let recorded = 0;
    for (const [index, finding] of findings.entries()) {
      const body = String(finding.body ?? '').trim();
      if (!body) continue;
      await this.feedbackRepository.upsertIfNew({
        pullRequestId: pullRequest.id,
        sessionId,
        kind: BuilderPrFeedbackKind.AGENT_REVIEW,
        // Keyed on the run, not the finding's text: the same run reporting
        // twice is a retry and must not double-record, while a later review of
        // a newer head sha is a different run and genuinely new work.
        externalId: `${runId}:${finding.key ?? index}`,
        author: 'builder-review',
        body,
        path: finding.path ?? null,
        line: finding.line ?? null,
      });
      recorded += 1;
    }

    this.logger.info(
      `Review run ${runId} reported ${recorded} finding(s) on ${pullRequest.repo}#${pullRequest.prNumber}.`,
    );

    if (isOpencodeBranch(pullRequest.branch)) {
      await this.considerEscalation(pullRequest, findings, recorded);
    }

    // A clean review is the only thing that can approve. Recorded as a fact on
    // the row rather than acted on only here, because approval is reconsidered
    // on the tick and needs to know the OUTCOME — `reviewedSha` is stamped at
    // dispatch and a failed run leaves it looking identical to this.
    if (recorded === 0) {
      await this.repository.update(
        { id: pullRequest.id },
        { reviewPassedSha: pullRequest.reviewedSha ?? null },
      );
      pullRequest.reviewPassedSha = pullRequest.reviewedSha ?? null;
      await this.considerApproval(pullRequest);
    }

    return recorded;
  }

  /**
   * Whether a clean review may approve the pull request.
   *
   * This is the step that actually blocked every Builder pull request. `master`
   * requires an approving review, the bot holds only `write`, and nothing in
   * the system ever approved — so a green, reviewed, finding-free PR still
   * waited on a human to click Approve, or on an admin to override branch
   * protection outright.
   *
   * The guards:
   *
   *  - **its own switch**, off by default and independent of review and fix.
   *    This is the strongest of the three and the last to earn trust; review
   *    can run for weeks writing findings a human reads before anyone enables
   *    it.
   *  - **CI green right now**, re-read rather than taken from the row. The row
   *    was written by the reconcile tick that dispatched the review, and a
   *    check can have gone red in the minutes a review takes. Approving on a
   *    stale green is exactly the mistake that makes an approval worthless.
   *  - **nothing outstanding.** Findings from an earlier review that a fix run
   *    has not finished with mean this pull request is mid-conversation.
   *
   * It never forces. The approval is an ordinary review: every other required
   * check still has to pass, and a human can dismiss it like any other.
   */
  /**
   * Does the review we already have still cover this head?
   *
   * Both repos protect master with `dismiss_stale_reviews` AND
   * `strict_up_to_date`, which between them form a closed loop: a pull request
   * must be current with master to merge, bringing it current pushes a commit,
   * and that commit dismisses the approval. Re-approving needs a review of the
   * new head, the per-PR review cap refuses one after two, and the pull request
   * is then stuck for good — green, reviewed, unapprovable, unmergeable.
   *
   * It is broken by looking at what the new commit actually is. An update-branch
   * merge is authored by us and has the reviewed head as its FIRST parent: the
   * pull request's own commits are unchanged and only master moved underneath
   * them. The review verdict still describes the work, so it carries forward.
   *
   * First parent specifically, not "any parent". On a merge commit the first
   * parent is the branch being merged INTO — our reviewed head — and the second
   * is master. Accepting either would also accept the reverse merge, which is a
   * different commit with different contents.
   *
   * What this does not assume is that the result still works: approval requires
   * a green rollup on the new head regardless, so a semantic conflict dragged in
   * from master is caught by CI before anything is approved.
   */
  private async reviewSurvivedOurOwnUpdate(
    pullRequest: BuilderPullRequest,
    headSha: string,
  ): Promise<boolean> {
    const head = await this.github.getCommitAuthor(pullRequest.repo, headSha);
    // Two parents is what makes it a merge; anything else is real work. A
    // missing `parents` is treated as "cannot tell", which refuses — the same
    // judgement the branch-update guard makes about an unreadable author.
    if (!head?.parents || head.parents.length !== 2) return false;
    if (head.parents[0] !== pullRequest.reviewPassedSha) return false;
    if (!this.isOwnActor(head.login ?? head.name ?? '')) return false;

    this.logger.info(
      `Carrying the review of ${pullRequest.repo}#${pullRequest.prNumber} across our own branch update.`,
    );
    await this.repository.update(
      { id: pullRequest.id },
      { reviewPassedSha: headSha },
    );
    pullRequest.reviewPassedSha = headSha;
    return true;
  }

  private async considerApproval(
    pullRequest: BuilderPullRequest,
    known?: { remote: PullRequestInfo | null; rollup: CheckRollup | null },
  ): Promise<void> {
    // Waiting on a person: a review that was already in flight must not
    // approve it behind their back.
    if (pullRequest.needsHumanAt) return;
    const settings = await this.settingsService.get();
    if (!settings.enabled || !settings.autoApproveEnabled) return;

    // The approve call posts a new review every time it is made, and this now
    // runs on a tick rather than once per review, so the stamp is what keeps a
    // pull request from collecting one approval every few minutes. Checked
    // against the sha we last saw, before any network call, so the ordinary
    // tick over an already-approved pull request costs nothing.
    if (
      pullRequest.approvedSha &&
      pullRequest.approvedSha === pullRequest.headSha
    )
      return;

    // Never approve a commit no review PASSED on. `considerApproval` used to be
    // reachable only from a review that had just finished reporting zero
    // findings, which made this implicit; on the reconcile path it has to be
    // said, and said against the outcome rather than the dispatch.
    if (!pullRequest.reviewPassedSha) return;

    const outstanding = await this.feedbackRepository.countActionable(
      pullRequest.id,
    );
    if (outstanding) return;

    // The reconcile pass has already fetched both of these for this tick.
    // Re-fetching would double this service's GitHub traffic for every open
    // pull request, to learn what the caller already knows.
    const remote =
      known?.remote ??
      (await this.github.getPullRequest(
        pullRequest.repo,
        pullRequest.prNumber,
      ));
    if (!remote || remote.state !== 'open' || remote.merged) return;
    if (!remote.headSha) return;
    if (pullRequest.approvedSha === remote.headSha) return;
    if (
      pullRequest.reviewPassedSha !== remote.headSha &&
      !(await this.reviewSurvivedOurOwnUpdate(pullRequest, remote.headSha))
    )
      return;

    const rollup =
      known?.rollup ??
      (await this.github.getCheckRollup(pullRequest.repo, remote.headSha));
    if (rollup?.state !== 'success') {
      this.logger.info(
        `Not approving ${pullRequest.repo}#${pullRequest.prNumber}: checks are ${rollup?.state ?? 'unknown'}.`,
      );
      return;
    }

    // Says what it is and what it rests on. Anyone reading the pull request
    // should be able to tell at a glance that a machine approved it, and on
    // what basis, rather than finding an unattributed "LGTM".
    const { approved, message } = await this.github.approvePullRequest(
      pullRequest.repo,
      pullRequest.prNumber,
      [
        "Approved by Builder's review agent.",
        '',
        'It read the full diff against master and reported no findings, with',
        'every required check green. This is a machine review, not a human one',
        '— dismiss it like any other if you want a person to look.',
      ].join('\n'),
    );

    if (approved) {
      await this.repository.update(
        { id: pullRequest.id },
        { approvedSha: remote.headSha },
      );
      this.logger.info(
        `[BUILDER] Approved ${pullRequest.repo}#${pullRequest.prNumber} on a clean review.`,
      );
      return;
    }
    this.logger.warn(
      `Could not approve ${pullRequest.repo}#${pullRequest.prNumber}: ${message ?? 'no reason given'}.`,
    );
  }

  /**
   * Record what arrived on the PR: failing checks and human comments.
   *
   * CI failures are keyed by `sha:check` so a re-run of the same failing check
   * on the same commit is one item, but the same check failing again after a
   * new push is a new one — which is the distinction a fix loop needs to avoid
   * either spinning on a stale failure or ignoring a fresh one.
   *
   * ## The head-sha guard
   *
   * A failing check is only Builder's to fix if Builder wrote the commit it
   * failed on. Once somebody pushes to the branch they are mid-work on it, and
   * a commit landing underneath them is how an agent becomes the reason nobody
   * reviews its pull requests — the risk `builder-fix-prompt.ts` opens by
   * naming. So a failure on a head commit we did not author is still recorded,
   * as OBSERVED, and never counted as pending work.
   *
   * Scoped to the CI half on purpose. A reviewer who pushes a commit AND leaves
   * a comment is asking for something; suppressing the whole loop there would
   * answer a direct request with silence. Their comment still goes in as
   * PENDING and still earns a fix run.
   *
   * "Could not tell who pushed" is not "somebody else pushed". `orIgnore` in
   * `upsertIfNew` makes the first write final, so guessing OBSERVED during a
   * GitHub blip would permanently sink a real failure of our own — and guessing
   * PENDING is the very push we are guarding against. The tick is skipped
   * instead; this is polled, so the next one picks it up.
   *
   * ## The unfixable-check guard
   *
   * A second, independent reason to record rather than act: some checks are
   * ours and still cannot be satisfied from inside a code repo. The docs guard
   * wants a `Wiki-PR:` trailer pointing at a pull request in a repo the runner
   * cannot clone, so a fix run spends an attempt, changes nothing it could
   * change, and leaves the PR as red as it found it — three times over, up to
   * `maxFixRunsPerPr`. See `BUILDER_UNFIXABLE_CHECKS`.
   *
   * Decided per check, not per commit, because one push routinely fails both:
   * the docs guard, which we cannot fix, and a real test, which we must.
   */
  private async ingestFeedback(
    pullRequest: BuilderPullRequest,
    headSha: string | null,
    rollup: CheckRollup | null,
  ): Promise<void> {
    if (rollup?.state === 'failure' && headSha) {
      const headAuthor = await this.github.getCommitAuthor(
        pullRequest.repo,
        headSha,
      );
      if (!headAuthor) {
        this.logger.warn(
          `Skipping CI feedback for ${pullRequest.repo}#${pullRequest.prNumber}: could not read who authored ${headSha.slice(0, 7)}.`,
        );
      } else {
        // `login` is null for a commit whose email is not linked to a GitHub
        // account — a definite answer, and definitely not our bot, so it falls
        // through to the git author name rather than to "unknown".
        const ours = this.isOwnActor(headAuthor.login ?? headAuthor.name ?? '');
        // The failing step's own output, so a fix request carries the error
        // rather than only the check's name.
        const excerpts = ours
          ? await this.github
              .failedCheckExcerpts(pullRequest.repo, headSha)
              .catch(() => ({}) as Record<string, string>)
          : {};

        for (const check of rollup.failed) {
          // Two independent reasons a failure is not ours to act on, and the
          // check-level one is decided per check rather than per commit: a
          // push of ours can fail the docs guard AND a real test at once, and
          // the test half must still earn its fix run.
          const unfixable = isUnfixableCheck(check);
          const status =
            ours && !unfixable
              ? BuilderPrFeedbackStatus.PENDING
              : BuilderPrFeedbackStatus.OBSERVED;

          const shortSha = headSha.slice(0, 7);
          let body: string;
          if (unfixable) {
            body =
              `The check "${check}" failed on ${shortSha}. A fix run cannot ` +
              `satisfy it — it needs a Wiki-PR trailer pointing at a pull ` +
              `request in the wiki repo, which a build cannot open. Recorded ` +
              `for a human.`;
          } else if (!ours) {
            body =
              `The check "${check}" failed on ${shortSha}, pushed by ` +
              `${headAuthor.login ?? headAuthor.name ?? 'someone else'}. Left for them.`;
          } else {
            body = `The check "${check}" failed on ${shortSha}.`;
            if (excerpts[check]) {
              body += `\n\nThe failing step's output:\n\n\`\`\`\n${excerpts[check]}\n\`\`\``;
            }
          }

          // A docs rule a fix run cannot satisfy is a person's call: say what
          // the guard asked for, on an opencode PR, instead of recording it for
          // nobody.
          if (unfixable && ours && isOpencodeBranch(pullRequest.branch)) {
            const asked = (excerpts[check] ?? '')
              .split('\n')
              .map((line) => line.replace(/^##\[error\]/, '').trim())
              .find((line) => /wiki|docs/i.test(line));
            await this.escalate(
              pullRequest,
              `Needs a docs decision: ${asked ?? `the "${check}" check failed`}. Add a Wiki-PR: line to the pull request description (a wiki PR link, or "Wiki-PR: none — <reason>"), or the docs:skip label with a reason.`,
            );
          }

          await this.feedbackRepository.upsertIfNew({
            pullRequestId: pullRequest.id,
            sessionId: pullRequest.sessionId,
            kind: BuilderPrFeedbackKind.CI_FAILURE,
            externalId: `${headSha}:${check}`,
            author: 'ci',
            body,
            status,
          });
        }
      }
    }

    const feedback = await this.github.listPullRequestFeedback(
      pullRequest.repo,
      pullRequest.prNumber,
    );
    for (const item of feedback) {
      // Builder's own PR body and its replies are not feedback to itself.
      if (this.isOwnActor(item.author)) continue;
      // An approval that says nothing needs no action; `listPullRequestFeedback`
      // already drops the empty ones, and a "looks good" with words is still
      // worth recording as context rather than as work.
      await this.feedbackRepository.upsertIfNew({
        pullRequestId: pullRequest.id,
        sessionId: pullRequest.sessionId,
        kind:
          item.kind === 'review'
            ? BuilderPrFeedbackKind.REVIEW
            : BuilderPrFeedbackKind.REVIEW_COMMENT,
        externalId: item.externalId,
        author: item.author,
        body: item.body,
        path: item.path ?? null,
        line: item.line ?? null,
      });
    }
  }

  /**
   * Whether a GitHub actor is Builder itself.
   *
   * Answers two questions with one rule: whose comments to ignore (Builder's
   * own replies are not feedback to itself) and whose commits Builder may act
   * on top of. Keeping it one predicate is the point — a bot that skipped its
   * own comments but failed to recognise its own pushes would read a branch it
   * owns as somebody else's and stop fixing its own red CI.
   */
  private isOwnActor(author: string): boolean {
    const login = author.toLowerCase();
    // Exact match against the known accounts, plus the GitHub App suffix. The
    // old prefix match missed the account runners actually push as, which
    // disabled branch updates and self-fixing red CI without a word.
    return (
      BUILDER_OWN_ACTORS.some((actor) => login === actor) ||
      login.endsWith('[bot]')
    );
  }

  /**
   * PENDING and IN_FIX only. OBSERVED is left alone deliberately: it was never
   * work, so "the PR closed before we got to it" is not true of it, and
   * flattening the two into STALE would cost the flywheel the only record that
   * a person's own push was what broke this branch.
   */
  private async staleFeedback(pullRequestId: string): Promise<void> {
    await this.feedbackRepository.update(
      {
        pullRequestId,
        status: In([
          BuilderPrFeedbackStatus.PENDING,
          BuilderPrFeedbackStatus.IN_FIX,
        ]),
      },
      { status: BuilderPrFeedbackStatus.STALE },
    );
  }

  /**
   * Whether to ask for a fix on this PR, and why not when not.
   *
   * Only opencode pull requests are fixed: their feedback goes back to
   * opencode as a `/oc` comment (considerOpencodeFix). A `builder/*` pull
   * request left by a build on Builder's old runner is no longer worked on
   * automatically — that runner only drafts designs now — so its feedback
   * waits for a person.
   */
  private async considerFixRun(pullRequest: BuilderPullRequest): Promise<void> {
    if (!isOpencodeBranch(pullRequest.branch)) return;
    await this.considerOpencodeFix(pullRequest);
  }

  /**
   * Feedback on an opencode pull request goes to opencode, as a `/oc` comment,
   * not to a fix run on the old runner.
   *
   * opencode made the branch, knows it, and is what the repo's `builder.yml`
   * runs on a `/oc` comment; a second agent on the same branch is two
   * authors of one change. The comment carries only a marker: the findings
   * themselves are fetched privately by the workflow
   * (GET /builder/pipeline/pull-requests/:id/fix-request), because ally-be,
   * ally-web and ally-ai are public and a review reads against a private
   * design — the same reason a build issue carries only its run id.
   *
   * The same guards as a fix run: the kill switch, the per-PR ceiling, and
   * nothing in flight for the session (while the issue build runs, red CI is
   * its to fix — reconcileIssueRun). One request at a time: opencode reports
   * no per-item outcome, so the request stays open until the branch moves
   * (settleOpencodeFix).
   */
  private async considerOpencodeFix(
    pullRequest: BuilderPullRequest,
  ): Promise<void> {
    if (pullRequest.fixRequestedAt) {
      await this.settleOpencodeFix(pullRequest);
      return;
    }

    const settings = await this.settingsService.get();
    if (!settings.enabled || !settings.autoFixEnabled) return;
    const pending = await this.feedbackRepository.countPending(pullRequest.id);
    const ceiling = settings.maxFixRunsPerPr ?? 0;
    if (ceiling && pullRequest.fixRunCount >= ceiling) {
      // Out of rounds with something still open — failing checks or
      // findings — is a person's call now, not another quiet stop.
      if (pending) {
        await this.escalate(
          pullRequest,
          `${pullRequest.fixRunCount} fix rounds and ${pending} problem${pending === 1 ? '' : 's'} still open.`,
        );
      }
      return;
    }
    if (!pending) return;
    if (await this.buildService.hasRunInFlight(pullRequest.sessionId)) return;

    const items = await this.feedbackRepository.listActionable(pullRequest.id);
    if (!items.length) return;

    const commentUrl = await this.github.createIssueComment(
      pullRequest.repo,
      pullRequest.prNumber,
      `/oc Address Builder's review feedback on this pull request ` +
        `(${items.length} item${items.length === 1 ? '' : 's'}). ` +
        'Fix each one on this branch and keep every check passing. ' +
        'Say which you fixed, and for any you disagree with, why.\n\n' +
        `<!-- builder-feedback: ${pullRequest.id} -->`,
    );
    if (!commentUrl) return;

    await this.feedbackRepository.update(
      { id: In(items.map((item) => item.id)) },
      {
        status: BuilderPrFeedbackStatus.IN_FIX,
        fixRunId: null,
        replyUrl: commentUrl,
      },
    );
    await this.repository.update(
      { id: pullRequest.id },
      {
        fixRunCount: pullRequest.fixRunCount + 1,
        fixRequestedSha: pullRequest.headSha ?? null,
        fixRequestedAt: new Date(),
      },
    );
    this.logger.info(
      `[BUILDER] Asked opencode to address ${items.length} feedback item(s) on ${pullRequest.repo}#${pullRequest.prNumber}: ${commentUrl}`,
    );
  }

  /**
   * Close an outstanding `/oc` request once opencode has answered it.
   *
   *  - The branch moved: opencode pushed, so the items are addressed. CI and
   *    the next review judge whether they really are.
   *  - opencode's run finished and the branch did not move: nothing it did
   *    reached the branch, whatever its reply says — on ally-mobile#114 it
   *    switched branches, opencode skipped the push, and the reply claimed
   *    every item fixed. The items go back to PENDING and the round counts,
   *    so the escalation rules, not a reply, decide when to stop.
   *  - Neither within the timeout: the items go back to PENDING for another
   *    request, which the per-PR ceiling bounds.
   */
  private async settleOpencodeFix(
    pullRequest: BuilderPullRequest,
  ): Promise<void> {
    const requestedAt = pullRequest.fixRequestedAt as Date;
    const moved =
      Boolean(pullRequest.headSha) &&
      pullRequest.headSha !== pullRequest.fixRequestedSha;

    let status: BuilderPrFeedbackStatus | null = null;
    if (moved) {
      status = BuilderPrFeedbackStatus.ADDRESSED;
    } else {
      const answer = await this.github.findRunSince({
        repo: pullRequest.repo,
        workflow: ISSUE_BUILD_WORKFLOW,
        since: requestedAt,
        event: 'issue_comment',
      });
      if (answer?.status === 'completed') {
        status = BuilderPrFeedbackStatus.PENDING;
        this.logger.warn(
          `[BUILDER] opencode finished on ${pullRequest.repo}#${pullRequest.prNumber} without pushing; its feedback goes back to pending.`,
        );
      } else if (Date.now() - requestedAt.getTime() > OC_FIX_TIMEOUT_MS) {
        status = BuilderPrFeedbackStatus.PENDING;
      }
    }
    if (!status) return;

    await this.feedbackRepository.update(
      { pullRequestId: pullRequest.id, status: BuilderPrFeedbackStatus.IN_FIX },
      {
        status,
        ...(status === BuilderPrFeedbackStatus.PENDING
          ? {}
          : { addressedAt: new Date() }),
      },
    );
    await this.repository.update(
      { id: pullRequest.id },
      { fixRequestedSha: null, fixRequestedAt: null },
    );
    this.logger.info(
      `[BUILDER] opencode's fix request on ${pullRequest.repo}#${pullRequest.prNumber} settled: feedback ${status}.`,
    );
  }

  /**
   * The feedback an outstanding `/oc` request hands opencode, as its prompt.
   * Read by the repo's `builder.yml` (builder-opencode.yml) when a `/oc`
   * comment carries Builder's `builder-feedback` marker.
   */
  async fixRequestPrompt(pullRequestId: string): Promise<string> {
    const pullRequest = await this.repository.findOne({
      where: { id: pullRequestId },
    });
    if (!pullRequest) {
      throw new NotFoundException(`No Builder pull request ${pullRequestId}.`);
    }
    const items = (
      await this.feedbackRepository.listActionable(pullRequest.id)
    ).filter((item) => item.status === BuilderPrFeedbackStatus.IN_FIX);
    const lines = items.map((item, index) => {
      const where = item.path
        ? ` (${item.path}${item.line ? `:${item.line}` : ''})`
        : '';
      const source =
        item.kind === BuilderPrFeedbackKind.AGENT_REVIEW
          ? 'Review finding'
          : item.kind === BuilderPrFeedbackKind.CI_FAILURE
            ? 'Failing check'
            : `Comment from ${item.author ?? 'a reviewer'}`;
      return `${index + 1}. ${source}${where}:\n${String(item.body ?? '').trim()}`;
    });
    return [
      `Address this feedback on pull request #${pullRequest.prNumber}, on its own branch.`,
      'Fix each item where it is right. Where you disagree, change nothing for it and',
      "say why in your reply. Keep every check passing: run the repository's typecheck,",
      'lint and tests and fix what they report. Do not change a test to make it pass',
      'unless the test itself is wrong, and say so if it is. Change nothing outside',
      'what the feedback asks for. End with a short list of what you fixed, what you',
      'disagreed with, and how you tested it.',
      ...this.repoCheckLines(pullRequest.repo),
      '',
      ...(lines.length ? lines : ['(No feedback is outstanding.)']),
    ].join('\n');
  }

  /** The commands this repository's CI holds a pull request to. */
  private repoCheckLines(repo: string): string[] {
    const definition = findBuilderRepo(repo);
    if (!definition) return [];
    const commands = [
      definition.typecheck,
      definition.lint,
      ...(definition.ciChecks ?? []),
      definition.affectedTest ?? definition.test,
    ].filter(Boolean);
    return [
      '',
      `CI runs: ${commands.map((c) => `\`${c}\``).join(', ')}. Formatting of changed files is applied for you afterwards.`,
    ];
  }

  /**
   * Decide, from the review just filed, whether this pull request is still
   * converging or needs a person.
   *
   * Stacks, "Escalation Criteria for Human-in-the-Loop Review": route to a
   * person on exceeded thresholds, persistent errors and unresolved conflicts.
   * Each rule below is one of those:
   *  - out of rounds: serious findings remain once the fix ceiling is spent;
   *  - not getting better: two fix rounds in a row that did not reduce them;
   *  - the same problem twice: a finding that survived two fix rounds, which
   *    is opencode unable to fix it or disagreeing with it.
   * A clean review never escalates.
   */
  private async considerEscalation(
    pullRequest: BuilderPullRequest,
    findings: { key?: string; body?: string }[],
    count: number,
  ): Promise<void> {
    // Keys arrive as "<sha>:<slug>" so a finding that survives a round is
    // filed as new; the slug is what identifies the problem.
    const slug = (key?: string) =>
      String(key ?? '').replace(/^[0-9a-f]{7,40}:/, '');
    const keys = findings.map((finding) => slug(finding.key)).filter(Boolean);
    const history = [
      ...(pullRequest.reviewHistory ?? []),
      {
        sha: pullRequest.reviewedSha ?? null,
        count,
        keys,
        at: new Date().toISOString(),
      },
    ];
    await this.repository.update(
      { id: pullRequest.id },
      { reviewHistory: history },
    );
    pullRequest.reviewHistory = history;
    if (count === 0) return;

    const settings = await this.settingsService.get();
    const ceiling = settings.maxFixRunsPerPr ?? 0;
    if (ceiling && pullRequest.fixRunCount >= ceiling) {
      await this.escalate(
        pullRequest,
        `After ${pullRequest.fixRunCount} fix round${pullRequest.fixRunCount === 1 ? '' : 's'}, the latest review still found ${count} problem${count === 1 ? '' : 's'}.`,
      );
      return;
    }
    if (await this.timeBoxSpent(pullRequest)) return;

    const [a, b, c] = history.slice(-3);
    if (c && b.count >= a.count && c.count >= b.count) {
      await this.escalate(
        pullRequest,
        `Two fix rounds in a row did not reduce the problems the review found (still ${count}).`,
      );
      return;
    }

    const survivor = c
      ? keys.find((key) => a.keys.includes(key) && b.keys.includes(key))
      : undefined;
    if (survivor) {
      const finding = findings.find((item) => slug(item.key) === survivor);
      const what = String(finding?.body ?? survivor)
        .split('\n')
        .map((line) => line.replace(/^\[(high|medium|low)\]\s*/i, '').trim())
        .find(Boolean);
      await this.escalate(
        pullRequest,
        `The same problem survived two fix rounds: ${what}`,
      );
    }
  }

  /**
   * Record what an opencode run or a review spent (POST pipeline/usage).
   *
   * Every report adds to the session's total and, when it names one, the
   * run's cost. Reports for a pull request — a review, a `/oc` fix, a
   * person's `/oc` — add to that PR's automation spend, which the per-PR
   * budget (maxPrAutomationUsd) is checked against. A build report names its
   * run (the issue marker); its PR does not exist yet, so it counts towards
   * the session, not a PR budget.
   */
  async recordUsage(report: {
    kind: 'build' | 'fix' | 'review';
    repo: string;
    prNumber?: number | null;
    runId?: string | null;
    costUsd: number;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<{ ok: boolean; sessionId: string | null }> {
    const cost = Math.max(0, Number(report.costUsd) || 0);
    const pullRequest = report.prNumber
      ? await this.repository.findOne({
          where: { repo: report.repo, prNumber: report.prNumber },
          order: { createdAt: 'DESC' },
        })
      : null;
    const sessionId = await this.buildService.recordExternalUsage(
      report.runId ?? null,
      pullRequest?.sessionId ?? null,
      cost,
    );
    if (pullRequest && cost > 0) {
      await this.repository.increment(
        { id: pullRequest.id },
        'automationCostUsd',
        cost,
      );
    }
    this.logger.info(
      `[BUILDER] ${report.kind} on ${report.repo}${report.prNumber ? `#${report.prNumber}` : ''} cost $${cost.toFixed(4)} (${report.inputTokens ?? 0} in / ${report.outputTokens ?? 0} out tokens).`,
    );
    return { ok: true, sessionId };
  }

  /**
   * The spend limit: this pull request's automated review and fixes have cost
   * at least maxPrAutomationUsd. Escalates, and says whether it did. Checked
   * before every review or `/oc` request, so Builder never starts work past
   * the limit.
   */
  private async budgetSpent(pullRequest: BuilderPullRequest): Promise<boolean> {
    const settings = await this.settingsService.get();
    const limit = Number(settings.maxPrAutomationUsd ?? 0);
    const spent = Number(pullRequest.automationCostUsd ?? 0);
    if (!limit || spent < limit) return false;
    await this.escalate(
      pullRequest,
      `Spent $${spent.toFixed(2)} of the $${limit.toFixed(2)} automation budget on review and fixes` +
        (await this.openProblemsClause(pullRequest)),
    );
    return true;
  }

  /**
   * How an escalation ends: the problems still open (not the last review's
   * count, which went on reading 4 after fixes for two of them were pushed),
   * and whether fixes were pushed that no review has read yet.
   */
  private async openProblemsClause(
    pullRequest: BuilderPullRequest,
  ): Promise<string> {
    const open = await this.feedbackRepository.countActionable(pullRequest.id);
    const unreviewed =
      !!pullRequest.headSha &&
      !!pullRequest.reviewedSha &&
      pullRequest.headSha !== pullRequest.reviewedSha;
    const problems = open
      ? `, and ${open} problem${open === 1 ? ' is' : 's are'} still open`
      : ', and no problem is still open';
    return (
      problems +
      (unreviewed
        ? '. Fixes were pushed after the last review and have not been reviewed yet.'
        : '.')
    );
  }

  /**
   * The time box: review-and-fix has run on this pull request for
   * BUILDER_PR_AUTOMATION_TIMEBOX_MS since its first review, and its latest
   * review still had serious findings. Escalates, and says whether it did.
   * Checked on every tick as well as on each verdict, so a loop waiting on
   * opencode or CI still stops on time.
   */
  private async timeBoxSpent(
    pullRequest: BuilderPullRequest,
  ): Promise<boolean> {
    const history = pullRequest.reviewHistory ?? [];
    const first = history.find((entry) => entry.at)?.at;
    const last = history[history.length - 1];
    if (!first || !last || last.count === 0) return false;
    const spent = Date.now() - new Date(first).getTime();
    if (spent < BUILDER_PR_AUTOMATION_TIMEBOX_MS) return false;
    await this.escalate(
      pullRequest,
      `${spent >= 2 * 3_600_000 ? `${Math.round(spent / 3_600_000)} hours` : `${Math.round(spent / 60_000)} minutes`} of automated review and fixes` +
        (await this.openProblemsClause(pullRequest)),
    );
    return true;
  }

  /**
   * Stop automation on one pull request and tell a person why. Idempotent: a
   * PR already waiting on someone is not escalated (or announced) again.
   *
   * Stacks, "Escalate Agent Errors to Human Operators Transparently": the
   * stop is said, with its reason, rather than left as a loop that went quiet.
   */
  private async escalate(
    pullRequest: BuilderPullRequest,
    reason: string,
  ): Promise<void> {
    if (pullRequest.needsHumanAt) return;
    const at = new Date();
    await this.repository.update(
      { id: pullRequest.id },
      {
        needsHumanAt: at,
        needsHumanReason: reason,
        escalationResolution: null,
        escalationResolvedAt: null,
      },
    );
    pullRequest.needsHumanAt = at;
    pullRequest.needsHumanReason = reason;
    this.logger.warn(
      `[BUILDER] ${pullRequest.repo}#${pullRequest.prNumber} handed to a person: ${reason}`,
    );
    const session = await this.sessionRepository.findOne({
      where: { id: pullRequest.sessionId },
    });
    if (session) {
      await this.notificationService.prNeedsHuman(session, pullRequest, reason);
    }
  }

  /**
   * Give a pull request back to automation, with a fresh budget of rounds. The
   * person has steered it (a `/oc` comment, a fix of their own) or decided a
   * finding was wrong; either way the history that escalated it no longer
   * describes the branch.
   */
  async resumeAutomation(
    sessionId: string,
    pullRequestId: string,
    userId: number,
  ): Promise<BuilderPullRequest> {
    const pullRequest = await this.repository.findOne({
      where: { id: pullRequestId, sessionId },
    });
    if (!pullRequest) {
      throw new NotFoundException(
        'That pull request is not part of this session.',
      );
    }
    await this.repository.update(
      { id: pullRequest.id },
      {
        needsHumanAt: null,
        needsHumanReason: null,
        escalationResolution: pullRequest.needsHumanAt
          ? 'resumed'
          : (pullRequest.escalationResolution ?? null),
        escalationResolvedAt: pullRequest.needsHumanAt
          ? new Date()
          : (pullRequest.escalationResolvedAt ?? null),
        fixRunCount: 0,
        reviewRunCount: 0,
        reviewedSha: null,
        reviewHistory: [],
        fixRequestedSha: null,
        fixRequestedAt: null,
      },
    );
    this.logger.info(
      `[BUILDER] ${pullRequest.repo}#${pullRequest.prNumber} given back to automation by user ${userId}.`,
    );
    return this.repository.findOneOrFail({ where: { id: pullRequest.id } });
  }

  listBySession(sessionId: string): Promise<BuilderPullRequest[]> {
    return this.repository.listBySession(sessionId);
  }

  listFeedback(sessionId: string): Promise<BuilderPrFeedback[]> {
    return this.feedbackRepository.listBySession(sessionId);
  }
}
