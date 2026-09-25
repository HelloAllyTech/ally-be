import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  CheckRollup,
  GithubActionsService,
  PullRequestInfo,
} from 'src/github/service/github-actions.service';
import { AppConfigService } from 'src/config/config.service';
import { BuilderEventType } from '../enum/builder.enum';
import { buildVerificationComment } from '../util/verification-pr-comment.util';
import { BuilderPullRequest } from '../entity/builder-pull-request.entity';
import { BuilderPrFeedback } from '../entity/builder-pr-feedback.entity';
import {
  BuilderBuildEventRepository,
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
import { isBuilderRepo } from '../constants/builder-repos.constants';
import {
  BUILDER_AUTH_FAILURE_ALERT_THRESHOLD,
  BUILDER_MAX_REVIEW_RUNS_PER_PR,
  BUILDER_OWN_ACTORS,
  BUILDER_RELEASE_TIMEOUT_MS,
  BUILDER_WORKFLOW_REF,
  isUnfixableCheck,
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
    private readonly eventRepository: BuilderBuildEventRepository,
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

    // Only on first sight. A run that re-reports its pull requests — a retry,
    // a resumed run posting the same branch — must not stack a second identical
    // comment on a thread a person is reading.
    for (const pullRequest of opened) {
      await this.postVerificationComment(sessionId, runId, pullRequest);
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
   * Put the run's own review on the pull request it cleared.
   *
   * Builder already reviews its work before opening anything — the VERIFY
   * phase is a separate invocation with a fresh context and a read-only tool
   * allowlist, and no pull request opens until it passes. All of that happened
   * inside the run, so the person who arrives at the PR sees a green tick and
   * none of the reasoning behind it: not which requirements were checked, not
   * what the reviewer objected to before the coder fixed it, and not whether
   * the passing checks were judging an unmodified test configuration.
   *
   * This adds no judgement of its own. It renders events the run already
   * wrote, so it costs a GitHub call and nothing else — no second model, no
   * second opinion to reconcile with the first.
   *
   * Best-effort in every direction: a failed comment must not fail the pull
   * request it was describing, and a run with nothing recorded posts nothing
   * rather than an empty review that teaches people to skip these.
   */
  private async postVerificationComment(
    sessionId: string,
    runId: string,
    pullRequest: BuilderPullRequest,
  ): Promise<void> {
    // Read once, outside the try: a catch that dereferences the same object
    // the try failed on throws from the handler and escapes the guard entirely,
    // turning best-effort telemetry into a failed pull-request record.
    const where = `${pullRequest?.repo}#${pullRequest?.prNumber}`;
    try {
      const [verification, events] = await Promise.all([
        this.eventRepository.latestOfType(runId, BuilderEventType.VERIFICATION),
        this.eventRepository.listByRun(runId),
      ]);
      const gateResults = events.filter(
        (event) => event.type === BuilderEventType.GATE_RESULT,
      );

      const body = buildVerificationComment({
        verification,
        gateResults,
        sessionUrl: `${this.configService.adminBaseUrl}/builder/${sessionId}`,
      });
      if (!body) return;

      await this.github.createIssueComment(
        pullRequest.repo,
        pullRequest.prNumber,
        body,
      );
    } catch (error) {
      this.logger.warn(
        `Could not post the review summary to ${where}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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

    // A PR that is gone has nothing left to act on. Marked rather than
    // deleted: "we saw this and it stopped mattering" is the useful record,
    // and the flywheel reads closed-unmerged as its strongest signal.
    if (remote.merged || closedWithoutMerging) {
      await this.staleFeedback(pullRequest.id);
      if (remote.merged) await this.considerRelease(pullRequest);
      return;
    }

    await this.ingestFeedback(pullRequest, remote.headSha, rollup);
    if (rollup?.state === 'success') await this.staleCiFeedback(pullRequest.id);
    await this.considerBranchUpdate(pullRequest, remote);

    // Review before fix, and only one of them per tick. A review run that
    // dispatches leaves an active run behind, which `dispatchFixRun` refuses
    // to race — so asking for both here would reliably get the second refused
    // and look like a bug from the outside.
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

    if (pullRequest.reviewRunCount >= BUILDER_MAX_REVIEW_RUNS_PER_PR)
      return false;
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
   * Whether to send a fix run at this PR, and why not when not.
   *
   * Every guard here exists because the alternative is a loop that burns money
   * without converging:
   *  - the kill switch, because autonomy on someone's open PR should be opt-in;
   *  - `fixRunCount`, because a fix that cannot fix it will not fix it on the
   *    fourth attempt either;
   *  - "no active run", because two runners on one branch is a merge conflict
   *    Builder created for itself.
   *
   * Two of those are enforced elsewhere, and looking for them here is why this
   * list used to describe a guard that did not exist. "No active run" lives in
   * `BuilderBuildService.dispatchFixRun`, which every path to a fix run goes
   * through. The head-sha check lives in `ingestFeedback`: a CI failure on a
   * commit Builder did not author is written OBSERVED rather than PENDING, and
   * `countPending` never sees it — so the guard is upstream of the count below
   * rather than a fourth `if` in this method.
   */
  private async considerFixRun(pullRequest: BuilderPullRequest): Promise<void> {
    const settings = await this.settingsService.get();
    if (!settings.enabled || !settings.autoFixEnabled) return;

    const ceiling = settings.maxFixRunsPerPr ?? 0;
    if (ceiling && pullRequest.fixRunCount >= ceiling) return;

    const pending = await this.feedbackRepository.countPending(pullRequest.id);
    if (!pending) return;

    await this.buildService.dispatchFixRun(pullRequest);
  }

  listBySession(sessionId: string): Promise<BuilderPullRequest[]> {
    return this.repository.listBySession(sessionId);
  }

  listFeedback(sessionId: string): Promise<BuilderPrFeedback[]> {
    return this.feedbackRepository.listBySession(sessionId);
  }

  getById(pullRequestId: string): Promise<BuilderPullRequest> {
    return this.repository.findOneOrFail({ where: { id: pullRequestId } });
  }

  /**
   * Hand a fix run the items it should deal with, and mark them as claimed.
   *
   * Claiming matters because reconcile runs on a timer: a tick landing while a
   * fix run is mid-flight would count these as still pending and dispatch a
   * second run at the same comments.
   */
  async claimForFix(
    pullRequestId: string,
    runId: string,
  ): Promise<BuilderPrFeedback[]> {
    const items = await this.feedbackRepository.listActionable(pullRequestId);
    if (items.length) {
      await this.feedbackRepository.update(
        { id: In(items.map((item) => item.id)) },
        { status: BuilderPrFeedbackStatus.IN_FIX, fixRunId: runId },
      );
    }
    return items;
  }

  /**
   * What a fix run reports back: which items it handled and how.
   *
   * Trusted from the runner because only the runner knows — it read the
   * comment, wrote the code and posted the reply. What ally-be checks is that
   * the item belongs to this run's PR, so a stray key cannot mark another
   * session's feedback done.
   */
  async recordFeedbackOutcomes(
    runId: string,
    sessionId: string,
    outcomes: {
      feedbackId?: string;
      status?: string;
      replyUrl?: string;
    }[],
  ): Promise<number> {
    let updated = 0;
    for (const outcome of outcomes) {
      if (!outcome.feedbackId) continue;
      const row = await this.feedbackRepository.findOne({
        where: { id: outcome.feedbackId, sessionId },
      });
      if (!row) {
        this.logger.warn(
          `Builder run ${runId} reported feedback ${outcome.feedbackId}, which is not this session's — ignoring.`,
        );
        continue;
      }
      const status =
        outcome.status === 'dismissed'
          ? BuilderPrFeedbackStatus.DISMISSED
          : BuilderPrFeedbackStatus.ADDRESSED;
      await this.feedbackRepository.update(
        { id: row.id },
        {
          status,
          fixRunId: runId,
          replyUrl: outcome.replyUrl ?? row.replyUrl ?? null,
          addressedAt: new Date(),
        },
      );
      updated += 1;
    }
    return updated;
  }
}
