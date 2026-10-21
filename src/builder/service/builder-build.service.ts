import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { In, IsNull, Like } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { providerForModel } from 'src/llm-agent/service/agent-llm.factory';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import {
  BuilderBuildEventRepository,
  BuilderBuildRunRepository,
  BuilderPullRequestRepository,
} from '../repository/builder-build.repository';
import { BuilderEventService } from './builder-event.service';
import { LlmModelsRepository } from 'src/llm/repository/llm-models.repository';
import { BuilderSettingsService } from './builder-settings.service';
import { BuilderNotificationService } from './builder-notification.service';
import { BuilderExemplarService } from './builder-exemplar.service';
import { BuilderEpicService } from './builder-epic.service';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderReadinessService } from './builder-readiness.service';
import { BuilderTechnicalDesign } from '../type/builder-prd.type';
import { isBuilderRepo } from '../constants/builder-repos.constants';
import {
  computeDesignReadiness,
  createDraftingDesign,
  productHashOf,
} from '../util/builder-technical-design.util';
import {
  BUILDER_RUN_ACTIVE_STATUSES,
  BuilderEventType,
  BuilderMilestoneStatus,
  BuilderPrdVersionAuthor,
  BuilderRunMode,
  BuilderRunStatus,
  BuilderSessionStatus,
  BuilderStage,
} from '../enum/builder.enum';
import {
  BUILDER_CONSECUTIVE_FAILURE_LIMIT,
  BUILDER_DISPATCH_LOCK_PREFIX,
  BUILDER_DISPATCH_LOCK_TTL_SECONDS,
  BUILDER_DISPATCH_TIMEOUT_MS,
  BUILDER_ENGINE,
  BUILDER_MODEL_DEFAULTS,
  BUILDER_RUN_TIMEOUT_MS,
  BUILDER_WORKFLOW_FILE,
  BUILDER_WORKFLOW_REF,
  BUILDER_WORKFLOW_REPO,
  BUILDER_SIZE_PROFILES,
  BuilderBuildSize,
  classifyBuildSize,
  prdTechnicalPlanLength,
  BUILDER_REPO_REVIEW_WORKFLOW,
  BUILDER_REPO_REVIEW_TIMEOUT_MS,
} from '../constants/builder.constants';

/** A size decision plus the features it was derived from. */
export interface BuilderSizing {
  size: BuilderBuildSize;
  requirementCount: number;
  repoCount: number;
  technicalPlanLength: number;
}

/**
 * The models a run is recorded with, and what a design run's runner is told.
 *
 * Rides the single `models` workflow input: `workflow_dispatch` accepts at most
 * 10 inputs. Only design runs go to Builder's runner now; a build is an issue
 * in its repo, and opencode there runs the repo's own model.
 */
export interface BuilderResolvedModels {
  planner: string;
  coder: string;
  verifier: string;
  size: BuilderBuildSize;
  /** The features the size was derived from, recorded with the run. */
  requirementCount: number;
  repoCount: number;
  technicalPlanLength: number;
  effort: 'low' | 'medium' | 'high';
}

/** Live spend against the session's ceiling. */
export interface BuilderBudgetState {
  budgetUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  exceeded: boolean;
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
/**
 * Session states a build can be dispatched from.
 *
 * Named rather than inlined because the admin UI makes the same decision about
 * which sessions offer a start control, and the two had already drifted: the
 * page offered a retry the API refused.
 */

export const BUILDER_STARTABLE_STATUSES: BuilderSessionStatus[] = [
  BuilderSessionStatus.PRD_READY,
  BuilderSessionStatus.FAILED,
  BuilderSessionStatus.CANCELLED,
];

/**
 * The provider an engine's usage row is filed under, from the model id.
 *
 * opencode may report usage under its own `provider/model` form
 * (`google/gemini-2.5-pro`), which the prefix match does not recognise, and
 * the fallback used to be a literal 'anthropic' — so Gemini spend could land
 * under Claude. The id is read without that prefix, and an id nothing
 * recognises is filed as 'unknown' rather than as some vendor.
 */
export const usageProviderFor = (model: string): string => {
  const bare =
    model.includes('/') && !model.startsWith('models/')
      ? model.slice(model.indexOf('/') + 1)
      : model;
  return providerForModel(bare) ?? providerForModel(model) ?? 'unknown';
};

@Injectable()
export class BuilderBuildService {
  private readonly logger = LoggerService.getInstance(BuilderBuildService.name);

  constructor(
    private readonly configService: AppConfigService,
    private readonly github: GithubActionsService,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly eventRepository: BuilderBuildEventRepository,
    private readonly llmModelsRepository: LlmModelsRepository,
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
    private readonly llmUsage: LlmUsageService,
    private readonly prdService: BuilderPrdService,
    private readonly readiness: BuilderReadinessService,
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
      model?: string;
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
    // CANCELLED is startable, and leaving it out made stop a one-way door.
    //
    // A session only reaches CANCELLED by way of BUILDING, so its PRD is ready
    // by construction — stopping a run says "not this build", not "retire this
    // work". Refusing here meant the deliberate act of pressing stop discarded
    // the session: the PRD stayed, the branch stayed, and the only route
    // onward was a new session and a re-run of the interview.
    //
    // COMPLETED stays out. Its pull requests are open or merged, and a second
    // build of finished work opens a competing set against the same PRD.
    // A COMPLETED session that opened no pull requests has shipped nothing —
    // getDeliveryState says so in as many words — so it is not finished in any
    // sense a person cares about and must not be a dead end. It happens: a run
    // whose agent claimed done and whose evidence said otherwise settles the
    // session green with an empty branch behind it. One with pull requests
    // stays closed to rebuilding, because a second build against the same PRD
    // opens a competing set.
    const completedEmptyHanded =
      session.status === BuilderSessionStatus.COMPLETED &&
      (await this.pullRequestRepository.count({
        where: { sessionId: session.id },
      })) === 0;

    // A one-repo-per-build chain that stopped before its last repo is not
    // finished, whatever the session says: the repos left are still to build.
    // That includes a milestone a failed start left BUILDING (10-14: the
    // ally-mobile issue 403'd and the chain could not be restarted) — so long
    // as nothing for the session is actually running.
    const chainUnfinished =
      session.status === BuilderSessionStatus.COMPLETED &&
      Boolean(await this.epicService.unbuiltRepoMilestone(session.id)) &&
      (await this.runRepository.count({
        where: {
          sessionId: session.id,
          status: In([BuilderRunStatus.QUEUED, BuilderRunStatus.RUNNING]),
        },
      })) === 0;

    if (
      !BUILDER_STARTABLE_STATUSES.includes(session.status) &&
      !completedEmptyHanded &&
      !chainUnfinished
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

    await this.assertDesignApproved(session);

    // A build is an issue in its repo: opencode runs on that repo's own
    // Actions with the repo's model (BUILDER_MODEL), so Builder's
    // runner-minute ceiling and its model catalog check do not apply to it.
    await this.assertWithinConcurrency(settings.maxConcurrentBuilds);

    // Unreadable means "as before": resume the previous branch. Sizing already
    // tolerates an unreadable PRD the same way (classifySession).
    const doc = await this.prdService
      .getOrCreateDoc(session.id, session.createdBy)
      .catch(() => null);
    const prdVersion = doc?.versionNumber ?? null;
    const branchSlug = await this.branchSlugForBuild(session, prdVersion);

    // One repo per build: a design that changes several repos becomes a chain
    // of repo milestones, backend first (BuilderEpicService.ensureRepoMilestones).
    const designRepos = (doc?.draft?.technicalDesign?.scope ?? [])
      .map((entry) => String(entry?.repo ?? '').trim())
      .filter(Boolean);
    await this.epicService.ensureRepoMilestones(
      session.id,
      designRepos,
      branchSlug,
    );

    // Epic mode dispatches the first milestone rather than the whole PRD. The
    // split itself is proposed and confirmed before this point — a wrong
    // decomposition is expensive in a way a wrong plan is not, because it
    // becomes several pull requests in the wrong shape.
    //
    // Looked up before sizing, because what is being dispatched is what should
    // be sized. See classifySession.
    const milestone = await this.epicService.nextPending(session.id);

    const sizing = await this.classifySession(session, milestone);
    const models = this.resolveModels(session, settings, overrides, sizing);

    // Carry the chosen model onto the session so the milestones after the
    // first and the UI read the same thing without re-deriving it.
    const buildMetadata: Record<string, any> = {
      ...(session.metadata ?? {}),
      buildOverrides: {
        model: overrides.model ?? null,
      },
    };
    await this.sessionRepository.update(
      { id: session.id },
      {
        model: models.coder,
        status: BuilderSessionStatus.BUILDING,
        currentStage: BuilderStage.SETUP,
        error: null,
        ...(overrides.budgetUsd !== undefined
          ? { budgetUsd: String(overrides.budgetUsd) }
          : {}),
        // The model this build was started with, for the milestones after
        // the first: advanceEpic dispatches them with no request to read
        // overrides from.
        metadata: buildMetadata,
        updatedBy: userId,
      },
    );

    if (milestone) {
      await this.epicService.markStatus(
        milestone.id,
        BuilderMilestoneStatus.BUILDING,
      );
    }

    try {
      return await this.dispatchRun({
        session: { ...session, model: models.coder },
        mode: BuilderRunMode.BUILD,
        userId,
        // A one-repo design builds in the repo it names, whatever else the
        // session lists: an issue build covers exactly one repo.
        repos: milestone?.repos?.length
          ? milestone.repos
          : designRepos.length === 1
            ? designRepos
            : repos,
        models,
        milestoneId: milestone?.id ?? undefined,
        branchSlugOverride: milestone?.branchSlug ?? branchSlug,
        prdVersion,
      });
    } catch (error) {
      // Nothing started, so the milestone is still to build — as advanceEpic
      // leaves it when the next repo's dispatch fails.
      if (milestone) {
        const message = error instanceof Error ? error.message : String(error);
        await this.epicService.markStatus(
          milestone.id,
          BuilderMilestoneStatus.PENDING,
          message,
        );
      }
      throw error;
    }
  }

  /**
   * A build is held to an approved technical design written from this PRD.
   *
   * Only first builds and milestones. Reviews and fixes continue work that
   * already passed this gate, and refusing them because the PRD was edited
   * since would strand an open pull request's review comments behind a
   * redraft nobody asked for.
   */
  private async assertDesignApproved(session: BuilderSession): Promise<void> {
    const doc = await this.prdService.getOrCreateDoc(
      session.id,
      session.createdBy,
    );
    const design = doc.draft.technicalDesign;
    if (!design || design.status !== 'approved') {
      throw new BadRequestException(
        'Approve the technical design before building — draft it from the PRD panel.',
      );
    }
    if (productHashOf(doc.draft) !== design.productHash) {
      throw new BadRequestException(
        'The PRD changed after the technical design was approved — redraft and approve it again.',
      );
    }
  }

  /**
   * Draft the technical design: a read-only designer run on the runner, with
   * every repo the session targets checked out.
   *
   * The session does not move. A design is drafted from a ready PRD and the
   * session stays PRD_READY (or wherever it was) until a build starts; the
   * design's own status carries its progress. Giving it a session status
   * would put it on every list filter, the archive rules and the start-build
   * check, for a run that changes no code.
   */
  async startDesign(
    session: BuilderSession,
    userId: number,
  ): Promise<BuilderBuildRun> {
    const settings = await this.settingsService.get();
    if (!settings.enabled) {
      throw new BadRequestException(
        'Builder is switched off for this environment. Turn it on in Builder settings first.',
      );
    }
    if (!this.github.isConfigured) {
      throw new ServiceUnavailableException(
        'GITHUB_TOKEN is not configured on this environment, so the design run cannot be dispatched.',
      );
    }

    const doc = await this.prdService.getOrCreateDoc(
      session.id,
      session.createdBy,
    );
    if (!(await this.readiness.assess(session.id, doc)).ready) {
      throw new BadRequestException(
        'The PRD is not ready yet — settle its open blockers before drafting the technical design.',
      );
    }

    // The start dialog is the only place that saves repos onto the session,
    // and it stays locked until the design is approved — so a session that
    // has never been built has none here. The PRD's technical plan names the
    // repos it changes (the same list the dialog pre-checks), so the design
    // reads those, and they are saved so the dialog and the build agree.
    let repos = session.repos ?? [];
    if (!repos.length) {
      repos = [
        ...new Set(
          (doc.draft.technicalPlan?.repos ?? [])
            .map((plan) => plan.repo)
            .filter((repo): repo is string => Boolean(repo))
            .filter(isBuilderRepo),
        ),
      ];
    }
    if (!repos.length) {
      throw new BadRequestException(
        'No repos chosen — the designer has nothing to read.',
      );
    }

    if (await this.runRepository.countBlockingRuns(session.id)) {
      throw new BadRequestException(
        'This session already has a run in flight or waiting on an answer. Let it finish first.',
      );
    }

    if (!session.repos?.length) {
      await this.sessionRepository.update({ id: session.id }, { repos });
      session.repos = repos;
    }

    await this.assertWithinConcurrency(settings.maxConcurrentBuilds);
    this.assertWithinBudget(session, settings.maxRunnerMinutes);

    const models = this.resolveModels(session, settings);
    await this.assertModelsAreReal(models);

    let createdRunId: string | null = null;
    try {
      return await this.dispatchRun({
        session,
        mode: BuilderRunMode.DESIGN,
        userId,
        repos,
        models,
        // Written between the row and the dispatch, so the design names its
        // run before the runner can call back about it — the pipeline only
        // accepts a submission from the run the design says is drafting it.
        onCreated: async (run) => {
          createdRunId = run.id;
          await this.prdService.setTechnicalDesign(
            doc,
            createDraftingDesign(
              doc.draft,
              run.id,
              doc.draft.technicalDesign ?? null,
            ),
            userId,
            BuilderPrdVersionAuthor.ADMIN,
            'Drafting the technical design',
          );
        },
      });
    } catch (error) {
      // A dispatch that never left leaves a design claiming to be drafted by
      // a run that will never run. Marked failed so the panel offers a retry
      // rather than a spinner. Only when this call got as far as writing one:
      // a refusal before that (the dispatch lock, say) has a design that
      // belongs to someone else's start.
      if (createdRunId) {
        await this.markDesignEnded(
          session,
          createdRunId,
          BuilderRunStatus.FAILED,
          error instanceof Error ? error.message : String(error),
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * A person agreeing to the design. Refused unless it is in review, clears
   * every blocker, and was drafted from the PRD as it stands now.
   */
  async approveDesign(
    session: BuilderSession,
    userId: number,
  ): Promise<BuilderTechnicalDesign> {
    const doc = await this.prdService.getOrCreateDoc(
      session.id,
      session.createdBy,
    );
    const design = doc.draft.technicalDesign;
    if (!design) {
      throw new BadRequestException(
        'There is no technical design to approve — draft one from the PRD panel.',
      );
    }
    if (design.status !== 'review') {
      throw new BadRequestException(
        design.status === 'approved'
          ? 'This technical design is already approved.'
          : `Only a design in review can be approved — this one is ${design.status}.`,
      );
    }
    const readiness = computeDesignReadiness(doc.draft);
    if (readiness.stale) {
      throw new BadRequestException(
        'The PRD changed after this design was drafted — redraft it before approving.',
      );
    }
    if (!readiness.ready) {
      throw new BadRequestException(
        `The design is not ready to approve: ${readiness.blockers.join(' ')}`,
      );
    }

    const approved: BuilderTechnicalDesign = {
      ...design,
      status: 'approved',
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
    };
    await this.prdService.setTechnicalDesign(
      doc,
      approved,
      userId,
      BuilderPrdVersionAuthor.ADMIN,
      'Approved the technical design',
    );

    // The build clones `session.repos` and nothing else, so a design that
    // found the change also belongs in a repo the session never named would
    // otherwise be approved for files the build cannot reach. Widened, never
    // narrowed: a repo the admin chose stays chosen.
    const current = session.repos ?? [];
    const needed = (approved.scope ?? []).map((entry) => entry.repo);
    const union = [...new Set([...current, ...needed])];
    if (union.length !== current.length) {
      await this.sessionRepository.update(
        { id: session.id },
        { repos: union, updatedBy: userId },
      );
    }

    return approved;
  }

  /**
   * Record that a design run ended without a design to show for it.
   *
   * Only touches the design its own run is drafting, and only while it is
   * still drafting: a submission that already reached review stays there
   * whatever the run did afterwards, and a newer redraft is never failed by
   * an older run finishing late.
   */
  private async markDesignEnded(
    session: BuilderSession,
    runId: string,
    status: BuilderRunStatus,
    error: string | null,
  ): Promise<void> {
    const doc = await this.prdService.getOrCreateDoc(
      session.id,
      session.createdBy,
    );
    const design = doc.draft.technicalDesign;
    if (!design || design.status !== 'drafting') return;
    if (design.runId !== runId) return;

    const reason =
      error ??
      (status === BuilderRunStatus.SUCCEEDED
        ? 'The design run finished without submitting a design.'
        : status === BuilderRunStatus.CANCELLED
          ? 'The design run was cancelled.'
          : 'The design run failed.');
    await this.prdService.setTechnicalDesign(
      doc,
      { ...design, status: 'failed', error: reason },
      session.createdBy ?? 0,
      BuilderPrdVersionAuthor.AGENT,
      'The technical design run ended without a design',
    );
  }

  /**
   * The branch family a new build of this session pushes to.
   *
   * Starting a build again after a stop resumes the branch the last run left
   * behind: the runner finds `builder/<slug>` on the remote and gates what is
   * there before coding anything. That is right when the PRD is the one that
   * work was written from, and wrong when it is not. On 2026-10-12 session
   * 880e73e6 was stopped because its PRD prescribed a breaking rename, the PRD
   * was rewritten, and the next build gated and remediated the rename anyway —
   * it never ran a coding pass against the new PRD.
   *
   * So a build from a different PRD version starts its own branch,
   * `<slug>-v<version>`, and the old one is left untouched. Same version, or a
   * previous run from before versions were recorded: the previous run's
   * branch, as before. An open pull request on the previous branch keeps it
   * too, so a rebuild can never open a competing set.
   */
  private async branchSlugForBuild(
    session: BuilderSession,
    prdVersion: number | null,
  ): Promise<string> {
    const previous = await this.runRepository.findOne({
      where: {
        sessionId: session.id,
        mode: In([BuilderRunMode.BUILD, BuilderRunMode.RESUME]),
        milestoneId: IsNull(),
      },
      order: { sequence: 'DESC' },
    });
    if (!previous) return session.slug;

    const previousSlug = previous.branchSlug || session.slug;
    if (
      prdVersion == null ||
      previous.prdVersion == null ||
      previous.prdVersion === prdVersion
    ) {
      return previousSlug;
    }

    const openOnPrevious = await this.pullRequestRepository.count({
      where: {
        sessionId: session.id,
        branch: Like(`builder/${previousSlug}%`),
        state: 'open',
      },
    });
    if (openOnPrevious > 0) return previousSlug;

    return `${session.slug}-v${prdVersion}`;
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
      // Every milestone builds from the same approved design. One edited
      // between milestones is stale for the rest of the series, and the
      // refusal lands on the milestone as its reason for waiting.
      await this.assertDesignApproved(session);
      await this.assertWithinConcurrency(settings.maxConcurrentBuilds);

      const carried = (session.metadata?.buildOverrides ?? {}) as {
        model?: string | null;
      };
      const models = this.resolveModels(session, settings, {
        model: carried.model ?? undefined,
      });
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
        repos: next.repos?.length ? next.repos : (session.repos ?? []),
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
      // FAILED, not COMPLETED: the session has work left, and a person needs
      // to see why it stopped. On 2026-10-14 ally-mobile's issue could not be
      // raised (403) and the session read "Completed" with a repo unbuilt.
      // FAILED is startable, so a restart resumes at this milestone.
      await this.sessionRepository.update(
        { id: session.id },
        {
          status: BuilderSessionStatus.FAILED,
          error: `Could not start ${next.title}: ${message}`,
        },
      );
      this.logger.warn(
        `Builder session ${session.id} could not start milestone ${next.position}: ${message}`,
      );
      // Handled: settleRun must not go on to mark the session COMPLETED.
      return true;
    }
  }

  /**
   * Model per tier, resolved run override (coder only) → session (coder only)
   * → settings → config default. One resolution path so the run row, the
   * design workflow input and the UI can never disagree about which model a
   * phase used.
   */
  private resolveModels(
    session: BuilderSession,
    settings: {
      plannerModel?: string | null;
      coderModel?: string | null;
      verifierModel?: string | null;
      defaultModel?: string | null;
    },
    overrides: { model?: string } = {},
    sizing: BuilderSizing = {
      size: BuilderBuildSize.MEDIUM,
      requirementCount: 0,
      repoCount: 0,
      technicalPlanLength: 0,
    },
  ): BuilderResolvedModels {
    const config = this.configService.builder;
    const { size } = sizing;
    const profile = BUILDER_SIZE_PROFILES[size];

    // No per-vendor filter: opencode runs whatever provider it holds a key
    // for, and run-engine.sh derives the provider prefix from the model id.
    const coder =
      overrides.model ??
      session.model ??
      settings.coderModel ??
      settings.defaultModel ??
      config.coderModel ??
      // Last rung: the compiled default, so a run always has a model even
      // when every configurable rung above it is empty.
      BUILDER_MODEL_DEFAULTS.coder;

    return {
      planner:
        settings.plannerModel ??
        settings.defaultModel ??
        config.plannerModel ??
        coder,
      coder,
      verifier:
        settings.verifierModel ??
        settings.defaultModel ??
        config.verifierModel ??
        coder,
      size,
      requirementCount: sizing.requirementCount,
      repoCount: sizing.repoCount,
      technicalPlanLength: sizing.technicalPlanLength,
      effort: profile.effort,
    };
  }

  /**
   * Size a session's PRD.
   *
   * Failure is not fatal and lands on MEDIUM: an unreadable PRD is a reason to
   * spend the default, not a reason to refuse a build.
   */
  /**
   * What is about to be built, sized.
   *
   * `milestone` is what makes this honest for epics. Sizing used to read the
   * whole session and force LARGE the moment any milestone existed, so every
   * slice of an epic ran on the most expensive profile there is — Opus
   * planning, high effort, sixty turns, a $41 ceiling — including a slice that
   * touches two files.
   *
   * The reasoning behind that rule was "it was decomposed precisely because it
   * was too big to hold at once". That is true of the PRD and false of each
   * slice: decomposition is the thing that makes the pieces tractable, so
   * treating the existence of a split as evidence of bigness spends as if the
   * split had never happened. A milestone carries its own requirement set and
   * its own technical notes, which is exactly what the classifier wants.
   *
   * `isEpic` therefore applies only when sizing a whole PRD with no milestone
   * in hand — the pre-split case, where the signal still means what it said.
   */
  /**
   * Refuse a build whose configured models do not exist, before it costs
   * anything.
   *
   * A model id that a provider no longer serves fails in the worst available
   * way today: `run-engine.sh` has no `set -e`, so `opencode run --model <gone>`
   * errors, the script carries on, the gate runs against an unchanged tree and
   * blocks, and the loop retries. Nothing anywhere says the model does not
   * exist. On a small build's ladder — two rungs on the same tier — that burns
   * two of four attempts before the run even reaches a different model, and
   * the admin sees a failed build with a test-gate error.
   *
   * This is not hypothetical maintenance work: `claude-haiku-4-5` is the
   * mechanical tier's default and four AI-task registry rows, it is the only
   * Haiku Anthropic ships, and its retirement window opens 2026-10-15.
   *
   * Checked against the `llm_models` catalog rather than a hardcoded list, so
   * retiring a model is a row edit rather than a deploy. Unknown-to-the-catalog
   * is treated as fine: the catalog is admin-maintained and lags reality in
   * both directions, and refusing a build because someone has not added a row
   * yet would be a worse failure than the one this prevents. Only an
   * explicitly INACTIVE row blocks — that is somebody stating the model is
   * gone.
   */
  private async assertModelsAreReal(
    models: BuilderResolvedModels,
  ): Promise<void> {
    const wanted = [
      ...new Set(
        [models.planner, models.coder, models.verifier]
          .map((model) => String(model ?? '').trim())
          .filter(Boolean),
      ),
    ];
    if (!wanted.length) return;

    let retired: string[] = [];
    try {
      const rows = await this.llmModelsRepository.find({
        where: { model: In(wanted) },
      });
      retired = rows
        .filter((row) => row.active === false)
        .map((row) => row.model);
    } catch (error) {
      // The catalog being unreadable is not evidence a model is gone, and a
      // build refused over a database hiccup is a worse outcome than one that
      // runs on a model nobody has retired.
      this.logger.warn(
        `Could not check Builder's models against the catalog: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (retired.length) {
      throw new BadRequestException(
        `${retired.join(', ')} ${retired.length === 1 ? 'is' : 'are'} marked retired in the model catalog, so this build would burn its attempts on a model that no longer answers. Pick another model tier in Builder settings, or mark the row active again if the retirement was recorded early.`,
      );
    }
  }

  private async classifySession(
    session: BuilderSession,
    milestone?: {
      requirementIds?: string[] | null;
      technicalNotesMd?: string | null;
    } | null,
  ): Promise<BuilderSizing> {
    try {
      const doc = await this.prdService.getOrCreateDoc(
        session.id,
        session.createdBy,
      );
      const draft = (doc?.draft ?? {}) as Record<string, any>;

      if (milestone) {
        // A milestone with no requirements recorded is not evidence of a small
        // milestone, only of a thin decomposition — fall through to the PRD's
        // own requirement count rather than sizing it as trivial.
        const ownRequirements = milestone.requirementIds?.length ?? 0;
        const features = {
          requirementCount:
            ownRequirements ||
            (Array.isArray(draft.requirements) ? draft.requirements.length : 0),
          repoCount: (session.repos ?? []).length,
          technicalPlanLength:
            (milestone.technicalNotesMd ?? '').length ||
            prdTechnicalPlanLength(draft),
        };
        return { size: classifyBuildSize(features), ...features };
      }

      const milestones = await this.epicService.listBySession(session.id);
      const features = {
        requirementCount: Array.isArray(draft.requirements)
          ? draft.requirements.length
          : 0,
        repoCount: (session.repos ?? []).length,
        technicalPlanLength: prdTechnicalPlanLength(draft),
      };
      return {
        size: classifyBuildSize({ ...features, isEpic: milestones.length > 0 }),
        ...features,
      };
    } catch (error) {
      this.logger.warn(
        `Could not size the PRD for session ${session.id}; planning at the default tier: ${
          (error as Error).message
        }`,
      );
      return {
        size: BuilderBuildSize.MEDIUM,
        requirementCount: 0,
        repoCount: (session.repos ?? []).length,
        technicalPlanLength: 0,
      };
    }
  }

  /**
   * Whether this session has stopped converging.
   *
   * The per-PR ceilings bound each loop on its own — two reviews, three fixes —
   * and nothing was watching the session as a whole. One session burned eight
   * runs inside those ceilings while nothing succeeded after the build: a
   * review that died on a database error, a fix sent at feedback that was
   * Builder's own approval, then more of both.
   *
   * So: consecutive failures, newest first, across every mode. A success
   * anywhere in the recent history clears it, because a loop that produced
   * something is a loop still doing work.
   *
   * Only automatic dispatches consult this. A person clicking retry has looked
   * at the failures and decided to try anyway, which is the judgement the
   * breaker is waiting for — blocking them would make it a cage rather than a
   * fuse.
   */
  private async consecutiveFailures(sessionId: string): Promise<number> {
    const recent = await this.runRepository.listRecent(
      sessionId,
      BUILDER_CONSECUTIVE_FAILURE_LIMIT + 1,
    );
    let count = 0;
    for (const run of recent) {
      // QUEUED/RUNNING are not verdicts: a run still going tells us nothing
      // about convergence, so it neither counts nor clears.
      if (
        run.status === BuilderRunStatus.QUEUED ||
        run.status === BuilderRunStatus.RUNNING
      )
        continue;
      if (
        run.status === BuilderRunStatus.FAILED ||
        run.status === BuilderRunStatus.TIMED_OUT
      ) {
        // A run can fail at the protocol and still succeed at the work. Run 9
        // of session 34d68cd2 fixed a migration collision, pushed it, went
        // green — then ended its turn without calling `complete`, and the
        // outcome gate correctly recorded a failure. Counting that as
        // "nothing is converging" stopped automatic work on a session whose
        // pull request was, at that moment, finished.
        //
        // Judged on evidence rather than on the error text: the run changed
        // files AND the session's open pull requests are green. Prose can be
        // anything; a green check on pushed code cannot be faked, and a loop
        // that is genuinely diverging will not produce one.
        if (await this.failureLandedWorkingCode(run)) break;
        count += 1;
        continue;
      }
      break;
    }
    return count;
  }

  /**
   * Did this failed run leave working code behind?
   *
   * Both halves are required. Files changed, so it did something — a run that
   * edited nothing and failed is the non-converging shape the breaker exists
   * for. And the session's open pull requests are green, so what it did works.
   * Either alone would be too generous: edits with red CI is exactly a fix
   * loop making things worse, and green CI with no edits is just the previous
   * run's success being credited twice.
   */
  /**
   * Is anything still in flight for this session?
   *
   * Exposed for the reconcile pass, which needs to know whether a session that
   * ended badly has genuinely stopped before it rewrites the verdict.
   */
  async hasBlockingRuns(sessionId: string): Promise<boolean> {
    return (await this.runRepository.countBlockingRuns(sessionId)) > 0;
  }

  private async failureLandedWorkingCode(
    run: BuilderBuildRun,
  ): Promise<boolean> {
    if (await this.touchedNoFiles(run.id)) return false;

    const pullRequests = await this.pullRequestRepository.find({
      where: { sessionId: run.sessionId },
    });
    const open = pullRequests.filter(
      (row) => !row.merged && row.state !== 'closed',
    );
    return open.length > 0 && open.every((row) => row.ciStatus === 'success');
  }

  /**
   * Refuse an automatic dispatch once the session has stopped converging, and
   * say so once.
   */
  private async breakerTripped(session: BuilderSession): Promise<boolean> {
    const failures = await this.consecutiveFailures(session.id);
    if (failures < BUILDER_CONSECUTIVE_FAILURE_LIMIT) return false;

    this.logger.warn(
      `[BUILDER] Automatic runs paused for session ${session.id}: ${failures} consecutive failures.`,
    );
    // Announced once per trip rather than per refused dispatch — the point is
    // that the loop stopped, not that it stopped again. The newest run's
    // timestamp is the trip's identity: an announcement newer than it has
    // already covered this one, and a further failure moves it forward and
    // earns a fresh word.
    const latest = await this.runRepository.findLatest(session.id);
    await this.notificationService.automationPaused(
      session,
      failures,
      latest?.createdAt ?? null,
    );
    return true;
  }

  /**
   * Send a review at an open opencode pull request: the in-repo review
   * (builder-review.yml), where the code is checked out and the reviewer can
   * run it. Same concurrency and in-flight guards as any dispatch.
   *
   * `reviewedSha` is stamped at dispatch, not on completion. Reconcile is
   * polled: a tick landing while the review is still running would see an
   * unreviewed head sha and dispatch a second reviewer at the same diff. A
   * review that fails gives the claim back (releaseReviewClaim).
   */
  async dispatchReviewRun(
    pullRequest: {
      id: string;
      sessionId: string;
      repo: string;
      branch: string;
      prNumber: number;
      runId?: string | null;
    },
    headSha: string,
  ): Promise<BuilderBuildRun | null> {
    const session = await this.sessionRepository.findOne({
      where: { id: pullRequest.sessionId },
    });
    if (!session) return null;
    if (await this.breakerTripped(session)) return null;

    if (await this.runRepository.countBlockingRuns(session.id)) {
      this.logger.info(
        `Skipping a review run for ${pullRequest.repo}#${pullRequest.prNumber}: this session already has a run in flight.`,
      );
      return null;
    }

    const settings = await this.settingsService.get();
    try {
      // A repo review holds no Builder runner: its minutes are the target
      // repo's own Actions minutes, so only the concurrency limit applies.
      await this.assertWithinConcurrency(settings.maxConcurrentBuilds);
    } catch (error) {
      this.logger.info(
        `Skipping a review run for ${pullRequest.repo}#${pullRequest.prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    // A review starting means the last failure is no longer what is
    // happening, and leaving it on the session shows a stale error above a
    // running review.
    await this.sessionRepository.update({ id: session.id }, { error: null });
    await this.pullRequestRepository.update(
      { id: pullRequest.id },
      { reviewedSha: headSha },
    );
    await this.pullRequestRepository.increment(
      { id: pullRequest.id },
      'reviewRunCount',
      1,
    );

    return this.dispatchRepoReview(session, pullRequest, headSha);
  }

  /**
   * Start the in-repo review of an opencode pull request.
   *
   * The run row records which kind of review it is (`cost.reviewWorkflow`), so
   * its findings settle it (BuilderPipelineController.recordReviewFindings),
   * the tick looks for it in the target repo rather than in ally-be
   * (reconcileRepoReview), and cancelling it stops the right workflow.
   *
   * The workflow reads the spec this pull request was built from, through the
   * build run that recorded the PR; a PR without one falls back to the latest
   * build of its repo.
   */
  private async dispatchRepoReview(
    session: BuilderSession,
    pullRequest: {
      id: string;
      repo: string;
      prNumber: number;
      runId?: string | null;
    },
    headSha: string,
  ): Promise<BuilderBuildRun | null> {
    const specRunId =
      pullRequest.runId ??
      (
        await this.runRepository.find({
          where: { sessionId: session.id, mode: BuilderRunMode.BUILD },
          order: { sequence: 'DESC' },
        })
      ).find((run) => run.repos?.includes(pullRequest.repo))?.id ??
      null;
    if (!specRunId) {
      this.logger.warn(
        `Not reviewing ${pullRequest.repo}#${pullRequest.prNumber}: no build run to read its spec from.`,
      );
      await this.pullRequestRepository.update(
        { id: pullRequest.id },
        { reviewedSha: null },
      );
      return null;
    }

    const dispatchedAt = new Date(Date.now() - 5_000);
    const run = await this.runRepository.save(
      this.runRepository.create({
        sessionId: session.id,
        sequence: await this.runRepository.nextSequence(session.id),
        mode: BuilderRunMode.REVIEW,
        status: BuilderRunStatus.QUEUED,
        engine: BUILDER_ENGINE,
        model: 'repo review (BUILDER_REVIEW_MODEL)',
        branchSlug: session.slug,
        repos: [pullRequest.repo],
        pullRequestId: pullRequest.id,
        dispatchedAt,
        createdBy: session.createdBy ?? 0,
        cost: { reviewWorkflow: 'repo', reviewedSha: headSha } as any,
      }),
    );

    try {
      await this.github.dispatchWorkflow({
        repo: pullRequest.repo,
        workflow: BUILDER_REPO_REVIEW_WORKFLOW,
        ref: 'master',
        inputs: {
          pr_number: String(pullRequest.prNumber),
          spec_run_id: specRunId,
          review_run_id: run.id,
          builder_pr_id: pullRequest.id,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.settleRepoReview(
        run,
        BuilderRunStatus.FAILED,
        `Could not start the review: ${message}`,
      );
      return null;
    }

    await this.runRepository.update(
      { id: run.id },
      { status: BuilderRunStatus.RUNNING, startedAt: new Date() },
    );
    await this.eventService.record(
      run,
      BuilderEventType.TEXT,
      {
        text: `Reviewing ${pullRequest.repo}#${pullRequest.prNumber} at ${headSha.slice(0, 7)} in ${pullRequest.repo}'s Actions.`,
      },
      null,
    );
    this.logger.info(
      `Builder review run ${run.id} dispatched in ${pullRequest.repo} for #${pullRequest.prNumber} at ${headSha.slice(0, 7)}`,
    );
    return run;
  }

  /**
   * Add spend reported from outside Builder's runner — an opencode issue
   * build or fix, an in-repo review — to its run and its session. Returns the
   * session it was attributed to, or null when neither is known.
   */
  async recordExternalUsage(
    runId: string | null,
    sessionId: string | null,
    costUsd: number,
  ): Promise<string | null> {
    const run = runId
      ? await this.runRepository.findOne({ where: { id: runId } })
      : null;
    const session = run?.sessionId ?? sessionId;
    if (!session || costUsd <= 0) return session;
    if (run) {
      await this.runRepository.update(
        { id: run.id },
        { costUsd: String(Number(run.costUsd ?? 0) + costUsd) },
      );
    }
    await this.sessionRepository.increment(
      { id: session },
      'totalCostUsd',
      costUsd,
    );
    return session;
  }

  /** The latest review runs' outcomes for a pull request, newest first. */
  async recentReviewOutcomes(
    pullRequestId: string,
    take: number,
  ): Promise<BuilderRunStatus[]> {
    const runs = await this.runRepository.find({
      where: { pullRequestId, mode: BuilderRunMode.REVIEW },
      order: { sequence: 'DESC' },
      take,
    });
    return runs.map((run) => run.status);
  }

  /** Whether a run is an in-repo review (dispatchRepoReview). */
  isRepoReview(run: BuilderBuildRun): boolean {
    return (
      run.mode === BuilderRunMode.REVIEW &&
      (run.cost as any)?.reviewWorkflow === 'repo'
    );
  }

  /**
   * Close an in-repo review. Only the run and its pull request's review claim
   * move: a review changes no code, and settleRun's session rules — a failed
   * latest run reopening a COMPLETED session as FAILED — would let a review
   * that crashed fail a build that succeeded.
   */
  async settleRepoReview(
    run: BuilderBuildRun,
    status: BuilderRunStatus,
    error: string | null,
  ): Promise<void> {
    await this.runRepository.update(
      { id: run.id },
      { status, error, completedAt: new Date() },
    );
    await this.releaseReviewClaim(run, status);
  }

  /**
   * Follow an in-repo review to its end. Its findings settle it the moment
   * they are filed; this catches the workflow that ended without filing, and
   * the one that never ended.
   */
  private async reconcileRepoReview(run: BuilderBuildRun): Promise<void> {
    const repo = run.repos?.[0];
    if (!repo) return;
    const remote = await this.github.findRunSince({
      repo,
      workflow: BUILDER_REPO_REVIEW_WORKFLOW,
      since: run.dispatchedAt,
    });
    if (remote && !run.githubRunUrl) {
      await this.runRepository.update(
        { id: run.id },
        { githubRunId: remote.id, githubRunUrl: remote.htmlUrl },
      );
    }
    if (remote?.status === 'completed') {
      const current = await this.runRepository.findOne({
        where: { id: run.id },
      });
      if (current && current.status === BuilderRunStatus.RUNNING) {
        await this.settleRepoReview(
          current,
          BuilderRunStatus.FAILED,
          `The review ended without filing a verdict (${remote.htmlUrl}).`,
        );
      }
      return;
    }
    if (
      Date.now() - run.dispatchedAt.getTime() >
      BUILDER_REPO_REVIEW_TIMEOUT_MS
    ) {
      if (remote && remote.status !== 'completed') {
        await this.github.cancelRun(repo, remote.id).catch(() => undefined);
      }
      await this.settleRepoReview(
        run,
        BuilderRunStatus.TIMED_OUT,
        `No verdict from the review within ${BUILDER_REPO_REVIEW_TIMEOUT_MS / 60_000} minutes.`,
      );
    }
  }

  /**
   * Create the run row, then dispatch: a BUILD as an issue in its repo
   * (dispatchAsIssue), a DESIGN to Builder's own runner. Order matters: the
   * runner and the issue workflow are both handed the run id and call back
   * with it, so the row has to exist before either can start.
   */
  private async dispatchRun(params: {
    session: BuilderSession;
    mode: BuilderRunMode;
    userId: number;
    repos: string[];
    models: BuilderResolvedModels;
    milestoneId?: string;
    branchSlugOverride?: string;
    prdVersion?: number | null;
    /** Runs after the row exists and before the workflow is dispatched. */
    onCreated?: (run: BuilderBuildRun) => Promise<void>;
  }): Promise<BuilderBuildRun> {
    // Only the session is needed here — everything else in `params` is passed
    // straight through to `dispatchRunLocked`, which does the destructuring.
    const { session } = params;

    // Per-session dispatch mutex. The atomic sequence counter stops two
    // dispatches colliding on a run number, but nothing stopped them both
    // *happening* — a double-clicked start would send two runs at the same
    // branches.
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

  /**
   * Start a build as a GitHub issue in its repo — the only way a build runs.
   *
   * The issue carries the repo's slice of the PRD and the approved design,
   * labelled `builder`; the repo's `builder.yml` workflow runs opencode on it
   * (`opencode github run`), which works on a branch and opens a pull request
   * that closes the issue. Builder follows the issue to that PR in the
   * reconcile tick (reconcileIssueRun). One repo per build: a design spanning
   * several repos is a chain of repo milestones, each its own issue.
   */
  private async dispatchAsIssue(
    session: BuilderSession,
    run: BuilderBuildRun,
    repos: string[],
  ): Promise<void> {
    if (repos.length !== 1) {
      throw new BadRequestException(
        `An issue build covers one repo; this one names ${repos.length}.`,
      );
    }
    const [repo] = repos;
    // Nothing private in the issue: ally-be, ally-web and ally-ai are public
    // repos, and the PRD and design are not. The workflow fetches them from
    // GET /builder/pipeline/runs/:runId/spec with the Builder API key, cut to
    // this repo's slice, and hands them to opencode; the issue carries only
    // the run id it needs to do that (in a marker the workflow parses).
    const body = [
      `<!-- builder-run: ${run.id} -->`,
      `Builder build for \`${repo}\` (session \`${session.id.slice(0, 8)}\`, run ${run.sequence}).`,
      '',
      'The specification is private: the Builder workflow fetches it from Builder ' +
        'and opencode works from that. Progress and the pull request appear here and ' +
        'on the Builder build page.',
    ].join('\n');
    const issue = await this.github.createIssue(repo, {
      title: `Builder build — ${repo} (run ${run.sequence}, ${session.id.slice(0, 8)})`,
      body,
      labels: ['builder'],
    });
    // The label is what starts the repo's workflow. GitHub drops it without
    // an error when the token can open issues but not label them — which is
    // how the first production issue build (ally-be#629, 2026-10-14) sat
    // unstarted. Try once more, then fail loudly rather than leave a build
    // that never begins.
    if (!issue.labels.includes('builder')) {
      const labels = await this.github.addIssueLabels(repo, issue.number, [
        'builder',
      ]);
      if (!labels.includes('builder')) {
        throw new Error(
          `raised ${issue.htmlUrl} but could not label it \`builder\`, so its workflow ` +
            `will not start. The ally-be GITHUB_TOKEN needs permission to label issues ` +
            `in ${repo} (triage or write access).`,
        );
      }
    }
    await this.runRepository.update(
      { id: run.id },
      {
        issueNumber: issue.number,
        issueUrl: issue.htmlUrl,
        githubRunUrl: issue.htmlUrl,
        status: BuilderRunStatus.RUNNING,
        startedAt: new Date(),
      },
    );
    await this.recordIssueMilestone(
      {
        ...run,
        issueNumber: issue.number,
        issueUrl: issue.htmlUrl,
      } as BuilderBuildRun,
      'issue',
      `Raised ${repo}#${issue.number} (${issue.htmlUrl}) with this build's PRD and approved design. ` +
        `opencode picks it up in ${repo}'s Builder workflow.`,
      BuilderStage.CODING,
    );
    this.logger.info(
      `Builder run ${run.id} raised ${repo}#${issue.number} for session ${session.id}.`,
    );
  }

  private async dispatchRunLocked(params: {
    session: BuilderSession;
    mode: BuilderRunMode;
    userId: number;
    repos: string[];
    models: BuilderResolvedModels;
    milestoneId?: string;
    branchSlugOverride?: string;
    prdVersion?: number | null;
    /** Runs after the row exists and before the workflow is dispatched. */
    onCreated?: (run: BuilderBuildRun) => Promise<void>;
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
        engine: BUILDER_ENGINE,
        model: models.coder,
        plannerModel: models.planner,
        verifierModel: models.verifier,
        size: models.size,
        // Frozen with the run, not re-derived later: the PRD keeps changing,
        // and a policy trained on today's draft would be learning from
        // features this decision was never conditioned on.
        requirementCount: models.requirementCount,
        repoCount: models.repoCount,
        technicalPlanLength: models.technicalPlanLength,
        effort: models.effort,
        // A milestone pushes to its own branch family (`<slug>-m2`), so the
        // slices stay separately reviewable rather than piling into one branch.
        branchSlug: params.branchSlugOverride ?? session.slug,
        prdVersion: params.prdVersion ?? null,
        repos,
        milestoneId: params.milestoneId ?? null,
        dispatchedAt,
        createdBy: userId,
      }),
    );

    try {
      if (params.onCreated) await params.onCreated(run);
      if (mode === BuilderRunMode.BUILD) {
        await this.dispatchAsIssue(session, run, repos);
        return run;
      }
      await this.github.dispatchWorkflow({
        repo: BUILDER_WORKFLOW_REPO,
        workflow: BUILDER_WORKFLOW_FILE,
        ref:
          this.configService.builder.designWorkflowRef || BUILDER_WORKFLOW_REF,
        inputs: {
          session_id: session.id,
          run_id: run.id,
          mode,
          repos: JSON.stringify(repos),
          // One JSON input for all three tiers: workflow_dispatch caps at 10
          // inputs.
          models: JSON.stringify(models),
          branch_slug: run.branchSlug,
          branches: JSON.stringify({}),
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
      // A design run never moves the session, failing included: the PRD is
      // as ready as it was, and the design records its own failure.
      if (mode !== BuilderRunMode.DESIGN) {
        await this.sessionRepository.update(
          { id: session.id },
          {
            status: BuilderSessionStatus.FAILED,
            error: `Could not start the build: ${message}`,
          },
        );
      }
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
   * Whether a run touched any code at all.
   *
   * The gate rule exists because "I fixed it" is not checkable without machine
   * evidence. A run that changed nothing makes no such claim — and on
   * 2026-09-16 two fix runs did exactly the right thing (read the feedback,
   * found it was Builder's own approval, said so, changed nothing) and were
   * recorded FAILED for it. That failure then poisoned the session status, lit
   * a red banner, and counted toward the circuit breaker.
   *
   * `file_edit` is emitted by the forwarder from the engine's own output rather
   * than asserted by the agent, so this is evidence in the same sense the gate
   * is: a run cannot claim it changed nothing while having edited files.
   */
  async touchedNoFiles(runId: string): Promise<boolean> {
    const edit = await this.eventRepository.latestOfType(
      runId,
      BuilderEventType.FILE_EDIT,
    );
    return !edit;
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

    if (run.mode === BuilderRunMode.DESIGN) {
      const session = await this.sessionRepository.findOne({
        where: { id: run.sessionId },
      });
      if (session) {
        await this.markDesignEnded(
          session,
          run.id,
          BuilderRunStatus.CANCELLED,
          null,
        ).catch(() => undefined);
      }
    }

    if (run.issueNumber) {
      await this.stopIssueBuild(run);
      return;
    }
    if (this.isRepoReview(run)) {
      await this.releaseReviewClaim(run, BuilderRunStatus.CANCELLED);
      const repo = run.repos?.[0];
      const remote = repo
        ? await this.github
            .findRunSince({
              repo,
              workflow: BUILDER_REPO_REVIEW_WORKFLOW,
              since: run.dispatchedAt,
            })
            .catch(() => null)
        : null;
      if (repo && remote && remote.status !== 'completed') {
        await this.github.cancelRun(repo, remote.id).catch(() => undefined);
      }
      return;
    }

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
   * Stop an issue build where it actually runs: opencode's `builder.yml` run
   * in the target repo, and the issue that started it.
   *
   * Looking for ally-be's own runner here, as a runner build does, found
   * whatever `builder-session.yml` run was dispatched after this one — another
   * session's design or review — and cancelled it. A pull request opencode
   * already opened is left open: it is work a person may still want.
   * Best-effort throughout; the run is already CANCELLED.
   */
  private async stopIssueBuild(run: BuilderBuildRun): Promise<void> {
    const repo = run.repos?.[0];
    if (!repo || !run.issueNumber || !this.github.isConfigured) return;
    try {
      const working = await this.github.findRunSince({
        repo,
        workflow: 'builder.yml',
        since: run.dispatchedAt,
        event: 'issues',
      });
      if (working && working.status !== 'completed') {
        await this.github.cancelRun(repo, working.id);
      }
      await this.github.closeIssue(repo, run.issueNumber);
    } catch (error) {
      this.logger.warn(
        `Could not stop issue build ${run.id} in ${repo}#${run.issueNumber}: ${
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

  /**
   * One step of an issue build on the session's feed, posted once.
   *
   * An issue build runs in the target repo's own workflow, which reports
   * nothing to Builder, so the feed is written from here as the PR tick sees
   * each stage: issue raised, opencode working (with its live log), PR opened,
   * CI running / failed / passed, fix requested. `key` makes it idempotent
   * across ticks; `stage` moves the build page's progress rail.
   */
  async recordIssueMilestone(
    run: BuilderBuildRun,
    key: string,
    text: string,
    stage?: BuilderStage,
    extra: {
      /** The opencode Actions run's log, kept on the run for the UI's link. */
      workflowRunUrl?: string;
      /** The repo's CI verdict, also recorded as a structured CI_RESULT event. */
      ci?: {
        repo: string;
        prNumber: number;
        prUrl: string;
        sha: string;
        state: 'success' | 'failure' | 'pending';
        failed: string[];
      };
    } = {},
  ): Promise<void> {
    const fresh =
      (await this.runRepository.findOne({ where: { id: run.id } })) ?? run;
    const cost = (fresh.cost ?? {}) as Record<string, any>;
    const posted = (cost.issueTimeline as string[] | undefined) ?? [];
    if (posted.includes(key)) return;
    await this.runRepository.update(
      { id: run.id },
      {
        cost: {
          ...cost,
          issueTimeline: [...posted, key],
          ...(extra.workflowRunUrl
            ? { issueWorkflowRunUrl: extra.workflowRunUrl }
            : {}),
        } as any,
      },
    );
    if (extra.ci) {
      await this.eventService.record(
        fresh,
        BuilderEventType.CI_RESULT,
        extra.ci,
        stage ?? null,
      );
    }
    if (stage) {
      await this.sessionRepository.update(
        { id: run.sessionId },
        { currentStage: stage },
      );
      await this.eventService.record(
        fresh,
        BuilderEventType.STAGE_CHANGE,
        { stage },
        stage,
      );
    }
    await this.eventService.record(
      fresh,
      BuilderEventType.TEXT,
      { text },
      stage ?? null,
    );
  }

  /** The head commit Builder asked opencode to fix, so it asks once per commit. */
  async recordIssueFixRequest(
    run: BuilderBuildRun,
    headSha: string,
  ): Promise<void> {
    const fresh =
      (await this.runRepository.findOne({ where: { id: run.id } })) ?? run;
    const cost = (fresh.cost ?? {}) as Record<string, any>;
    const asked = [...((cost.issueFixRequests as string[]) ?? []), headSha];
    await this.runRepository.update(
      { id: run.id },
      { cost: { ...cost, issueFixRequests: asked } as any },
    );
  }

  /**
   * Whether the session has a run in flight — the guard every automatic
   * dispatch applies, for fixes that are not a run (`/oc`).
   */
  async hasRunInFlight(sessionId: string): Promise<boolean> {
    return (await this.runRepository.countBlockingRuns(sessionId)) > 0;
  }

  /** Active issue-dispatched builds, for the PR tick to follow (BuilderPullRequestService). */
  async listActiveIssueRuns(): Promise<BuilderBuildRun[]> {
    return (await this.runRepository.listActive()).filter((run) =>
      Boolean(run.issueNumber),
    );
  }

  private async reconcileRun(run: BuilderBuildRun): Promise<void> {
    // An issue build has no Builder runner to look for; the PR tick follows
    // its issue to the pull request instead (reconcileIssueRuns).
    if (run.issueNumber) return;
    if (this.isRepoReview(run)) {
      await this.reconcileRepoReview(run);
      return;
    }
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

  /**
   * One `llm_usage` row per engine invocation.
   *
   * The runner reports `modelUsage` keyed by model id, which is the shape the
   * engine emits when a phase used more than one (a Sonnet coder that spawned a
   * Haiku subagent bills both). One row each, so the store's per-model
   * aggregates stay true rather than attributing a phase's whole spend to the
   * tier that led it.
   */
  private async recordBuildUsage(
    run: BuilderBuildRun,
    cost: {
      phase?: string;
      model?: string;
      modelUsage?: Record<string, any>;
    },
  ): Promise<void> {
    const phase = cost.phase ?? 'build';
    const usage = cost.modelUsage ?? {};

    // Keyed by model id when the engine gives us that; otherwise the one model
    // the phase declared, so a legacy `usage` blob still lands somewhere.
    const perModel = Object.entries(usage).filter(
      ([, value]) => value && typeof value === 'object',
    );
    const entries = perModel.length
      ? perModel
      : cost.model
        ? [[cost.model, usage] as [string, any]]
        : [];

    for (const [model, stats] of entries) {
      const input = Number(stats?.inputTokens ?? stats?.input_tokens ?? 0) || 0;
      const output =
        Number(stats?.outputTokens ?? stats?.output_tokens ?? 0) || 0;
      const cacheRead =
        Number(
          stats?.cacheReadInputTokens ?? stats?.cache_read_input_tokens ?? 0,
        ) || 0;
      const cacheWrite =
        Number(
          stats?.cacheCreationInputTokens ??
            stats?.cache_creation_input_tokens ??
            0,
        ) || 0;

      // A phase that reported nothing measurable is not worth a row.
      if (!input && !output && !cacheRead && !cacheWrite) continue;

      await this.llmUsage.record({
        provider: usageProviderFor(String(model)),
        model: String(model),
        task: LlmTask.BUILDER_BUILD,
        promptTokens: input,
        completionTokens: output,
        totalTokens: input + output,
        // Both counters: with only one, the real spend is unknowable — a cache
        // read and a cache write cost very different amounts.
        cachedTokens: cacheRead,
        cacheCreationTokens: cacheWrite,
        metadata: {
          builderSessionId: run.sessionId,
          builderRunId: run.id,
          phase,
        },
      });
    }
  }

  private async failRun(run: BuilderBuildRun, message: string): Promise<void> {
    await this.settleRun(run, BuilderRunStatus.FAILED, message);
  }

  /** Close a run and move the session with it. */
  /**
   * Give a failed review its pull request back.
   *
   * `dispatchReviewRun` stamps `reviewedSha` BEFORE dispatching, which is
   * correct and load-bearing: reconcile runs every five minutes and would
   * otherwise send a second reviewer at a pull request the first is still
   * reading. But the stamp says "a review was attempted at this commit", and
   * `considerReviewRun` reads it as "this commit has been reviewed".
   *
   * For a run that finished, those are the same thing. For one that failed
   * they are not, and nothing told them apart — so a single failure left the
   * pull request permanently unreviewable: the head never moves again on its
   * own, so `reviewedSha === headSha` holds forever, no second review is ever
   * dispatched, `reviewPassedSha` is never written, and approval and
   * auto-merge both wait on evidence that cannot now arrive. ally-be#503 has
   * sat in exactly that state since 2026-09-17, and migration
   * 1971200000000 records ally-be#494 doing the same thing before it.
   *
   * `reviewRunCount` is deliberately NOT rolled back. It is what bounds this:
   * a pull request still gets at most BUILDER_MAX_REVIEW_RUNS_PER_PR
   * dispatches, so an engine that fails every time costs two runs rather than
   * an endless supply. Clearing the sha buys a retry, not a loop.
   */
  private async releaseReviewClaim(
    run: BuilderBuildRun,
    status: BuilderRunStatus,
  ): Promise<void> {
    if (run.mode !== BuilderRunMode.REVIEW) return;
    if (!run.pullRequestId) return;
    if (
      status !== BuilderRunStatus.FAILED &&
      status !== BuilderRunStatus.TIMED_OUT &&
      status !== BuilderRunStatus.CANCELLED
    )
      return;

    await this.pullRequestRepository.update(
      { id: run.pullRequestId },
      { reviewedSha: null },
    );
    this.logger.info(
      `Review run ${run.id} ${status}; cleared the review claim on its pull request so the next tick can try again.`,
    );
  }

  async settleRun(
    run: BuilderBuildRun,
    status: BuilderRunStatus,
    error: string | null,
  ): Promise<void> {
    const completedAt = new Date();
    // An issue build holds no Builder runner: opencode runs on the target
    // repo's own Actions, and the time from issue to CI verdict is mostly
    // waiting on that repo's CI. Counting it would spend the session's
    // runner-minute ceiling on minutes Builder never used.
    const runnerMinutes = run.issueNumber
      ? null
      : Math.max(
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

    await this.releaseReviewClaim(run, status);

    const session = await this.sessionRepository.findOne({
      where: { id: run.sessionId },
    });
    if (!session) return;

    if (runnerMinutes) {
      await this.sessionRepository.increment(
        { id: session.id },
        'runnerMinutes',
        runnerMinutes,
      );
    }

    // A design run never moves the session, whatever its outcome — like a
    // review, it changes no code, and the session is PRD_READY before and
    // after it. Its outcome belongs to the design, which says whether it
    // reached review or failed getting there.
    if (run.mode === BuilderRunMode.DESIGN) {
      await this.markDesignEnded(session, run.id, status, error);
      return;
    }

    // Only the run's own outcome moves the session; a session already
    // cancelled by a human stays cancelled.
    //
    // The exception is this run correcting itself. A run reports its outcome
    // once — but the runner also reports one, from evidence, after the agent
    // has finished: work pushed with no pull request, a branch that went
    // nowhere. Those arrive second, and the guard above swallowed them, so a
    // run whose agent said "done" settled the session COMPLETED and the
    // runner's truthful "failed" moments later updated only the run row.
    //
    // That is the worst shape this can take: the session reads Done in green,
    // its own latest run reads Failed, no pull request exists, and COMPLETED
    // is deliberately not restartable — so the page offers no way onward from
    // a success that did not happen.
    //
    // Narrow on purpose. Only a FAILED settlement, only from the session's own
    // latest run, and only over a COMPLETED that the same run just set.
    // Evidence may correct a claim; a claim may not overwrite evidence, and
    // nothing here lets an older run reopen a session that has moved on.
    const correctingItsOwnClaim =
      session.status === BuilderSessionStatus.COMPLETED &&
      (status === BuilderRunStatus.FAILED ||
        status === BuilderRunStatus.TIMED_OUT) &&
      (await this.runRepository.isLatestForSession(run.id, session.id));

    if (
      session.status !== BuilderSessionStatus.BUILDING &&
      session.status !== BuilderSessionStatus.WAITING_FOR_INPUT &&
      !correctingItsOwnClaim
    ) {
      return;
    }

    if (correctingItsOwnClaim) {
      this.logger.warn(
        `Builder run ${run.id} reported done and then failed; correcting session ${session.id} back from COMPLETED.`,
      );
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
      durationMs?: number;
      durationApiMs?: number;
      numTurns?: number;
    },
  ): Promise<void> {
    // Re-read: earlier phases of this run have already written their share.
    const current = await this.runRepository.findOne({ where: { id: run.id } });
    if (!current) return;

    const phases: Record<
      string,
      {
        model?: string | null;
        usd: number;
        usage?: Record<string, any> | null;
        durationMs?: number | null;
        durationApiMs?: number | null;
        numTurns?: number | null;
      }
    > = { ...((current.cost?.phases as Record<string, any>) ?? {}) };

    const usd = Number(cost.totalCostUsd ?? 0);
    // A count of zero is real; a missing one is not. `?? null` rather than a
    // `|| 0` fallback, so an older workflow that reports no timings leaves them
    // absent instead of plotting a 0-second phase.
    const positive = (value?: number) =>
      Number.isFinite(Number(value)) && Number(value) >= 0
        ? Number(value)
        : null;
    phases[cost.phase ?? 'build'] = {
      model: cost.model ?? null,
      usd: Number.isFinite(usd) && usd > 0 ? usd : 0,
      usage: cost.modelUsage ?? null,
      durationMs: positive(cost.durationMs),
      durationApiMs: positive(cost.durationApiMs),
      numTurns: positive(cost.numTurns),
    };

    // Into the unified usage store as well. `LlmTask.BUILDER_BUILD` was declared
    // when the module was written and never had a writer, so the coding half —
    // by far the most expensive thing Builder does — was invisible to every
    // cross-service token and cost query, visible only as a dollar figure on a
    // run row. Recorded per phase so planner, coder and verifier are separable.
    //
    // Best-effort by construction: `record` swallows its own errors, and this is
    // deliberately not awaited. Telemetry must never fail a run's billing.
    void this.recordBuildUsage(run, cost);

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
   * Live spend against the session ceiling, for the admin UI. Read live rather
   * than taken from the session detail the page loaded, which is fetched once.
   */
  async getSessionBudget(sessionId: string): Promise<BuilderBudgetState> {
    return this.budgetStateFor(sessionId);
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
      };
    }
    return {
      budgetUsd: budget,
      spentUsd,
      remainingUsd: Math.max(0, budget - spentUsd),
      exceeded: spentUsd >= budget,
    };
  }

  /**
   * Raise (or lower) the session's spend ceiling, at any point in its life.
   *
   * The one refusal is a figure at or below what has already been spent: the
   * next dispatch would be refused straight away, and "raised the budget,
   * nothing happened" is a worse outcome than being told the number is too
   * low.
   */
  async raiseBudget(
    session: BuilderSession,
    userId: number,
    budgetUsd: number,
  ): Promise<BuilderBudgetState> {
    const spent = Number(session.totalCostUsd ?? 0);

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

    return this.budgetStateFor(session.id);
  }

  async getRunOrFail(runId: string): Promise<BuilderBuildRun> {
    const run = await this.runRepository.findOne({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Builder run not found: ${runId}`);
    }
    return run;
  }
}
