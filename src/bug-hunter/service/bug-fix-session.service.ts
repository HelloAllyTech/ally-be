import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { RoadmapOpportunity } from 'src/product-roadmap/entity/roadmap-opportunity.entity';
import { releaseLinkedRoadmapOpportunity } from '../util/release-linked-roadmap-opportunity.util';

import { BugHunterNotificationService } from './bug-hunter-notification.service';
import {
  findingReleased,
  findingReleaseFailed,
  planCreated,
  planReadyToRelease,
  planReleased,
  planReleaseStopped,
  planStepFailed,
  planStepNeedsAnswer,
} from '../constants/bug-hunter-voice';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHunterService } from './bug-hunter.service';
import { BugFindingService } from './bug-finding.service';
import { GithubActionsService } from './github-actions.service';
import {
  BugHunterRepoClassifierService,
  RepoClassification,
} from './bug-hunter-repo-classifier.service';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import {
  BUG_FINDING_FIX_SESSION_START_STATUSES,
  BugFindingStatus,
  BugHunterMode,
} from '../enum/bug-finding.enum';
import {
  BUG_FIX_SESSION_DEFAULT_REF,
  BUG_FIX_SESSION_DISPATCH_TIMEOUT_MS,
  BUG_FIX_SESSION_REPOS,
  BUG_FIX_SESSION_WORKFLOW_FILE,
  BUG_RELEASE_TIMEOUT_MS,
  resolveReleaseTarget,
} from '../constants/bug-fix-session.constants';

/**
 * The on-demand path: one admin, one bug, one click.
 *
 * Everything else in Bug Hunter is a repo-wide sweep that discovers bugs and
 * then decides what to do with them. This service is the other direction — the
 * bug is already known (usually because a human filed it), and an admin wants
 * it fixed *now* rather than whenever the next sweep runs. It does two things:
 *
 *  - `start` dispatches a Claude Code fix session for exactly one finding.
 *    The session skips Discover and Verify (pointless for a bug someone has
 *    already confirmed) and runs the Fix phase alone, ending at merged.
 *  - `release` takes a merged fix the last mile, dispatching that deployable's
 *    production-release workflow.
 *
 * ## Why those are two buttons and not one
 *
 * The fix half is autonomous: an agent writes a failing regression test, makes
 * it pass, keeps the suite green and merges. The release half deploys to
 * production — for `ally-be` that means running DB migrations against the
 * production database and rolling ECS. Making that second half automatic would
 * put an LLM-authored diff into production with no human between, and the
 * platform's release workflows are `workflow_dispatch`-only today precisely
 * because a person decides. So the split is the product: the agent goes as far
 * as master unattended, and one admin click — recorded in `released_by` —
 * promotes it. That is also the staged-autonomy shape Stacks describes in
 * "Progressive Delegation: Staged Autonomy Growth" and the human gate in
 * "Deployment Gates: Automated and Manual Quality Checks".
 */
@Injectable()
export class BugFixSessionService {
  private readonly logger = LoggerService.getInstance(
    BugFixSessionService.name,
  );

  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly bugFindingService: BugFindingService,
    private readonly bugHunterService: BugHunterService,
    private readonly github: GithubActionsService,
    private readonly notificationService: BugHunterNotificationService,
    private readonly configService: AppConfigService,
    private readonly repoClassifier: BugHunterRepoClassifierService,
    @InjectRepository(RoadmapOpportunity)
    private readonly roadmapOpportunityRepository: Repository<RoadmapOpportunity>,
  ) {}

  // ── start a fix session ──────────────────────────────────────────────────

  /**
   * Dispatches a fix session for one finding.
   *
   * `repoOverride` remains for the pipeline/API surface, but the admin-facing
   * flow no longer supplies it: when a human-reported bug arrives with no
   * repo attached yet, Bug Hunter classifies which codebase it's about itself
   * (`BugHunterRepoClassifierService`) rather than blocking on an admin
   * picking one from a list — see the classifier's own doc for why that
   * guess is safe to make (a validated allowlist, same guardrail as
   * RoadmapAiService.classifyGoal) and BugFindingDrawer for the UI history
   * this replaces. A bug the classifier can't place — too vague, or spans
   * repos — still fails loudly rather than dispatching a guess to the wrong
   * repo.
   */
  async start(
    findingId: string,
    userId: number,
    repoOverride?: string,
  ): Promise<BugFinding> {
    const settings = await this.bugHunterService.getSettings();
    if (settings.mode === BugHunterMode.OFF) {
      throw new ForbiddenException(
        'Bug Hunter is OFF. Switch it to Manual or AI before starting a fix session.',
      );
    }

    const finding = await this.bugFindingService.getOne(findingId);
    if (!BUG_FINDING_FIX_SESSION_START_STATUSES.includes(finding.status)) {
      throw new ForbiddenException(this.explainUnstartable(finding.status));
    }

    let repo = repoOverride ?? finding.repo;
    let classification: RepoClassification | null = null;
    if (!repo) {
      classification = await this.repoClassifier.classifyRepo(
        finding.description,
        finding.evidence,
      );
      repo = classification.repo ?? undefined;
    }

    if (!repo) {
      throw new BadRequestException(
        "I couldn't tell which repo this bug belongs to from its description — it may need more detail, or it may span more than one repo. File it more specifically, or fix it manually.",
      );
    }
    if (!BUG_FIX_SESSION_REPOS.includes(repo as never)) {
      throw new BadRequestException(
        `"${repo}" is not set up for fix sessions. Supported: ${BUG_FIX_SESSION_REPOS.join(', ')}.`,
      );
    }

    if (classification?.repo) {
      await this.bugHunterService.appendFindingEvent({
        findingId: finding.id,
        repo,
        stage: BugHuntEventStage.FINDER_RESULT,
        summary: `Classified this as ${repo} (${classification.rationale || 'no rationale given'}).`,
        payload: { classifiedRepo: repo, rationale: classification.rationale },
      });
    }

    await this.dispatchFix(finding, repo, userId);
    return this.bugFindingService.getOne(finding.id);
  }

  // ── stop a fix session ───────────────────────────────────────────────────

  /**
   * The manual kill switch: an admin watching a session that is clearly stuck
   * or looping stops it themselves rather than waiting out the workflow's
   * `timeout-minutes: 60` cap.
   *
   * Two things happen, and the second must happen even if the first can't:
   *
   *  1. Cancel the actual GitHub Actions run — real compute/token savings,
   *     not just a DB flag. If the reconcile loop hasn't resolved
   *     `sessionRunId` yet (the session was dispatched moments ago), one
   *     best-effort `findRunSince` call tries to resolve it right now rather
   *     than waiting for the next 5-minute tick — same reasoning as
   *     `reconcileQueuedSessions`. If GitHub still can't be reached, or
   *     refuses the cancel (409 for a run that already finished a moment
   *     before the click landed), that failure is logged and swallowed:
   *     the point of this action is to stop the finding progressing further
   *     in OUR pipeline, which does not depend on GitHub's cancel succeeding.
   *  2. Mark the finding CANCELLED, with who and when — the audit trail a
   *     human override always needs (see `releasedBy`/`releasedAt` for the
   *     same pattern on the release gate). Distinct from FAILED so the table
   *     reads "a human stopped this" rather than "the agent gave up".
   *
   * Nothing else needs to be told to stop watching this finding: the
   * escalation-answer poll and every reconcile pass are keyed off status
   * (QUEUED/FIXING/NEEDS_INPUT), so a status that has moved to CANCELLED
   * simply stops matching those queries on the very next read — see
   * `reconcileQueuedSessions`/`reconcilePrOpenedFindings`'s `WHERE status =`
   * filters and `advancePlans`'s stuck-step check for a cancelled child.
   */
  async cancelFixSession(
    findingId: string,
    actorUserId: number,
  ): Promise<BugFinding> {
    const finding = await this.bugFindingService.getOne(findingId);
    if (
      finding.status !== BugFindingStatus.QUEUED &&
      finding.status !== BugFindingStatus.FIXING
    ) {
      throw new ForbiddenException(
        `Finding ${findingId} is ${finding.status} — only a queued or in-progress fix session can be stopped.`,
      );
    }

    let runId = finding.sessionRunId ?? null;
    if (!runId && finding.repo && finding.dispatchedAt) {
      const run = await this.github.findRunSince({
        repo: finding.repo,
        workflow: BUG_FIX_SESSION_WORKFLOW_FILE,
        since: finding.dispatchedAt,
      });
      if (run) runId = run.id;
    }

    if (runId && finding.repo) {
      try {
        await this.github.cancelRun(finding.repo, runId);
      } catch (error) {
        this.logger.warn(
          `Could not cancel GitHub Actions run ${runId} for finding ${findingId} — marking it cancelled locally regardless: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await this.findingRepository.update(findingId, {
      status: BugFindingStatus.CANCELLED,
      sessionRunId: runId,
      cancelledBy: actorUserId,
      cancelledAt: new Date(),
    });
    await this.bugHunterService.appendFindingEvent({
      findingId,
      repo: finding.repo,
      stage: BugHuntEventStage.CANCELLED,
      summary: `Fix session cancelled by user ${actorUserId}.`,
      payload: { cancelledBy: actorUserId, runId },
    });
    return this.bugFindingService.getOne(findingId);
  }

  /**
   * Opens a run and dispatches a fix session for one finding in one repo.
   *
   * Shared by the admin's own "Start fix session" and by the orchestrator
   * starting the next step of a plan — `startedBy` is the user id in the first
   * case and null in the second, which is the only difference between them and
   * shows up only in the event summary.
   */
  private async dispatchFix(
    finding: BugFinding,
    repo: string,
    startedBy: number | null,
  ): Promise<void> {
    // The run row exists before the dispatch so the workflow has a run id to
    // report every step against from its very first call — and so a dispatch
    // that fails still leaves a visible, closed-out record of the attempt
    // rather than nothing at all.
    const run = await this.bugHunterService.startRun(
      BugHuntTrigger.FIX_SESSION,
      repo,
    );

    let dispatchedAt: Date;
    try {
      dispatchedAt = await this.github.dispatchWorkflow({
        repo,
        workflow: BUG_FIX_SESSION_WORKFLOW_FILE,
        ref: BUG_FIX_SESSION_DEFAULT_REF,
        inputs: {
          finding_id: finding.id,
          run_id: run.id,
          repo,
          api_base_url: this.configService.publicApiBaseUrl,
        },
      });
    } catch (error) {
      await this.bugHunterService.closeRun(
        run.id,
        BugHuntRunStatus.FAILED,
        {
          foundCount: 0,
          autoMergedCount: 0,
          prOpenedCount: 0,
          dismissedCount: 0,
        },
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    await this.findingRepository.update(finding.id, {
      status: BugFindingStatus.QUEUED,
      runId: run.id,
      repo,
      dispatchedAt,
      sessionRunUrl: null,
      sessionRunId: null,
    });
    await this.bugHunterService.appendEvent({
      runId: run.id,
      repo,
      findingId: finding.id,
      stage: startedBy
        ? BugHuntEventStage.SESSION_DISPATCHED
        : BugHuntEventStage.STEP_STARTED,
      summary: startedBy
        ? `Fix session started by user ${startedBy} for "${finding.title}".`
        : `Step ${(finding.stepIndex ?? 0) + 1} of the plan started in ${repo}.`,
      payload: { startedBy, repo, workflow: BUG_FIX_SESSION_WORKFLOW_FILE },
    });
  }

  // ── coordinated multi-repo plans ─────────────────────────────────────────

  /**
   * Turns a fix agent's "this spans more than one repo" report into a plan Bug
   * Hunter drives itself.
   *
   * The shape is planner-executor (Stacks: "Planner-Executor Agent
   * Architecture"): the first session is the planner — it has already read the
   * bug and one codebase and is best placed to say what has to change where —
   * and each child is an executor with a single repo and a single job. Keeping
   * the plan as rows rather than in one long-lived agent is what makes it
   * inspectable and resumable: you can see which step failed, and a step can
   * be retried on its own.
   *
   * **The order is the contract.** Steps run one at a time and release in the
   * same order, because a frontend live before the backend field it reads is
   * precisely the production break this feature exists to avoid. The planner
   * is told to order by dependency, not convenience.
   *
   * Idempotent: a workflow that retries this call gets the existing plan back
   * rather than a second set of children.
   */
  async recordPlan(
    findingId: string,
    steps: { repo: string; summary: string }[],
  ): Promise<BugFinding[]> {
    const parent = await this.bugFindingService.getOne(findingId);

    const existing = await this.findingRepository.listChildren(parent.id);
    if (existing.length) return existing;

    if (steps.length < 2) {
      throw new BadRequestException(
        'A plan needs at least two steps — a single-repo fix does not need one.',
      );
    }
    const unsupported = steps.find(
      (step) => !BUG_FIX_SESSION_REPOS.includes(step.repo as never),
    );
    if (unsupported) {
      throw new BadRequestException(
        `"${unsupported.repo}" is not set up for fix sessions. Supported: ${BUG_FIX_SESSION_REPOS.join(', ')}.`,
      );
    }

    const children: BugFinding[] = [];
    for (const [index, step] of steps.entries()) {
      children.push(
        await this.findingRepository.save(
          this.findingRepository.create({
            parentFindingId: parent.id,
            stepIndex: index,
            stepSummary: step.summary,
            repo: step.repo,
            source: parent.source,
            title: `${parent.title} — ${step.repo}`,
            description: `${step.summary}\n\nPart of: ${parent.description}`,
            evidence: parent.evidence,
            severity: parent.severity,
            proven: parent.proven,
            // Re-judged per repo by that step's own agent; inheriting the
            // parent's flag would let a backend-only guarded path block an
            // unrelated frontend step from merging.
            touchesGuardedPath: false,
            // Only the first step runs now; the rest wait their turn.
            status:
              index === 0 ? BugFindingStatus.NEW : BugFindingStatus.BLOCKED,
          }),
        ),
      );
    }

    await this.findingRepository.update(parent.id, {
      status: BugFindingStatus.COORDINATING,
    });
    await this.bugHunterService.appendFindingEvent({
      findingId: parent.id,
      repo: parent.repo,
      stage: BugHuntEventStage.PLAN_CREATED,
      summary: `Needs ${steps.length} repos: ${steps.map((s) => s.repo).join(' → ')}.`,
      payload: { steps },
    });
    await this.notificationService.notify({
      level: BugHunterNotificationLevel.INFO,
      ...planCreated(
        parent.title,
        steps.map((s) => s.repo),
      ),
      findingId: parent.id,
      repo: parent.repo,
    });

    await this.dispatchFix(children[0], children[0].repo!, null);
    return this.findingRepository.listChildren(parent.id);
  }

  // ── release to production ────────────────────────────────────────────────

  /**
   * Dispatches the production release for a merged fix.
   *
   * The version is always the next PATCH on whatever tag is currently newest
   * on the remote — never a stored counter. Every one of these release
   * workflows rejects a tag that isn't strictly newer than the latest existing
   * one, so anything derived from local state would break the first time
   * somebody cut a release by hand.
   */
  async release(findingId: string, userId: number): Promise<BugFinding> {
    const finding = await this.bugFindingService.getOne(findingId);
    if (
      finding.status !== BugFindingStatus.MERGED &&
      finding.status !== BugFindingStatus.RELEASE_FAILED
    ) {
      throw new ForbiddenException(
        finding.status === BugFindingStatus.RELEASING
          ? 'A release for this fix is already running.'
          : finding.status === BugFindingStatus.RELEASED
            ? 'This fix is already released to production.'
            : `Only a merged fix can be released — this one is ${finding.status}.`,
      );
    }

    const children = await this.findingRepository.listChildren(finding.id);

    // A coordinated fix releases as a sequence, from one click: this dispatches
    // step 1 only, and the reconcile task starts each later step once the one
    // before it is green in production. Ordering is the whole reason the plan
    // exists — a frontend deployed before the backend field it reads is the
    // break this is designed to prevent — so the steps are never fired
    // together, however much faster that would be.
    if (children.length) {
      const first = children.find(
        (child) => child.status !== BugFindingStatus.RELEASED,
      );
      if (!first) {
        throw new ForbiddenException('Every step is already released.');
      }
      await this.findingRepository.update(finding.id, {
        status: BugFindingStatus.RELEASING,
        releasedBy: userId,
        releasedAt: null,
      });
      await this.dispatchRelease(first, userId);
      return this.bugFindingService.getOne(finding.id);
    }

    await this.dispatchRelease(finding, userId);
    return this.bugFindingService.getOne(finding.id);
  }

  /** Dispatches the production release for one deployable — a standalone finding, or one step of a plan. */
  private async dispatchRelease(
    finding: BugFinding,
    userId: number,
  ): Promise<void> {
    const target = resolveReleaseTarget(finding.repo, finding.file);
    if (!target) {
      throw new BadRequestException(this.explainUnreleasable(finding));
    }

    const releaseTag = await this.github.nextPatchTag(
      target.repo,
      target.tagPrefix,
    );
    const dispatchedAt = await this.github.dispatchWorkflow({
      repo: target.repo,
      workflow: target.workflow,
      ref: BUG_FIX_SESSION_DEFAULT_REF,
      inputs: { version_tag: releaseTag },
    });

    await this.findingRepository.update(finding.id, {
      status: BugFindingStatus.RELEASING,
      releaseTag,
      releaseRunId: null,
      releaseRunUrl: null,
      releasedBy: userId,
      releasedAt: null,
      dispatchedAt,
    });
    await this.bugHunterService.appendFindingEvent({
      findingId: finding.id,
      repo: finding.repo,
      stage: BugHuntEventStage.RELEASE_DISPATCHED,
      summary: `Release ${releaseTag} of ${target.label} dispatched by user ${userId}.`,
      payload: { userId, releaseTag, workflow: target.workflow },
    });
  }

  /**
   * Whether the "Release to production" button should be offered, and if not,
   * why — so the drawer can explain rather than just hide a control the admin
   * is looking for.
   */
  async releasability(finding: BugFinding): Promise<{
    releasable: boolean;
    target: string | null;
    reason: string | null;
  }> {
    if (
      finding.status !== BugFindingStatus.MERGED &&
      finding.status !== BugFindingStatus.RELEASE_FAILED
    ) {
      return { releasable: false, target: null, reason: null };
    }
    if (!this.github.isConfigured) {
      return {
        releasable: false,
        target: null,
        reason:
          'Releases are not configured on this environment (no GitHub token).',
      };
    }

    // A coordinated fix is releasable only if EVERY step is, and the confirm
    // dialog names the whole sequence — an admin approving this is approving
    // several production deploys, not one, and should see that before they
    // click.
    const steps = await this.findingRepository.listChildren(finding.id);
    if (steps.length) {
      const targets = steps.map((step) => ({
        step,
        target: resolveReleaseTarget(step.repo, step.file),
      }));
      const unmappable = targets.find((entry) => !entry.target);
      if (unmappable) {
        return {
          releasable: false,
          target: null,
          reason: `Step ${(unmappable.step.stepIndex ?? 0) + 1}: ${this.explainUnreleasable(unmappable.step)}`,
        };
      }
      const pending = targets.filter(
        (entry) => entry.step.status !== BugFindingStatus.RELEASED,
      );
      return {
        releasable: true,
        target: pending.map((entry) => entry.target!.label).join(' → '),
        reason: null,
      };
    }

    const target = resolveReleaseTarget(finding.repo, finding.file);
    return target
      ? { releasable: true, target: target.label, reason: null }
      : {
          releasable: false,
          target: null,
          reason: this.explainUnreleasable(finding),
        };
  }

  // ── reconcile (scheduled) ────────────────────────────────────────────────

  /**
   * Closes the loop on both dispatches, since neither tells us anything at the
   * moment it is made: `workflow_dispatch` returns 204 with no run id.
   *
   * Runs on the 5-minute tick. Everything it does is idempotent and derived
   * from GitHub's own state, so a missed tick or a double-run costs nothing.
   */
  async reconcile(): Promise<void> {
    if (!this.github.isConfigured) return;
    await this.reconcileQueuedSessions();
    await this.reconcilePrOpenedFindings();
    await this.reconcileReleases();
    // Order matters: the three passes above settle each step's own status from
    // GitHub, and these two then read those settled statuses to decide what to
    // start next. Running them first would advance a plan on stale state.
    await this.advancePlans();
    await this.advanceReleaseSequences();
  }

  /**
   * Drives each coordinated fix through its plan: when the current step is
   * merged, start the next one; when they are all merged, the parent becomes
   * releasable; when one gets stuck, the whole plan stops there.
   *
   * Stopping the plan on a stuck step is deliberate. The steps are ordered by
   * dependency, so carrying on past a failed one would build the later repos
   * against something that never landed.
   */
  private async advancePlans(): Promise<void> {
    const parents = await this.findingRepository.listCoordinatingParents();

    for (const parent of parents) {
      try {
        const steps = await this.findingRepository.listChildren(parent.id);
        if (!steps.length) continue;

        const stuck = steps.find(
          (step) =>
            step.status === BugFindingStatus.FAILED ||
            step.status === BugFindingStatus.NEEDS_INPUT ||
            step.status === BugFindingStatus.DISMISSED ||
            // An admin cancelling one step must stop the whole plan here —
            // without this, the next tick would read the cancelled step as
            // neither stuck nor in-flight and dispatch the step after it,
            // silently overriding the cancellation.
            step.status === BugFindingStatus.CANCELLED,
        );
        if (stuck) {
          await this.haltPlan(parent, stuck);
          continue;
        }

        if (steps.every((step) => step.status === BugFindingStatus.MERGED)) {
          await this.findingRepository.update(parent.id, {
            status: BugFindingStatus.MERGED,
          });
          await this.releaseLinkedRoadmapOpportunity(parent);
          await this.notificationService.notify({
            level: BugHunterNotificationLevel.ACTION_NEEDED,
            ...planReadyToRelease(
              parent.title,
              steps.map((s) => s.repo),
            ),
            findingId: parent.id,
            repo: parent.repo,
          });
          continue;
        }

        // Nothing in flight but not finished either: the step before is merged,
        // so the next blocked one is now unblocked.
        const inFlight = steps.some((step) =>
          [
            BugFindingStatus.QUEUED,
            BugFindingStatus.FIXING,
            BugFindingStatus.PR_OPENED,
          ].includes(step.status),
        );
        if (inFlight) continue;

        const next = steps.find(
          (step) => step.status === BugFindingStatus.BLOCKED,
        );
        if (next?.repo) await this.dispatchFix(next, next.repo, null);
      } catch (error) {
        this.logger.warn(
          `Could not advance plan for finding ${parent.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** A plan that cannot continue: the parent takes on the stuck step's meaning and the admin is told which step and why. */
  private async haltPlan(parent: BugFinding, stuck: BugFinding): Promise<void> {
    const needsAnswer = stuck.status === BugFindingStatus.NEEDS_INPUT;
    const cancelled = stuck.status === BugFindingStatus.CANCELLED;
    await this.findingRepository.update(parent.id, {
      status: needsAnswer
        ? BugFindingStatus.NEEDS_INPUT
        : cancelled
          ? BugFindingStatus.CANCELLED
          : BugFindingStatus.FAILED,
      escalationQuestion: stuck.escalationQuestion ?? parent.escalationQuestion,
    });

    // A cancelled step was a deliberate admin action, not something to alert
    // the same admin about — record it in the timeline and stay quiet, unlike
    // the other two halts which raise an inbox notification.
    if (cancelled) {
      await this.bugHunterService.appendFindingEvent({
        findingId: parent.id,
        repo: stuck.repo,
        stage: BugHuntEventStage.CANCELLED,
        summary: `Step ${(stuck.stepIndex ?? 0) + 1} (${stuck.repo}) was cancelled — the plan stops here.`,
        payload: { cancelledStepId: stuck.id, cancelledBy: stuck.cancelledBy },
      });
      return;
    }

    await this.notificationService.notify({
      level: needsAnswer
        ? BugHunterNotificationLevel.ACTION_NEEDED
        : BugHunterNotificationLevel.PROBLEM,
      ...(needsAnswer
        ? planStepNeedsAnswer(
            parent.title,
            stuck.stepIndex,
            stuck.repo,
            stuck.escalationQuestion,
          )
        : planStepFailed(parent.title, stuck.stepIndex, stuck.repo)),
      findingId: parent.id,
      repo: stuck.repo,
    });
  }

  /**
   * Walks a coordinated fix's releases, one repo at a time, only starting each
   * once the one before it is green in production.
   *
   * A red step stops the sequence where it is. That leaves the plan
   * half-deployed, which sounds bad and is in fact the safe outcome: the steps
   * are ordered so that everything already live works without what follows it.
   */
  private async advanceReleaseSequences(): Promise<void> {
    const parents = await this.findingRepository.listReleasingParents();

    for (const parent of parents) {
      try {
        const steps = await this.findingRepository.listChildren(parent.id);
        if (!steps.length) continue;

        const failed = steps.find(
          (step) => step.status === BugFindingStatus.RELEASE_FAILED,
        );
        if (failed) {
          await this.findingRepository.update(parent.id, {
            status: BugFindingStatus.RELEASE_FAILED,
          });
          await this.notificationService.notify({
            level: BugHunterNotificationLevel.PROBLEM,
            ...planReleaseStopped(parent.title, failed.stepIndex, failed.repo),
            findingId: parent.id,
            repo: failed.repo,
          });
          continue;
        }

        if (steps.some((step) => step.status === BugFindingStatus.RELEASING)) {
          continue;
        }

        const next = steps.find(
          (step) => step.status !== BugFindingStatus.RELEASED,
        );
        if (next) {
          await this.dispatchRelease(next, parent.releasedBy ?? 0);
          continue;
        }

        await this.findingRepository.update(parent.id, {
          status: BugFindingStatus.RELEASED,
          releasedAt: new Date(),
        });
        await this.notificationService.notify({
          level: BugHunterNotificationLevel.INFO,
          ...planReleased(parent.title, steps),
          findingId: parent.id,
          repo: parent.repo,
        });
      } catch (error) {
        this.logger.warn(
          `Could not advance release sequence for finding ${parent.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * QUEUED means dispatched-but-not-yet-heard-from. Two jobs: attach the run
   * URL once GitHub registers the run (so the drawer can link to it), and
   * time out a session that never reported in at all — a runner that died on
   * boot would otherwise leave the finding QUEUED forever, looking to an
   * admin exactly like one that is still working.
   */
  private async reconcileQueuedSessions(): Promise<void> {
    const queued = await this.findingRepository.find({
      where: { status: BugFindingStatus.QUEUED },
    });

    for (const finding of queued) {
      try {
        if (!finding.sessionRunUrl && finding.repo && finding.dispatchedAt) {
          const run = await this.github.findRunSince({
            repo: finding.repo,
            workflow: BUG_FIX_SESSION_WORKFLOW_FILE,
            since: finding.dispatchedAt,
          });
          if (run) {
            await this.findingRepository.update(finding.id, {
              sessionRunUrl: run.htmlUrl,
              sessionRunId: run.id,
            });
          }
        }

        const age = finding.dispatchedAt
          ? Date.now() - finding.dispatchedAt.getTime()
          : Number.POSITIVE_INFINITY;
        if (age <= BUG_FIX_SESSION_DISPATCH_TIMEOUT_MS) continue;

        await this.findingRepository.update(finding.id, {
          status: BugFindingStatus.FAILED,
        });
        await this.bugHunterService.appendFindingEvent({
          findingId: finding.id,
          repo: finding.repo,
          stage: BugHuntEventStage.ERROR,
          summary:
            'The fix session was dispatched but never reported in. Marked failed — start a new session to retry.',
          payload: { dispatchedAt: finding.dispatchedAt },
        });
      } catch (error) {
        // One stuck finding must never stop the rest of the tick.
        this.logger.warn(
          `Could not reconcile queued fix session ${finding.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * PR_OPENED → MERGED, read from the PR's own merge state.
   *
   * `pr_opened` is written once, self-reported by the fix agent the moment it
   * decides a guarded-path diff needs human review rather than merging it
   * itself (see `bug-fix-prompt.ts`'s Fix step). Nothing else ever asks GitHub
   * again after that — so a PR a human later merges by hand, through GitHub's
   * own review UI rather than the agent's `gh pr merge --admin`, stays stuck
   * here forever without this pass.
   */
  private async reconcilePrOpenedFindings(): Promise<void> {
    const opened = await this.findingRepository.find({
      where: { status: BugFindingStatus.PR_OPENED },
    });

    for (const finding of opened) {
      try {
        const prNumber = finding.prUrl
          ? BugFixSessionService.prNumberFrom(finding.prUrl)
          : null;
        if (!finding.repo || !prNumber) continue;

        const pr = await this.github.getPullRequest(finding.repo, prNumber);
        if (!pr?.merged) continue;

        await this.findingRepository.update(finding.id, {
          status: BugFindingStatus.MERGED,
        });
        await this.releaseLinkedRoadmapOpportunity(finding);
        await this.bugHunterService.appendFindingEvent({
          findingId: finding.id,
          repo: finding.repo,
          stage: BugHuntEventStage.MERGED,
          summary: `${finding.prUrl} was merged.`,
          payload: { prUrl: finding.prUrl, mergedAt: pr.mergedAt },
        });
      } catch (error) {
        this.logger.warn(
          `Could not reconcile PR status for finding ${finding.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * The two routes to MERGED this service owns — a plan's last step landing,
   * and the reconcile pass spotting a hand-merged PR — both write the status
   * straight through `findingRepository`, so neither passes the third and most
   * common route, `BugFindingService.setStatus`. All three share one
   * implementation (see the util's own doc) precisely so a card can't be closed
   * on some merge paths and not others.
   */
  private releaseLinkedRoadmapOpportunity(finding: BugFinding): Promise<void> {
    return releaseLinkedRoadmapOpportunity(
      this.roadmapOpportunityRepository,
      finding,
      this.logger,
    );
  }

  /** Pulls the PR number out of a GitHub PR URL — `.../pull/123` → `123`. */
  private static prNumberFrom(prUrl: string): number | null {
    const match = /\/pull\/(\d+)/.exec(prUrl);
    return match ? Number(match[1]) : null;
  }

  /** RELEASING → RELEASED / RELEASE_FAILED, read from the GitHub run's own conclusion. */
  private async reconcileReleases(): Promise<void> {
    const releasing = await this.findingRepository.find({
      where: { status: BugFindingStatus.RELEASING },
    });

    for (const finding of releasing) {
      try {
        const target = resolveReleaseTarget(finding.repo, finding.file);
        if (!target) continue;

        let runId = finding.releaseRunId;
        if (!runId && finding.dispatchedAt) {
          const found = await this.github.findRunSince({
            repo: target.repo,
            workflow: target.workflow,
            since: finding.dispatchedAt,
          });
          if (found) {
            runId = found.id;
            await this.findingRepository.update(finding.id, {
              releaseRunId: found.id,
              releaseRunUrl: found.htmlUrl,
            });
          }
        }

        const run = runId ? await this.github.getRun(target.repo, runId) : null;

        if (run?.status === 'completed') {
          await this.settleRelease(
            finding,
            run.conclusion === 'success',
            run.htmlUrl,
            run.conclusion,
          );
          continue;
        }

        // Still running, or we never managed to identify the run. Either way,
        // stop waiting once the window is past — an unresolved release is
        // reported as failed rather than left mid-flight, because "merged but
        // not deployed" is the state an admin must act on.
        const age = finding.dispatchedAt
          ? Date.now() - finding.dispatchedAt.getTime()
          : Number.POSITIVE_INFINITY;
        if (age > BUG_RELEASE_TIMEOUT_MS) {
          await this.settleRelease(
            finding,
            false,
            finding.releaseRunUrl,
            run ? 'timed out' : 'no matching GitHub Actions run found',
          );
        }
      } catch (error) {
        this.logger.warn(
          `Could not reconcile release for finding ${finding.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async settleRelease(
    finding: BugFinding,
    succeeded: boolean,
    runUrl: string | null | undefined,
    detail: string | null,
  ): Promise<void> {
    await this.findingRepository.update(finding.id, {
      status: succeeded
        ? BugFindingStatus.RELEASED
        : BugFindingStatus.RELEASE_FAILED,
      ...(succeeded ? { releasedAt: new Date() } : {}),
      ...(runUrl ? { releaseRunUrl: runUrl } : {}),
    });
    await this.bugHunterService.appendFindingEvent({
      findingId: finding.id,
      repo: finding.repo,
      stage: succeeded
        ? BugHuntEventStage.RELEASED
        : BugHuntEventStage.RELEASE_FAILED,
      summary: succeeded
        ? `Released to production as ${finding.releaseTag}.`
        : `Release ${finding.releaseTag} failed (${detail ?? 'unknown'}). The fix is merged to master but is NOT deployed.`,
      payload: { releaseTag: finding.releaseTag, runUrl, detail },
    });
    // A step inside a plan stays quiet: advanceReleaseSequences speaks once for
    // the whole sequence, and one notification per repo would bury that.
    if (finding.parentFindingId) return;

    await this.notificationService.notify({
      level: succeeded
        ? BugHunterNotificationLevel.INFO
        : BugHunterNotificationLevel.PROBLEM,
      ...(succeeded
        ? findingReleased(finding.title, finding.releaseTag, finding.repo)
        : findingReleaseFailed(
            finding.title,
            finding.releaseTag,
            finding.repo,
            detail ?? null,
          )),
      findingId: finding.id,
      repo: finding.repo,
    });
  }

  // ── message helpers ──────────────────────────────────────────────────────

  private explainUnstartable(status: BugFindingStatus): string {
    switch (status) {
      case BugFindingStatus.QUEUED:
      case BugFindingStatus.FIXING:
        return 'A fix session is already running for this bug.';
      case BugFindingStatus.MERGED:
      case BugFindingStatus.RELEASING:
      case BugFindingStatus.RELEASED:
        return 'This bug is already fixed — releasing it is the next step, not fixing it again.';
      case BugFindingStatus.RELEASE_FAILED:
        return 'The fix is merged; only its release failed. Retry the release rather than starting a new fix session.';
      case BugFindingStatus.DISMISSED:
      case BugFindingStatus.REJECTED:
        return `This bug was ${status} — reopen it before starting a fix session.`;
      default:
        return `Can't start a fix session from status ${status}.`;
    }
  }

  private explainUnreleasable(finding: BugFinding): string {
    if (finding.repo === 'ally-web') {
      return (
        'This fix could not be matched to one of the three ally-web apps ' +
        `(file: ${finding.file ?? 'unknown'}). A change in libs/ ships in all ` +
        'three, so release each affected app manually from GitHub Actions.'
      );
    }
    if (finding.repo === 'ally-mobile') {
      return 'ally-mobile releases through App Store / Play Store builds, which cannot be dispatched from here.';
    }
    return `No production-release workflow is configured for "${finding.repo ?? 'unknown repo'}".`;
  }
}
