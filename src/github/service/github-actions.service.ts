import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';

/** The subset of a GitHub Actions run this module cares about. */
export interface WorkflowRun {
  id: string;
  htmlUrl: string;
  status: 'queued' | 'in_progress' | 'completed' | string;
  /** Null until `status` is `completed`. */
  conclusion: string | null;
  createdAt: Date;
}

/** The subset of a GitHub pull request this module cares about. */
export interface PullRequestInfo {
  merged: boolean;
  htmlUrl: string;
  mergedAt: Date | null;
  /** open | closed. A PR closed without merging is a rejection, not a pass. */
  state: string;
  /** Head commit sha — what a CI rollup is actually about. */
  headSha: string | null;
}

/**
 * The combined state of every check on a commit, as one word.
 *
 * GitHub reports checks per run; what a reader (and an auto-fix decision)
 * wants is "is this branch red". `failure` wins over everything because one
 * failing required check blocks a merge regardless of what else passed.
 */
export interface CheckRollup {
  /** success | failure | pending | none */
  state: string;
  /** Names of the checks that failed, for the fix prompt to reproduce. */
  failed: string[];
  total: number;
}

/**
 * Who wrote a commit.
 *
 * Two names because they answer differently. `login` is the GitHub ACCOUNT the
 * commit is attributed to and is the one worth matching a bot against — but it
 * is null whenever the commit's email is not linked to an account, which is
 * ordinary for a CI-authored or a locally-configured git identity. `name` is
 * the git author line, always there, and is the fallback.
 */
export interface CommitAuthor {
  login: string | null;
  name: string | null;
}

/** A review comment or review verdict left on a pull request by a person. */
export interface PullRequestFeedback {
  /** GitHub's own id, so re-reading the PR cannot duplicate a row. */
  externalId: string;
  kind: 'review_comment' | 'review';
  author: string;
  body: string;
  path?: string | null;
  line?: number | null;
  /** For a review: APPROVED | CHANGES_REQUESTED | COMMENTED. */
  state?: string | null;
  createdAt: Date | null;
}

/**
 * A deliberately small GitHub REST client — five calls, nothing more.
 *
 * Bug Hunter is the only caller, so this lives in the module rather than
 * `src/github/`: pulling in Octokit for five endpoints would add a dependency
 * (and its ESM/CJS interop problem — see ally-be/CLAUDE.md) to earn nothing.
 * Everything here uses the same plain `axios` the AI service already uses for
 * its outbound calls.
 *
 * ## Why dispatching is asymmetric
 *
 * `POST /actions/workflows/{file}/dispatches` answers **204 No Content**: it
 * tells you the dispatch was accepted and nothing about the run it created.
 * There is no run id to correlate on. `findRunSince` closes that gap by
 * listing the workflow's recent runs and taking the newest one created at or
 * after the dispatch instant — which is why callers must record
 * `dispatchedAt` at dispatch time and why the reconcile task, not the
 * dispatching request, is what resolves a run id.
 */
@Injectable()
export class GithubActionsService {
  private readonly logger = LoggerService.getInstance(
    GithubActionsService.name,
  );

  constructor(private readonly configService: AppConfigService) {}

  /** False when no token is configured — every caller must refuse cleanly rather than 500. */
  get isConfigured(): boolean {
    return Boolean(this.configService.githubToken);
  }

  private get headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.configService.githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private url(repo: string, path: string): string {
    return `https://api.github.com/repos/${this.configService.githubOrg}/${repo}/${path}`;
  }

  /**
   * Fires a `workflow_dispatch`. Resolves to the instant GitHub accepted it —
   * the correlation key `findRunSince` needs, taken from our own clock a beat
   * BEFORE the request so clock skew can only ever widen the search window,
   * never exclude our own run from it.
   */
  async dispatchWorkflow(params: {
    repo: string;
    workflow: string;
    ref: string;
    inputs: Record<string, string>;
  }): Promise<Date> {
    this.requireConfigured();
    const dispatchedAt = new Date();
    try {
      await axios.post(
        this.url(
          params.repo,
          `actions/workflows/${params.workflow}/dispatches`,
        ),
        { ref: params.ref, inputs: params.inputs },
        { headers: this.headers, timeout: 15_000 },
      );
      return dispatchedAt;
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not dispatch ${params.workflow} in ${params.repo}`,
      );
    }
  }

  /**
   * The run this dispatch created, or null if GitHub hasn't registered it yet
   * (routinely the case for the first several seconds — the caller should
   * treat null as "check again later", never as failure).
   *
   * Takes the OLDEST qualifying run rather than the newest: if a second
   * dispatch landed while we were waiting, the earlier one is ours.
   */
  async findRunSince(params: {
    repo: string;
    workflow: string;
    since: Date;
  }): Promise<WorkflowRun | null> {
    this.requireConfigured();
    try {
      const { data } = await axios.get(
        this.url(params.repo, `actions/workflows/${params.workflow}/runs`),
        {
          headers: this.headers,
          params: { event: 'workflow_dispatch', per_page: 30 },
          timeout: 15_000,
        },
      );
      const candidates = (data?.workflow_runs ?? [])
        .map((run: any) => this.toWorkflowRun(run))
        .filter((run: WorkflowRun) => run.createdAt >= params.since)
        .sort(
          (a: WorkflowRun, b: WorkflowRun) =>
            a.createdAt.getTime() - b.createdAt.getTime(),
        );
      return candidates[0] ?? null;
    } catch (error) {
      // Correlation is best-effort by design: a failure here costs the drawer
      // a "watch it work" link, and must never fail the caller's own work.
      this.logger.warn(
        `Could not list runs for ${params.workflow} in ${params.repo}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * A pull request's current merge state, straight from GitHub — the check
   * nothing else in this module performs. `merged` is only ever true once
   * GitHub itself reports it, whichever way the PR was actually merged (the
   * fix agent's own `gh pr merge --admin`, or a human merging it by hand in
   * GitHub's review UI, which this module otherwise never hears about).
   */
  async getPullRequest(
    repo: string,
    number: number,
  ): Promise<PullRequestInfo | null> {
    this.requireConfigured();
    try {
      const { data } = await axios.get(this.url(repo, `pulls/${number}`), {
        headers: this.headers,
        timeout: 15_000,
      });
      return {
        merged: Boolean(data?.merged),
        htmlUrl: data?.html_url,
        mergedAt: data?.merged_at ? new Date(data.merged_at) : null,
        state: String(data?.state ?? 'open'),
        headSha: data?.head?.sha ? String(data.head.sha) : null,
      };
    } catch (error) {
      this.logger.warn(
        `Could not read PR #${number} in ${repo}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Merges a pull request, as the platform's own GitHub token.
   *
   * ## Why this exists at all
   *
   * The bot account that opens a fix PR holds `write` on the three protected
   * repos, and their `master` requires an approving review — so the fix
   * agent's own `gh pr merge --admin` cannot land anything there. In practice
   * that made every backend and frontend fix end at a green PR with a human
   * going to GitHub to merge it: 89 of the 122 bot PRs merged so far were
   * clicked through by hand, almost all within the hour. The review was never
   * the cost; the trip was.
   *
   * So this merges as the SERVER's token (the same one that dispatches
   * production releases, which necessarily has more rights than the bot), at
   * an admin's explicit request, from the Bug Hunter drawer. The decision
   * stays human and is recorded; only the errand is removed.
   *
   * ## Why it does not force
   *
   * `merge_method: squash` and nothing else — no `--admin` equivalent, no
   * bypass. The caller checks the rollup first, and if GitHub still refuses
   * (a required review missing, a branch behind, a check that went red in the
   * meantime) that refusal is surfaced verbatim rather than worked around.
   * A one-click merge that could push past a red gate would be a worse thing
   * than the errand it replaces.
   *
   * Returns GitHub's own message on refusal instead of throwing, because
   * "Base branch was modified" and "At least 1 approving review is required"
   * are both things the admin can act on and neither is an outage.
   */
  async mergePullRequest(
    repo: string,
    number: number,
    commitTitle?: string,
  ): Promise<{ merged: boolean; message: string | null }> {
    this.requireConfigured();
    try {
      const { data } = await axios.put(
        this.url(repo, `pulls/${number}/merge`),
        {
          merge_method: 'squash',
          ...(commitTitle ? { commit_title: commitTitle } : {}),
        },
        { headers: this.headers, timeout: 30_000 },
      );
      return {
        merged: Boolean(data?.merged),
        message: data?.message ? String(data.message) : null,
      };
    } catch (error) {
      // 405 (not mergeable) and 409 (head changed) are the expected refusals
      // and both carry a message worth showing; anything else is logged and
      // reported the same way, since the admin's next move is identical.
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ??
        (error instanceof Error ? error.message : String(error));
      this.logger.warn(`Could not merge PR #${number} in ${repo}: ${message}`);
      return { merged: false, message };
    }
  }

  /**
   * Who authored a commit — used to tell Builder's own pushes from a person's.
   *
   * Returns `null` for "could not tell", which callers must NOT collapse into
   * "not a bot": the two mean different things, and a caller that writes a
   * decision to the database on a failed lookup makes a transient GitHub
   * outage permanent. See `BuilderPullRequestService.ingestFeedback`, which
   * skips the tick rather than guessing.
   */
  async getCommitAuthor(
    repo: string,
    sha: string,
  ): Promise<CommitAuthor | null> {
    this.requireConfigured();
    try {
      const { data } = await axios.get(this.url(repo, `commits/${sha}`), {
        headers: this.headers,
        timeout: 15_000,
      });
      return {
        login: data?.author?.login ? String(data.author.login) : null,
        name: data?.commit?.author?.name
          ? String(data.commit.author.name)
          : null,
      };
    } catch (error) {
      this.logger.warn(
        `Could not read the author of ${repo}@${sha}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Whether CI is green on a commit, as one verdict plus the names of what
   * failed.
   *
   * Reads both APIs on purpose: `check-runs` covers GitHub Actions, and the
   * older `status` API covers anything reporting commit statuses instead. A
   * repo using only one of them would look like it had no CI at all if we read
   * only the other, and "no CI" is indistinguishable from "green" to a caller
   * deciding whether to auto-fix.
   */
  async getCheckRollup(repo: string, ref: string): Promise<CheckRollup | null> {
    this.requireConfigured();
    try {
      const [checks, statuses] = await Promise.all([
        axios
          .get(this.url(repo, `commits/${ref}/check-runs`), {
            headers: this.headers,
            timeout: 15_000,
          })
          .then((response) => response.data?.check_runs ?? [])
          .catch(() => []),
        axios
          .get(this.url(repo, `commits/${ref}/status`), {
            headers: this.headers,
            timeout: 15_000,
          })
          .then((response) => response.data?.statuses ?? [])
          .catch(() => []),
      ]);

      const failed: string[] = [];
      let pending = 0;
      let total = 0;

      for (const run of checks) {
        total += 1;
        const status = String(run?.status ?? '');
        const conclusion = String(run?.conclusion ?? '');
        if (status !== 'completed') {
          pending += 1;
        } else if (
          // `neutral`, `skipped` and `cancelled` are not failures: a skipped
          // job is a job somebody deliberately did not need to run.
          [
            'failure',
            'timed_out',
            'action_required',
            'startup_failure',
          ].includes(conclusion)
        ) {
          failed.push(String(run?.name ?? 'unnamed check'));
        }
      }

      for (const status of statuses) {
        total += 1;
        const state = String(status?.state ?? '');
        if (state === 'pending') pending += 1;
        else if (state === 'failure' || state === 'error') {
          failed.push(String(status?.context ?? 'unnamed status'));
        }
      }

      const state = !total
        ? 'none'
        : failed.length
          ? 'failure'
          : pending
            ? 'pending'
            : 'success';
      return { state, failed, total };
    } catch (error) {
      this.logger.warn(
        `Could not read checks for ${repo}@${ref}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Human feedback on a pull request: inline review comments and review
   * verdicts, newest first.
   *
   * Both carry GitHub's own ids so a caller can upsert rather than duplicate —
   * this is polled on a timer, so every read sees everything again.
   */
  async listPullRequestFeedback(
    repo: string,
    number: number,
  ): Promise<PullRequestFeedback[]> {
    this.requireConfigured();
    const feedback: PullRequestFeedback[] = [];

    try {
      const { data } = await axios.get(
        this.url(repo, `pulls/${number}/comments`),
        { headers: this.headers, timeout: 15_000, params: { per_page: 100 } },
      );
      for (const comment of data ?? []) {
        feedback.push({
          externalId: String(comment?.id),
          kind: 'review_comment',
          author: String(comment?.user?.login ?? 'unknown'),
          body: String(comment?.body ?? ''),
          path: comment?.path ? String(comment.path) : null,
          line: Number.isFinite(comment?.line) ? Number(comment.line) : null,
          createdAt: comment?.created_at ? new Date(comment.created_at) : null,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Could not read review comments on ${repo}#${number}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      const { data } = await axios.get(
        this.url(repo, `pulls/${number}/reviews`),
        { headers: this.headers, timeout: 15_000, params: { per_page: 100 } },
      );
      for (const review of data ?? []) {
        const state = String(review?.state ?? '');
        // An approval with no words is not feedback to act on.
        if (state === 'APPROVED' && !String(review?.body ?? '').trim())
          continue;
        feedback.push({
          externalId: String(review?.id),
          kind: 'review',
          author: String(review?.user?.login ?? 'unknown'),
          body: String(review?.body ?? ''),
          state,
          createdAt: review?.submitted_at
            ? new Date(review.submitted_at)
            : null,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Could not read reviews on ${repo}#${number}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return feedback;
  }

  /**
   * Reply in the thread of a review comment, so the person who raised it sees
   * the answer where they asked rather than as a new top-level comment.
   */
  async replyToReviewComment(
    repo: string,
    number: number,
    commentId: string,
    body: string,
  ): Promise<string | null> {
    this.requireConfigured();
    try {
      const { data } = await axios.post(
        this.url(repo, `pulls/${number}/comments/${commentId}/replies`),
        { body },
        { headers: this.headers, timeout: 15_000 },
      );
      return data?.html_url ? String(data.html_url) : null;
    } catch (error) {
      this.logger.warn(
        `Could not reply to comment ${commentId} on ${repo}#${number}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Cancels a running workflow — `POST /actions/runs/{run_id}/cancel`. This is
   * the actual compute/token saving behind "Stop fix session": the workflow's
   * `timeout-minutes: 60` cap otherwise runs to completion regardless of the
   * finding's own status in our DB.
   *
   * GitHub 409s cancelling a run that has already completed (or is already
   * cancelling); callers should treat that as fine, not fatal — see
   * `BugFixSessionService.cancelFixSession`, which must land the finding at
   * CANCELLED either way.
   */
  async cancelRun(repo: string, runId: string): Promise<void> {
    this.requireConfigured();
    try {
      await axios.post(
        this.url(repo, `actions/runs/${runId}/cancel`),
        undefined,
        { headers: this.headers, timeout: 15_000 },
      );
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not cancel run ${runId} in ${repo}`,
      );
    }
  }

  async getRun(repo: string, runId: string): Promise<WorkflowRun | null> {
    this.requireConfigured();
    try {
      const { data } = await axios.get(
        this.url(repo, `actions/runs/${runId}`),
        { headers: this.headers, timeout: 15_000 },
      );
      return this.toWorkflowRun(data);
    } catch (error) {
      this.logger.warn(
        `Could not read run ${runId} in ${repo}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * The next patch version for a tag prefix — `v1.4.1` → `v1.4.2`.
   *
   * Always a patch bump, never minor or major: this ships one bug fix, and
   * every one of these release workflows rejects a tag that isn't strictly
   * newer than the latest existing one, so the version must be derived from
   * what is actually on the remote rather than from anything stored here.
   * Falls back to `{prefix}0.0.1` for a repo with no matching tag yet.
   */
  async nextPatchTag(repo: string, tagPrefix: string): Promise<string> {
    this.requireConfigured();
    const pattern = new RegExp(
      `^${tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\.(\\d+)\\.(\\d+)$`,
    );
    try {
      const { data } = await axios.get(this.url(repo, 'tags'), {
        headers: this.headers,
        params: { per_page: 100 },
        timeout: 15_000,
      });
      const versions = (data ?? [])
        .map((tag: any) => pattern.exec(tag?.name ?? ''))
        .filter(Boolean)
        .map((match: RegExpExecArray) => [
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
        ]);
      if (versions.length === 0) return `${tagPrefix}0.0.1`;

      const [major, minor, patch] = versions.sort(
        (a: number[], b: number[]) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2],
      )[0];
      return `${tagPrefix}${major}.${minor}.${patch + 1}`;
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not read existing ${tagPrefix}* tags in ${repo}`,
      );
    }
  }

  private toWorkflowRun(run: any): WorkflowRun {
    return {
      id: String(run.id),
      htmlUrl: run.html_url,
      status: run.status,
      conclusion: run.conclusion ?? null,
      createdAt: new Date(run.created_at),
    };
  }

  private requireConfigured(): void {
    if (this.isConfigured) return;
    throw new ServiceUnavailableException(
      // Deliberately names no caller: this client is shared (Bug Hunter and
      // Builder both dispatch through it), and an error telling a Builder
      // user that "Bug Hunter cannot dispatch" sends them to the wrong tab.
      'GITHUB_TOKEN is not configured on this environment, so workflows cannot be dispatched.',
    );
  }

  /**
   * GitHub's own error text is far more useful to an admin than a generic 502
   * ("workflow does not have workflow_dispatch trigger", "Resource not
   * accessible by integration"), so it is surfaced rather than swallowed.
   */
  private toReadableError(error: unknown, prefix: string): Error {
    const axiosError = error as AxiosError<{ message?: string }>;
    const detail =
      axiosError?.response?.data?.message ??
      (error instanceof Error ? error.message : String(error));
    const status = axiosError?.response?.status;
    this.logger.error(`${prefix}: ${status ?? ''} ${detail}`);
    return new ServiceUnavailableException(`${prefix}: ${detail}`);
  }
}
