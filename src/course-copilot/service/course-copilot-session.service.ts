import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';
import { TokenUser } from 'src/auth/type/auth.types';
import { LoggerService } from 'src/logger/logger.service';
import { TrackSharedService } from 'src/track/service/track-shared.service';
import { Track } from 'src/track/entity/track.entity';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import { CourseCopilotJob } from '../entity/course-copilot-job.entity';
import { CourseCopilotMessage } from '../entity/course-copilot-message.entity';
import {
  COURSE_COPILOT_ACTIVE_STATUSES,
  CourseCopilotJobKind,
  CourseCopilotMode,
  CourseCopilotSessionStatus,
} from '../enum/course-copilot.enum';
import {
  CourseCopilotJobRepository,
  CourseCopilotMessageRepository,
  CourseCopilotSessionRepository,
} from '../repository/course-copilot.repository';
import {
  CourseCopilotJobView,
  CourseCopilotMessageView,
  CourseCopilotSessionDetail,
  CourseCopilotSessionSummary,
} from '../type/course-copilot-api.type';
import { CourseChangeLogEntry } from '../type/course-copilot.type';
import { COURSE_COPILOT_LIMITS } from '../constants/course-copilot.constants';
import { CourseCopilotBriefService } from './course-copilot-brief.service';
import {
  COURSE_COPILOT_ANALYTICS_EVENTS,
  CourseCopilotAnalyticsService,
} from './course-copilot-analytics.service';
import { CourseCopilotCostService } from './course-copilot-cost.service';
import { CourseCopilotEventService } from './course-copilot-event.service';
import { CourseCopilotStructureService } from './course-copilot-structure.service';

const CHANGE_LOG_MAX = 50;

/** Course-wide job labels for the build panel. */
const COURSE_JOB_TITLES: Partial<Record<CourseCopilotJobKind, string>> = {
  [CourseCopilotJobKind.COURSE_META]: 'Course title and description',
  [CourseCopilotJobKind.COVER_IMAGE]: 'Cover image',
  [CourseCopilotJobKind.COURSE_REVIEW]: 'Review of the finished course',
};

const iso = (value: Date | null | undefined) =>
  value ? new Date(value).toISOString() : null;

/**
 * Session lifecycle: create (with the per-user cap and EDIT-mode binding),
 * owner-only reads, the detail payload the page renders, archive, and the
 * small atomic writes other services make to a session row.
 */
@Injectable()
export class CourseCopilotSessionService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotSessionService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly sessionRepository: CourseCopilotSessionRepository,
    private readonly messageRepository: CourseCopilotMessageRepository,
    private readonly jobRepository: CourseCopilotJobRepository,
    private readonly trackSharedService: TrackSharedService,
    private readonly briefService: CourseCopilotBriefService,
    private readonly costService: CourseCopilotCostService,
    private readonly eventService: CourseCopilotEventService,
    private readonly structureService: CourseCopilotStructureService,
    @Optional() private readonly analytics?: CourseCopilotAnalyticsService,
  ) {}

  async createSession(
    user: TokenUser,
    options: { trackId?: string } = {},
  ): Promise<CourseCopilotSessionSummary> {
    if (options.trackId) {
      return this.openForTrack(user, options.trackId);
    }

    const active = await this.sessionRepository.count({
      where: {
        createdBy: user.id,
        mode: CourseCopilotMode.CREATE,
        status: In(COURSE_COPILOT_ACTIVE_STATUSES),
      },
    });
    if (active >= COURSE_COPILOT_LIMITS.activeSessionsPerUser) {
      throw new ConflictException(
        `You already have ${active} courses in progress with Course Copilot. ` +
          'Finish or archive one to start another.',
      );
    }

    const session = await this.sessionRepository.save(
      this.sessionRepository.create({
        mode: CourseCopilotMode.CREATE,
        status: CourseCopilotSessionStatus.INTERVIEWING,
        brief: {},
        budgetUsd: String(this.configService.courseCopilot.sessionBudgetUsd),
        tenantId: user.tenantId ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      }),
    );
    this.analytics?.capture(
      COURSE_COPILOT_ANALYTICS_EVENTS.SESSION_STARTED,
      user.id,
      { session_id: session.id, mode: session.mode },
    );
    return this.toSummary(session, null);
  }

  /**
   * EDIT mode: a session bound to a course that already exists. Re-opening
   * the same course resumes the caller's session for it rather than starting
   * a second conversation about the same thing.
   */
  private async openForTrack(
    user: TokenUser,
    trackId: string,
  ): Promise<CourseCopilotSessionSummary> {
    const track = await this.trackSharedService.getTrackById(trackId);
    if (!track) throw new NotFoundException('Course not found');

    const existing = await this.sessionRepository.findOne({
      where: {
        createdBy: user.id,
        trackId,
        status: Not(CourseCopilotSessionStatus.ARCHIVED),
      },
      order: { updatedAt: 'DESC' },
    });
    if (existing) return this.toSummary(existing, track);

    const session = await this.sessionRepository.save(
      this.sessionRepository.create({
        mode: CourseCopilotMode.EDIT,
        status: CourseCopilotSessionStatus.EDITING,
        title: track.title?.slice(0, 200) || 'Course',
        trackId,
        brief: {},
        budgetUsd: String(this.configService.courseCopilot.sessionBudgetUsd),
        tenantId: user.tenantId ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      }),
    );
    this.analytics?.capture(
      COURSE_COPILOT_ANALYTICS_EVENTS.SESSION_STARTED,
      user.id,
      { session_id: session.id, mode: session.mode, track_id: trackId },
    );
    return this.toSummary(session, track);
  }

  async listSessions(userId: number): Promise<CourseCopilotSessionSummary[]> {
    const sessions = await this.sessionRepository.find({
      where: {
        createdBy: userId,
        status: Not(CourseCopilotSessionStatus.ARCHIVED),
        deletedAt: IsNull(),
      },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
    const trackIds = sessions
      .map((session) => session.trackId)
      .filter((id): id is string => Boolean(id));
    const tracks = trackIds.length
      ? await this.sessionRepository.manager.getRepository(Track).find({
          where: { id: In(trackIds) },
          select: { id: true, title: true, status: true },
        })
      : [];
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return sessions.map((session) =>
      this.toSummary(
        session,
        session.trackId ? byId.get(session.trackId) : null,
      ),
    );
  }

  /** Owner only — a copilot session is a private working conversation. */
  async getOwned(
    sessionId: string,
    userId: number,
  ): Promise<CourseCopilotSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session || session.createdBy !== userId) {
      throw new NotFoundException('This copilot session no longer exists.');
    }
    return session;
  }

  async getById(sessionId: string): Promise<CourseCopilotSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('This copilot session no longer exists.');
    }
    return session;
  }

  async getDetail(
    sessionId: string,
    userId: number,
    afterSeq = 0,
  ): Promise<CourseCopilotSessionDetail> {
    const session = await this.getOwned(sessionId, userId);
    const [messages, jobs, events, budget] = await Promise.all([
      this.messageRepository.listBySession(session.id),
      this.jobRepository.listBySession(session.id),
      this.eventService.listAfter(session.id, Math.max(0, afterSeq)),
      this.costService.budget(session),
    ]);

    let outline: CourseCopilotSessionDetail['outline'] = null;
    let readiness: CourseCopilotSessionDetail['readiness'] = null;
    let track: Track | null = null;
    if (session.trackId) {
      try {
        const full = await this.structureService.getTrack(session.trackId);
        track = full;
        [outline, readiness] = await Promise.all([
          this.structureService.buildOutline(full, {
            withPreview: true,
            generatedScenarioIds: session.generatedScenarioIds,
            generatedCaseIds: session.generatedCaseIds,
          }),
          this.structureService.readiness(full),
        ]);
      } catch (error) {
        // A deleted course must not make the conversation unreadable.
        this.logger.warn(
          `Course Copilot ${session.id}: course ${session.trackId} unreadable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const titles = this.blueprintTitles(session);
    return {
      session: {
        ...this.toSummary(session, track),
        brief: session.brief ?? {},
        briefReadiness: this.briefService.readiness(session.brief),
        blueprint: session.blueprint ?? null,
        blueprintVersion: session.blueprintVersion,
        approvedBlueprint: session.approvedBlueprint ?? null,
        changeLog: Array.isArray(session.metadata?.changeLog)
          ? session.metadata!.changeLog
          : [],
        generatedScenarioIds: session.generatedScenarioIds ?? [],
        generatedCaseIds: session.generatedCaseIds ?? [],
      },
      messages: messages.map((message) => this.toMessageView(message)),
      jobs: jobs.map((job) => this.toJobView(job, titles)),
      events,
      lastEventSeq: session.lastEventSeq,
      outline,
      readiness,
      budget,
    };
  }

  async archive(sessionId: string, userId: number): Promise<void> {
    const session = await this.getOwned(sessionId, userId);
    if (session.status === CourseCopilotSessionStatus.BUILDING) {
      throw new BadRequestException(
        'The course is still being built. Cancel the build first, then archive.',
      );
    }
    await this.sessionRepository.update(
      { id: session.id },
      { status: CourseCopilotSessionStatus.ARCHIVED, updatedBy: userId },
    );
  }

  async setStatus(
    sessionId: string,
    status: CourseCopilotSessionStatus,
  ): Promise<void> {
    await this.sessionRepository.update({ id: sessionId }, { status });
  }

  /** Shallow-merge keys into `metadata` atomically. */
  async patchMetadata(
    sessionId: string,
    patch: Record<string, any>,
  ): Promise<void> {
    await this.sessionRepository.manager.query(
      `UPDATE "course_copilot_sessions"
          SET "metadata" = COALESCE("metadata", '{}'::jsonb) || $2::jsonb
        WHERE id = $1`,
      [sessionId, JSON.stringify(patch)],
    );
  }

  /** Append one entry to the change log, keeping the newest fifty. */
  async appendChangeLog(
    sessionId: string,
    entry: Omit<CourseChangeLogEntry, 'at'>,
  ): Promise<CourseChangeLogEntry> {
    const full: CourseChangeLogEntry = {
      at: new Date().toISOString(),
      ...entry,
    };
    await this.sessionRepository.manager.query(
      `UPDATE "course_copilot_sessions" s
          SET "metadata" = jsonb_set(
            COALESCE(s."metadata", '{}'::jsonb),
            '{changeLog}',
            (
              SELECT COALESCE(jsonb_agg(x.e ORDER BY x.i), '[]'::jsonb)
                FROM jsonb_array_elements(
                       COALESCE(s."metadata" -> 'changeLog', '[]'::jsonb) || $2::jsonb
                     ) WITH ORDINALITY AS x(e, i)
               WHERE x.i > jsonb_array_length(
                       COALESCE(s."metadata" -> 'changeLog', '[]'::jsonb) || $2::jsonb
                     ) - $3
            )
          )
        WHERE s.id = $1`,
      [sessionId, JSON.stringify([full]), CHANGE_LOG_MAX],
    );
    return full;
  }

  /** Record a roleplay/case this session generated (provenance + previews). */
  async addGenerated(
    sessionId: string,
    kind: 'scenario' | 'case' | 'character',
    id: number | string,
  ): Promise<void> {
    const column =
      kind === 'scenario'
        ? 'generatedScenarioIds'
        : kind === 'case'
          ? 'generatedCaseIds'
          : 'generatedCharacterIds';
    await this.sessionRepository.manager.query(
      `UPDATE "course_copilot_sessions"
          SET "${column}" = CASE
                WHEN "${column}" @> $2::jsonb THEN "${column}"
                ELSE "${column}" || $2::jsonb
              END
        WHERE id = $1`,
      [sessionId, JSON.stringify([id])],
    );
  }

  toSummary(
    session: CourseCopilotSession,
    track: Pick<Track, 'title' | 'status'> | null | undefined,
  ): CourseCopilotSessionSummary {
    return {
      id: session.id,
      title:
        session.title && session.title !== 'New course'
          ? session.title
          : (track?.title ?? session.title),
      mode: session.mode,
      status: session.status,
      trackId: session.trackId ?? null,
      trackTitle: track?.title ?? null,
      trackStatus: track?.status ?? null,
      createdAt: iso(session.createdAt)!,
      updatedAt: iso(session.updatedAt)!,
    };
  }

  toMessageView(message: CourseCopilotMessage): CourseCopilotMessageView {
    return {
      id: message.id,
      seq: message.seq,
      role: message.role,
      content: message.content ?? null,
      toolCalls: message.toolCalls ?? null,
      toolResults: message.toolResults ?? null,
      metadata: message.metadata ?? null,
      createdAt: iso(message.createdAt)!,
    };
  }

  toJobView(
    job: CourseCopilotJob,
    titles: Map<string, string>,
  ): CourseCopilotJobView {
    const title =
      (job.input?.title as string | undefined) ??
      (job.blueprintItemId ? titles.get(job.blueprintItemId) : undefined) ??
      COURSE_JOB_TITLES[job.kind] ??
      job.kind;
    return {
      id: job.id,
      kind: job.kind,
      blueprintItemId: job.blueprintItemId ?? null,
      title:
        job.kind === CourseCopilotJobKind.ARTICLE_IMAGE
          ? `Image for "${title}"`
          : title,
      status: job.status,
      attempts: job.attempts,
      error: job.error ?? null,
      summary: job.result?.summary ?? null,
      skippedReason: job.result?.skippedReason ?? null,
      startedAt: iso(job.startedAt),
      finishedAt: iso(job.finishedAt),
      costUsd:
        job.costUsd !== null && job.costUsd !== undefined
          ? Number(job.costUsd)
          : null,
      scenarioId: job.result?.scenarioId ?? null,
      caseId: job.result?.caseId ?? null,
    };
  }

  private blueprintTitles(session: CourseCopilotSession): Map<string, string> {
    const titles = new Map<string, string>();
    for (const blueprint of [session.approvedBlueprint, session.blueprint]) {
      for (const section of blueprint?.sections ?? []) {
        for (const item of section.items ?? []) {
          if (!titles.has(item.id)) titles.set(item.id, item.title);
        }
      }
    }
    return titles;
  }
}
