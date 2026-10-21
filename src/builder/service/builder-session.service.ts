import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { In, IsNull, MoreThanOrEqual, Not } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import { BuilderMessageRepository } from '../repository/builder-message.repository';
import { BuilderPullRequestRepository } from '../repository/builder-build.repository';
import { BuilderPrdService } from './builder-prd.service';
import {
  BuilderDesignReadiness,
  computeDesignReadiness,
} from '../util/builder-technical-design.util';
import { BuilderReadinessService } from './builder-readiness.service';
import { BuilderPrdReviewService } from './builder-prd-review.service';
import { BuilderSettingsService } from './builder-settings.service';
import { BuilderBuildService } from './builder-build.service';
import {
  BUILDER_ACTIVE_STATUSES,
  BUILDER_ARCHIVABLE_STATUSES,
  BuilderPrdVersionAuthor,
  BuilderSessionStatus,
} from '../enum/builder.enum';
import { BuilderPrdReadiness } from '../type/builder-prd.type';

export type BuilderSessionListItem = BuilderSession & {
  createdByName: string | null;
};
import {
  BUILDER_HANDOFF_CONTEXT_MAX,
  BUILDER_MAX_ACTIVE_SESSIONS_PER_TENANT,
  BUILDER_MAX_SESSIONS_PER_TENANT_PER_MONTH,
  BUILDER_SLUG_MAX_LENGTH,
  BUILDER_TITLE_MAX_LENGTH,
} from '../constants/builder.constants';
import { isBuilderRepo } from '../constants/builder-repos.constants';

/**
 * Session lifecycle and the non-streaming REST around it. The streamed
 * interview turn itself lives in BuilderInterviewOrchestratorService.
 */
@Injectable()
export class BuilderSessionService {
  private readonly logger = LoggerService.getInstance(
    BuilderSessionService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly messageRepository: BuilderMessageRepository,
    private readonly pullRequestRepository: BuilderPullRequestRepository,
    private readonly prdService: BuilderPrdService,
    private readonly settingsService: BuilderSettingsService,
    // Forward-ref'd: the build service reads sessions through repositories
    // only, so this is a one-way edge rather than a cycle. Cancelling has to
    // reach it — a DB-only cancel left the runner burning up to two hours.
    @Inject(forwardRef(() => BuilderBuildService))
    private readonly buildService: BuilderBuildService,
    private readonly readiness: BuilderReadinessService,
    private readonly reviewService: BuilderPrdReviewService,
  ) {}

  /**
   * Has this session's work actually shipped?
   *
   * For callers outside Builder — today the roadmap, which needs to know when
   * an opportunity it handed over has been delivered. Deliberately NOT
   * user-scoped, unlike `getSession`: this is read by a scheduled sweep that
   * has no user, and ownership is not the question being asked.
   *
   * "Shipped" is stricter than "merged". A merged pull request is code on
   * master; `released` on the roadmap is a claim that it reached production,
   * and the two can be hours apart — or never converge, since `failed` means
   * merged but NOT deployed, which is exactly the state a person has to act on.
   * So every pull request must be merged AND every release either `released`
   * or `skipped` — skipped being a repo with no deploy pipeline, where the
   * merge genuinely is the delivery.
   *
   * A session with no pull requests has shipped nothing, whatever its status:
   * a build can complete having decided there was nothing to do.
   */
  async getDeliveryState(sessionId: string): Promise<{
    status: BuilderSessionStatus;
    pullRequestCount: number;
    shipped: boolean;
  } | null> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) return null;

    const pullRequests =
      await this.pullRequestRepository.listBySession(sessionId);
    const delivered = (state?: string | null) =>
      state === 'released' || state === 'skipped';

    return {
      status: session.status,
      pullRequestCount: pullRequests.length,
      shipped:
        pullRequests.length > 0 &&
        pullRequests.every((row) => row.merged && delivered(row.releaseState)),
    };
  }

  async createSession(
    userId: number,
    params: {
      title?: string;
      tenantId?: string | null;
      /** See BuilderSession.handoffContext. Only callers outside Builder pass it. */
      handoffContext?: string | null;
    } = {},
  ): Promise<BuilderSession> {
    if (params.tenantId) {
      await this.assertTenantWithinCaps(params.tenantId);
    }
    const title = (params.title ?? '')
      .trim()
      .slice(0, BUILDER_TITLE_MAX_LENGTH);

    // Stamp the default budget at creation. `defaultBudgetUsd` was documented
    // as "applied to a new session's budgetUsd" and never actually read, so
    // every session ran with no ceiling at all: `assertWithinBudget`
    // short-circuits on a null budget, and the config default had no readers.
    const settings = await this.settingsService.get();
    const budgetUsd =
      settings.defaultBudgetUsd ??
      (this.configService.builder.defaultBudgetUsd
        ? String(this.configService.builder.defaultBudgetUsd)
        : null);

    const session = await this.sessionRepository.save(
      this.sessionRepository.create({
        title: title || 'New build',
        slug: await this.allocateSlug(title),
        tenantId: params.tenantId ?? null,
        budgetUsd,
        handoffContext: this.boundHandoff(params.handoffContext),
        createdBy: userId,
        updatedBy: userId,
      }),
    );
    // Create the PRD up front so the doc panel has something to render on the
    // very first paint rather than after the agent's first patch.
    await this.prdService.getOrCreateDoc(session.id, userId, session.title);
    return session;
  }

  /**
   * Hand a session that already exists the context it would have been created with.
   *
   * For sessions opened before their caller passed any — today, roadmap sessions started
   * before the hand-off existed. Writes only where the column is still NULL, in the UPDATE's
   * own WHERE: the context is frozen once set (see the entity), and two presses racing each
   * other must not have the second replace the first. Resolves true when it wrote.
   */
  async attachHandoffContext(
    sessionId: string,
    handoffContext: string,
  ): Promise<boolean> {
    const text = this.boundHandoff(handoffContext);
    if (!text) return false;
    const result = await this.sessionRepository.update(
      { id: sessionId, handoffContext: IsNull() },
      { handoffContext: text },
    );
    return !!result.affected;
  }

  /**
   * The session's hand-off, or null. A read of its own because the column is `select: false`
   * — every other session read leaves it out, and only the interview turn needs it.
   */
  async getHandoffContext(sessionId: string): Promise<string | null> {
    const row = await this.sessionRepository.findOne({
      where: { id: sessionId },
      select: { id: true, handoffContext: true },
    });
    return row?.handoffContext ?? null;
  }

  private boundHandoff(text?: string | null): string | null {
    const trimmed = (text ?? '').trim();
    return trimmed ? trimmed.slice(0, BUILDER_HANDOFF_CONTEXT_MAX) : null;
  }

  /**
   * A branch-safe, unique slug. Collisions get a numeric suffix rather than a
   * random one so the branch name still reads like the feature it builds.
   */
  private async allocateSlug(title: string): Promise<string> {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, BUILDER_SLUG_MAX_LENGTH - 6) || 'build';

    if (!(await this.sessionRepository.slugExists(base))) {
      return base;
    }
    for (let suffix = 2; suffix < 1000; suffix++) {
      const candidate = `${base}-${suffix}`;
      if (!(await this.sessionRepository.slugExists(candidate))) {
        return candidate;
      }
    }
    // Practically unreachable; better than looping forever.
    return `${base}-${Date.now().toString(36)}`;
  }

  /**
   * Refuse a new session once an org is at either cap. The message names the
   * limit and the way out — "finish or cancel one" is actionable, a bare 429
   * is not. Platform admins (no tenant) are not capped.
   */
  private async assertTenantWithinCaps(tenantId: string): Promise<void> {
    const activeCount = await this.sessionRepository.count({
      where: { tenantId, status: In(BUILDER_ACTIVE_STATUSES) },
    });
    if (activeCount >= BUILDER_MAX_ACTIVE_SESSIONS_PER_TENANT) {
      throw new ForbiddenException(
        `Your organisation already has ${BUILDER_MAX_ACTIVE_SESSIONS_PER_TENANT} Builder sessions open. ` +
          'Finish or cancel one before starting another.',
      );
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthCount = await this.sessionRepository.count({
      where: { tenantId, createdAt: MoreThanOrEqual(monthStart) },
    });
    if (monthCount >= BUILDER_MAX_SESSIONS_PER_TENANT_PER_MONTH) {
      throw new ForbiddenException(
        `Your organisation has reached its limit of ${BUILDER_MAX_SESSIONS_PER_TENANT_PER_MONTH} Builder sessions this month. ` +
          'Contact Ally support if you need a higher limit.',
      );
    }
  }

  /**
   * Sessions are shared by everyone with Builder access (the route-level
   * toggle + VIEW/EDIT_BUILDER gate), not private to their creator: a
   * non-coder's stuck session has to be openable by someone who can debug
   * it, read its runs and logs, and carry it on.
   */
  async getSession(sessionId: string): Promise<BuilderSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Builder session not found');
    }
    return session;
  }

  /**
   * Every non-archived session, newest first — mission control's default
   * list. Unpaginated, unchanged shape: an archive is a separate, paginated
   * view (`listArchivedSessions`), not a param on this one.
   */
  async listSessions(
    params: { statuses?: BuilderSessionStatus[]; createdBy?: number } = {},
  ): Promise<BuilderSessionListItem[]> {
    const { statuses, createdBy } = params;
    const sessions = await this.sessionRepository.find({
      where: {
        ...(createdBy !== undefined ? { createdBy } : {}),
        archivedAt: IsNull(),
        ...(statuses?.length ? { status: In(statuses) } : {}),
      },
      order: { updatedAt: 'DESC' },
    });
    return this.withCreatorNames(sessions);
  }

  /**
   * Archived sessions, newest-archived first, paged. Ordered by
   * `archivedAt` rather than `updatedAt`: unarchiving bumps `updatedAt`, which
   * would otherwise reshuffle this list's order every time something leaves it.
   */
  async listArchivedSessions(params: {
    statuses?: BuilderSessionStatus[];
    /** Narrow to one user's sessions — the feed's "Mine" filter. */
    createdBy?: number;
    limit: number;
    offset: number;
  }): Promise<{ sessions: BuilderSessionListItem[]; totalCount: number }> {
    const [sessions, totalCount] = await this.sessionRepository.findAndCount({
      where: {
        ...(params.createdBy !== undefined
          ? { createdBy: params.createdBy }
          : {}),
        archivedAt: Not(IsNull()),
        ...(params.statuses?.length ? { status: In(params.statuses) } : {}),
      },
      order: { archivedAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
    return { sessions: await this.withCreatorNames(sessions), totalCount };
  }

  /** A shared feed has to say whose session each row is. */
  private async withCreatorNames(
    sessions: BuilderSession[],
  ): Promise<BuilderSessionListItem[]> {
    const names = await this.sessionRepository.findCreatorNames(
      sessions.map((session) => session.createdBy),
    );
    return sessions.map((session) => ({
      ...session,
      createdByName: names.get(session.createdBy) ?? null,
    }));
  }

  /** Session + transcript + PRD + readiness: what the session view resumes from. */
  async getSessionDetail(
    sessionId: string,
    userId: number,
  ): Promise<
    BuilderSession & {
      messages: BuilderMessage[];
      prd: Record<string, any>;
      prdVersionNumber: number;
      readiness: BuilderPrdReadiness;
      /** Whether the technical design can be approved and built from. */
      designReadiness: BuilderDesignReadiness;
      /** For the exported PRD's header only — never part of the build's context. */
      createdByName: string | null;
    }
  > {
    const session = await this.getSession(sessionId);
    const [messages, doc, createdByName] = await Promise.all([
      this.messageRepository.listBySession(sessionId),
      this.prdService.getOrCreateDoc(sessionId, userId),
      this.sessionRepository.findCreatorName(session.createdBy),
    ]);
    const readiness = await this.readiness.assess(sessionId, doc);
    const designReadiness = computeDesignReadiness(doc.draft);
    return {
      ...session,
      createdByName,
      messages,
      prd: doc.draft as unknown as Record<string, any>,
      prdVersionNumber: doc.versionNumber,
      readiness,
      designReadiness,
    };
  }

  /**
   * An admin's direct section edit. Frozen while a build is reading the PRD:
   * a run implements the document it was dispatched with, so an edit landing
   * mid-build would diverge from what is actually being built without anyone
   * being told.
   */
  async patchPrd(
    sessionId: string,
    userId: number,
    ops: any[],
    changeSummary?: string,
  ): Promise<{
    prd: Record<string, any>;
    readiness: BuilderPrdReadiness;
    versionNumber: number;
  }> {
    const session = await this.getSession(sessionId);
    if (
      session.status === BuilderSessionStatus.BUILDING ||
      session.status === BuilderSessionStatus.WAITING_FOR_INPUT
    ) {
      throw new BadRequestException(
        'The PRD is locked while a build is running — it is the source of truth for the run in flight. ' +
          'Cancel the build to edit it.',
      );
    }

    const doc = await this.prdService.getOrCreateDoc(sessionId, userId);
    const { doc: updated } = await this.prdService.applyPatch(
      doc,
      ops,
      userId,
      BuilderPrdVersionAuthor.ADMIN,
      changeSummary,
    );
    // May run the cold reviewer, when this edit is what first makes the PRD
    // read ready or it changes a PRD with findings open — under a timeout
    // short enough for a save a person is waiting on.
    const readiness = await this.readiness.settle(
      sessionId,
      updated,
      'admin_edit',
    );

    // An admin edit can be what tips the PRD over the line (or back under
    // it), so the session status tracks readiness while no build is running.
    await this.syncReadinessStatus(session, readiness);

    return {
      prd: updated.draft as unknown as Record<string, any>,
      readiness,
      versionNumber: updated.versionNumber,
    };
  }

  /**
   * An admin dismisses one of the cold reviewer's findings, with the reason
   * it is wrong. The reason is kept beside the finding — it is the record of
   * where the reviewer misjudged, which the replay eval learns from.
   *
   * Allowed while no build is reading the PRD, like any other PRD change.
   */
  async dismissReviewFinding(
    sessionId: string,
    userId: number,
    findingId: string,
    reason: string,
  ): Promise<{ readiness: BuilderPrdReadiness; status: BuilderSessionStatus }> {
    const session = await this.getSession(sessionId);
    if (
      session.status === BuilderSessionStatus.BUILDING ||
      session.status === BuilderSessionStatus.WAITING_FOR_INPUT
    ) {
      throw new BadRequestException(
        'The PRD is locked while a build is running. Cancel the build to change it.',
      );
    }
    const doc = await this.prdService.getOrCreateDoc(sessionId, userId);
    await this.reviewService.dismiss(doc, findingId, reason, userId, 'admin');
    const readiness = await this.readiness.assess(sessionId, doc);
    const status = await this.syncReadinessStatus(session, readiness);
    return { readiness, status };
  }

  /**
   * Keep INTERVIEWING ⇄ PRD_READY in step with the rubric. Only ever moves
   * between those two: a session mid-build is not re-scored underneath itself.
   */
  async syncReadinessStatus(
    session: BuilderSession,
    readiness: BuilderPrdReadiness,
  ): Promise<BuilderSessionStatus> {
    const eligible =
      session.status === BuilderSessionStatus.INTERVIEWING ||
      session.status === BuilderSessionStatus.PRD_READY;
    if (!eligible) {
      return session.status;
    }
    const next = readiness.ready
      ? BuilderSessionStatus.PRD_READY
      : BuilderSessionStatus.INTERVIEWING;
    if (next !== session.status) {
      // Partial UPDATE, never a full-entity save: the in-memory session was
      // loaded before the orchestrator's atomic lastMessageSeq increment, and
      // saving it whole would wind that counter back and collide the next
      // message append on (sessionId, seq).
      await this.sessionRepository.update({ id: session.id }, { status: next });
      session.status = next;
    }
    return next;
  }

  /** Rename, or set the repo list the interview settled on. */
  async updateSession(
    sessionId: string,
    userId: number,
    changes: {
      title?: string;
      repos?: string[];
      model?: string;
    },
  ): Promise<BuilderSession> {
    const session = await this.getSession(sessionId);
    const patch: Record<string, any> = { updatedBy: userId };

    if (changes.title !== undefined) {
      const title = changes.title.trim().slice(0, BUILDER_TITLE_MAX_LENGTH);
      if (!title) {
        throw new BadRequestException('Title cannot be empty');
      }
      patch.title = title;
    }
    if (changes.repos !== undefined) {
      const unknown = changes.repos.filter((repo) => !isBuilderRepo(repo));
      if (unknown.length) {
        throw new BadRequestException(
          `Not repos Builder can work in: ${unknown.join(', ')}`,
        );
      }
      patch.repos = changes.repos;
    }
    if (changes.model !== undefined) patch.model = changes.model;

    await this.sessionRepository.update({ id: session.id }, patch);
    return this.getSession(sessionId);
  }

  /**
   * Stop a session. In M1 this only settles ally-be's own state; once build
   * runs exist, the build service also best-effort cancels the GitHub run —
   * the DB write lands either way, because the point is to stop the session
   * progressing here, which does not depend on GitHub's cancel succeeding.
   */
  async cancelSession(
    sessionId: string,
    userId: number,
  ): Promise<BuilderSession> {
    const session = await this.getSession(sessionId);
    if (!BUILDER_ACTIVE_STATUSES.includes(session.status)) {
      throw new BadRequestException(
        `This session is already ${session.status.toLowerCase()}.`,
      );
    }
    await this.sessionRepository.update(
      { id: session.id },
      { status: BuilderSessionStatus.CANCELLED, updatedBy: userId },
    );

    // Then stop the thing that is actually running. The DB write above is
    // what the UI reads, so it lands first and unconditionally; this second
    // half is why "cancel" now costs GitHub minutes rather than only looking
    // like it stopped. Without it a cancelled session left its runner working
    // for up to two hours and its questions PENDING against a dead session.
    await this.cancelActiveRun(session.id, userId);

    this.logger.info(
      `Builder session ${sessionId} cancelled by user ${userId}`,
    );
    return this.getSession(sessionId);
  }

  /**
   * Hide a finished session from the caller's default feed. Only ever a list
   * filter — it never touches the PRD, transcript, runs, events, PRs or
   * reports underneath the session. A no-op (not an error) if the session is
   * already archived, so a double-click or a retried request can't fail.
   */
  async archiveSession(
    sessionId: string,
    userId: number,
  ): Promise<BuilderSession> {
    const session = await this.getSession(sessionId);
    if (session.archivedAt) {
      return session;
    }
    if (!BUILDER_ARCHIVABLE_STATUSES.includes(session.status)) {
      throw new BadRequestException(
        `Only COMPLETED, FAILED or CANCELLED sessions can be archived — this one is ${session.status}.`,
      );
    }
    await this.sessionRepository.update(
      { id: session.id },
      { archivedAt: new Date(), updatedBy: userId },
    );
    return this.getSession(sessionId);
  }

  /**
   * Restore an archived session to the default feed. A no-op (not an error)
   * if it is not archived, mirroring `archiveSession`.
   */
  async unarchiveSession(
    sessionId: string,
    userId: number,
  ): Promise<BuilderSession> {
    const session = await this.getSession(sessionId);
    if (!session.archivedAt) {
      return session;
    }
    await this.sessionRepository.update(
      { id: session.id },
      { archivedAt: null, updatedBy: userId },
    );
    return this.getSession(sessionId);
  }

  /**
   * Best-effort cancel of whatever run the session still has in flight.
   *
   * Swallows its own failures: the session is already CANCELLED in the DB, and
   * a GitHub API hiccup must not turn a successful cancel into a 500 for the
   * admin who asked for it. The reconcile pass settles the run row either way.
   */
  private async cancelActiveRun(
    sessionId: string,
    userId: number,
  ): Promise<void> {
    try {
      const run = await this.buildService.findCancellableRun(sessionId);
      if (!run) return;
      await this.buildService.cancelRun(run, userId);
    } catch (error) {
      this.logger.warn(
        `Builder session ${sessionId} was cancelled, but stopping its run failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
