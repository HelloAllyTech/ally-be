import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  GithubActionsService,
  WorkflowRun,
} from 'src/github/service/github-actions.service';
import { ReleaseTarget } from '../constants/release-targets.constants';

/**
 * Dispatching a production release, and watching it to a verdict.
 *
 * ## Why this is its own service
 *
 * Bug Hunter has released merged fixes since 2026-08, and every mechanical part
 * of that — pick the next tag, dispatch the workflow, find the run it created,
 * poll it, give up after a while — is about GitHub and says nothing about bug
 * findings. Builder now needs exactly the same seven steps for merged pull
 * requests. Writing them twice would mean two timeout policies, two ideas of
 * how to find a run, and two places to fix the next thing we learn about
 * Actions.
 *
 * ## What it deliberately does NOT own
 *
 * State. Neither caller's status machine lives here, and they are genuinely
 * different: Bug Hunter releases a *sequence* of deployables in order, where a
 * frontend must not ship before the backend field it reads; Builder releases
 * the deployables one merged pull request touched. Folding those into one
 * abstraction would produce a shape that fits neither.
 *
 * So this owns the GitHub conversation and returns facts. Callers own their own
 * rows, their own events and their own notifications.
 */
@Injectable()
export class ProductionReleaseService {
  private readonly logger = LoggerService.getInstance(
    ProductionReleaseService.name,
  );

  constructor(private readonly github: GithubActionsService) {}

  /**
   * Fire a target's production-release workflow at the next patch version.
   *
   * Returns the tag and the moment GitHub accepted the dispatch. That timestamp
   * is not cosmetic — `resolve` uses it to find the run this call created, and
   * without it a release cannot be told from one somebody started by hand a
   * minute earlier.
   */
  async dispatch(
    target: ReleaseTarget,
    ref: string,
  ): Promise<{ tag: string; dispatchedAt: Date }> {
    const tag = await this.github.nextPatchTag(target.repo, target.tagPrefix);
    const dispatchedAt = await this.github.dispatchWorkflow({
      repo: target.repo,
      workflow: target.workflow,
      ref,
      inputs: { version_tag: tag },
    });
    this.logger.info(
      `Dispatched ${target.label} release ${tag} on ${target.repo}.`,
    );
    return { tag, dispatchedAt: dispatchedAt ?? new Date() };
  }

  /**
   * Find the Actions run a dispatch created.
   *
   * `workflow_dispatch` answers 204 with no body — GitHub tells you it accepted
   * the request and nothing about what it started — so the run has to be found
   * afterwards by workflow and time. Returns null while GitHub has not yet
   * listed it, which is normal for the first few seconds and is why callers
   * retry rather than treating it as a failure.
   */
  async resolveRun(
    target: ReleaseTarget,
    dispatchedAt: Date,
  ): Promise<WorkflowRun | null> {
    return this.github.findRunSince({
      repo: target.repo,
      workflow: target.workflow,
      since: dispatchedAt,
    });
  }

  /**
   * Where a dispatched release has got to.
   *
   * The three verdicts are the three things a caller must act on differently:
   *
   *  - `running` — say nothing, look again next tick.
   *  - `succeeded` — it is live.
   *  - `failed` — **merged but not deployed**, which is the state that needs a
   *    person. This is the verdict today's v1.109.0 would have produced: its
   *    deploy job failed when the ECS circuit breaker rolled the release back,
   *    and nothing noticed for the better part of an hour.
   *
   * A run that cannot be identified, or one still going past `timeoutMs`,
   * settles as `failed` rather than waiting forever. That is deliberate and it
   * is the conservative direction: a release wrongly called failed costs
   * somebody a look at a green Actions page, while one left "in progress"
   * forever silently claims work shipped that did not.
   */
  async poll(params: {
    target: ReleaseTarget;
    runId: string | null | undefined;
    dispatchedAt: Date | null | undefined;
    timeoutMs: number;
  }): Promise<{
    state: 'running' | 'succeeded' | 'failed';
    runUrl: string | null;
    detail: string | null;
  }> {
    const { target, runId, dispatchedAt, timeoutMs } = params;

    const run = runId ? await this.github.getRun(target.repo, runId) : null;
    if (run?.status === 'completed') {
      const succeeded = run.conclusion === 'success';
      return {
        state: succeeded ? 'succeeded' : 'failed',
        runUrl: run.htmlUrl ?? null,
        detail: run.conclusion ?? null,
      };
    }

    const age = dispatchedAt
      ? Date.now() - dispatchedAt.getTime()
      : Number.POSITIVE_INFINITY;
    if (age > timeoutMs) {
      return {
        state: 'failed',
        runUrl: run?.htmlUrl ?? null,
        detail: run ? 'timed out' : 'no matching GitHub Actions run found',
      };
    }

    return { state: 'running', runUrl: run?.htmlUrl ?? null, detail: null };
  }
}
