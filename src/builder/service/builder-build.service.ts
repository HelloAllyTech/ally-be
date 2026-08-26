import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { GithubActionsService } from 'src/bug-hunter/service/github-actions.service';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import {
  BuilderBuildEventRepository,
  BuilderBuildRunRepository,
  BuilderQuestionRepository,
} from '../repository/builder-build.repository';
import { BuilderSettingsService } from './builder-settings.service';
import { BuilderNotificationService } from './builder-notification.service';
import {
  BuilderEventType,
  BuilderQuestionStatus,
  BuilderRunMode,
  BuilderRunStatus,
  BuilderSessionStatus,
  BuilderStage,
} from '../enum/builder.enum';
import {
  BUILDER_DISPATCH_TIMEOUT_MS,
  BUILDER_RESUME_FILES_MAX,
  BUILDER_RESUME_TEST_OUTPUT_MAX,
  BUILDER_RUN_TIMEOUT_MS,
  BUILDER_WORKFLOW_FILE,
  BUILDER_WORKFLOW_REF,
  BUILDER_WORKFLOW_REPO,
} from '../constants/builder.constants';

/**
 * Dispatching, resuming, cancelling and reconciling build runs.
 *
 * The shape of everything here follows from one GitHub behaviour:
 * `workflow_dispatch` answers **204 with no run id**. So a run row is created
 * before the dispatch (the runner is handed its id as an input), `dispatchedAt`
 * is stamped from our clock a beat before the POST, and a reconcile pass
 * correlates the two afterwards. Cancel, run links and status settling are all
 * eventually consistent because of it.
 */
@Injectable()
export class BuilderBuildService {
  private readonly logger = LoggerService.getInstance(BuilderBuildService.name);

  constructor(
    private readonly configService: AppConfigService,
    private readonly github: GithubActionsService,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly eventRepository: BuilderBuildEventRepository,
    private readonly questionRepository: BuilderQuestionRepository,
    private readonly settingsService: BuilderSettingsService,
    private readonly notificationService: BuilderNotificationService,
  ) {}

  /**
   * Start the first run of a session (or retry a failed one).
   *
   * Every refusal here is a spend control with a different cause, so each says
   * which one it was — "can't start a build" would leave the admin guessing
   * between a kill switch, a queue and a budget.
   */
  async startBuild(
    session: BuilderSession,
    userId: number,
    overrides: { engine?: string; model?: string; budgetUsd?: number } = {},
  ): Promise<BuilderBuildRun> {
    const settings = await this.settingsService.get();
    if (!settings.enabled) {
      throw new BadRequestException(
        'Builder is switched off for this environment. Turn it on in Builder settings first.',
      );
    }
    if (!this.github.isConfigured) {
      throw new ServiceUnavailableException(
        'GITHUB_TOKEN is not configured on this environment, so builds cannot be dispatched.',
      );
    }
    if (
      session.status !== BuilderSessionStatus.PRD_READY &&
      session.status !== BuilderSessionStatus.FAILED
    ) {
      throw new BadRequestException(
        `A build can only start from a ready PRD — this session is ${session.status.toLowerCase()}.`,
      );
    }

    const repos = session.repos ?? [];
    if (!repos.length) {
      throw new BadRequestException(
        'No repos chosen — the build has nowhere to land.',
      );
    }

    await this.assertWithinConcurrency(settings.maxConcurrentBuilds);
    this.assertWithinBudget(session);

    const engine = overrides.engine ?? session.engine;
    const model =
      overrides.model ?? session.model ?? this.configService.builder.buildModel;

    // Carry the chosen engine/model onto the session so a resume run and the
    // UI both read the same thing without re-deriving it.
    await this.sessionRepository.update(
      { id: session.id },
      {
        engine,
        model,
        status: BuilderSessionStatus.BUILDING,
        currentStage: BuilderStage.SETUP,
        error: null,
        ...(overrides.budgetUsd !== undefined
          ? { budgetUsd: String(overrides.budgetUsd) }
          : {}),
        updatedBy: userId,
      },
    );

    return this.dispatchRun({
      session: { ...session, engine, model },
      mode: BuilderRunMode.BUILD,
      userId,
      repos,
    });
  }

  /**
   * Continue a paused run once its whole question group is answered.
   *
   * Guarded on the group rather than the single question: the agent batches
   * everything ambiguous into one pause precisely so it only pays for one
   * teardown, and dispatching on the first answer would throw that away.
   */
  async resumeFromQuestions(
    session: BuilderSession,
    pausedRun: BuilderBuildRun,
    groupId: string,
    userId: number,
  ): Promise<BuilderBuildRun | null> {
    if (!(await this.questionRepository.isGroupComplete(groupId))) {
      return null;
    }
    this.assertWithinBudget(session);

    await this.sessionRepository.update(
      { id: session.id },
      { status: BuilderSessionStatus.BUILDING, updatedBy: userId },
    );

    return this.dispatchRun({
      session,
      mode: BuilderRunMode.RESUME,
      userId,
      repos: session.repos ?? [],
      resumeOfRunId: pausedRun.id,
      branches: pausedRun.branches ?? undefined,
    });
  }

  /**
   * Create the run row, then dispatch. Order matters: the runner is handed
   * its own run id as a workflow input and calls back with it from its first
   * step, so the row has to exist before the workflow can start.
   */
  private async dispatchRun(params: {
    session: BuilderSession;
    mode: BuilderRunMode;
    userId: number;
    repos: string[];
    resumeOfRunId?: string;
    branches?: Record<string, string>;
  }): Promise<BuilderBuildRun> {
    const { session, mode, userId, repos } = params;
    const sequence = await this.runRepository.nextSequence(session.id);

    // Our clock, a beat BEFORE the POST: clock skew can then only widen the
    // correlation window, never exclude our own run from it.
    const dispatchedAt = new Date(Date.now() - 5_000);

    const run = await this.runRepository.save(
      this.runRepository.create({
        sessionId: session.id,
        sequence,
        mode,
        status: BuilderRunStatus.QUEUED,
        resumeOfRunId: params.resumeOfRunId ?? null,
        engine: session.engine,
        model: session.model ?? this.configService.builder.buildModel,
        branchSlug: session.slug,
        branches: params.branches ?? null,
        dispatchedAt,
        createdBy: userId,
      }),
    );

    try {
      await this.github.dispatchWorkflow({
        repo: BUILDER_WORKFLOW_REPO,
        workflow: BUILDER_WORKFLOW_FILE,
        ref: BUILDER_WORKFLOW_REF,
        inputs: {
          session_id: session.id,
          run_id: run.id,
          mode,
          repos: JSON.stringify(repos),
          engine: run.engine,
          model: run.model,
          branch_slug: run.branchSlug,
          branches: JSON.stringify(params.branches ?? {}),
          api_base_url: this.configService.publicApiBaseUrl,
        },
      });
    } catch (error) {
      // The row exists but nothing will ever run against it, so fail it here
      // rather than leaving reconcile to time it out half an hour from now.
      const message = error instanceof Error ? error.message : String(error);
      await this.runRepository.update(
        { id: run.id },
        {
          status: BuilderRunStatus.FAILED,
          error: `Dispatch failed: ${message}`,
          completedAt: new Date(),
        },
      );
      await this.sessionRepository.update(
        { id: session.id },
        {
          status: BuilderSessionStatus.FAILED,
          error: `Could not start the build: ${message}`,
        },
      );
      throw new ServiceUnavailableException(
        `Could not start the build: ${message}`,
      );
    }

    this.logger.info(
      `Builder run ${run.id} dispatched (${mode}) for session ${session.id}`,
    );
    return run;
  }

  private async assertWithinConcurrency(max: number): Promise<void> {
    const building = await this.sessionRepository.count({
      where: {
        status: In([
          BuilderSessionStatus.BUILDING,
          BuilderSessionStatus.WAITING_FOR_INPUT,
        ]),
      },
    });
    if (building >= max) {
      throw new BadRequestException(
        `${max} builds are already running, which is the current limit. ` +
          'Wait for one to finish, or raise the limit in Builder settings.',
      );
    }
  }

  /**
   * A session past its ceiling stops dispatching. Checked before every run,
   * including resumes: an agent that pauses and resumes repeatedly is exactly
   * the shape of runaway this bounds.
   */
  private assertWithinBudget(session: BuilderSession): void {
    const budget = Number(session.budgetUsd ?? 0);
    if (!budget) return;
    const spent = Number(session.totalCostUsd ?? 0);
    if (spent >= budget) {
      throw new BadRequestException(
        `This session has spent $${spent.toFixed(2)} of its $${budget.toFixed(2)} budget. ` +
          'Raise the budget to continue, or stop the build.',
      );
    }
  }

  /**
   * Condense a paused run's history into the state a resume needs.
   *
   * Server-side rather than replayed from the transcript: the events are the
   * only durable record once the runner is gone, and feeding a fresh agent two
   * hundred tool calls would cost more tokens than the work they represent.
   * What survives is what a person would write on a handover note.
   */
  async buildResumeContext(runId: string): Promise<string> {
    const events = await this.eventRepository.listByRun(runId, 0, 2000);
    if (!events.length) return '';

    const stagesSeen: string[] = [];
    let plan = '';
    let latestTodo: any[] = [];
    const filesTouched = new Set<string>();
    let lastTestOutput = '';
    let lastVerification = '';

    for (const event of events) {
      switch (event.type) {
        case BuilderEventType.STAGE_CHANGE: {
          const stage = String(event.payload?.stage ?? '');
          if (stage && !stagesSeen.includes(stage)) stagesSeen.push(stage);
          break;
        }
        case BuilderEventType.PLAN:
          plan = String(event.payload?.text ?? plan);
          break;
        case BuilderEventType.TODO:
          latestTodo = Array.isArray(event.payload?.items)
            ? event.payload.items
            : latestTodo;
          break;
        case BuilderEventType.FILE_EDIT: {
          const path = event.payload?.path;
          if (path) filesTouched.add(String(path));
          break;
        }
        case BuilderEventType.TEST_OUTPUT:
          lastTestOutput = String(event.payload?.text ?? lastTestOutput);
          break;
        case BuilderEventType.VERIFICATION:
          lastVerification = String(event.payload?.text ?? lastVerification);
          break;
        default:
          break;
      }
    }

    const parts: string[] = [];
    if (stagesSeen.length) {
      parts.push(`Stages reached: ${stagesSeen.join(' → ')}`);
    }
    if (plan) {
      parts.push(`\n**Your plan was:**\n\n${plan}`);
    }
    if (latestTodo.length) {
      const rendered = latestTodo
        .map(
          (item: any) =>
            `- [${item?.status === 'done' ? 'x' : ' '}] ${item?.text ?? ''}${
              item?.status === 'in_progress' ? ' *(in progress)*' : ''
            }`,
        )
        .join('\n');
      parts.push(`\n**Todo list as you left it:**\n\n${rendered}`);
    }
    if (filesTouched.size) {
      const files = [...filesTouched].slice(0, BUILDER_RESUME_FILES_MAX);
      parts.push(
        `\n**Files you had already edited** (${filesTouched.size}):\n\n${files
          .map((file) => `- ${file}`)
          .join('\n')}${
          filesTouched.size > files.length
            ? `\n- …and ${filesTouched.size - files.length} more`
            : ''
        }`,
      );
    }
    if (lastTestOutput) {
      parts.push(
        `\n**Last test results:**\n\n\`\`\`\n${lastTestOutput.slice(
          0,
          BUILDER_RESUME_TEST_OUTPUT_MAX,
        )}\n\`\`\``,
      );
    }
    if (lastVerification) {
      parts.push(`\n**Last verification verdict:**\n\n${lastVerification}`);
    }
    return parts.join('\n');
  }

  /**
   * Stop a run. The DB write always lands; the GitHub cancel is best-effort,
   * because the point of the action is to stop this session progressing here,
   * which does not depend on GitHub's cancel succeeding (it 409s on an
   * already-completed run, routinely).
   */
  async cancelRun(run: BuilderBuildRun, userId: number): Promise<void> {
    await this.runRepository.update(
      { id: run.id },
      {
        status: BuilderRunStatus.CANCELLED,
        cancelledBy: userId,
        completedAt: new Date(),
      },
    );

    // Supersede anything it was waiting on, so an answered-too-late question
    // cannot dispatch a resume against a cancelled session.
    await this.questionRepository.update(
      { runId: run.id, status: BuilderQuestionStatus.PENDING },
      { status: BuilderQuestionStatus.SUPERSEDED },
    );

    let githubRunId = run.githubRunId;
    if (!githubRunId && this.github.isConfigured) {
      // Not correlated yet — one best-effort lookup inline rather than waiting
      // up to five minutes for the next reconcile tick to find it.
      const found = await this.github.findRunSince({
        repo: BUILDER_WORKFLOW_REPO,
        workflow: BUILDER_WORKFLOW_FILE,
        since: run.dispatchedAt,
      });
      githubRunId = found?.id ?? null;
    }
    if (!githubRunId) return;

    try {
      await this.github.cancelRun(BUILDER_WORKFLOW_REPO, String(githubRunId));
    } catch (error) {
      this.logger.warn(
        `GitHub cancel failed for Builder run ${run.id} (harmless if it had already finished): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The 5-minute pass that settles what the callbacks could not: correlating
   * dispatches to GitHub runs, and failing runs that went quiet.
   *
   * Each finding is wrapped individually — one stuck run must never stop the
   * rest of the tick.
   */
  async reconcile(): Promise<void> {
    if (!this.github.isConfigured) return;

    const active = await this.runRepository.listActive();
    for (const run of active) {
      try {
        await this.reconcileRun(run);
      } catch (error) {
        this.logger.error(
          `Builder reconcile failed for run ${run.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async reconcileRun(run: BuilderBuildRun): Promise<void> {
    const age = Date.now() - run.dispatchedAt.getTime();

    if (!run.githubRunId) {
      const found = await this.github.findRunSince({
        repo: BUILDER_WORKFLOW_REPO,
        workflow: BUILDER_WORKFLOW_FILE,
        since: run.dispatchedAt,
      });
      if (found) {
        await this.runRepository.update(
          { id: run.id },
          { githubRunId: found.id, githubRunUrl: found.htmlUrl },
        );
        return;
      }
      if (age > BUILDER_DISPATCH_TIMEOUT_MS) {
        await this.failRun(
          run,
          'GitHub never registered a run for this dispatch.',
        );
      }
      return;
    }

    const remote = await this.github.getRun(
      BUILDER_WORKFLOW_REPO,
      String(run.githubRunId),
    );

    // A completed GitHub run whose DB status is WAITING_FOR_INPUT is HEALTHY,
    // not failed: pausing is a deliberate exit 0. Without this rule every
    // pause would be reported as a failure five minutes later.
    if (remote?.status === 'completed') {
      const current = await this.runRepository.findOne({
        where: { id: run.id },
      });
      if (current?.status === BuilderRunStatus.WAITING_FOR_INPUT) return;
      if (current && !this.isActive(current.status)) return;

      if (remote.conclusion === 'success') {
        // Success on GitHub without a /complete callback means the runner
        // finished but never reported — treat it as done rather than leaving
        // the session building forever.
        await this.settleRun(run, BuilderRunStatus.SUCCEEDED, null);
      } else if (remote.conclusion === 'cancelled') {
        await this.settleRun(run, BuilderRunStatus.CANCELLED, null);
      } else {
        await this.failRun(
          run,
          `The build run ${remote.conclusion ?? 'failed'}.`,
        );
      }
      return;
    }

    if (remote?.status === 'in_progress' && !run.startedAt) {
      await this.runRepository.update(
        { id: run.id },
        { startedAt: new Date() },
      );
    }

    if (age > BUILDER_RUN_TIMEOUT_MS) {
      await this.settleRun(
        run,
        BuilderRunStatus.TIMED_OUT,
        'The build ran past its time limit and was stopped.',
      );
    }
  }

  private isActive(status: BuilderRunStatus): boolean {
    return (
      status === BuilderRunStatus.QUEUED || status === BuilderRunStatus.RUNNING
    );
  }

  private async failRun(run: BuilderBuildRun, message: string): Promise<void> {
    await this.settleRun(run, BuilderRunStatus.FAILED, message);
  }

  /** Close a run and move the session with it. */
  async settleRun(
    run: BuilderBuildRun,
    status: BuilderRunStatus,
    error: string | null,
  ): Promise<void> {
    const completedAt = new Date();
    const runnerMinutes = Math.max(
      0,
      Math.round(
        (completedAt.getTime() -
          (run.startedAt ?? run.dispatchedAt).getTime()) /
          60_000,
      ),
    );

    await this.runRepository.update(
      { id: run.id },
      { status, error, completedAt, runnerMinutes },
    );

    const session = await this.sessionRepository.findOne({
      where: { id: run.sessionId },
    });
    if (!session) return;

    await this.sessionRepository.increment(
      { id: session.id },
      'runnerMinutes',
      runnerMinutes,
    );

    // Only the run's own outcome moves the session; a session already
    // cancelled by a human stays cancelled.
    if (
      session.status !== BuilderSessionStatus.BUILDING &&
      session.status !== BuilderSessionStatus.WAITING_FOR_INPUT
    ) {
      return;
    }

    if (status === BuilderRunStatus.SUCCEEDED) {
      await this.sessionRepository.update(
        { id: session.id },
        {
          status: BuilderSessionStatus.COMPLETED,
          currentStage: BuilderStage.DONE,
        },
      );
      await this.notificationService.buildCompleted(session);
      return;
    }

    if (status === BuilderRunStatus.CANCELLED) {
      await this.sessionRepository.update(
        { id: session.id },
        { status: BuilderSessionStatus.CANCELLED },
      );
      return;
    }

    if (
      status === BuilderRunStatus.FAILED ||
      status === BuilderRunStatus.TIMED_OUT
    ) {
      await this.sessionRepository.update(
        { id: session.id },
        { status: BuilderSessionStatus.FAILED, error },
      );
      await this.notificationService.buildFailed(session, error);
    }
  }

  /**
   * Record what a run cost, both on the run and rolled up onto the session.
   *
   * The rollup is what the budget check reads, so it has to land even when
   * the run itself failed — an agent that burned twenty dollars and then
   * crashed spent twenty dollars, and a retry should be measured against
   * what is left rather than starting the count again.
   */
  async recordRunCost(
    run: BuilderBuildRun,
    cost: { modelUsage?: Record<string, any>; totalCostUsd?: number },
  ): Promise<void> {
    const usd = Number(cost.totalCostUsd ?? 0);
    await this.runRepository.update(
      { id: run.id },
      {
        cost: cost.modelUsage ?? null,
        costUsd: Number.isFinite(usd) ? String(usd) : null,
      },
    );

    if (!Number.isFinite(usd) || usd <= 0) return;

    // Read-modify-write rather than `increment`, because the column is
    // numeric and the running total is displayed as money.
    const session = await this.sessionRepository.findOne({
      where: { id: run.sessionId },
    });
    if (!session) return;

    const total = Number(session.totalCostUsd ?? 0) + usd;
    await this.sessionRepository.update(
      { id: session.id },
      { totalCostUsd: total.toFixed(4) },
    );

    const budget = Number(session.budgetUsd ?? 0);
    if (budget && total >= budget) {
      // Said once, when the line is crossed — the dispatch guard will refuse
      // from here on, and an admin who is not told will read that refusal as
      // a fault rather than a limit they set.
      await this.notificationService.budgetReached(session, total);
    }
  }

  async getRunOrFail(runId: string): Promise<BuilderBuildRun> {
    const run = await this.runRepository.findOne({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Builder run not found: ${runId}`);
    }
    return run;
  }

  /** A fresh group id for a batch of questions asked in one pause. */
  newQuestionGroupId(): string {
    return uuidv4();
  }
}
