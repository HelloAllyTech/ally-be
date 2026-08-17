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

/**
 * A deliberately small GitHub REST client — four calls, nothing more.
 *
 * Bug Hunter is the only caller, so this lives in the module rather than
 * `src/github/`: pulling in Octokit for four endpoints would add a dependency
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
      'GITHUB_TOKEN is not configured on this environment — Bug Hunter cannot dispatch workflows.',
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
