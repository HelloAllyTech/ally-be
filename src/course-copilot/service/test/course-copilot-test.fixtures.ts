import { BadRequestException } from '@nestjs/common';
import { CourseCopilotSession } from '../../entity/course-copilot-session.entity';
import { CourseCopilotJob } from '../../entity/course-copilot-job.entity';
import {
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
  CourseCopilotMode,
  CourseCopilotSessionStatus,
} from '../../enum/course-copilot.enum';
import { TrackItemType } from 'src/track/type/track.type';

/**
 * Shared fakes for the Course Copilot service specs: rows, an in-memory job
 * repository that honours the real one's conditional-UPDATE semantics, and an
 * in-memory course that behaves like `TrackService.upsertStructure` (refuses
 * ids it did not create, requires contiguous orders, deletes what is omitted).
 */

let counter = 0;
export const nextId = (prefix: string) => `${prefix}-${++counter}`;

export function makeSession(
  overrides: Partial<CourseCopilotSession> = {},
): CourseCopilotSession {
  return {
    id: 'session-1',
    title: 'New course',
    mode: CourseCopilotMode.CREATE,
    status: CourseCopilotSessionStatus.BUILDING,
    trackId: 'track-1',
    brief: {},
    blueprint: null,
    blueprintVersion: 1,
    approvedBlueprint: null,
    trackIdMap: { sections: {}, items: {} },
    budgetUsd: '15.00',
    generatedScenarioIds: [],
    generatedCaseIds: [],
    generatedCharacterIds: [],
    metadata: null,
    lastMessageSeq: 0,
    lastEventSeq: 0,
    tenantId: null,
    createdBy: 7,
    updatedBy: 7,
    createdAt: new Date('2026-10-14T10:00:00Z'),
    updatedAt: new Date('2026-10-14T10:00:00Z'),
    ...overrides,
  } as CourseCopilotSession;
}

export function makeJob(
  overrides: Partial<CourseCopilotJob> = {},
): CourseCopilotJob {
  return {
    id: nextId('job'),
    sessionId: 'session-1',
    kind: CourseCopilotJobKind.QUIZ,
    blueprintItemId: null,
    dependsOn: [],
    status: CourseCopilotJobStatus.QUEUED,
    attempts: 0,
    input: { title: 'A job' },
    result: null,
    error: null,
    costUsd: null,
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    createdAt: new Date('2026-10-14T10:00:00Z'),
    updatedAt: new Date('2026-10-14T10:00:00Z'),
    ...overrides,
  } as CourseCopilotJob;
}

const clone = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));

const SETTLED = ['done', 'failed', 'skipped'];

/**
 * In-memory stand-in for CourseCopilotJobRepository.
 *
 * It copies the real repository's guarantees, because the runner's
 * correctness leans on them: `claim` only moves queued → running, `settle`
 * only moves a *running* job (so a reconciled-away job is not resurrected),
 * `setStatus` only touches rows in a `from` status, and every read returns a
 * fresh copy (the runner mutates the snapshot it holds — that must not leak
 * into "the database").
 */
export class FakeJobRepository {
  rows: CourseCopilotJob[] = [];

  seed(...jobs: CourseCopilotJob[]) {
    this.rows.push(...jobs);
    return this;
  }

  byId(id: string): CourseCopilotJob {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`No fake job ${id}`);
    return row;
  }

  statusOf(id: string) {
    return this.byId(id).status;
  }

  create = jest.fn((partial: Partial<CourseCopilotJob>) =>
    makeJob({
      ...partial,
      id: partial.id ?? nextId('job'),
    } as Partial<CourseCopilotJob>),
  );

  save = jest.fn(async (input: any) => {
    const list: CourseCopilotJob[] = Array.isArray(input) ? input : [input];
    for (const job of list) {
      const index = this.rows.findIndex((row) => row.id === job.id);
      if (index >= 0) this.rows[index] = job;
      else this.rows.push(job);
    }
    return input;
  });

  listBySession = jest.fn(async (sessionId: string) =>
    this.rows
      .filter((row) => row.sessionId === sessionId)
      .map((row) => clone(row)),
  );

  findOne = jest.fn(async (options: { where: { id: string } }) => {
    const row = this.rows.find(
      (candidate) => candidate.id === options.where.id,
    );
    return row ? clone(row) : null;
  });

  claim = jest.fn(async (jobId: string) => {
    const row = this.rows.find((candidate) => candidate.id === jobId);
    if (!row || row.status !== CourseCopilotJobStatus.QUEUED) return null;
    row.status = CourseCopilotJobStatus.RUNNING;
    row.attempts += 1;
    row.startedAt = row.startedAt ?? new Date(Date.now());
    row.heartbeatAt = new Date(Date.now());
    row.error = null;
    return clone(row);
  });

  heartbeat = jest.fn(async (jobId: string) => {
    const row = this.rows.find((candidate) => candidate.id === jobId);
    if (row?.status === CourseCopilotJobStatus.RUNNING) {
      row.heartbeatAt = new Date(Date.now());
    }
  });

  settle = jest.fn(
    async (
      jobId: string,
      status: CourseCopilotJobStatus,
      patch: { result?: any; error?: string | null },
    ) => {
      const row = this.rows.find((candidate) => candidate.id === jobId);
      if (!row || row.status !== CourseCopilotJobStatus.RUNNING) return false;
      row.status = status;
      // COALESCE($3::jsonb, "result"): a null patch keeps the old result.
      if (patch.result !== undefined && patch.result !== null) {
        row.result = clone(patch.result);
      }
      row.error = patch.error ?? null;
      row.finishedAt = new Date(Date.now());
      return true;
    },
  );

  requeueForRepair = jest.fn(async (jobId: string, error: string) => {
    const row = this.rows.find((candidate) => candidate.id === jobId);
    if (row?.status === CourseCopilotJobStatus.RUNNING) {
      row.status = CourseCopilotJobStatus.QUEUED;
      row.error = error;
    }
  });

  setStatus = jest.fn(
    async (
      jobIds: string[],
      from: CourseCopilotJobStatus[],
      to: CourseCopilotJobStatus,
      extra: { error?: string | null; resetAttempts?: boolean } = {},
    ) => {
      const changed: string[] = [];
      for (const id of jobIds) {
        const row = this.rows.find((candidate) => candidate.id === id);
        if (!row || !from.includes(row.status)) continue;
        row.status = to;
        if (extra.error !== undefined) row.error = extra.error ?? null;
        if (extra.resetAttempts) row.attempts = 0;
        row.finishedAt = SETTLED.includes(to) ? new Date(Date.now()) : null;
        changed.push(id);
      }
      return changed;
    },
  );

  /** Accepts `{ id }` or `{ id: In([...]) }` like the real Repository.update. */
  update = jest.fn(async (criteria: any, patch: Record<string, any>) => {
    const ids: string[] = Array.isArray(criteria.id?.value)
      ? criteria.id.value
      : [criteria.id];
    for (const row of this.rows) {
      if (ids.includes(row.id)) Object.assign(row, clone(patch));
    }
  });

  findStale = jest.fn(async (staleMs: number) =>
    this.rows
      .filter(
        (row) =>
          row.status === CourseCopilotJobStatus.RUNNING &&
          Date.now() -
            new Date(
              row.heartbeatAt ?? row.startedAt ?? row.createdAt,
            ).getTime() >
            staleMs,
      )
      .map((row) => clone(row)),
  );

  countByStatus = jest.fn(
    async (sessionId: string, statuses: CourseCopilotJobStatus[]) =>
      this.rows.filter(
        (row) => row.sessionId === sessionId && statuses.includes(row.status),
      ).length,
  );

  /**
   * reconcile's one query: DISTINCT sessionId with a queued or running job.
   * Shortcut — it ignores whatever the chain is asked and answers that.
   */
  createQueryBuilder = jest.fn(() => {
    const chain: any = {
      select: () => chain,
      where: () => chain,
      getRawMany: async () =>
        [
          ...new Set(
            this.rows
              .filter((row) =>
                [
                  CourseCopilotJobStatus.QUEUED,
                  CourseCopilotJobStatus.RUNNING,
                ].includes(row.status),
              )
              .map((row) => row.sessionId),
          ),
        ].map((sessionId) => ({ sessionId })),
    };
    return chain;
  });
}

/**
 * In-memory CourseCopilotSessionRepository. `manager.query` recognises the two
 * raw UPDATEs the build service issues (finish / cancel) by their text and
 * applies their effect, so specs assert on resulting state, not SQL.
 */
export class FakeSessionRepository {
  rows = new Map<string, CourseCopilotSession>();

  seed(...sessions: CourseCopilotSession[]) {
    for (const session of sessions) this.rows.set(session.id, session);
    return this;
  }

  get(id: string): CourseCopilotSession {
    const row = this.rows.get(id);
    if (!row) throw new Error(`No fake session ${id}`);
    return row;
  }

  findOne = jest.fn(async (options: { where: { id: string } }) => {
    const row = this.rows.get(options.where.id);
    return row ? clone(row) : null;
  });

  update = jest.fn(async (criteria: { id: string }, patch: any) => {
    const row = this.rows.get(criteria.id);
    if (row) Object.assign(row, clone(patch));
  });

  manager = {
    query: jest.fn(async (sql: string, params: any[]) => {
      const row = this.rows.get(params[0]);
      if (!row) return [];
      const conditional = sql.includes(
        `"status" IN ('BUILDING','BUILD_FAILED')`,
      );
      const toEditing = sql.includes(`"status" = 'EDITING'`);
      if (toEditing) {
        row.status = CourseCopilotSessionStatus.EDITING;
      } else if (
        conditional &&
        [
          CourseCopilotSessionStatus.BUILDING,
          CourseCopilotSessionStatus.BUILD_FAILED,
        ].includes(row.status)
      ) {
        row.status = CourseCopilotSessionStatus.EDITING;
      }
      if (sql.includes('buildCompletedAt')) {
        row.metadata = {
          ...(row.metadata ?? {}),
          buildCompletedAt:
            row.metadata?.buildCompletedAt ??
            new Date(Date.now()).toISOString(),
        };
      }
      return [[], 1];
    }),
  };
}

/** The event service as the services use it: record() and nothing else. */
export class FakeEventService {
  events: { sessionId: string; type: string; payload: any }[] = [];
  record = jest.fn(
    async (sessionId: string, type: string, payload: any = {}) => {
      this.events.push({ sessionId, type, payload });
    },
  );

  of(type: string) {
    return this.events.filter((event) => event.type === type);
  }

  types() {
    return this.events.map((event) => event.type);
  }
}

// ── An in-memory course ─────────────────────────────────────────────────────

export interface FakeItemSeed {
  type: TrackItemType | `${TrackItemType}`;
  title: string;
  id?: string;
  scenarioId?: number;
  caseId?: string;
  content?: Record<string, any>;
  completionCriteria?: Record<string, any>;
  description?: string;
}

export interface FakeSectionSeed {
  title: string;
  id?: string;
  description?: string;
  items?: FakeItemSeed[];
}

/**
 * A course in memory with the same contract as the real write path:
 *  - an id the course did not create is refused ("does not belong"),
 *  - orders must run 1..n at both levels,
 *  - anything omitted from the payload is removed,
 *  - rows without an id are created and given one by the "server".
 */
export class FakeTrackStore {
  track: Record<string, any>;
  sections: any[] = [];
  /** Every payload `upsertStructure` accepted, in order. */
  saves: any[][] = [];
  private ids = 0;

  constructor(
    sections: FakeSectionSeed[] = [],
    track: Record<string, any> = {},
  ) {
    this.track = {
      id: 'track-1',
      title: 'Staying with the texter',
      description: '<p>A short course.</p>',
      coverImageUrl: 'https://cdn.example.org/cover.png',
      status: 'DRAFT',
      estimatedDurationMinutes: 40,
      competencyIds: ['c-1'],
      ...track,
    };
    this.sections = sections.map((section, sectionIndex) =>
      this.toRow(section, sectionIndex),
    );
  }

  private newId(prefix: string) {
    this.ids += 1;
    return `${prefix}${this.ids}`;
  }

  private toRow(section: FakeSectionSeed, index: number) {
    const id = section.id ?? this.newId('S');
    return {
      id,
      trackId: this.track.id,
      title: section.title,
      description: section.description ?? null,
      order: index + 1,
      items: (section.items ?? []).map((item, itemIndex) => ({
        id: item.id ?? this.newId('I'),
        sectionId: id,
        type: item.type,
        order: itemIndex + 1,
        title: item.title,
        description: item.description ?? null,
        scenarioId: item.scenarioId ?? null,
        caseId: item.caseId ?? null,
        content: item.content ?? null,
        completionCriteria: item.completionCriteria ?? null,
        hasDiscussion: false,
      })),
    };
  }

  snapshot() {
    return clone({ ...this.track, sections: this.sections });
  }

  /** Ids in order, e.g. `['S1', 'I2', 'I3']` flattened per section. */
  itemIds(): string[] {
    return this.sections.flatMap((section) =>
      section.items.map((item: any) => item.id),
    );
  }

  item(id: string) {
    for (const section of this.sections) {
      const found = section.items.find((item: any) => item.id === id);
      if (found) return found;
    }
    return undefined;
  }

  getTrackWithStructure = jest.fn(async (trackId: string) => {
    if (trackId !== this.track.id) throw new Error(`No fake track ${trackId}`);
    return this.snapshot();
  });

  upsertStructure = jest.fn(
    async (_trackId: string, body: { sections: any[] }) => {
      const knownSections = new Set(this.sections.map((s) => s.id));
      const knownItems = new Set(this.itemIds());
      body.sections.forEach((section, sectionIndex) => {
        if (section.id && !knownSections.has(section.id)) {
          throw new BadRequestException(
            `Section ${section.id} does not belong to this track`,
          );
        }
        if (section.order !== sectionIndex + 1) {
          throw new BadRequestException('Section orders must be contiguous');
        }
        section.items.forEach((item: any, itemIndex: number) => {
          if (item.id && !knownItems.has(item.id)) {
            throw new BadRequestException(
              `Item ${item.id} does not belong to this track`,
            );
          }
          if (item.order !== itemIndex + 1) {
            throw new BadRequestException('Item orders must be contiguous');
          }
        });
      });
      this.saves.push(clone(body.sections));
      this.sections = body.sections.map((section) => {
        const id = section.id ?? this.newId('S');
        return {
          id,
          trackId: this.track.id,
          title: section.title,
          description: section.description ?? null,
          order: section.order,
          items: section.items.map((item: any) => ({
            id: item.id ?? this.newId('I'),
            sectionId: id,
            type: item.type,
            order: item.order,
            title: item.title,
            description: item.description ?? null,
            scenarioId: item.scenarioId ?? null,
            caseId: item.caseId ?? null,
            content: item.content ?? null,
            completionCriteria: item.completionCriteria ?? null,
            hasDiscussion: item.hasDiscussion ?? false,
          })),
        };
      });
      return this.snapshot();
    },
  );
}
