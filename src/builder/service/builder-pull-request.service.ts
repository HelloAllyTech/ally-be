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
} from '../enum/builder.enum';
import { isBuilderRepo } from '../constants/builder-repos.constants';
import { isUnfixableCheck } from '../constants/builder.constants';

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
      `[BUILDER] ${row.repo}#${row.prNumber} merged from the drawer by user ${userId}.`,
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
      return;
    }

    await this.ingestFeedback(pullRequest, remote.headSha, rollup);
    await this.considerFixRun(pullRequest);
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
    return login.startsWith('ally-builder') || login.endsWith('[bot]');
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
