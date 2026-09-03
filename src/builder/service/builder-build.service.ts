import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';
import { GithubActionsService } from 'src/bug-hunter/service/github-actions.service';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import {
  BuilderBuildEventRepository,
  BuilderBuildRunRepository,
  BuilderPullRequestRepository,
  BuilderQuestionRepository,
} from '../repository/builder-build.repository';
import { BuilderEventService } from './builder-event.service';
import { BuilderSettingsService } from './builder-settings.service';
import { BuilderNotificationService } from './builder-notification.service';
import { BuilderExemplarService } from './builder-exemplar.service';
import { BuilderEpicService } from './builder-epic.service';
import {
  BUILDER_RUN_ACTIVE_STATUSES,
  BuilderEventType,
  BuilderMilestoneStatus,
  BuilderQuestionStatus,
  BuilderRunMode,
  BuilderRunStatus,
  BuilderSessionStatus,
  BuilderStage,
} from '../enum/builder.enum';
import {
  BUILDER_BUDGET_HOLD_POLL_SECONDS,
  BUILDER_BUDGET_HOLD_SECONDS,
  BUILDER_DISPATCH_LOCK_PREFIX,
  BUILDER_DISPATCH_LOCK_TTL_SECONDS,
  BUILDER_DISPATCH_TIMEOUT_MS,
  BUILDER_RESUME_FILES_MAX,
  BUILDER_RESUME_TEST_OUTPUT_MAX,
  BUILDER_RUN_TIMEOUT_MS,
  BUILDER_WORKFLOW_FILE,
  BUILDER_WORKFLOW_REF,
  BUILDER_WORKFLOW_REPO,
} from '../constants/builder.constants';

/**
 * Live spend against the session's ceiling.
 *
 * `holdSeconds` and `pollSeconds` are served rather than compiled into the
 * workflow on purpose: run-engine.sh reads them at the boundary it stops on,
 * so the wait can be re-tuned here without a workflow merge.
 */
export interface BuilderBudgetState {
  budgetUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  exceeded: boolean;
  holdSeconds: number;
  pollSeconds: number;
}

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
    private readonly pullRequestRepository: BuilderPullRequestRepository,
    private readonly settingsService: BuilderSettingsService,
    private readonly notificationService: BuilderNotificationService,
    private readonly eventService: BuilderEventService,
    private readonly redisService: RedisService,
    // Forward-ref'd: the exemplar service reads runs and events through
    // repositories, so this edge is one-way rather than a cycle.
    @Inject(forwardRef(() => BuilderExemplarService))
    private readonly exemplarService: BuilderExemplarService,
    private readonly epicService: BuilderEpicService,
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
    overrides: {
      engine?: string;
      model?: string;
      plannerModel?: string;
      verifierModel?: string;
      budgetUsd?: number;
    } = {},
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
    this.assertWithinBudget(session, settings.maxRunnerMinutes);

    const engine = overrides.engine ?? session.engine;
    const models = this.resolveModels(session, settings, overrides);

    // Carry the chosen engine/model onto the session so a resume run and the
    // UI both read the same thing without re-deriving it.
    await this.sessionRepository.update(
      { id: session.id },
      {
        engine,
        model: models.coder,
        status: BuilderSessionStatus.BUILDING,
        currentStage: BuilderStage.SETUP,
        error: null,
        ...(overrides.budgetUsd !== undefined
          ? { budgetUsd: String(overrides.budgetUsd) }
          : {}),
        updatedBy: userId,
      },
    );

    // Epic mode dispatches the first milestone rather than the whole PRD. The
    // split itself is proposed and confirmed before this point — a wrong
    // decomposition is expensive in a way a wrong plan is not, because it
    // becomes several pull requests in the wrong shape.
    const milestone = await this.epicService.nextPending(session.id);

    return this.dispatchRun({
      session: { ...session, engine, model: models.coder },
      mode: BuilderRunMode.BUILD,
      userId,
      repos,
      models,
      milestoneId: milestone?.id ?? undefined,
      branchSlugOverride: milestone?.branchSlug,
    });
  }

  /**
   * Move an epic on after a milestone lands.
   *
   * Sequential rather than parallel, deliberately: milestone 2 branches from
   * milestone 1, so starting it early would mean branching from work that is
   * still changing. Called from run settling, and a no-op for a session that
   * has no milestones.
   */
  private async advanceEpic(
    session: BuilderSession,
    run: BuilderBuildRun,
    succeeded: boolean,
  ): Promise<boolean> {
    if (!run.milestoneId) return false;

    await this.epicService.markStatus(
      run.milestoneId,
      succeeded
        ? BuilderMilestoneStatus.COMPLETED
        : BuilderMilestoneStatus.FAILED,
      succeeded ? null : (run.error ?? 'The milestone build failed.'),
    );
    if (!succeeded) return false;

    const next = await this.epicService.nextPending(session.id);
    if (!next) return false;

    try {
      const settings = await this.settingsService.get();
      this.assertWithinBudget(session, settings.maxRunnerMinutes);
      await this.assertWithinConcurrency(settings.maxConcurrentBuilds);

      const models = this.resolveModels(session, settings);
      await this.sessionRepository.update(
        { id: session.id },
        {
          status: BuilderSessionStatus.BUILDING,
          currentStage: BuilderStage.SETUP,
        },
      );
      await this.epicService.markStatus(
        next.id,
        BuilderMilestoneStatus.BUILDING,
      );
      await this.dispatchRun({
        session,
        mode: BuilderRunMode.BUILD,
        userId: session.createdBy ?? 0,
        repos: session.repos ?? [],
        models,
        milestoneId: next.id,
        branchSlugOverride: next.branchSlug,
      });
      this.logger.info(
        `Builder session ${session.id} advanced to milestone ${next.position}.`,
      );
      return true;
    } catch (error) {
      // The milestone that just landed is still a success; the epic simply
      // stops here and a person restarts it. Recording the reason on the
      // milestone is what makes that recoverable rather than mysterious.
      const message = error instanceof Error ? error.message : String(error);
      await this.epicService.markStatus(
        next.id,
        BuilderMilestoneStatus.PENDING,
        message,
      );
      this.logger.warn(
        `Builder session ${session.id} could not start milestone ${next.position}: ${message}`,
      );
      return false;
    }
  }

  /**
   * Model per tier, resolved run override → session (coder only) → settings →
   * config default. One resolution path so the run row, the workflow input
   * and the UI can never disagree about which model a phase used.
   */
  private resolveModels(
    session: BuilderSession,
    settings: {
      plannerModel?: string | null;
      coderModel?: string | null;
      verifierModel?: string | null;
      defaultModel?: string | null;
    },
    overrides: {
      model?: string;
      plannerModel?: string;
      verifierModel?: string;
    } = {},
  ): { planner: string; coder: string; verifier: string } {
    const config = this.configService.builder;
    return {
      planner:
        overrides.plannerModel ?? settings.plannerModel ?? config.plannerModel,
      coder:
        overrides.model ??
        session.model ??
        settings.coderModel ??
        settings.defaultModel ??
        config.coderModel,
      verifier:
        overrides.verifierModel ??
        settings.verifierModel ??
        config.verifierModel,
    };
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
    const settings = await this.settingsService.get();
    this.assertWithinBudget(session, settings.maxRunnerMinutes);

    await this.sessionRepository.update(
      { id: session.id },
      { status: BuilderSessionStatus.BUILDING, updatedBy: userId },
    );

    // A resume keeps the paused run's models: switching tiers mid-session
    // would make "which model wrote this" unanswerable for the run pair.
    const models = this.resolveModels(session, settings);
    return this.dispatchRun({
      session,
      mode: BuilderRunMode.RESUME,
      userId,
      repos: session.repos ?? [],
      resumeOfRunId: pausedRun.id,
      branches: pausedRun.branches ?? undefined,
      models: {
        planner: pausedRun.plannerModel ?? models.planner,
        coder: pausedRun.model ?? models.coder,
        verifier: pausedRun.verifierModel ?? models.verifier,
      },
    });
  }

  /**
   * Send a run at an already-open pull request, to fix red CI or answer review
   * comments.
   *
   * Different from a build or a resume in what it skips: no planner (there is
   * no plan to make — the work is a list of specific complaints) and no
   * verifier (CI and a human reviewer are already the second pair of eyes).
   * The gate still runs, because "it fixes the comment and breaks a test" is
   * exactly the failure a fix run is prone to.
   *
   * Returns null rather than throwing on a refusal: this is called from a
   * timer, and every refusal here is an ordinary state (the session is busy,
   * the budget is gone) rather than an error anyone asked to see.
   */
  async dispatchFixRun(
    pullRequest: {
      id: string;
      sessionId: string;
      repo: string;
      branch: string;
      prNumber: number;
      fixRunCount: number;
    },
    reason = 'acting on review feedback',
  ): Promise<BuilderBuildRun | null> {
    const session = await this.sessionRepository.findOne({
      where: { id: pullRequest.sessionId },
    });
    if (!session) return null;

    // Two runners on one branch is a merge conflict Builder created for
    // itself, so an in-flight run of any kind blocks a fix.
    const active = await this.runRepository.count({
      where: {
        sessionId: session.id,
        status: In([
          ...BUILDER_RUN_ACTIVE_STATUSES,
          BuilderRunStatus.WAITING_FOR_INPUT,
        ]),
      },
    });
    if (active) return null;

    const settings = await this.settingsService.get();
    try {
      await this.assertWithinConcurrency(settings.maxConcurrentBuilds);
      this.assertWithinBudget(session, settings.maxRunnerMinutes);
    } catch (error) {
      this.logger.info(
        `Skipping a fix run for ${pullRequest.repo}#${pullRequest.prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    // Counted at dispatch, not on success: a fix run that crashes still used
    // an attempt, and counting only successes would let a crash loop run
    // forever.
    await this.pullRequestRepository.increment(
      { id: pullRequest.id },
      'fixRunCount',
      1,
    );

    const models = this.resolveModels(session, settings);
    const run = await this.dispatchRun({
      session,
      mode: BuilderRunMode.FIX,
      userId: session.createdBy ?? 0,
      repos: [pullRequest.repo],
      models,
      branches: { [pullRequest.repo]: pullRequest.branch },
      pullRequestId: pullRequest.id,
    });

    // The session goes back to BUILDING so the UI stops reading as finished
    // while Builder is pushing commits; settleRun moves it back.
    await this.sessionRepository.update(
      { id: session.id },
      {
        status: BuilderSessionStatus.BUILDING,
        currentStage: BuilderStage.SETUP,
      },
    );
    await this.notificationService.fixRunStarted(
      session,
      pullRequest.repo,
      pullRequest.prNumber,
      reason,
    );
    return run;
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
    models: { planner: string; coder: string; verifier: string };
    resumeOfRunId?: string;
    branches?: Record<string, string>;
    pullRequestId?: string;
    milestoneId?: string;
    branchSlugOverride?: string;
  }): Promise<BuilderBuildRun> {
    // Only the session is needed here — everything else in `params` is passed
    // straight through to `dispatchRunLocked`, which does the destructuring.
    const { session } = params;

    // Per-session dispatch mutex. The atomic sequence counter stops two
    // dispatches colliding on a run number, but nothing stopped them both
    // *happening* — a double-clicked answer, or two admins answering the last
    // question of a group at once, would send two runners at the same branches.
    // The lock constants have existed unused since the module was written.
    const lockKey = `${BUILDER_DISPATCH_LOCK_PREFIX}:${session.id}`;
    const locked = await this.redisService.acquireLock(
      lockKey,
      BUILDER_DISPATCH_LOCK_TTL_SECONDS,
    );
    if (!locked) {
      throw new BadRequestException(
        'A build for this session is already being started. Give it a moment.',
      );
    }

    try {
      return await this.dispatchRunLocked(params);
    } finally {
      // Released on the way out rather than left to expire: the TTL is only
      // the crash backstop, and holding it for a minute after a successful
      // dispatch would refuse a legitimate follow-up.
      await this.redisService.releaseLock(lockKey).catch(() => undefined);
    }
  }

  private async dispatchRunLocked(params: {
    session: BuilderSession;
    mode: BuilderRunMode;
    userId: number;
    repos: string[];
    models: { planner: string; coder: string; verifier: string };
    resumeOfRunId?: string;
    branches?: Record<string, string>;
    pullRequestId?: string;
    milestoneId?: string;
    branchSlugOverride?: string;
  }): Promise<BuilderBuildRun> {
    const { session, mode, userId, repos, models } = params;
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
        model: models.coder,
        plannerModel: models.planner,
        verifierModel: models.verifier,
        // A milestone pushes to its own branch family (`<slug>-m2`), so the
        // slices stay separately reviewable rather than piling into one branch.
        branchSlug: params.branchSlugOverride ?? session.slug,
        branches: params.branches ?? null,
        pullRequestId: params.pullRequestId ?? null,
        milestoneId: params.milestoneId ?? null,
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
          // One JSON input for all three tiers: workflow_dispatch caps at 10
          // inputs and this file already sits at 9.
          models: JSON.stringify(models),
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

  /**
   * The ceiling counts **runs holding a runner**, not sessions.
   *
   * Counting sessions over-counted and under-counted at once: a session parked
   * on a question occupies no runner but consumed a slot, while a session
   * running several dispatches (epic milestones, an auto-dispatched fix)
   * counted as one. Runs in QUEUED or RUNNING is the thing that actually costs
   * GitHub capacity.
   */
  private async assertWithinConcurrency(max: number): Promise<void> {
    const inFlight = await this.runRepository.count({
      where: { status: In(BUILDER_RUN_ACTIVE_STATUSES) },
    });
    if (inFlight >= max) {
      throw new BadRequestException(
        `${max} builds are already running, which is the current limit. ` +
          'Wait for one to finish, or raise the limit in Builder settings.',
      );
    }
  }

  /** The run a cancel should stop, if the session still has one in flight. */
  async findCancellableRun(sessionId: string): Promise<BuilderBuildRun | null> {
    return this.runRepository.findOne({
      where: {
        sessionId,
        status: In([
          ...BUILDER_RUN_ACTIVE_STATUSES,
          // A paused run has no runner, but it does hold pending questions
          // that would otherwise dispatch a resume against a dead session.
          BuilderRunStatus.WAITING_FOR_INPUT,
        ]),
      },
      order: { sequence: 'DESC' },
    });
  }

  /**
   * A session past either ceiling stops dispatching. Checked before every run,
   * including resumes: an agent that pauses and resumes repeatedly is exactly
   * the shape of runaway this bounds.
   *
   * Dollars and runner minutes are separate limits because they measure
   * different waste. A run can be cheap in tokens and still hold a runner for
   * two hours, and `totalCostUsd` says nothing about that.
   */
  private assertWithinBudget(
    session: BuilderSession,
    maxRunnerMinutes?: number | null,
  ): void {
    const budget = Number(session.budgetUsd ?? 0);
    if (budget) {
      const spent = Number(session.totalCostUsd ?? 0);
      if (spent >= budget) {
        throw new BadRequestException(
          `This session has spent $${spent.toFixed(2)} of its $${budget.toFixed(2)} budget. ` +
            'Raise the budget to continue, or stop the build.',
        );
      }
    }

    const minutesCeiling = Number(maxRunnerMinutes ?? 0);
    if (minutesCeiling) {
      const used = Number(session.runnerMinutes ?? 0);
      if (used >= minutesCeiling) {
        throw new BadRequestException(
          `This session has used ${used} of its ${minutesCeiling} runner minutes. ` +
            'Raise the limit in Builder settings to continue, or stop the build.',
        );
      }
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
   * What the later phases of a run need to know about its earlier ones.
   *
   * The event log is the only durable record of a run in flight — the runner's
   * filesystem is gone the moment the job ends, and a resume happens in a
   * different container. So the plan the planner wrote, the gate's verdicts and
   * the reviewer's objections are read back from events rather than passed
   * along in memory. That is also what makes the remediation prompt possible:
   * the coder is a *new process* by then and knows none of it.
   */
  async getRunPhaseContext(runId: string): Promise<{
    planMd: string | null;
    gateFailures: {
      repo: string;
      kind: string;
      command: string;
      newFailures: string[];
      preExistingFailures: string[];
      outputTail?: string | null;
    }[];
    gateSummary: string | null;
    objections: {
      severity?: string;
      repo?: string;
      file?: string;
      summary?: string;
      detail?: string;
    }[];
    verifierNotes: string | null;
    lastVerifyRound: number;
  }> {
    const events = await this.eventRepository.listByRun(runId, 0, 2000);

    let planMd: string | null = null;
    let verifierNotes: string | null = null;
    let lastVerifyRound = 0;
    let objections: any[] = [];
    // Latest result per (repo, kind): a remediation round re-runs the gate, and
    // only the newest verdict for a check describes the tree as it stands.
    const gateByKey = new Map<string, any>();

    for (const event of events) {
      switch (event.type) {
        case BuilderEventType.PLAN:
          planMd = String(event.payload?.text ?? planMd ?? '') || planMd;
          break;
        case BuilderEventType.GATE_RESULT: {
          const repo = String(event.payload?.repo ?? '');
          const kind = String(event.payload?.kind ?? '');
          if (repo && kind) gateByKey.set(`${repo}:${kind}`, event.payload);
          break;
        }
        case BuilderEventType.VERIFICATION: {
          const round = Number(event.payload?.round ?? 0);
          // Keep the newest round's verdict; an older one describes code that
          // has since been remediated.
          if (round >= lastVerifyRound) {
            lastVerifyRound = round;
            objections = Array.isArray(event.payload?.objections)
              ? event.payload.objections
              : [];
            const notes = event.payload?.notes;
            verifierNotes = notes ? String(notes) : null;
          }
          break;
        }
        default:
          break;
      }
    }

    const gateResults = [...gateByKey.values()];
    const gateFailures = gateResults
      .filter((result) => result?.passed === false)
      .map((result) => ({
        repo: String(result.repo ?? ''),
        kind: String(result.kind ?? ''),
        command: String(result.command ?? ''),
        newFailures: Array.isArray(result.newFailures)
          ? result.newFailures.map((name: unknown) => String(name))
          : [],
        preExistingFailures: Array.isArray(result.preExistingFailures)
          ? result.preExistingFailures.map((name: unknown) => String(name))
          : [],
        outputTail: result.outputTail ? String(result.outputTail) : null,
      }));

    const gateSummary = gateResults.length
      ? gateResults
          .map(
            (result) =>
              `- ${result.repo} ${result.kind} (\`${result.command}\`): ${
                result.passed ? 'passed' : 'FAILED'
              }${
                Array.isArray(result.preExistingFailures) &&
                result.preExistingFailures.length
                  ? ` — ${result.preExistingFailures.length} pre-existing failure(s) carried over`
                  : ''
              }`,
          )
          .join('\n')
      : null;

    return {
      planMd,
      gateFailures,
      gateSummary,
      objections,
      verifierNotes,
      lastVerifyRound,
    };
  }

  /**
   * Whether a run has a passing machine gate for every check it ran.
   *
   * `/complete {done}` is refused without one. Before the gate existed, a run
   * that skipped testing entirely and self-reported success settled as
   * SUCCEEDED — testing was prompt-instructed and the only evidence was a
   * string the agent chose to send.
   */
  async hasPassingGate(runId: string): Promise<boolean> {
    const events = await this.eventRepository.listByRun(runId, 0, 2000);
    const gateByKey = new Map<string, boolean>();
    for (const event of events) {
      if (event.type !== BuilderEventType.GATE_RESULT) continue;
      const repo = String(event.payload?.repo ?? '');
      const kind = String(event.payload?.kind ?? '');
      if (!repo || !kind) continue;
      gateByKey.set(`${repo}:${kind}`, event.payload?.passed === true);
    }
    if (!gateByKey.size) return false;
    return [...gateByKey.values()].every(Boolean);
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
        // A green job without a /complete callback is NOT a success. `claude -p`
        // exits 0 whenever the agent produces a final response, including when
        // it ends its turn mid-protocol — so "the agent stopped after CODE
        // without committing" and "the agent finished and opened PRs" reach
        // this branch identically. Settling SUCCEEDED here reported builds that
        // never shipped anything, and made the scoreboard's merge rate a
        // measure of nothing.
        //
        // The run reports its own outcome or it did not finish. The workflow's
        // outcome gate normally catches this first and posts a precise error;
        // this is the net for when the runner died before that step ran.
        await this.failRun(
          run,
          'The runner finished without reporting an outcome. It stopped ' +
            'mid-protocol, so anything it had not pushed is gone with the ' +
            'runner. Retry the build.',
        );
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
      // An epic mid-series is not finished: the next milestone dispatches and
      // the session stays BUILDING. Marking it COMPLETED here would tell the
      // admin the feature had shipped when two thirds of it had not started.
      const advanced = await this.advanceEpic(session, run, true);
      if (advanced) return;

      await this.sessionRepository.update(
        { id: session.id },
        {
          status: BuilderSessionStatus.COMPLETED,
          currentStage: BuilderStage.DONE,
        },
      );
      await this.notificationService.buildCompleted(session);
      await this.archive(session.id);
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
      // A failed milestone stops the series where it is; the ones already
      // built keep their branches and pull requests.
      await this.advanceEpic(session, run, false);
      // Failures are archived too: "a similar build tried this and it did not
      // work" is more useful to the next attempt than any number of successes,
      // and a corpus of only wins would be flattering and useless.
      await this.archive(session.id);
    }
  }

  /**
   * Archive a finished session into the exemplar bank, best-effort.
   *
   * Swallows its own failures: the run has already settled and the session
   * status is already right. A flywheel that could fail a build would be a
   * worse trade than a flywheel that occasionally misses one.
   */
  private async archive(sessionId: string): Promise<void> {
    try {
      await this.exemplarService.archiveSession(sessionId);
    } catch (error) {
      this.logger.warn(
        `Could not archive Builder session ${sessionId} as an exemplar: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Record what a run cost, both on the run and rolled up onto the session.
   *
   * The run's `cost` jsonb is `{ phases: { <phase>: {model, usd, usage} } }`
   * and each POST **upserts one phase** — the tiered loop bills every engine
   * invocation (plan, code rounds, verify rounds, finalise) as it happens, so
   * planner and verifier spend is visible and the mid-run budget check reads
   * a live number. Upsert-by-phase also makes the end-of-workflow safety-net
   * POST idempotent: re-reporting a phase replaces it instead of double
   * counting.
   *
   * The rollup is what the budget check reads, so it has to land even when
   * the run itself failed — an agent that burned twenty dollars and then
   * crashed spent twenty dollars, and a retry should be measured against
   * what is left rather than starting the count again.
   */
  async recordRunCost(
    run: BuilderBuildRun,
    cost: {
      phase?: string;
      model?: string;
      modelUsage?: Record<string, any>;
      totalCostUsd?: number;
    },
  ): Promise<void> {
    // Re-read: earlier phases of this run have already written their share.
    const current = await this.runRepository.findOne({ where: { id: run.id } });
    if (!current) return;

    const phases: Record<
      string,
      { model?: string | null; usd: number; usage?: Record<string, any> | null }
    > = { ...((current.cost?.phases as Record<string, any>) ?? {}) };

    const usd = Number(cost.totalCostUsd ?? 0);
    phases[cost.phase ?? 'build'] = {
      model: cost.model ?? null,
      usd: Number.isFinite(usd) && usd > 0 ? usd : 0,
      usage: cost.modelUsage ?? null,
    };

    const runTotal = Object.values(phases).reduce(
      (sum, phase) => sum + (Number.isFinite(phase.usd) ? phase.usd : 0),
      0,
    );
    const previousRunTotal = Number(current.costUsd ?? 0);
    await this.runRepository.update(
      { id: run.id },
      // `phases` is a jsonb map, which TypeORM's DeepPartial reads as an
      // entity-shaped object unless it is widened here.
      {
        cost: { phases } as Record<string, any>,
        costUsd: runTotal.toFixed(4),
      },
    );

    const delta = runTotal - previousRunTotal;
    if (!Number.isFinite(delta) || delta <= 0) return;

    // Read-modify-write rather than `increment`, because the column is
    // numeric and the running total is displayed as money.
    const session = await this.sessionRepository.findOne({
      where: { id: run.sessionId },
    });
    if (!session) return;

    const previousTotal = Number(session.totalCostUsd ?? 0);
    const total = previousTotal + delta;
    await this.sessionRepository.update(
      { id: session.id },
      { totalCostUsd: total.toFixed(4) },
    );

    const budget = Number(session.budgetUsd ?? 0);
    if (budget && total >= budget && previousTotal < budget) {
      // Said once, when the line is crossed — per-phase reporting would
      // otherwise repeat it on every invocation past the ceiling, and the
      // dispatch guard already refuses from here on.
      await this.notificationService.budgetReached(session, total);
    }
  }

  /**
   * Live spend against the session ceiling, for the between-phase check the
   * runner makes.
   *
   * The dispatch guard alone was not a budget: it refused the *next* run while
   * the current one could overshoot by any amount. Now every phase boundary is
   * a checkpoint, and the phase-level cost reporting that feeds it means the
   * number is current rather than end-of-run.
   */
  async getBudgetState(run: BuilderBuildRun): Promise<BuilderBudgetState> {
    return this.budgetStateFor(run.sessionId);
  }

  /**
   * The same state, for the admin UI rather than the runner.
   *
   * Read live rather than taken from the session detail the page loaded: that
   * response is fetched once per session and a held run's whole point is that
   * the numbers moved after it was fetched. `holdSeconds` rides along so the
   * banner can say how long the run will wait without hard-coding it.
   */
  async getSessionBudget(sessionId: string): Promise<
    BuilderBudgetState & {
      /** Set while a run is parked at a phase boundary waiting for a raise. */
      hold: { runId: string; heldAt: string; holdUntil: string } | null;
    }
  > {
    const state = await this.budgetStateFor(sessionId);
    // Gated on `exceeded` as well as the event, so the hold clears however the
    // ceiling moved. A retry dispatched with a `budgetUsd` override raises it
    // without going through raiseBudget, and nothing would then write the
    // `raised` event that ends the hold — leaving the page saying "paused" over
    // a run that is working.
    return {
      ...state,
      hold: state.exceeded ? await this.findActiveHold(sessionId) : null,
    };
  }

  private async budgetStateFor(sessionId: string): Promise<BuilderBudgetState> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    const spentUsd = Number(session?.totalCostUsd ?? 0);
    const budget = Number(session?.budgetUsd ?? 0);
    if (!budget) {
      return {
        budgetUsd: null,
        spentUsd,
        remainingUsd: null,
        exceeded: false,
        holdSeconds: BUILDER_BUDGET_HOLD_SECONDS,
        pollSeconds: BUILDER_BUDGET_HOLD_POLL_SECONDS,
      };
    }
    return {
      budgetUsd: budget,
      spentUsd,
      remainingUsd: Math.max(0, budget - spentUsd),
      exceeded: spentUsd >= budget,
      holdSeconds: BUILDER_BUDGET_HOLD_SECONDS,
      pollSeconds: BUILDER_BUDGET_HOLD_POLL_SECONDS,
    };
  }

  /**
   * Raise (or lower) the session's spend ceiling, at any point in its life.
   *
   * Deliberately allowed **while a build is running**, which is the case it
   * exists for. A run that hits the ceiling mid-flight holds at the next phase
   * boundary rather than aborting, and this is what releases it — the runner
   * re-reads the ceiling every few seconds, so nothing needs to be dispatched
   * and the hour of work already in its tree survives.
   *
   * The one refusal is a figure that would not actually release a held run:
   * setting the ceiling at or below what has already been spent leaves the run
   * exactly where it was, and "raised the budget, nothing happened" is a worse
   * outcome than being told the number is too low.
   */
  async raiseBudget(
    session: BuilderSession,
    userId: number,
    budgetUsd: number,
  ): Promise<
    BuilderBudgetState & { hold: { runId: string } | null; released: boolean }
  > {
    const spent = Number(session.totalCostUsd ?? 0);
    const activeRun = await this.runRepository.findOne({
      where: { sessionId: session.id, status: In(BUILDER_RUN_ACTIVE_STATUSES) },
      order: { sequence: 'DESC' },
    });

    // A ceiling of zero means "no ceiling" everywhere else (see
    // assertWithinBudget), so it is a legitimate value here and not a floor
    // violation — uncapping a session is the strongest possible raise.
    if (budgetUsd > 0 && budgetUsd <= spent) {
      throw new BadRequestException(
        `This session has already spent $${spent.toFixed(2)}, so a $${budgetUsd.toFixed(2)} ceiling ` +
          'would stop it again immediately. Choose a figure above what it has spent, or stop the build.',
      );
    }

    await this.sessionRepository.update(
      { id: session.id },
      { budgetUsd: String(budgetUsd), updatedBy: userId },
    );

    const hold = activeRun
      ? await this.findActiveHold(session.id, activeRun)
      : null;

    // Written onto the run's own log so the feed shows the raise where the
    // hold is, in order, rather than the banner quietly changing.
    if (activeRun) {
      await this.eventService.record(activeRun, BuilderEventType.BUDGET_HOLD, {
        state: hold ? 'raised' : 'headroom',
        budgetUsd,
        spentUsd: spent,
        previousBudgetUsd: Number(session.budgetUsd ?? 0) || null,
      });
    }

    const state = await this.budgetStateFor(session.id);
    return {
      ...state,
      hold: hold ? { runId: hold.runId } : null,
      released: Boolean(hold) && !state.exceeded,
    };
  }

  /**
   * Record that a run has parked on its ceiling, and tell somebody.
   *
   * Posted by the runner at the phase boundary where it stopped, not inferred
   * from the spend: only the runner knows it is actually sitting there waiting,
   * and a session whose ceiling is gone between runs is a different (already
   * notified) situation.
   */
  async recordBudgetHold(
    run: BuilderBuildRun,
  ): Promise<{ holdSeconds: number }> {
    const state = await this.budgetStateFor(run.sessionId);
    const holdUntil = new Date(Date.now() + state.holdSeconds * 1000);

    await this.eventService.record(run, BuilderEventType.BUDGET_HOLD, {
      state: 'held',
      spentUsd: state.spentUsd,
      budgetUsd: state.budgetUsd,
      holdUntil: holdUntil.toISOString(),
      holdSeconds: state.holdSeconds,
    });

    const session = await this.sessionRepository.findOne({
      where: { id: run.sessionId },
    });
    if (session) {
      await this.notificationService.budgetHold(
        session,
        state.spentUsd,
        Math.round(state.holdSeconds / 60),
      );
    }
    return { holdSeconds: state.holdSeconds };
  }

  /**
   * The hold a run is currently sitting in, if any — the last BUDGET_HOLD
   * event on the newest active run, and only while it still says `held`.
   */
  private async findActiveHold(
    sessionId: string,
    knownRun?: BuilderBuildRun,
  ): Promise<{ runId: string; heldAt: string; holdUntil: string } | null> {
    const run =
      knownRun ??
      (await this.runRepository.findOne({
        where: { sessionId, status: In(BUILDER_RUN_ACTIVE_STATUSES) },
        order: { sequence: 'DESC' },
      }));
    if (!run) return null;

    const event = await this.eventRepository.latestOfType(
      run.id,
      BuilderEventType.BUDGET_HOLD,
    );
    if (!event || event.payload?.state !== 'held') return null;

    const heldAt = event.createdAt ?? new Date();
    return {
      runId: run.id,
      heldAt: new Date(heldAt).toISOString(),
      holdUntil: String(
        event.payload?.holdUntil ??
          new Date(
            new Date(heldAt).getTime() + BUILDER_BUDGET_HOLD_SECONDS * 1000,
          ).toISOString(),
      ),
    };
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
