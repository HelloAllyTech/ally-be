import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { In } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { TrackItemType } from 'src/track/type/track.type';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import { CourseCopilotJob } from '../entity/course-copilot-job.entity';
import {
  COURSE_COPILOT_SETTLED_JOB_STATUSES,
  CourseCopilotEventType,
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
  CourseCopilotMode,
  CourseCopilotSessionStatus,
} from '../enum/course-copilot.enum';
import {
  CourseCopilotJobRepository,
  CourseCopilotSessionRepository,
} from '../repository/course-copilot.repository';
import {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBrief,
  CourseCopilotJobResult,
} from '../type/course-copilot.type';
import {
  COURSE_COPILOT_BUILD_LOCK_PREFIX,
  COURSE_COPILOT_DEFAULT_CONCURRENCY,
  COURSE_COPILOT_JOB_HEARTBEAT_MS,
  COURSE_COPILOT_JOB_MAX_ATTEMPTS,
  COURSE_COPILOT_JOB_STALE_MS,
} from '../constants/course-copilot.constants';
import { SpecialistValidationError } from './specialists/specialist.types';
import { CourseCopilotJobSkip } from './course-copilot-media.service';
import { CourseCopilotCostService } from './course-copilot-cost.service';
import {
  COURSE_COPILOT_ANALYTICS_EVENTS,
  CourseCopilotAnalyticsService,
} from './course-copilot-analytics.service';
import { CourseCopilotEventService } from './course-copilot-event.service';
import { CourseCopilotJobExecutorService } from './course-copilot-job-executor.service';
import {
  CourseCopilotStructureService,
  ITEM_JOB_KINDS,
} from './course-copilot-structure.service';

const BUILD_LOCK_TTL_SECONDS = 120;

/** Generated fine, but could not be put into the course. Not retried. */
export class CourseCopilotPlacementError extends Error {
  constructor(message: string) {
    super(`Could not add it to the course: ${message}`);
    this.name = 'CourseCopilotPlacementError';
  }
}
const IDLE_POLL_MS = 1_000;

/** The job kind that realises a blueprint item. */
export function jobKindForItem(
  item: CourseBlueprintItem,
): CourseCopilotJobKind {
  const fromLibrary = item.source?.kind === 'library';
  switch (item.type) {
    case TrackItemType.ARTICLE:
      return CourseCopilotJobKind.ARTICLE;
    case TrackItemType.QUIZ:
      return CourseCopilotJobKind.QUIZ;
    case TrackItemType.JOURNAL:
      return CourseCopilotJobKind.JOURNAL;
    case TrackItemType.ANNOTATED_ARTIFACT:
      return CourseCopilotJobKind.ANNOTATED_ARTIFACT;
    case TrackItemType.GAME:
      return CourseCopilotJobKind.GAME;
    case TrackItemType.VIDEO:
      return CourseCopilotJobKind.VIDEO;
    case TrackItemType.ROLEPLAY:
      return fromLibrary
        ? CourseCopilotJobKind.ROLEPLAY_REF
        : CourseCopilotJobKind.ROLEPLAY_NEW;
    case TrackItemType.CASE:
      return fromLibrary
        ? CourseCopilotJobKind.CASE_REF
        : CourseCopilotJobKind.CASE_NEW;
    default:
      throw new Error(`No job kind for item type ${item.type}`);
  }
}

/** Roleplays first: they are the long pole, so they should start earliest. */
const KIND_PRIORITY: Partial<Record<CourseCopilotJobKind, number>> = {
  [CourseCopilotJobKind.ROLEPLAY_NEW]: 0,
  [CourseCopilotJobKind.COVER_IMAGE]: 1,
  [CourseCopilotJobKind.COURSE_META]: 1,
};

/**
 * The background build: a dependency graph of jobs run with bounded
 * concurrency, resumable across deploys.
 *
 * ## Why it survives a deploy
 * ECS replaces tasks mid-build and in-flight work is dropped. Everything the
 * runner knows is in `course_copilot_jobs`: a job claims itself with a
 * conditional UPDATE, beats a heartbeat while it runs, and writes its result
 * in the statement that marks it done. The five-minute reconcile resumes a
 * build with queued work and no runner, and fails a running job whose
 * heartbeat has gone quiet (keeping its attempt count so a retry still works).
 * A Redis lock keeps one runner per session across tasks; the job claim makes
 * an overlap harmless anyway.
 *
 * ## Failure policy
 * A job gets two attempts. A validator rejection is retried with the
 * validator's own errors fed back to the specialist (the "repair pass"); any
 * other error is retried as-is. A job whose dependency did not finish is
 * skipped, never failed — the failure is reported once, on the job that
 * actually failed. Nothing already generated is lost when a job fails.
 */
@Injectable()
export class CourseCopilotBuildService implements OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotBuildService.name,
  );
  private readonly runners = new Map<string, Promise<void>>();
  private stopping = false;

  constructor(
    private readonly configService: AppConfigService,
    private readonly redis: RedisService,
    private readonly sessionRepository: CourseCopilotSessionRepository,
    private readonly jobRepository: CourseCopilotJobRepository,
    private readonly structureService: CourseCopilotStructureService,
    private readonly executor: CourseCopilotJobExecutorService,
    private readonly costService: CourseCopilotCostService,
    private readonly eventService: CourseCopilotEventService,
    @Optional() private readonly analytics?: CourseCopilotAnalyticsService,
  ) {}

  onModuleDestroy() {
    this.stopping = true;
  }

  // ── Job graph ────────────────────────────────────────────────────────────

  /**
   * One job per blueprint item, plus course meta, the cover and the reviewer.
   * Dependencies: a new case waits for its member roleplays; an article image
   * waits for its article. The reviewer has none — it runs once everything
   * else has settled.
   */
  async createJobsForBlueprint(
    session: CourseCopilotSession,
    blueprint: CourseBlueprint,
  ): Promise<CourseCopilotJob[]> {
    const brief: CourseBrief = session.brief ?? {};
    const rows: Partial<CourseCopilotJob>[] = [];
    const jobIdByItem = new Map<string, string>();
    const newId = () => crypto.randomUUID();

    rows.push({
      id: newId(),
      sessionId: session.id,
      kind: CourseCopilotJobKind.COURSE_META,
      input: { title: 'Course title and description' },
      dependsOn: [],
    });
    if (blueprint.cover?.mode === 'generate') {
      rows.push({
        id: newId(),
        sessionId: session.id,
        kind: CourseCopilotJobKind.COVER_IMAGE,
        input: { title: 'Cover image', prompt: blueprint.cover.prompt },
        dependsOn: [],
      });
    }

    for (const section of blueprint.sections) {
      for (const item of section.items) {
        const id = newId();
        jobIdByItem.set(item.id, id);
        rows.push({
          id,
          sessionId: session.id,
          kind: jobKindForItem(item),
          blueprintItemId: item.id,
          input: { title: item.title, sectionId: section.id, item },
          dependsOn: [],
        });
      }
    }

    const articleImages = brief.look?.articleImages === 'one-per-article';
    for (const section of blueprint.sections) {
      for (const item of section.items) {
        const jobId = jobIdByItem.get(item.id)!;
        const row = rows.find((candidate) => candidate.id === jobId)!;
        if (row.kind === CourseCopilotJobKind.CASE_NEW) {
          const members: string[] = Array.isArray(item.spec?.memberItemIds)
            ? item.spec.memberItemIds
            : [];
          row.dependsOn = members
            .map((memberId) => jobIdByItem.get(memberId))
            .filter((value): value is string => Boolean(value));
        }
        if (
          item.type === TrackItemType.ARTICLE &&
          (articleImages || item.spec?.withImage === true)
        ) {
          rows.push({
            id: newId(),
            sessionId: session.id,
            kind: CourseCopilotJobKind.ARTICLE_IMAGE,
            blueprintItemId: item.id,
            input: { title: item.title, articleJobId: jobId },
            dependsOn: [jobId],
          });
        }
      }
    }

    rows.push({
      id: newId(),
      sessionId: session.id,
      kind: CourseCopilotJobKind.COURSE_REVIEW,
      input: { title: 'Review of the finished course' },
      dependsOn: [],
    });

    const saved = await this.jobRepository.save(
      rows.map((row) =>
        this.jobRepository.create({
          ...row,
          status: CourseCopilotJobStatus.QUEUED,
          attempts: 0,
        }),
      ),
    );
    await this.eventService.record(
      session.id,
      CourseCopilotEventType.BUILD_STARTED,
      { jobCount: saved.length, estimateUsd: blueprint.estimate?.usd },
    );
    return saved;
  }

  /** Queue one job from the edit loop (a new roleplay, an image) and run it. */
  async enqueue(
    session: CourseCopilotSession,
    job: Pick<CourseCopilotJob, 'kind' | 'input'> & {
      blueprintItemId?: string | null;
      dependsOn?: string[];
    },
  ): Promise<CourseCopilotJob> {
    const saved = await this.jobRepository.save(
      this.jobRepository.create({
        sessionId: session.id,
        kind: job.kind,
        blueprintItemId: job.blueprintItemId ?? null,
        input: job.input,
        dependsOn: job.dependsOn ?? [],
        status: CourseCopilotJobStatus.QUEUED,
        attempts: 0,
      }),
    );
    await this.eventService.record(
      session.id,
      CourseCopilotEventType.JOB_QUEUED,
      {
        jobId: saved.id,
        kind: saved.kind,
        title: saved.input?.title ?? saved.kind,
      },
    );
    this.start(session.id);
    return saved;
  }

  // ── Runner ───────────────────────────────────────────────────────────────

  /** Start (or join) this process's runner for a session. Fire and forget. */
  start(sessionId: string): void {
    if (this.stopping || this.runners.has(sessionId)) return;
    const runner = this.run(sessionId)
      .catch((error) =>
        this.logger.error(
          `Course Copilot build ${sessionId} crashed: ${
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error)
          }`,
        ),
      )
      .finally(() => this.runners.delete(sessionId));
    this.runners.set(sessionId, runner);
  }

  /** For tests and graceful paths: wait for this process's runner to finish. */
  async waitFor(sessionId: string): Promise<void> {
    await this.runners.get(sessionId);
  }

  private async run(sessionId: string): Promise<void> {
    const lockKey = `${COURSE_COPILOT_BUILD_LOCK_PREFIX}:${sessionId}`;
    if (!(await this.redis.acquireLock(lockKey, BUILD_LOCK_TTL_SECONDS))) {
      // Another task owns this build. Its jobs are visible to everyone; the
      // reconcile tick takes over if that task dies.
      return;
    }
    const concurrency = Math.max(
      1,
      Number(this.configService.courseCopilot.buildConcurrency) ||
        COURSE_COPILOT_DEFAULT_CONCURRENCY,
    );
    const active = new Map<string, Promise<void>>();
    let lastLockRefresh = Date.now();

    try {
      while (!this.stopping) {
        if (
          Date.now() - lastLockRefresh >
          (BUILD_LOCK_TTL_SECONDS * 1000) / 3
        ) {
          // Re-arm the lock: releasing then re-acquiring is safe because we
          // hold it, and the TTL is the only thing that frees it if we die.
          await this.redis.releaseLock(lockKey).catch(() => undefined);
          await this.redis.acquireLock(lockKey, BUILD_LOCK_TTL_SECONDS);
          lastLockRefresh = Date.now();
        }

        const session = await this.sessionRepository.findOne({
          where: { id: sessionId },
        });
        if (
          !session ||
          session.status === CourseCopilotSessionStatus.ARCHIVED
        ) {
          break;
        }
        const jobs = await this.jobRepository.listBySession(sessionId);
        await this.skipBlocked(session, jobs);

        const byId = new Map(jobs.map((job) => [job.id, job]));
        const queued = jobs.filter(
          (job) =>
            job.status === CourseCopilotJobStatus.QUEUED && !active.has(job.id),
        );
        const nonReview = jobs.filter(
          (job) => job.kind !== CourseCopilotJobKind.COURSE_REVIEW,
        );
        const othersSettled = nonReview.every((job) =>
          COURSE_COPILOT_SETTLED_JOB_STATUSES.includes(job.status),
        );

        const ready = queued
          .filter((job) =>
            job.kind === CourseCopilotJobKind.COURSE_REVIEW
              ? othersSettled && active.size === 0
              : (job.dependsOn ?? []).every(
                  (dep) =>
                    byId.get(dep)?.status === CourseCopilotJobStatus.DONE,
                ),
          )
          .sort(
            (a, b) =>
              (KIND_PRIORITY[a.kind] ?? 2) - (KIND_PRIORITY[b.kind] ?? 2),
          );

        if (ready.length && active.size < concurrency) {
          if (await this.overBudget(session)) {
            await this.hold(session, queued);
            if (!active.size) break;
          } else {
            for (const job of ready.slice(0, concurrency - active.size)) {
              const claimed = await this.jobRepository.claim(job.id);
              if (!claimed) continue;
              const promise = this.runJob(session, claimed).finally(() =>
                active.delete(claimed.id),
              );
              active.set(claimed.id, promise);
            }
            continue;
          }
        }

        if (active.size) {
          await Promise.race([
            ...active.values(),
            new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS)),
          ]);
          continue;
        }

        const held = jobs.some(
          (job) => job.status === CourseCopilotJobStatus.HELD,
        );
        const pending = jobs.some(
          (job) =>
            job.status === CourseCopilotJobStatus.QUEUED ||
            job.status === CourseCopilotJobStatus.RUNNING,
        );
        if (held) break; // waits for a budget raise
        if (!pending) {
          await this.finish(session, jobs);
          break;
        }
        // Queued jobs whose dependencies are running elsewhere: wait for them.
        await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
      }
      await Promise.allSettled(active.values());
    } finally {
      await this.redis.releaseLock(lockKey).catch(() => undefined);
    }
  }

  private async runJob(
    session: CourseCopilotSession,
    job: CourseCopilotJob,
  ): Promise<void> {
    const title = job.input?.title ?? job.kind;
    await this.eventService.record(
      session.id,
      CourseCopilotEventType.JOB_STARTED,
      {
        jobId: job.id,
        kind: job.kind,
        title,
        attempt: job.attempts,
      },
    );
    const heartbeat = setInterval(
      () => void this.jobRepository.heartbeat(job.id).catch(() => undefined),
      COURSE_COPILOT_JOB_HEARTBEAT_MS,
    );

    try {
      // The session row is re-read so a job sees the latest map, brief and
      // build-completion flag, not the ones from when the runner started.
      const fresh =
        (await this.sessionRepository.findOne({ where: { id: session.id } })) ??
        session;
      const result = await this.structureService.asOwner(fresh, () =>
        this.executor.execute(fresh, job),
      );
      // An item that goes straight into the live course is placed BEFORE the
      // job is marked done: if placement fails (the section was deleted,
      // learners enrolled) the job must fail with it, not report done while
      // its item never arrived.
      const placesLive = this.placesLive(fresh, job);
      if (placesLive) {
        try {
          await this.afterDone(fresh, { ...job, result });
        } catch (error) {
          throw new CourseCopilotPlacementError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      const settled = await this.jobRepository.settle(
        job.id,
        CourseCopilotJobStatus.DONE,
        { result },
      );
      if (!settled) return; // reconciled away while running; the retry owns it
      if (!placesLive) await this.afterDone(fresh, { ...job, result });
      await this.eventService.record(
        session.id,
        CourseCopilotEventType.JOB_DONE,
        {
          jobId: job.id,
          kind: job.kind,
          title,
          summary: result.summary ?? null,
        },
      );
    } catch (error) {
      await this.handleFailure(session, job, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** True when this job's item is written into the live course, not the first-build rewrite. */
  private placesLive(
    session: CourseCopilotSession,
    job: CourseCopilotJob,
  ): boolean {
    if (job.kind === CourseCopilotJobKind.ARTICLE_IMAGE) return false;
    if (!ITEM_JOB_KINDS.has(job.kind)) return false;
    return Boolean(
      job.input?.placement ||
      job.input?.replaceTrackItemId ||
      session.metadata?.buildCompletedAt,
    );
  }

  /** Place a finished item in the course. */
  private async afterDone(
    session: CourseCopilotSession,
    job: CourseCopilotJob & { result: CourseCopilotJobResult },
  ): Promise<void> {
    if (job.kind === CourseCopilotJobKind.ARTICLE_IMAGE) {
      // The image was written onto the article job's result (first build) or
      // the live item (after); either way the course needs re-saving only in
      // the first case.
      if (
        !job.input?.articleTrackItemId &&
        !session.metadata?.buildCompletedAt
      ) {
        this.structureService.scheduleBuildWrite(session.id);
      }
      return;
    }
    if (!ITEM_JOB_KINDS.has(job.kind)) return;

    if (job.input?.placement || job.input?.replaceTrackItemId) {
      await this.placeInLiveCourse(session, job);
      return;
    }
    if (!session.metadata?.buildCompletedAt) {
      this.structureService.scheduleBuildWrite(session.id);
      return;
    }
    // A retried blueprint job after the course has been edited: insert it
    // where the blueprint put it, relative to what is there now, rather than
    // rewriting the course from the blueprint and undoing the trainer's edits.
    await this.insertBlueprintItemLive(session, job);
  }

  /** Edit-loop jobs: insert at a placement, or replace an item in place. */
  private async placeInLiveCourse(
    session: CourseCopilotSession,
    job: CourseCopilotJob & { result: CourseCopilotJobResult },
  ): Promise<void> {
    const item = job.input?.item as CourseBlueprintItem;
    const { result } = await this.structureService.mutate(
      session,
      (sections) => {
        if (job.input?.replaceTrackItemId) {
          for (const section of sections) {
            const index = section.items.findIndex(
              (candidate) => candidate.id === job.input.replaceTrackItemId,
            );
            if (index < 0) continue;
            const existing = section.items[index];
            const replacement = this.structureService.itemFromJob(
              item,
              job as CourseCopilotJob,
              existing.id,
            );
            // Regenerating keeps the item's identity: id, title and rule stay
            // unless the tool asked to change them.
            const hasRule =
              replacement.completionCriteria &&
              Object.keys(replacement.completionCriteria).length > 0;
            section.items[index] = {
              ...existing,
              ...replacement,
              id: existing.id,
              title: existing.title,
              completionCriteria: hasRule
                ? replacement.completionCriteria
                : existing.completionCriteria,
            };
            return existing.id;
          }
          throw new Error(
            'The item being replaced is no longer in the course.',
          );
        }
        const placement = job.input.placement as {
          trackSectionId: string;
          afterTrackItemId?: string | null;
        };
        const section = sections.find((s) => s.id === placement.trackSectionId);
        if (!section) {
          throw new Error(
            'The section this item was for is no longer in the course.',
          );
        }
        const at = placement.afterTrackItemId
          ? section.items.findIndex(
              (i) => i.id === placement.afterTrackItemId,
            ) + 1
          : section.items.length;
        section.items.splice(
          at <= 0 && placement.afterTrackItemId ? section.items.length : at,
          0,
          this.structureService.itemFromJob(item, job as CourseCopilotJob),
        );
        return null;
      },
    );
    await this.eventService.record(
      session.id,
      CourseCopilotEventType.COURSE_CHANGED,
      {
        summary: `${job.input?.replaceTrackItemId ? 'Regenerated' : 'Added'} "${item.title}"`,
        itemId: result,
      },
    );
  }

  private async insertBlueprintItemLive(
    session: CourseCopilotSession,
    job: CourseCopilotJob & { result: CourseCopilotJobResult },
  ): Promise<void> {
    const blueprint = session.approvedBlueprint;
    const bpSection = blueprint?.sections.find(
      (s) => s.id === job.input?.sectionId,
    );
    const bpItem = job.input?.item as CourseBlueprintItem;
    if (!blueprint || !bpSection || !bpItem) return;
    const map = session.trackIdMap ?? { sections: {}, items: {} };

    await this.structureService.mutate(session, (sections) => {
      let section = sections.find((s) => s.id === map.sections[bpSection.id]);
      if (!section) {
        section = {
          title: bpSection.title,
          description: bpSection.description || undefined,
          order: sections.length + 1,
          items: [],
        };
        sections.push(section);
      }
      // After the nearest earlier blueprint sibling that is still in the course.
      const index = bpSection.items.findIndex((i) => i.id === bpItem.id);
      let at = 0;
      for (let i = index - 1; i >= 0; i--) {
        const trackId = map.items[bpSection.items[i].id];
        const found = section.items.findIndex((item) => item.id === trackId);
        if (found >= 0) {
          at = found + 1;
          break;
        }
      }
      section.items.splice(
        at,
        0,
        this.structureService.itemFromJob(bpItem, job),
      );
    });
    // Record the new row's id so a later image job can find it.
    const track = await this.structureService.getTrack(session.trackId!);
    const known = new Set(Object.values(map.items));
    const created = track.sections
      .flatMap((s) => s.items)
      .find((item) => !known.has(item.id) && item.title === bpItem.title);
    if (created) {
      map.items[bpItem.id] = created.id;
      await this.sessionRepository.update(
        { id: session.id },
        { trackIdMap: map as any },
      );
    }
  }

  private async handleFailure(
    session: CourseCopilotSession,
    job: CourseCopilotJob,
    error: unknown,
  ): Promise<void> {
    const title = job.input?.title ?? job.kind;
    if (error instanceof CourseCopilotJobSkip) {
      await this.jobRepository.settle(job.id, CourseCopilotJobStatus.SKIPPED, {
        result: { skippedReason: error.reason, summary: null as any },
        error: null,
      });
      await this.eventService.record(
        session.id,
        CourseCopilotEventType.JOB_SKIPPED,
        {
          jobId: job.id,
          kind: job.kind,
          title,
          reason: error.reason,
        },
      );
      return;
    }

    const message = this.describe(error);
    const repairErrors =
      error instanceof SpecialistValidationError ? error.errors : undefined;
    // A placement failure is about the course, not the content: generating
    // the content again would fail in the same place and pay twice.
    const willRetry =
      !(error instanceof CourseCopilotPlacementError) &&
      job.attempts < COURSE_COPILOT_JOB_MAX_ATTEMPTS;
    this.logger.warn(
      `Course Copilot ${session.id}: job ${job.id} (${job.kind}) attempt ${job.attempts} failed: ${message}`,
    );
    if (willRetry) {
      if (repairErrors?.length) {
        await this.jobRepository.update(
          { id: job.id },
          { input: { ...job.input, repairErrors } as any },
        );
      }
      await this.jobRepository.requeueForRepair(job.id, message);
    } else {
      await this.jobRepository.settle(job.id, CourseCopilotJobStatus.FAILED, {
        error: message,
      });
    }
    await this.eventService.record(
      session.id,
      CourseCopilotEventType.JOB_FAILED,
      {
        jobId: job.id,
        kind: job.kind,
        title,
        error: message,
        willRetry,
      },
    );
  }

  /** Queued jobs whose dependency did not finish can never run: skip them. */
  private async skipBlocked(
    session: CourseCopilotSession,
    jobs: CourseCopilotJob[],
  ): Promise<void> {
    const byId = new Map(jobs.map((job) => [job.id, job]));
    for (const job of jobs) {
      if (job.status !== CourseCopilotJobStatus.QUEUED) continue;
      const blocker = (job.dependsOn ?? [])
        .map((dep) => byId.get(dep))
        .find(
          (dep) =>
            dep?.status === CourseCopilotJobStatus.FAILED ||
            dep?.status === CourseCopilotJobStatus.SKIPPED,
        );
      if (!blocker) continue;
      const reason = `Skipped because "${blocker.input?.title ?? blocker.kind}" did not finish.`;
      const changed = await this.jobRepository.setStatus(
        [job.id],
        [CourseCopilotJobStatus.QUEUED],
        CourseCopilotJobStatus.SKIPPED,
      );
      if (changed.length) {
        job.status = CourseCopilotJobStatus.SKIPPED;
        await this.jobRepository.update(
          { id: job.id },
          { result: { skippedReason: reason } as any },
        );
        await this.eventService.record(
          session.id,
          CourseCopilotEventType.JOB_SKIPPED,
          {
            jobId: job.id,
            kind: job.kind,
            title: job.input?.title ?? job.kind,
            reason,
          },
        );
      }
    }
  }

  private async overBudget(session: CourseCopilotSession): Promise<boolean> {
    const ceiling = Number(session.budgetUsd) || 0;
    if (ceiling <= 0) return false;
    return (await this.costService.spent(session)) >= ceiling;
  }

  private async hold(
    session: CourseCopilotSession,
    queued: CourseCopilotJob[],
  ): Promise<void> {
    const held = await this.jobRepository.setStatus(
      queued.map((job) => job.id),
      [CourseCopilotJobStatus.QUEUED],
      CourseCopilotJobStatus.HELD,
    );
    if (!held.length) return;
    const spentUsd = await this.costService.spent(session);
    await this.eventService.record(
      session.id,
      CourseCopilotEventType.BUDGET_HOLD,
      {
        state: 'held',
        spentUsd,
        ceilingUsd: Number(session.budgetUsd) || 0,
        jobs: held.length,
      },
    );
  }

  /** Everything settled: save the course one last time and hand it over. */
  private async finish(
    session: CourseCopilotSession,
    jobs: CourseCopilotJob[],
  ): Promise<void> {
    if (!session.metadata?.buildCompletedAt && session.approvedBlueprint) {
      await this.structureService.flushBuildWrite(session.id);
    }
    const fresh = await this.sessionRepository.findOne({
      where: { id: session.id },
    });
    if (!fresh) return;
    const counts = {
      done: jobs.filter((job) => job.status === CourseCopilotJobStatus.DONE)
        .length,
      failed: jobs.filter((job) => job.status === CourseCopilotJobStatus.FAILED)
        .length,
      skipped: jobs.filter(
        (job) => job.status === CourseCopilotJobStatus.SKIPPED,
      ).length,
    };
    const wasBuilding =
      fresh.status === CourseCopilotSessionStatus.BUILDING ||
      fresh.status === CourseCopilotSessionStatus.BUILD_FAILED;
    await this.sessionRepository.manager.query(
      `UPDATE "course_copilot_sessions"
          SET "status" = CASE WHEN "status" IN ('BUILDING','BUILD_FAILED') THEN 'EDITING' ELSE "status" END,
              "metadata" = COALESCE("metadata", '{}'::jsonb) ||
                jsonb_build_object('buildCompletedAt', COALESCE("metadata"->>'buildCompletedAt', now()::text)),
              "updatedAt" = now()
        WHERE id = $1`,
      [fresh.id],
    );
    if (wasBuilding) {
      const spentUsd = await this.costService.spent(fresh);
      await this.eventService.record(
        fresh.id,
        CourseCopilotEventType.BUILD_FINISHED,
        { ...counts, spentUsd },
      );
      this.analytics?.capture(
        COURSE_COPILOT_ANALYTICS_EVENTS.BUILD_FINISHED,
        fresh.createdBy,
        {
          session_id: fresh.id,
          track_id: fresh.trackId ?? null,
          items: jobs.length,
          failed: counts.failed,
          skipped: counts.skipped,
          usd: spentUsd,
          cancelled: false,
        },
      );
    }
  }

  // ── Trainer actions ──────────────────────────────────────────────────────

  async retry(session: CourseCopilotSession, jobIds?: string[]): Promise<void> {
    const jobs = await this.jobRepository.listBySession(session.id);
    const retryable = jobs.filter(
      (job) =>
        (job.status === CourseCopilotJobStatus.FAILED ||
          job.status === CourseCopilotJobStatus.SKIPPED) &&
        (!jobIds?.length || jobIds.includes(job.id)),
    );
    if (!retryable.length) {
      throw new BadRequestException('Nothing to retry.');
    }
    // Pull along anything skipped only because one of these did not finish.
    const ids = new Set(retryable.map((job) => job.id));
    let grew = true;
    while (grew) {
      grew = false;
      for (const job of jobs) {
        if (ids.has(job.id) || job.status !== CourseCopilotJobStatus.SKIPPED)
          continue;
        if ((job.dependsOn ?? []).some((dep) => ids.has(dep))) {
          ids.add(job.id);
          grew = true;
        }
      }
    }
    await this.jobRepository.setStatus(
      [...ids],
      [CourseCopilotJobStatus.FAILED, CourseCopilotJobStatus.SKIPPED],
      CourseCopilotJobStatus.QUEUED,
      { error: null, resetAttempts: true },
    );
    for (const id of ids) {
      const job = jobs.find((candidate) => candidate.id === id);
      if (job?.input?.repairErrors) {
        // A trainer's retry starts clean: last run's validator errors are stale.
        const input = { ...job.input };
        delete input.repairErrors;
        await this.jobRepository.update({ id }, { input: input as any });
      }
    }
    if (
      session.mode === CourseCopilotMode.CREATE &&
      session.status === CourseCopilotSessionStatus.BUILD_FAILED
    ) {
      await this.sessionRepository.update(
        { id: session.id },
        { status: CourseCopilotSessionStatus.BUILDING },
      );
    }
    this.start(session.id);
  }

  /**
   * Stop: waiting jobs are skipped, running ones finish, and the course as
   * built so far is handed over.
   */
  async cancel(session: CourseCopilotSession): Promise<void> {
    if (
      session.status !== CourseCopilotSessionStatus.BUILDING &&
      session.status !== CourseCopilotSessionStatus.BUILD_FAILED
    ) {
      throw new ConflictException('There is no build running to cancel.');
    }
    const jobs = await this.jobRepository.listBySession(session.id);
    const waiting = jobs.filter(
      (job) =>
        job.status === CourseCopilotJobStatus.QUEUED ||
        job.status === CourseCopilotJobStatus.HELD,
    );
    const skipped = await this.jobRepository.setStatus(
      waiting.map((job) => job.id),
      [CourseCopilotJobStatus.QUEUED, CourseCopilotJobStatus.HELD],
      CourseCopilotJobStatus.SKIPPED,
    );
    if (skipped.length) {
      await this.jobRepository.update(
        { id: In(skipped) },
        { result: { skippedReason: 'Cancelled.' } as any },
      );
    }
    await this.structureService.flushBuildWrite(session.id);
    await this.sessionRepository.manager.query(
      `UPDATE "course_copilot_sessions"
          SET "status" = 'EDITING',
              "metadata" = COALESCE("metadata", '{}'::jsonb) ||
                jsonb_build_object('buildCompletedAt', COALESCE("metadata"->>'buildCompletedAt', now()::text))
        WHERE id = $1`,
      [session.id],
    );
    const spentUsd = await this.costService.spent(session);
    await this.eventService.record(
      session.id,
      CourseCopilotEventType.BUILD_FINISHED,
      { cancelled: true, skipped: skipped.length, spentUsd },
    );
    this.analytics?.capture(
      COURSE_COPILOT_ANALYTICS_EVENTS.BUILD_FINISHED,
      session.createdBy,
      {
        session_id: session.id,
        track_id: session.trackId ?? null,
        items: jobs.length,
        failed: jobs.filter(
          (job) => job.status === CourseCopilotJobStatus.FAILED,
        ).length,
        skipped: skipped.length,
        usd: spentUsd,
        cancelled: true,
      },
    );
  }

  /**
   * Raise (or remove, with 0) the ceiling. Refuses a figure at or below what
   * is already spent — it would not release anything — the same contract as
   * Builder's mid-run raise.
   */
  async raiseBudget(
    session: CourseCopilotSession,
    budgetUsd: number,
  ): Promise<void> {
    const value = Number(budgetUsd);
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(
        'Enter a budget in US dollars, or 0 for no cap.',
      );
    }
    const spent = await this.costService.spent(session);
    if (value !== 0 && value <= spent) {
      throw new BadRequestException(
        `That is not above what this session has already spent ($${spent.toFixed(2)}).`,
      );
    }
    await this.sessionRepository.update(
      { id: session.id },
      { budgetUsd: value.toFixed(2) },
    );
    const jobs = await this.jobRepository.listBySession(session.id);
    const released = await this.jobRepository.setStatus(
      jobs
        .filter((job) => job.status === CourseCopilotJobStatus.HELD)
        .map((job) => job.id),
      [CourseCopilotJobStatus.HELD],
      CourseCopilotJobStatus.QUEUED,
    );
    if (released.length) {
      await this.eventService.record(
        session.id,
        CourseCopilotEventType.BUDGET_HOLD,
        {
          state: 'raised',
          spentUsd: spent,
          ceilingUsd: value,
          jobs: released.length,
        },
      );
      this.start(session.id);
    }
  }

  // ── Watchdog ─────────────────────────────────────────────────────────────

  /**
   * Every five minutes (and 30 s after boot): give a running job whose
   * heartbeat went quiet its remaining attempt back (or fail it when it has
   * none), and restart any session with queued work and no live runner. A
   * session whose jobs died with nothing queued behind them is marked
   * BUILD_FAILED so the trainer sees a Retry instead of a spinner.
   */
  async reconcile(): Promise<void> {
    const stale = await this.jobRepository.findStale(
      COURSE_COPILOT_JOB_STALE_MS,
    );
    const touched = new Set<string>();
    for (const job of stale) {
      // A job orphaned by a restart says nothing about its content, so it
      // gets its remaining attempt back automatically; only a job that has
      // already used every attempt is failed for the trainer to retry.
      const retry = job.attempts < COURSE_COPILOT_JOB_MAX_ATTEMPTS;
      const changed = await this.jobRepository.setStatus(
        [job.id],
        [CourseCopilotJobStatus.RUNNING],
        retry ? CourseCopilotJobStatus.QUEUED : CourseCopilotJobStatus.FAILED,
        {
          error: retry
            ? 'Interrupted by a server restart; running it again.'
            : 'Stopped responding (the server restarted mid-job). Retry it.',
        },
      );
      if (changed.length) {
        touched.add(job.sessionId);
        await this.eventService.record(
          job.sessionId,
          CourseCopilotEventType.JOB_FAILED,
          {
            jobId: job.id,
            kind: job.kind,
            title: job.input?.title ?? job.kind,
            error: 'Interrupted by a server restart',
            willRetry: retry,
          },
        );
      }
    }

    const sessionIds: { sessionId: string }[] = await this.jobRepository
      .createQueryBuilder('job')
      .select('DISTINCT job."sessionId"', 'sessionId')
      .where('job.status IN (:...statuses)', {
        statuses: [
          CourseCopilotJobStatus.QUEUED,
          CourseCopilotJobStatus.RUNNING,
        ],
      })
      .getRawMany();
    for (const { sessionId } of sessionIds) {
      this.start(sessionId);
    }

    for (const sessionId of touched) {
      const pending = await this.jobRepository.countByStatus(sessionId, [
        CourseCopilotJobStatus.QUEUED,
        CourseCopilotJobStatus.RUNNING,
      ]);
      if (pending > 0) continue;
      const session = await this.sessionRepository.findOne({
        where: { id: sessionId },
      });
      if (session?.status === CourseCopilotSessionStatus.BUILDING) {
        await this.sessionRepository.update(
          { id: sessionId },
          { status: CourseCopilotSessionStatus.BUILD_FAILED },
        );
        await this.eventService.record(
          sessionId,
          CourseCopilotEventType.BUILD_FAILED,
          {
            reason:
              'A job stopped responding and nothing else was left to run.',
          },
        );
      }
    }
  }

  private describe(error: unknown): string {
    if (error instanceof SpecialistValidationError) {
      return `The generated content did not pass validation: ${error.errors.slice(0, 3).join('; ')}`;
    }
    const message = error instanceof Error ? error.message : String(error);
    return message.length > 500 ? `${message.slice(0, 497)}…` : message;
  }
}
