import { BadRequestException, Injectable } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';

import { LoggerService } from 'src/logger/logger.service';

import {
  BUG_FIX_SESSION_DEFAULT_REF,
  BUG_HUNT_SWEEP_WORKFLOW_FILE,
} from '../constants/bug-fix-session.constants';
import { BUG_HUNT_REPOS } from '../constants/bug-hunt-repos.constants';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugHunterService } from './bug-hunter.service';
import { GithubActionsService } from './github-actions.service';

/**
 * Starts a repo-wide sweep on demand.
 *
 * ## Why this exists
 *
 * Before this, nothing started a sweep. `BugHuntTrigger.SCHEDULED` was a valid
 * enum value with no producer anywhere in the platform; there was no
 * `schedule:` workflow; and the human-facing controller had no run-trigger
 * route at all — the only way to sweep was for someone to run
 * `.claude/workflows/bug-hunt.mjs` by hand inside a Claude Code session. An
 * agent whose whole value is noticing things nobody asked it to notice cannot
 * depend on being asked.
 *
 * ## Why it dispatches rather than runs
 *
 * A sweep checks out a repo, runs its suite, and may open a PR — none of which
 * ally-be can do from inside its own container. So this does exactly what the
 * fix session already does: create the run row FIRST (so the runner has a run
 * id from its very first call), then fire a `workflow_dispatch` at that repo's
 * `bug-hunt-sweep.yml`, which fetches the protocol from
 * `GET pipeline/sweep-prompt` and hands it to Claude Code.
 *
 * As with the fix session, `POST .../dispatches` returns 204 with **no run id**,
 * so there is nothing to correlate on at call time beyond the dispatch moment.
 */
@Injectable()
export class BugHuntSweepService {
  private readonly logger = LoggerService.getInstance(BugHuntSweepService.name);

  constructor(
    private readonly bugHunterService: BugHunterService,
    private readonly github: GithubActionsService,
    private readonly configService: AppConfigService,
  ) {}

  /**
   * Dispatch a sweep for one repo.
   *
   * Returns null when the kill switch is OFF — `requireEnabledOrRecordSkip` has
   * already written a `skipped_disabled` run row in that case, so an admin
   * pressing the button while Bug Hunter is off gets an audit trail rather than
   * silence.
   */
  async trigger(
    repo: string,
    userId: number,
    deep = false,
  ): Promise<BugHuntRun | null> {
    if (!BUG_HUNT_REPOS[repo]) {
      // Fail at the API boundary rather than dispatching a workflow filename
      // into a repo Bug Hunter was never configured for.
      throw new BadRequestException(
        `Bug Hunter is not configured for "${repo}". Known repos: ${Object.keys(
          BUG_HUNT_REPOS,
        ).join(', ')}.`,
      );
    }

    // Returns the live mode, or null having already written a
    // `skipped_disabled` run row when the kill switch is OFF.
    const mode = await this.bugHunterService.requireEnabledOrRecordSkip(
      BugHuntTrigger.MANUAL,
      repo,
    );
    if (!mode) return null;

    // Opened before the dispatch, not after, so the runner has a run id to
    // report against from its very first call.
    const run = await this.bugHunterService.startRun(
      BugHuntTrigger.MANUAL,
      repo,
    );

    try {
      await this.github.dispatchWorkflow({
        repo,
        workflow: BUG_HUNT_SWEEP_WORKFLOW_FILE,
        ref: BUG_FIX_SESSION_DEFAULT_REF,
        inputs: {
          run_id: run.id,
          repo,
          deep: String(deep),
          api_base_url: this.configService.publicApiBaseUrl,
        },
      });
      this.logger.info(
        `Dispatched a ${deep ? 'deep' : 'diff-scoped'} sweep of ${repo} ` +
          `(run ${run.id}) at the request of user ${userId}.`,
      );
      return run;
    } catch (error) {
      // Close the run we just opened. Leaving it RUNNING would show an admin a
      // sweep in progress that no runner is ever going to report on — the same
      // reasoning as dispatchFix closing the run it opened.
      await this.bugHunterService.closeRun(
        run.id,
        BugHuntRunStatus.FAILED,
        {
          foundCount: 0,
          autoMergedCount: 0,
          prOpenedCount: 0,
          dismissedCount: 0,
        },
        `Could not dispatch the sweep workflow: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
