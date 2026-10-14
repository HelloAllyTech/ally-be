import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { TrackService } from 'src/track/service/track.service';
import {
  TrackSharedService,
  TrackWithStructure,
} from 'src/track/service/track-shared.service';
import { TrackEnrollment } from 'src/track/entity/track-enrollment.entity';
import { TrackItem } from 'src/track/entity/track-item.entity';
import { TrackItemType } from 'src/track/type/track.type';
import {
  UpsertTrackItemDto,
  UpsertTrackSectionDto,
} from 'src/track/dto/upsert-track-structure.dto';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioStatus } from 'src/learn/type/scenario.type';
import { Case } from 'src/case/entity/case.entity';
import { CaseStatus } from 'src/case/type/cases.type';
import { CaseItem } from 'src/case/entity/case-item.entity';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import { CourseCopilotJob } from '../entity/course-copilot-job.entity';
import {
  CourseCopilotEventType,
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
} from '../enum/course-copilot.enum';
import {
  CourseCopilotJobRepository,
  CourseCopilotSessionRepository,
} from '../repository/course-copilot.repository';
import {
  CourseBlueprintItem,
  CourseCopilotTrackIdMap,
  CourseOutline,
  CourseOutlineItem,
  CoursePublishReadiness,
} from '../type/course-copilot.type';
import {
  CourseItemPreview,
  CourseOutlineWithPreview,
} from '../type/course-copilot-api.type';
import {
  COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS,
  COURSE_COPILOT_STRUCTURE_LOCK_PREFIX,
  COURSE_COPILOT_STRUCTURE_LOCK_TTL_SECONDS,
} from '../constants/course-copilot.constants';
import { CourseCopilotEventService } from './course-copilot-event.service';

/** Item jobs — the ones that become a track item. */
export const ITEM_JOB_KINDS = new Set<CourseCopilotJobKind>([
  CourseCopilotJobKind.ARTICLE,
  CourseCopilotJobKind.QUIZ,
  CourseCopilotJobKind.JOURNAL,
  CourseCopilotJobKind.ANNOTATED_ARTIFACT,
  CourseCopilotJobKind.GAME,
  CourseCopilotJobKind.VIDEO,
  CourseCopilotJobKind.ROLEPLAY_NEW,
  CourseCopilotJobKind.ROLEPLAY_REF,
  CourseCopilotJobKind.CASE_NEW,
  CourseCopilotJobKind.CASE_REF,
]);

const textOf = (html: unknown): string =>
  typeof html === 'string'
    ? html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Everything that reads or writes the course itself.
 *
 * Every write goes through `TrackService.upsertStructure` — the editor's own
 * path — so the copilot's output passes the same validator, the same reference
 * checks (ACTIVE scenarios and cases only) and the same structural lock once
 * learners are enrolled. Writes for one session are serialised by a Redis lock
 * and always re-read the course first, so a change made in the editor between
 * two copilot turns is what the next tool works from.
 *
 * ## Ids
 * `upsertStructure` refuses an id it did not create ("Item … does not belong
 * to this track"), so blueprint ids cannot be written as track ids. The first
 * write creates rows without ids and `trackIdMap` records what the server
 * assigned, by position; every later write is then an update of the same rows
 * — nothing is soft-deleted and recreated between jobs, which matters because
 * learner progress rows point at item ids.
 */
@Injectable()
export class CourseCopilotStructureService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotStructureService.name,
  );

  /** Per-session write coalescing (in-process; the Redis lock covers other tasks). */
  private readonly pending = new Map<
    string,
    {
      timer: NodeJS.Timeout | null;
      running: Promise<void> | null;
      dirty: boolean;
    }
  >();

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly trackService: TrackService,
    private readonly trackSharedService: TrackSharedService,
    private readonly sessionRepository: CourseCopilotSessionRepository,
    private readonly jobRepository: CourseCopilotJobRepository,
    private readonly eventService: CourseCopilotEventService,
  ) {}

  getTrack(trackId: string): Promise<TrackWithStructure> {
    return this.trackSharedService.getTrackWithStructure(trackId);
  }

  async isLocked(trackId: string): Promise<boolean> {
    return this.dataSource
      .getRepository(TrackEnrollment)
      .exist({ where: { trackId } });
  }

  toUpsertShape(track: TrackWithStructure): UpsertTrackSectionDto[] {
    return track.sections.map((section) => this.sectionToUpsert(section));
  }

  sectionToUpsert(
    section: TrackWithStructure['sections'][number],
  ): UpsertTrackSectionDto {
    return {
      id: section.id,
      title: section.title,
      description: section.description ?? undefined,
      order: section.order,
      items: section.items.map((item) => this.itemToUpsert(item)),
    };
  }

  itemToUpsert(item: TrackItem): UpsertTrackItemDto {
    return {
      id: item.id,
      type: item.type,
      order: item.order,
      title: item.title,
      description: item.description ?? undefined,
      scenarioId: item.scenarioId ?? undefined,
      caseId: item.caseId ?? undefined,
      content: (item.content as Record<string, any>) ?? undefined,
      completionCriteria: item.completionCriteria ?? undefined,
      hasDiscussion: item.hasDiscussion,
    } as UpsertTrackItemDto;
  }

  /** Renumber orders 1..n at both levels — the validator requires contiguity. */
  renumber(sections: UpsertTrackSectionDto[]): UpsertTrackSectionDto[] {
    return sections.map((section, sectionIndex) => ({
      ...section,
      order: sectionIndex + 1,
      items: section.items.map((item, itemIndex) => ({
        ...item,
        order: itemIndex + 1,
      })),
    }));
  }

  // ── Outline ──────────────────────────────────────────────────────────────

  async buildOutline(
    track: TrackWithStructure,
    options: {
      withPreview?: boolean;
      generatedScenarioIds?: number[];
      generatedCaseIds?: string[];
    } = {},
  ): Promise<CourseOutlineWithPreview> {
    const items = track.sections.flatMap((section) => section.items);
    const scenarioIds = [
      ...new Set(items.map((item) => item.scenarioId).filter(Boolean)),
    ] as number[];
    const caseIds = [
      ...new Set(items.map((item) => item.caseId).filter(Boolean)),
    ] as string[];
    const [scenarios, cases, caseItemCounts] = options.withPreview
      ? await Promise.all([
          scenarioIds.length
            ? this.dataSource.getRepository(Scenarios).find({
                where: { id: In(scenarioIds) },
                select: { id: true, title: true, coverImageUrl: true },
                withDeleted: true,
              })
            : Promise.resolve([] as Scenarios[]),
          caseIds.length
            ? this.dataSource.getRepository(Case).find({
                where: { id: In(caseIds) },
                select: { id: true, title: true },
                withDeleted: true,
              })
            : Promise.resolve([] as Case[]),
          this.caseItemCounts(caseIds),
        ])
      : [[] as Scenarios[], [] as Case[], new Map<string, number>()];
    const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
    const caseById = new Map(cases.map((c) => [c.id, c]));
    const generatedScenarios = new Set(options.generatedScenarioIds ?? []);
    const generatedCases = new Set(options.generatedCaseIds ?? []);

    return {
      trackId: track.id,
      title: track.title,
      description: track.description ?? null,
      coverImageUrl: track.coverImageUrl ?? null,
      status: track.status,
      estimatedDurationMinutes: track.estimatedDurationMinutes ?? null,
      competencyIds: track.competencyIds ?? null,
      structureLocked: await this.isLocked(track.id),
      sections: track.sections.map((section) => ({
        id: section.id,
        order: section.order,
        title: section.title,
        description: section.description ?? null,
        items: section.items.map((item) => {
          const base: CourseOutlineItem = {
            id: item.id,
            type: item.type,
            order: item.order,
            title: item.title,
            description: item.description ?? null,
            scenarioId: item.scenarioId ?? null,
            caseId: item.caseId ?? null,
            completionCriteria: item.completionCriteria ?? null,
            size: this.sizeOf(item.type, item.content as any, item),
            hasDiscussion: item.hasDiscussion,
          };
          return {
            ...base,
            preview: options.withPreview
              ? this.previewOf(item, {
                  scenario: item.scenarioId
                    ? scenarioById.get(item.scenarioId)
                    : undefined,
                  caseRow: item.caseId ? caseById.get(item.caseId) : undefined,
                  caseItems: item.caseId
                    ? (caseItemCounts.get(item.caseId) ?? 0)
                    : 0,
                  generatedScenario: Boolean(
                    item.scenarioId && generatedScenarios.has(item.scenarioId),
                  ),
                  generatedCase: Boolean(
                    item.caseId && generatedCases.has(item.caseId),
                  ),
                })
              : ({ type: item.type } as any),
          };
        }),
      })),
    };
  }

  /**
   * The outline the model reads each edit turn: ids, types, titles, orders,
   * rules and sizes — never full content. Real ids are what stop it guessing.
   */
  outlineForPrompt(outline: CourseOutline): string {
    return JSON.stringify({
      trackId: outline.trackId,
      title: outline.title,
      status: outline.status,
      coverImageUrl: outline.coverImageUrl ? 'set' : null,
      structureLocked: outline.structureLocked,
      sections: outline.sections.map((section) => ({
        id: section.id,
        order: section.order,
        title: section.title,
        items: section.items.map((item) => ({
          id: item.id,
          order: item.order,
          type: item.type,
          title: item.title,
          size: item.size,
          ...(item.scenarioId ? { scenarioId: item.scenarioId } : {}),
          ...(item.caseId ? { caseId: item.caseId } : {}),
          ...(item.completionCriteria &&
          Object.keys(item.completionCriteria).length
            ? { rule: item.completionCriteria }
            : {}),
        })),
      })),
    });
  }

  /** Mirrors TrackService.validateTrackForPublish as a checklist instead of a throw. */
  async readiness(track: TrackWithStructure): Promise<CoursePublishReadiness> {
    const emptySections = track.sections.filter((s) => s.items.length === 0);
    const items = track.sections.flatMap((s) => s.items);
    const scenarioIds = items
      .filter((i) => i.type === TrackItemType.ROLEPLAY && i.scenarioId)
      .map((i) => i.scenarioId!) as number[];
    const caseIds = items
      .filter((i) => i.type === TrackItemType.CASE && i.caseId)
      .map((i) => i.caseId!) as string[];
    const [activeScenarios, activeCases] = await Promise.all([
      scenarioIds.length
        ? this.dataSource.getRepository(Scenarios).count({
            where: { id: In(scenarioIds), status: ScenarioStatus.ACTIVE },
          })
        : 0,
      caseIds.length
        ? this.dataSource.getRepository(Case).count({
            where: { id: In(caseIds), status: CaseStatus.ACTIVE },
          })
        : 0,
    ]);
    const referencesOk =
      activeScenarios === new Set(scenarioIds).size &&
      activeCases === new Set(caseIds).size;
    const checks: CoursePublishReadiness['checks'] = [
      { key: 'title', label: 'Title', ok: Boolean(track.title?.trim()) },
      {
        key: 'description',
        label: 'Description',
        ok: Boolean(textOf(track.description)),
      },
      {
        key: 'cover',
        label: 'Cover image',
        ok: Boolean(track.coverImageUrl),
        ...(track.coverImageUrl
          ? {}
          : {
              detail:
                'Cover image needed — pick one from the library or upload one in the editor.',
            }),
      },
      {
        key: 'sections',
        label: 'At least one section',
        ok: track.sections.length > 0,
      },
      {
        key: 'sectionItems',
        label: 'Every section has a component',
        ok: track.sections.length > 0 && emptySections.length === 0,
        ...(emptySections.length
          ? {
              detail: `Empty: ${emptySections.map((s) => `"${s.title}"`).join(', ')}`,
            }
          : {}),
      },
      {
        key: 'references',
        label: 'Every roleplay and case is published',
        ok: referencesOk,
        ...(referencesOk
          ? {}
          : { detail: 'A roleplay or case the course uses is not active.' }),
      },
    ];
    return { ready: checks.every((check) => check.ok), checks };
  }

  // ── Locked writes ────────────────────────────────────────────────────────

  /**
   * Run `mutate` against a fresh read of the course, validate and save it, all
   * under the session's structure lock. Throws ConflictException (the 409 the
   * editor gets) when learners are enrolled and the change is structural.
   */
  async mutate<T>(
    session: Pick<
      CourseCopilotSession,
      'id' | 'trackId' | 'createdBy' | 'tenantId'
    >,
    fn: (
      sections: UpsertTrackSectionDto[],
      track: TrackWithStructure,
    ) => Promise<T> | T,
  ): Promise<{ result: T; track: TrackWithStructure }> {
    if (!session.trackId) {
      throw new ConflictException('This session is not bound to a course yet.');
    }
    const trackId = session.trackId;
    return this.withLock(session.id, async () => {
      const track = await this.getTrack(trackId);
      const sections = this.toUpsertShape(track);
      const result = await fn(sections, track);
      await this.save(session, trackId, this.renumber(sections));
      return { result, track: await this.getTrack(trackId) };
    });
  }

  /** Save as the session owner — TrackService stamps `updatedBy` from the context. */
  async save(
    session: Pick<CourseCopilotSession, 'createdBy' | 'tenantId'>,
    trackId: string,
    sections: UpsertTrackSectionDto[],
  ): Promise<void> {
    await this.asOwner(session, () =>
      this.trackService.upsertStructure(trackId, { sections }),
    );
  }

  /**
   * Run as the session's owner. A background build has no request, and
   * TrackService / CaseService / the character library read the user from the
   * execution context — without this they throw Unauthorized or write
   * `createdBy: null` (the copilot-autobuild lesson).
   */
  asOwner<T>(
    session: Pick<CourseCopilotSession, 'createdBy' | 'tenantId'>,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (ExecutionManager.getUserId()) return fn();
    return ExecutionManager.runWithContext(() => {
      ExecutionManager.setAuthContext(
        String(session.createdBy),
        session.tenantId ?? '',
      );
      return fn();
    });
  }

  async withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${COURSE_COPILOT_STRUCTURE_LOCK_PREFIX}:${sessionId}`;
    const deadline = Date.now() + 45_000;
    while (
      !(await this.redis.acquireLock(
        key,
        COURSE_COPILOT_STRUCTURE_LOCK_TTL_SECONDS,
      ))
    ) {
      if (Date.now() > deadline) {
        throw new ConflictException(
          'Another change to this course is still being saved. Try again in a moment.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    try {
      return await fn();
    } finally {
      await this.redis.releaseLock(key).catch(() => undefined);
    }
  }

  // ── Build writes ─────────────────────────────────────────────────────────

  /**
   * Ask for the course to be rewritten from the approved blueprint. Results
   * that land within the debounce window share one save; a request during a
   * save schedules exactly one more.
   */
  scheduleBuildWrite(sessionId: string): void {
    const state = this.pending.get(sessionId) ?? {
      timer: null,
      running: null,
      dirty: false,
    };
    this.pending.set(sessionId, state);
    state.dirty = true;
    if (state.timer || state.running) return;
    state.timer = setTimeout(
      () => this.runPendingWrite(sessionId),
      COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS,
    );
  }

  /** Wait for any scheduled write, then make sure the latest results are saved. */
  async flushBuildWrite(sessionId: string): Promise<void> {
    const state = this.pending.get(sessionId);
    if (state?.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state?.running) await state.running.catch(() => undefined);
    this.pending.delete(sessionId);
    await this.writeBuildStructure(sessionId);
  }

  private runPendingWrite(sessionId: string): void {
    const state = this.pending.get(sessionId);
    if (!state) return;
    state.timer = null;
    state.dirty = false;
    state.running = this.writeBuildStructure(sessionId)
      .catch((error) =>
        this.logger.error(
          `Course Copilot ${sessionId}: structure write failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      )
      .finally(() => {
        state.running = null;
        if (state.dirty) {
          state.timer = setTimeout(
            () => this.runPendingWrite(sessionId),
            COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS,
          );
        } else {
          this.pending.delete(sessionId);
        }
      });
  }

  /**
   * Rewrite the course from the approved blueprint, including only items
   * whose job is done, in blueprint order.
   *
   * Rows already in the course that the blueprint does not know about — added
   * in the editor despite the build — are kept: appended to their section, or
   * as trailing sections. Losing a trainer's work to a background job would be
   * worse than an untidy order.
   */
  async writeBuildStructure(sessionId: string): Promise<void> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    const blueprint = session?.approvedBlueprint;
    if (!session?.trackId || !blueprint) return;

    await this.withLock(sessionId, async () => {
      const fresh = await this.sessionRepository.findOne({
        where: { id: sessionId },
      });
      if (!fresh?.trackId) return;
      const map: CourseCopilotTrackIdMap = {
        sections: { ...(fresh.trackIdMap?.sections ?? {}) },
        items: { ...(fresh.trackIdMap?.items ?? {}) },
      };
      const jobs = await this.jobRepository.listBySession(sessionId);
      const doneByItem = new Map<string, CourseCopilotJob>();
      for (const job of jobs) {
        if (
          job.blueprintItemId &&
          ITEM_JOB_KINDS.has(job.kind) &&
          job.status === CourseCopilotJobStatus.DONE &&
          !job.input?.placement &&
          !job.input?.replaceTrackItemId
        ) {
          doneByItem.set(job.blueprintItemId, job);
        }
      }

      const track = await this.getTrack(fresh.trackId);
      const liveSectionIds = new Set(track.sections.map((s) => s.id));
      const liveItemIds = new Set(
        track.sections.flatMap((s) => s.items.map((i) => i.id)),
      );
      const mappedSectionIds = new Set(Object.values(map.sections));
      const mappedItemIds = new Set(Object.values(map.items));
      const liveById = new Map(
        track.sections.flatMap((s) => s.items).map((i) => [i.id, i]),
      );

      // What each written row stands for, by position, to read ids back after.
      const plan: { sectionBp: string | null; itemBps: (string | null)[] }[] =
        [];
      const sections: UpsertTrackSectionDto[] = [];

      for (const bpSection of blueprint.sections) {
        const trackSectionId = map.sections[bpSection.id];
        const keepSectionId =
          trackSectionId && liveSectionIds.has(trackSectionId)
            ? trackSectionId
            : undefined;
        const items: UpsertTrackItemDto[] = [];
        const itemBps: (string | null)[] = [];
        for (const bpItem of bpSection.items) {
          const job = doneByItem.get(bpItem.id);
          if (!job?.result) continue;
          const trackItemId = map.items[bpItem.id];
          const existing =
            trackItemId && liveItemIds.has(trackItemId)
              ? liveById.get(trackItemId)
              : undefined;
          items.push(this.itemFromJob(bpItem, job, existing?.id));
          itemBps.push(bpItem.id);
        }
        // Editor-added items in this section survive the rewrite.
        const liveSection = keepSectionId
          ? track.sections.find((s) => s.id === keepSectionId)
          : undefined;
        for (const extra of liveSection?.items ?? []) {
          if (mappedItemIds.has(extra.id)) continue;
          items.push(this.itemToUpsert(extra));
          itemBps.push(null);
        }
        if (!items.length) continue;
        sections.push({
          ...(keepSectionId ? { id: keepSectionId } : {}),
          title: bpSection.title,
          description: bpSection.description || undefined,
          order: 0,
          items,
        });
        plan.push({ sectionBp: bpSection.id, itemBps });
      }
      for (const liveSection of track.sections) {
        if (mappedSectionIds.has(liveSection.id)) continue;
        const shape = this.sectionToUpsert(liveSection);
        sections.push(shape);
        plan.push({ sectionBp: null, itemBps: shape.items.map(() => null) });
      }

      if (!sections.length) return;
      await this.save(fresh, fresh.trackId, this.renumber(sections));

      // Read back what the server assigned, by position.
      const written = await this.getTrack(fresh.trackId);
      plan.forEach((entry, sectionIndex) => {
        const savedSection = written.sections[sectionIndex];
        if (!savedSection) return;
        if (entry.sectionBp) map.sections[entry.sectionBp] = savedSection.id;
        entry.itemBps.forEach((bpId, itemIndex) => {
          const savedItem = savedSection.items[itemIndex];
          if (bpId && savedItem) map.items[bpId] = savedItem.id;
        });
      });
      await this.sessionRepository.update(
        { id: sessionId },
        { trackIdMap: map as any },
      );

      const itemCount = written.sections.reduce(
        (sum, s) => sum + s.items.length,
        0,
      );
      await this.eventService.record(
        sessionId,
        CourseCopilotEventType.STRUCTURE_WRITTEN,
        { sections: written.sections.length, items: itemCount },
      );
    });
  }

  /** One track item from a finished job and its blueprint node. */
  itemFromJob(
    bpItem: CourseBlueprintItem,
    job: CourseCopilotJob,
    existingId?: string,
  ): UpsertTrackItemDto {
    const result = job.result ?? {};
    const criteria = bpItem.completionCriteria ?? {};
    const base: UpsertTrackItemDto = {
      ...(existingId ? { id: existingId } : {}),
      type: bpItem.type as TrackItemType,
      order: 0,
      title: bpItem.title,
      ...(bpItem.hasDiscussion !== undefined
        ? { hasDiscussion: bpItem.hasDiscussion }
        : {}),
    };
    switch (bpItem.type) {
      case TrackItemType.ROLEPLAY: {
        const rule = {
          ...(criteria.minScore !== undefined
            ? { minScore: criteria.minScore }
            : {}),
          ...(criteria.minDurationSeconds !== undefined
            ? { minDurationSeconds: criteria.minDurationSeconds }
            : {}),
        };
        // Undefined rather than {}: an empty rule is still a value, and a
        // regenerated roleplay would replace the item's real rule with it.
        return {
          ...base,
          scenarioId: result.scenarioId,
          completionCriteria: Object.keys(rule).length ? rule : undefined,
        };
      }
      case TrackItemType.CASE:
        return {
          ...base,
          caseId: result.caseId,
          completionCriteria:
            criteria.minScore !== undefined
              ? { minScore: criteria.minScore }
              : undefined,
        };
      case TrackItemType.QUIZ:
      case TrackItemType.ANNOTATED_ARTIFACT:
        return {
          ...base,
          content: result.content,
          completionCriteria:
            criteria.passScore !== undefined
              ? { passScore: criteria.passScore }
              : undefined,
        };
      case TrackItemType.VIDEO:
        return {
          ...base,
          content: result.content,
          completionCriteria: { watchPct: criteria.watchPct ?? 90 },
        };
      case TrackItemType.ARTICLE:
        return {
          ...base,
          content: result.content,
          completionCriteria: { minReadSeconds: criteria.minReadSeconds ?? 0 },
        };
      default:
        return { ...base, content: result.content };
    }
  }

  // ── Sizes and previews ───────────────────────────────────────────────────

  sizeOf(
    type: TrackItemType,
    content: any,
    item?: { scenarioId?: number | null; caseId?: string | null },
  ): string {
    switch (type) {
      case TrackItemType.ARTICLE: {
        const words = textOf(content?.html).split(' ').filter(Boolean).length;
        const checks = Array.isArray(content?.questions)
          ? content.questions.length
          : 0;
        return `${words} words${checks ? ` · ${plural(checks, 'check')}` : ''}`;
      }
      case TrackItemType.QUIZ:
        return plural(
          Array.isArray(content?.questions) ? content.questions.length : 0,
          'question',
        );
      case TrackItemType.JOURNAL:
        return plural(
          Array.isArray(content?.prompts) ? content.prompts.length : 0,
          'prompt',
        );
      case TrackItemType.ANNOTATED_ARTIFACT:
        return `${plural(Array.isArray(content?.units) ? content.units.length : 0, 'line')} · ${plural(
          Array.isArray(content?.labels) ? content.labels.length : 0,
          'label',
        )}`;
      case TrackItemType.GAME:
        return String(content?.gameKey ?? 'game');
      case TrackItemType.VIDEO:
        return String(content?.source ?? 'video');
      case TrackItemType.ROLEPLAY:
        return item?.scenarioId ? `roleplay #${item.scenarioId}` : 'roleplay';
      case TrackItemType.CASE:
        return 'case';
      default:
        return '';
    }
  }

  private previewOf(
    item: {
      type: TrackItemType;
      content?: any;
      scenarioId?: number | null;
      caseId?: string | null;
    },
    refs: {
      scenario?: Scenarios;
      caseRow?: Case;
      caseItems: number;
      generatedScenario: boolean;
      generatedCase: boolean;
    },
  ): CourseItemPreview {
    const content = (item.content ?? {}) as any;
    switch (item.type) {
      case TrackItemType.ARTICLE: {
        const text = textOf(content.html);
        return {
          type: 'ARTICLE',
          excerpt: text.length > 240 ? `${text.slice(0, 239)}…` : text,
          wordCount: text.split(' ').filter(Boolean).length,
          questionCount: Array.isArray(content.questions)
            ? content.questions.length
            : 0,
          resourceCount: Array.isArray(content.resources)
            ? content.resources.length
            : 0,
          imageUrls: Array.isArray(content.imageUrls)
            ? content.imageUrls.slice(0, 3)
            : [],
        };
      }
      case TrackItemType.QUIZ: {
        const questions = Array.isArray(content.questions)
          ? content.questions
          : [];
        return {
          type: 'QUIZ',
          questionCount: questions.length,
          passScore: content.settings?.passScore ?? null,
          sampleQuestion:
            questions[0]?.prompt ?? questions[0]?.template ?? null,
          questionTypes: [
            ...new Set<string>(questions.map((q: any) => String(q.type))),
          ],
        };
      }
      case TrackItemType.JOURNAL:
        return {
          type: 'JOURNAL',
          prompts: (Array.isArray(content.prompts) ? content.prompts : [])
            .map((p: any) => String(p.prompt ?? ''))
            .filter(Boolean),
        };
      case TrackItemType.ANNOTATED_ARTIFACT:
        return {
          type: 'ANNOTATED_ARTIFACT',
          unitCount: Array.isArray(content.units) ? content.units.length : 0,
          labels: (Array.isArray(content.labels) ? content.labels : []).map(
            (l: any) => String(l.text ?? ''),
          ),
          targetCount: Array.isArray(content.targets)
            ? content.targets.length
            : 0,
          intro: content.intro ?? null,
        };
      case TrackItemType.ROLEPLAY:
        return {
          type: 'ROLEPLAY',
          scenarioId: item.scenarioId ?? null,
          scenarioTitle: refs.scenario?.title ?? null,
          coverImageUrl: refs.scenario?.coverImageUrl ?? null,
          generated: refs.generatedScenario,
        };
      case TrackItemType.CASE:
        return {
          type: 'CASE',
          caseId: item.caseId ?? null,
          caseTitle: refs.caseRow?.title ?? null,
          roleplayCount: refs.caseItems,
          generated: refs.generatedCase,
        };
      case TrackItemType.GAME:
        return {
          type: 'GAME',
          gameKey: content.gameKey ?? null,
          intro: content.intro ?? null,
        };
      case TrackItemType.VIDEO:
      default:
        return {
          type: 'VIDEO',
          source: content.source ?? null,
          url: content.url ?? null,
        };
    }
  }

  private async caseItemCounts(
    caseIds: string[],
  ): Promise<Map<string, number>> {
    if (!caseIds.length) return new Map();
    const rows: { caseId: string; count: string }[] = await this.dataSource
      .getRepository(CaseItem)
      .createQueryBuilder('ci')
      .select('ci."caseId"', 'caseId')
      .addSelect('COUNT(*)', 'count')
      .where('ci."caseId" IN (:...caseIds)', { caseIds })
      .groupBy('ci."caseId"')
      .getRawMany();
    return new Map(rows.map((row) => [row.caseId, Number(row.count)]));
  }
}
