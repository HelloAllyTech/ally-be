import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import { Track } from 'src/track/entity/track.entity';
import {
  COURSE_COPILOT_ACTIVE_STATUSES,
  CourseCopilotJobKind as Kind,
  CourseCopilotJobStatus as JobStatus,
  CourseCopilotMode,
  CourseCopilotSessionStatus as Status,
} from '../../enum/course-copilot.enum';
import { COURSE_COPILOT_LIMITS } from '../../constants/course-copilot.constants';
import { CourseBlueprint } from '../../type/course-copilot.type';
import { CourseCopilotBriefService } from '../course-copilot-brief.service';
import { CourseCopilotSessionService } from '../course-copilot-session.service';
import { item } from '../specialists/test/specialist-test.fixtures';
import { makeJob, makeSession } from './course-copilot-test.fixtures';

const user = { id: 7, tenantId: 'tenant-1' } as any;
const platformUser = { id: 9 } as any; // a platform admin has no tenant

describe('CourseCopilotSessionService', () => {
  let service: CourseCopilotSessionService;
  let sessionRepository: {
    count: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    manager: { query: jest.Mock; getRepository: jest.Mock };
  };
  let messageRepository: { listBySession: jest.Mock };
  let jobRepository: { listBySession: jest.Mock };
  let trackShared: { getTrackById: jest.Mock };
  let costService: { budget: jest.Mock };
  let eventService: { listAfter: jest.Mock };
  let structure: {
    getTrack: jest.Mock;
    buildOutline: jest.Mock;
    readiness: jest.Mock;
  };
  let trackRepo: { find: jest.Mock };

  beforeEach(() => {
    trackRepo = { find: jest.fn().mockResolvedValue([]) };
    sessionRepository = {
      count: jest.fn().mockResolvedValue(0),
      // save echoes with an id, timestamps and the column default title, like the database would
      save: jest.fn(async (row: any) => ({
        id: 'new-session',
        title: 'New course',
        createdAt: new Date('2026-10-14T10:00:00Z'),
        updatedAt: new Date('2026-10-14T10:00:00Z'),
        ...row,
      })),
      create: jest.fn((row: any) => row),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      manager: {
        query: jest.fn().mockResolvedValue([]),
        getRepository: jest.fn().mockReturnValue(trackRepo),
      },
    };
    messageRepository = { listBySession: jest.fn().mockResolvedValue([]) };
    jobRepository = { listBySession: jest.fn().mockResolvedValue([]) };
    trackShared = { getTrackById: jest.fn() };
    costService = {
      budget: jest.fn().mockResolvedValue({
        ceilingUsd: 15,
        spentUsd: 0,
        remainingUsd: 15,
        held: false,
      }),
    };
    eventService = { listAfter: jest.fn().mockResolvedValue([]) };
    structure = {
      getTrack: jest.fn(),
      buildOutline: jest.fn().mockResolvedValue({ sections: [] }),
      readiness: jest.fn().mockResolvedValue({ ready: false, checks: [] }),
    };
    service = new CourseCopilotSessionService(
      { courseCopilot: { sessionBudgetUsd: 15 } } as any,
      sessionRepository as any,
      messageRepository as any,
      jobRepository as any,
      trackShared as any,
      new CourseCopilotBriefService(),
      costService as any,
      eventService as any,
      structure as any,
    );
  });

  // ── createSession: CREATE mode ───────────────────────────────────────────

  describe('createSession', () => {
    it('opens a new interview for the user with the configured budget', async () => {
      const summary = await service.createSession(user);

      expect(sessionRepository.create).toHaveBeenCalledWith({
        mode: CourseCopilotMode.CREATE,
        status: Status.INTERVIEWING,
        brief: {},
        budgetUsd: '15',
        tenantId: 'tenant-1',
        createdBy: 7,
        updatedBy: 7,
      });
      expect(summary).toMatchObject({
        id: 'new-session',
        mode: 'CREATE',
        status: 'INTERVIEWING',
        trackId: null,
        trackTitle: null,
        title: 'New course',
      });
    });

    it('records no tenant for a platform admin', async () => {
      await service.createSession(platformUser);
      expect(sessionRepository.create.mock.calls[0][0].tenantId).toBeNull();
    });

    it("counts only this user's CREATE sessions that are still in progress", async () => {
      await service.createSession(user);

      const { where } = sessionRepository.count.mock.calls[0][0];
      expect(where.createdBy).toBe(7);
      expect(where.mode).toBe(CourseCopilotMode.CREATE);
      expect(where.status).toEqual(In(COURSE_COPILOT_ACTIVE_STATUSES));
      // Archived and finished (EDITING) courses must not hold a slot.
      expect(COURSE_COPILOT_ACTIVE_STATUSES).not.toContain(Status.ARCHIVED);
      expect(COURSE_COPILOT_ACTIVE_STATUSES).not.toContain(Status.EDITING);
    });

    it('allows a second active session', async () => {
      sessionRepository.count.mockResolvedValue(
        COURSE_COPILOT_LIMITS.activeSessionsPerUser - 1,
      );
      await expect(service.createSession(user)).resolves.toBeDefined();
      expect(sessionRepository.save).toHaveBeenCalledTimes(1);
    });

    it.each([2, 3, 10])(
      'refuses with a ConflictException at %i active sessions, saving nothing',
      async (active) => {
        expect(COURSE_COPILOT_LIMITS.activeSessionsPerUser).toBe(2);
        sessionRepository.count.mockResolvedValue(active);

        await expect(service.createSession(user)).rejects.toThrow(
          ConflictException,
        );
        await expect(service.createSession(user)).rejects.toThrow(
          `You already have ${active} courses in progress with Course Copilot. Finish or archive one to start another.`,
        );
        expect(sessionRepository.create).not.toHaveBeenCalled();
        expect(sessionRepository.save).not.toHaveBeenCalled();
      },
    );
  });

  // ── createSession: EDIT mode ─────────────────────────────────────────────

  describe('createSession for an existing course (EDIT mode)', () => {
    const track = {
      id: 'track-1',
      title: 'Staying with the texter',
      status: 'DRAFT',
    };

    it('refuses a course that does not exist', async () => {
      trackShared.getTrackById.mockResolvedValue(null);
      await expect(
        service.createSession(user, { trackId: 'nope' }),
      ).rejects.toThrow(NotFoundException);
      expect(sessionRepository.save).not.toHaveBeenCalled();
    });

    it('opens a new session bound to the course, already in the edit loop', async () => {
      trackShared.getTrackById.mockResolvedValue(track);

      const summary = await service.createSession(user, { trackId: 'track-1' });

      expect(sessionRepository.create).toHaveBeenCalledWith({
        mode: CourseCopilotMode.EDIT,
        status: Status.EDITING,
        title: 'Staying with the texter',
        trackId: 'track-1',
        brief: {},
        budgetUsd: '15',
        tenantId: 'tenant-1',
        createdBy: 7,
        updatedBy: 7,
      });
      expect(summary).toMatchObject({
        mode: 'EDIT',
        status: 'EDITING',
        trackId: 'track-1',
        trackTitle: 'Staying with the texter',
        trackStatus: 'DRAFT',
      });
    });

    it("returns the caller's existing non-archived session for the course instead of starting a second", async () => {
      trackShared.getTrackById.mockResolvedValue(track);
      const existing = makeSession({
        id: 'existing',
        mode: CourseCopilotMode.EDIT,
        status: Status.EDITING,
        trackId: 'track-1',
        title: 'Staying with the texter',
      });
      sessionRepository.findOne.mockResolvedValue(existing);

      const summary = await service.createSession(user, { trackId: 'track-1' });

      expect(summary.id).toBe('existing');
      expect(sessionRepository.save).not.toHaveBeenCalled();
      expect(sessionRepository.findOne).toHaveBeenCalledWith({
        where: {
          createdBy: 7,
          trackId: 'track-1',
          status: Not(Status.ARCHIVED),
        },
        order: { updatedAt: 'DESC' },
      });
    });

    it("scopes the lookup to the caller: someone else's session for the course is not returned", async () => {
      trackShared.getTrackById.mockResolvedValue(track);
      sessionRepository.findOne.mockImplementation(async ({ where }: any) =>
        where.createdBy === 7
          ? null
          : makeSession({ id: 'theirs', createdBy: where.createdBy }),
      );

      const summary = await service.createSession(user, { trackId: 'track-1' });

      expect(summary.id).toBe('new-session');
      expect(sessionRepository.create).toHaveBeenCalledTimes(1);
    });

    it('is not subject to the active-session cap — editing a course is not a new course in progress', async () => {
      sessionRepository.count.mockResolvedValue(5);
      trackShared.getTrackById.mockResolvedValue(track);
      await expect(
        service.createSession(user, { trackId: 'track-1' }),
      ).resolves.toBeDefined();
      expect(sessionRepository.count).not.toHaveBeenCalled();
    });

    it('truncates a very long course title to the 200 the column holds, and names an untitled course', async () => {
      trackShared.getTrackById.mockResolvedValue({
        ...track,
        title: 'T'.repeat(300),
      });
      await service.createSession(user, { trackId: 'track-1' });
      expect(sessionRepository.create.mock.calls[0][0].title).toHaveLength(200);

      sessionRepository.create.mockClear();
      trackShared.getTrackById.mockResolvedValue({ ...track, title: '' });
      await service.createSession(user, { trackId: 'track-1' });
      expect(sessionRepository.create.mock.calls[0][0].title).toBe('Course');
    });
  });

  // ── Ownership ────────────────────────────────────────────────────────────

  describe('getOwned', () => {
    it('returns the session to its owner', async () => {
      const session = makeSession({ createdBy: 7 });
      sessionRepository.findOne.mockResolvedValue(session);
      await expect(service.getOwned('session-1', 7)).resolves.toBe(session);
      expect(sessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });

    it("throws NotFound for another user's session — and says exactly what it says for a missing one", async () => {
      sessionRepository.findOne.mockResolvedValue(
        makeSession({ createdBy: 7 }),
      );
      const forbidden = await service.getOwned('session-1', 8).catch((e) => e);

      sessionRepository.findOne.mockResolvedValue(null);
      const missing = await service.getOwned('session-1', 7).catch((e) => e);

      expect(forbidden).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      // A private working conversation: its existence is not confirmed to others.
      expect(forbidden.message).toBe(missing.message);
    });

    it('getById has no owner check but still 404s a missing session', async () => {
      sessionRepository.findOne.mockResolvedValue(
        makeSession({ createdBy: 7 }),
      );
      await expect(service.getById('session-1')).resolves.toBeDefined();
      sessionRepository.findOne.mockResolvedValue(null);
      await expect(service.getById('session-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archive', () => {
    it('refuses while the course is still being built, and says what to do', async () => {
      sessionRepository.findOne.mockResolvedValue(
        makeSession({ status: Status.BUILDING }),
      );

      await expect(service.archive('session-1', 7)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.archive('session-1', 7)).rejects.toThrow(
        /Cancel the build first/,
      );
      expect(sessionRepository.update).not.toHaveBeenCalled();
    });

    it.each([
      Status.INTERVIEWING,
      Status.AWAITING_BLUEPRINT,
      Status.BUILD_FAILED,
      Status.EDITING,
    ])('archives a %s session, recording who did it', async (status) => {
      sessionRepository.findOne.mockResolvedValue(makeSession({ status }));

      await service.archive('session-1', 7);

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { status: Status.ARCHIVED, updatedBy: 7 },
      );
    });

    it("does not let one user archive another's session", async () => {
      sessionRepository.findOne.mockResolvedValue(
        makeSession({ createdBy: 7 }),
      );
      await expect(service.archive('session-1', 8)).rejects.toThrow(
        NotFoundException,
      );
      expect(sessionRepository.update).not.toHaveBeenCalled();
    });

    it('leaves the course it made alone', async () => {
      sessionRepository.findOne.mockResolvedValue(
        makeSession({ status: Status.EDITING, trackId: 'track-1' }),
      );
      await service.archive('session-1', 7);
      expect(trackShared.getTrackById).not.toHaveBeenCalled();
      expect(structure.getTrack).not.toHaveBeenCalled();
      // Only the session row changed.
      expect(sessionRepository.update).toHaveBeenCalledTimes(1);
      expect(
        Object.keys(sessionRepository.update.mock.calls[0][1]).sort(),
      ).toEqual(['status', 'updatedBy']);
    });
  });

  describe('listSessions', () => {
    it("lists the user's live sessions, newest first, with their course titles", async () => {
      sessionRepository.find.mockResolvedValue([
        makeSession({ id: 'a', trackId: 'track-1', title: 'New course' }),
        makeSession({ id: 'b', trackId: null, title: 'New course' }),
      ]);
      trackRepo.find.mockResolvedValue([
        { id: 'track-1', title: 'Real title', status: 'DRAFT' },
      ]);

      const list = await service.listSessions(7);

      expect(sessionRepository.find).toHaveBeenCalledWith({
        where: {
          createdBy: 7,
          status: Not(Status.ARCHIVED),
          deletedAt: IsNull(),
        },
        order: { updatedAt: 'DESC' },
        take: 100,
      });
      expect(sessionRepository.manager.getRepository).toHaveBeenCalledWith(
        Track,
      );
      expect(list.map((s) => [s.id, s.title, s.trackTitle])).toEqual([
        ['a', 'Real title', 'Real title'],
        ['b', 'New course', null],
      ]);
    });

    it('does not query tracks when no session has a course', async () => {
      sessionRepository.find.mockResolvedValue([
        makeSession({ trackId: null }),
      ]);
      await service.listSessions(7);
      expect(trackRepo.find).not.toHaveBeenCalled();
    });
  });

  // ── Views ────────────────────────────────────────────────────────────────

  describe('toSummary', () => {
    it("shows the session's own title once it has one", () => {
      const summary = service.toSummary(makeSession({ title: 'My own name' }), {
        title: 'Track title',
        status: 'DRAFT',
      } as any);
      expect(summary.title).toBe('My own name');
    });

    it('falls back to the course title while the session still has the default name', () => {
      expect(
        service.toSummary(makeSession({ title: 'New course' }), {
          title: 'Track title',
          status: 'ACTIVE',
        } as any),
      ).toMatchObject({
        title: 'Track title',
        trackTitle: 'Track title',
        trackStatus: 'ACTIVE',
      });
      expect(
        service.toSummary(makeSession({ title: 'New course' }), null).title,
      ).toBe('New course');
    });

    it('serialises dates as ISO strings', () => {
      const summary = service.toSummary(makeSession(), null);
      expect(summary.createdAt).toBe('2026-10-14T10:00:00.000Z');
      expect(summary.updatedAt).toBe('2026-10-14T10:00:00.000Z');
    });
  });

  describe('toJobView', () => {
    const view = (
      overrides: Parameters<typeof makeJob>[0],
      titles: Record<string, string> = {},
    ) => service.toJobView(makeJob(overrides), new Map(Object.entries(titles)));

    it('titles a job with the title it carries, ahead of everything else', () => {
      const job = view(
        {
          kind: Kind.COURSE_META,
          blueprintItemId: 'qz',
          input: { title: 'Its own title' },
        },
        { qz: 'Blueprint title' },
      );
      expect(job.title).toBe('Its own title');
    });

    it("otherwise uses the blueprint item's title", () => {
      expect(
        view(
          { kind: Kind.QUIZ, blueprintItemId: 'qz', input: {} },
          { qz: 'Check your listening' },
        ).title,
      ).toBe('Check your listening');
    });

    it.each([
      [Kind.COURSE_META, 'Course title and description'],
      [Kind.COVER_IMAGE, 'Cover image'],
      [Kind.COURSE_REVIEW, 'Review of the finished course'],
    ])('labels the course-wide %s job "%s"', (kind, label) => {
      expect(view({ kind, input: {} }).title).toBe(label);
    });

    it('falls back to the kind when nothing else names the job', () => {
      expect(
        view({ kind: Kind.QUIZ, blueprintItemId: 'unknown', input: {} }).title,
      ).toBe('quiz');
      expect(view({ kind: Kind.ARTICLE, input: undefined as any }).title).toBe(
        'article',
      );
    });

    it('prefixes an article image with the article it illustrates', () => {
      expect(
        view(
          { kind: Kind.ARTICLE_IMAGE, blueprintItemId: 'a', input: {} },
          { a: 'Name the feeling' },
        ).title,
      ).toBe('Image for "Name the feeling"');
      expect(
        view({ kind: Kind.ARTICLE_IMAGE, input: { title: 'Name the feeling' } })
          .title,
      ).toBe('Image for "Name the feeling"');
    });

    it('carries status, attempts, error, summary and skipped reason, null where absent', () => {
      expect(
        view({
          kind: Kind.QUIZ,
          status: JobStatus.DONE,
          attempts: 2,
          error: null,
          result: { summary: '8 questions', scenarioId: 41, caseId: 'case-1' },
        }),
      ).toMatchObject({
        status: 'done',
        attempts: 2,
        error: null,
        summary: '8 questions',
        skippedReason: null,
        scenarioId: 41,
        caseId: 'case-1',
      });
      expect(
        view({
          kind: Kind.COVER_IMAGE,
          status: JobStatus.SKIPPED,
          result: { skippedReason: 'No image provider' },
        }),
      ).toMatchObject({
        summary: null,
        skippedReason: 'No image provider',
        scenarioId: null,
        caseId: null,
      });
    });

    it('converts costUsd from its numeric string, and keeps null as null (zero is a real cost)', () => {
      expect(view({ costUsd: '0.0842' }).costUsd).toBe(0.0842);
      expect(view({ costUsd: '0' }).costUsd).toBe(0);
      expect(view({ costUsd: null }).costUsd).toBeNull();
    });

    it('serialises start and finish times', () => {
      const job = view({
        startedAt: new Date('2026-10-14T10:01:00Z'),
        finishedAt: new Date('2026-10-14T10:02:30Z'),
      });
      expect(job.startedAt).toBe('2026-10-14T10:01:00.000Z');
      expect(job.finishedAt).toBe('2026-10-14T10:02:30.000Z');
      expect(view({}).startedAt).toBeNull();
    });
  });

  describe('getDetail', () => {
    const blueprintWith = (itemTitle: string): CourseBlueprint =>
      ({
        title: 't',
        sections: [
          {
            id: 's',
            title: 'S',
            items: [item({ id: 'qz', type: 'QUIZ', title: itemTitle })],
          },
        ],
      }) as unknown as CourseBlueprint;

    it("refuses a session that is not the caller's", async () => {
      sessionRepository.findOne.mockResolvedValue(
        makeSession({ createdBy: 7 }),
      );
      await expect(service.getDetail('session-1', 8)).rejects.toThrow(
        NotFoundException,
      );
      expect(messageRepository.listBySession).not.toHaveBeenCalled();
    });

    it('titles jobs from the approved blueprint, falling back to the draft', async () => {
      sessionRepository.findOne.mockResolvedValue(
        makeSession({
          trackId: null,
          approvedBlueprint: blueprintWith('Approved title'),
          blueprint: {
            ...blueprintWith('Draft title'),
            sections: [
              {
                id: 's',
                title: 'S',
                description: '',
                purpose: '',
                items: [
                  item({ id: 'qz', type: 'QUIZ', title: 'Draft title' }),
                  item({
                    id: 'only-in-draft',
                    type: 'JOURNAL',
                    title: 'Draft only',
                  }),
                ],
              },
            ],
          } as any,
        }),
      );
      jobRepository.listBySession.mockResolvedValue([
        makeJob({ kind: Kind.QUIZ, blueprintItemId: 'qz', input: {} }),
        makeJob({
          kind: Kind.JOURNAL,
          blueprintItemId: 'only-in-draft',
          input: {},
        }),
      ]);

      const detail = await service.getDetail('session-1', 7);

      expect(detail.jobs.map((j) => j.title)).toEqual([
        'Approved title',
        'Draft only',
      ]);
    });

    it('returns the brief with its readiness, and no outline before a course exists', async () => {
      sessionRepository.findOne.mockResolvedValue(
        makeSession({ trackId: null, brief: { seed: 'x' } }),
      );

      const detail = await service.getDetail('session-1', 7, 12);

      expect(detail.outline).toBeNull();
      expect(detail.readiness).toBeNull();
      expect(detail.session.briefReadiness).toMatchObject({ ready: false });
      expect(detail.session.briefReadiness.missing).not.toContain(
        'what the course is for',
      );
      expect(structure.getTrack).not.toHaveBeenCalled();
      expect(eventService.listAfter).toHaveBeenCalledWith('session-1', 12);
      expect(detail.budget).toMatchObject({ ceilingUsd: 15 });
    });

    it('never asks for events before 0', async () => {
      sessionRepository.findOne.mockResolvedValue(
        makeSession({ trackId: null }),
      );
      await service.getDetail('session-1', 7, -5);
      expect(eventService.listAfter).toHaveBeenCalledWith('session-1', 0);
    });

    it('still returns the conversation when the course can no longer be read', async () => {
      // A deleted course must not make the transcript unreadable.
      sessionRepository.findOne.mockResolvedValue(
        makeSession({ trackId: 'gone' }),
      );
      structure.getTrack.mockRejectedValue(
        new NotFoundException('Track not found'),
      );

      const detail = await service.getDetail('session-1', 7);

      expect(detail.outline).toBeNull();
      expect(detail.readiness).toBeNull();
      expect(detail.session.trackId).toBe('gone');
    });

    it('builds the outline with previews and the generated roleplay / case ids', async () => {
      const track = { id: 'track-1', title: 'Course', status: 'DRAFT' };
      sessionRepository.findOne.mockResolvedValue(
        makeSession({
          trackId: 'track-1',
          generatedScenarioIds: [4],
          generatedCaseIds: ['c'],
        }),
      );
      structure.getTrack.mockResolvedValue(track);

      const detail = await service.getDetail('session-1', 7);

      expect(structure.buildOutline).toHaveBeenCalledWith(track, {
        withPreview: true,
        generatedScenarioIds: [4],
        generatedCaseIds: ['c'],
      });
      expect(detail.session.trackTitle).toBe('Course');
    });
  });

  // ── Small atomic writes ──────────────────────────────────────────────────

  describe('atomic session writes', () => {
    it('appendChangeLog stamps the entry and keeps the newest fifty', async () => {
      const entry = await service.appendChangeLog('session-1', {
        summary: 'Did a thing',
        tool: 'add_item',
      });

      expect(entry).toMatchObject({ summary: 'Did a thing', tool: 'add_item' });
      expect(new Date(entry.at).toISOString()).toBe(entry.at);
      const [, params] = sessionRepository.manager.query.mock.calls[0];
      expect(params[0]).toBe('session-1');
      expect(JSON.parse(params[1])).toEqual([entry]);
      expect(params[2]).toBe(50);
    });

    it.each([
      ['scenario', 'generatedScenarioIds', 41],
      ['case', 'generatedCaseIds', 'case-7'],
      ['character', 'generatedCharacterIds', 'char-3'],
    ] as const)('addGenerated(%s) appends to %s', async (kind, column, id) => {
      await service.addGenerated('session-1', kind, id);
      const [sql, params] = sessionRepository.manager.query.mock.calls[0];
      expect(sql).toContain(`"${column}"`);
      expect(params).toEqual(['session-1', JSON.stringify([id])]);
    });

    it('addGenerated never lists an id twice', async () => {
      await service.addGenerated('session-1', 'scenario', 41);
      expect(sessionRepository.manager.query.mock.calls[0][0]).toMatch(
        /@> \$2::jsonb THEN/,
      );
    });

    it('patchMetadata merges a JSON patch rather than replacing metadata', async () => {
      await service.patchMetadata('session-1', { pendingConfirmation: null });
      const [sql, params] = sessionRepository.manager.query.mock.calls[0];
      expect(sql).toMatch(
        /COALESCE\("metadata", '\{\}'::jsonb\) \|\| \$2::jsonb/,
      );
      expect(params).toEqual(['session-1', '{"pendingConfirmation":null}']);
    });

    it('setStatus updates only the status', async () => {
      await service.setStatus('session-1', Status.EDITING);
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { status: Status.EDITING },
      );
    });
  });
});
