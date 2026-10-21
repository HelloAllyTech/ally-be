import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import { BuilderSessionService } from '../builder-session.service';
import { BuilderSessionStatus } from '../../enum/builder.enum';
import {
  BUILDER_HANDOFF_CONTEXT_MAX,
  BUILDER_MAX_ACTIVE_SESSIONS_PER_TENANT,
} from '../../constants/builder.constants';

describe('BuilderSessionService', () => {
  let service: BuilderSessionService;
  let sessionRepository: {
    save: jest.Mock;
    create: jest.Mock;
    count: jest.Mock;
    find: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    slugExists: jest.Mock;
    findCreatorNames: jest.Mock;
  };
  let prdService: {
    getOrCreateDoc: jest.Mock;
    applyPatch: jest.Mock;
    computeReadiness: jest.Mock;
  };
  let settingsService: { get: jest.Mock };
  let buildService: { findCancellableRun: jest.Mock; cancelRun: jest.Mock };
  let readinessService: { assess: jest.Mock; settle: jest.Mock };
  let reviewService: { dismiss: jest.Mock };

  beforeEach(() => {
    sessionRepository = {
      save: jest.fn(async (session) => ({ id: 'session-1', ...session })),
      create: jest.fn((session) => session),
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn(),
      update: jest.fn(),
      slugExists: jest.fn().mockResolvedValue(false),
      findCreatorNames: jest.fn().mockResolvedValue(new Map()),
    };
    settingsService = {
      get: jest.fn().mockResolvedValue({ defaultBudgetUsd: null }),
    };
    // Cancelling now has to reach the build service — a DB-only cancel left
    // the runner working for up to two hours.
    buildService = {
      findCancellableRun: jest.fn().mockResolvedValue(null),
      cancelRun: jest.fn().mockResolvedValue(undefined),
    };
    prdService = {
      getOrCreateDoc: jest.fn().mockResolvedValue({ id: 'doc-1', draft: {} }),
      applyPatch: jest
        .fn()
        .mockResolvedValue({ doc: { draft: {}, versionNumber: 2 } }),
      computeReadiness: jest.fn().mockReturnValue({
        score: 0,
        ready: false,
        sections: [],
        blockers: [],
      }),
    };

    const notReady = { score: 0, ready: false, sections: [], blockers: [] };
    readinessService = {
      assess: jest.fn().mockResolvedValue(notReady),
      settle: jest.fn().mockResolvedValue(notReady),
    };
    reviewService = { dismiss: jest.fn().mockResolvedValue({}) };

    service = new BuilderSessionService(
      { builder: { defaultBudgetUsd: 25 } } as any,
      sessionRepository as any,
      {} as any,
      // Pull requests: read by getDeliveryState, which the roadmap polls to
      // learn whether a session's work actually shipped.
      { listBySession: jest.fn().mockResolvedValue([]) } as any,
      prdService as any,
      settingsService as any,
      buildService as any,
      readinessService as any,
      reviewService as any,
    );
  });

  describe('createSession', () => {
    it('derives a branch-safe slug from the title', async () => {
      await service.createSession(1, { title: 'Add a Builder tab!' });

      expect(sessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'add-a-builder-tab' }),
      );
    });

    it('falls back to a default slug when the title has no usable characters, keeping the title itself', async () => {
      await service.createSession(1, { title: '???' });

      // The title is the admin's own words and is kept as typed; only the
      // slug needs to survive being a git branch component.
      expect(sessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'build', title: '???' }),
      );
    });

    it('titles an untitled session "New build"', async () => {
      await service.createSession(1, {});

      expect(sessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'build', title: 'New build' }),
      );
    });

    it('stamps the configured default budget, so no session runs uncapped', async () => {
      // `defaultBudgetUsd` was documented as applied at creation and never
      // read, so the budget guard short-circuited on null for every session
      // an admin did not manually cap.
      await service.createSession(1, {});

      expect(sessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ budgetUsd: '25' }),
      );
    });

    it('prefers the settings budget over the config default', async () => {
      settingsService.get.mockResolvedValue({ defaultBudgetUsd: '10.0000' });

      await service.createSession(1, {});

      expect(sessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ budgetUsd: '10.0000' }),
      );
    });

    it('suffixes a taken slug rather than colliding on the branch name', async () => {
      sessionRepository.slugExists
        .mockResolvedValueOnce(true) // "builder-tab"
        .mockResolvedValueOnce(true) // "builder-tab-2"
        .mockResolvedValueOnce(false); // "builder-tab-3"

      await service.createSession(1, { title: 'Builder tab' });

      expect(sessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'builder-tab-3' }),
      );
    });

    it('refuses a tenant already at the concurrent-session cap, naming the way out', async () => {
      sessionRepository.count.mockResolvedValue(
        BUILDER_MAX_ACTIVE_SESSIONS_PER_TENANT,
      );

      await expect(
        service.createSession(1, { title: 'Another', tenantId: 'tenant-a' }),
      ).rejects.toThrow(/Finish or cancel one/);
    });

    it('does not cap a platform admin (no tenant)', async () => {
      sessionRepository.count.mockResolvedValue(999);

      await expect(
        service.createSession(1, { title: 'Fine' }),
      ).resolves.toBeDefined();
      expect(sessionRepository.count).not.toHaveBeenCalled();
    });
  });

  describe('hand-off context', () => {
    it('stores what the caller handed over, trimmed and bounded', async () => {
      await service.createSession(1, {
        title: 'From the roadmap',
        handoffContext: `  ${'x'.repeat(BUILDER_HANDOFF_CONTEXT_MAX + 50)}  `,
      });

      const created = sessionRepository.create.mock.calls[0][0];
      expect(created.handoffContext).toHaveLength(BUILDER_HANDOFF_CONTEXT_MAX);
      expect(created.handoffContext.startsWith('x')).toBe(true);
    });

    it('stores none for a session started in Builder itself', async () => {
      await service.createSession(1, { title: 'Plain', handoffContext: '   ' });

      expect(sessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ handoffContext: null }),
      );
    });

    it('attaches to an existing session only where none is set yet', async () => {
      // Frozen once written: a second press must not replace the first, and the guard has to
      // be the UPDATE's own WHERE to hold under two presses racing.
      sessionRepository.update.mockResolvedValue({ affected: 1 });

      await expect(
        service.attachHandoffContext('session-1', 'the brief'),
      ).resolves.toBe(true);
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1', handoffContext: IsNull() },
        { handoffContext: 'the brief' },
      );
    });

    it('reports when there was already a hand-off and it wrote nothing', async () => {
      sessionRepository.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.attachHandoffContext('session-1', 'the brief'),
      ).resolves.toBe(false);
    });

    it('reads the column explicitly, since no other session read loads it', async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        handoffContext: 'the brief',
      });

      await expect(service.getHandoffContext('session-1')).resolves.toBe(
        'the brief',
      );
      expect(sessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        select: { id: true, handoffContext: true },
      });
    });
  });

  describe('getSession', () => {
    it("serves another admin's session — sessions are shared across Builder users", async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 2,
      });

      await expect(service.getSession('session-1')).resolves.toMatchObject({
        id: 'session-1',
      });
    });

    it('404s a session that does not exist', async () => {
      sessionRepository.findOne.mockResolvedValue(null);

      await expect(service.getSession('session-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getSessionDetail', () => {
    it("names the session's creator, for the exported PRD's header", async () => {
      const findCreatorName = jest.fn().mockResolvedValue('Asha Rao');
      const detailService = new BuilderSessionService(
        { builder: { defaultBudgetUsd: 25 } } as any,
        { ...sessionRepository, findCreatorName } as any,
        { listBySession: jest.fn().mockResolvedValue([]) } as any,
        { listBySession: jest.fn().mockResolvedValue([]) } as any,
        {
          getOrCreateDoc: jest
            .fn()
            .mockResolvedValue({ id: 'doc-1', draft: {}, versionNumber: 3 }),
        } as any,
        settingsService as any,
        buildService as any,
        readinessService as any,
        reviewService as any,
      );
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 1,
      });

      const detail = await detailService.getSessionDetail('session-1', 1);

      expect(findCreatorName).toHaveBeenCalledWith(1);
      expect(detail.createdByName).toBe('Asha Rao');
      expect(detail.prdVersionNumber).toBe(3);
    });
  });

  describe('patchPrd', () => {
    const sessionInStatus = (status: BuilderSessionStatus) => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 1,
        status,
      });
    };

    it.each([
      BuilderSessionStatus.BUILDING,
      BuilderSessionStatus.WAITING_FOR_INPUT,
    ])('freezes the PRD while a run is reading it (%s)', async (status) => {
      sessionInStatus(status);

      await expect(
        service.patchPrd('session-1', 1, [
          { op: 'replace', path: '/summary', value: 'x' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prdService.applyPatch).not.toHaveBeenCalled();
    });

    it('allows an edit while interviewing', async () => {
      sessionInStatus(BuilderSessionStatus.INTERVIEWING);

      await service.patchPrd('session-1', 1, [
        { op: 'replace', path: '/summary', value: 'x' },
      ]);

      expect(prdService.applyPatch).toHaveBeenCalled();
    });

    it('settles readiness as an admin edit, which may run the reviewer', async () => {
      sessionInStatus(BuilderSessionStatus.INTERVIEWING);

      await service.patchPrd('session-1', 1, [
        { op: 'replace', path: '/summary', value: 'x' },
      ]);

      expect(readinessService.settle).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ versionNumber: 2 }),
        'admin_edit',
      );
    });
  });

  describe('dismissReviewFinding', () => {
    const inStatus = (status: BuilderSessionStatus) =>
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 1,
        status,
      });

    it('records the admin as the dismisser and re-scores the PRD', async () => {
      inStatus(BuilderSessionStatus.INTERVIEWING);
      readinessService.assess.mockResolvedValue({
        score: 100,
        ready: true,
        sections: [],
        blockers: [],
      });

      const result = await service.dismissReviewFinding(
        'session-1',
        7,
        'F2',
        'Mobile is a separate opportunity this quarter.',
      );

      expect(reviewService.dismiss).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'doc-1' }),
        'F2',
        'Mobile is a separate opportunity this quarter.',
        7,
        'admin',
      );
      expect(result.status).toBe(BuilderSessionStatus.PRD_READY);
    });

    it('is refused while a build is reading the PRD', async () => {
      inStatus(BuilderSessionStatus.BUILDING);

      await expect(
        service.dismissReviewFinding('session-1', 7, 'F2', 'Not relevant now.'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(reviewService.dismiss).not.toHaveBeenCalled();
    });
  });

  describe('syncReadinessStatus', () => {
    it('promotes an interviewing session once the PRD is ready', async () => {
      const session = {
        id: 'session-1',
        status: BuilderSessionStatus.INTERVIEWING,
      } as any;

      const next = await service.syncReadinessStatus(session, {
        ready: true,
      } as any);

      expect(next).toBe(BuilderSessionStatus.PRD_READY);
      // A partial UPDATE, never a full-entity save: the in-memory session
      // predates the orchestrator's atomic lastMessageSeq increment.
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { status: BuilderSessionStatus.PRD_READY },
      );
    });

    it('demotes back to interviewing when an edit reopens a blocker', async () => {
      const session = {
        id: 'session-1',
        status: BuilderSessionStatus.PRD_READY,
      } as any;

      const next = await service.syncReadinessStatus(session, {
        ready: false,
      } as any);

      expect(next).toBe(BuilderSessionStatus.INTERVIEWING);
    });

    it('never re-scores a session that is mid-build underneath itself', async () => {
      const session = {
        id: 'session-1',
        status: BuilderSessionStatus.BUILDING,
      } as any;

      const next = await service.syncReadinessStatus(session, {
        ready: false,
      } as any);

      expect(next).toBe(BuilderSessionStatus.BUILDING);
      expect(sessionRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('cancelSession', () => {
    const activeSession = {
      id: 'session-1',
      createdBy: 1,
      status: BuilderSessionStatus.BUILDING,
    };

    it('refuses to cancel an already-terminal session', async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 1,
        status: BuilderSessionStatus.COMPLETED,
      });

      await expect(
        service.cancelSession('session-1', 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stops the run, not just the row', async () => {
      // A DB-only cancel left the runner working for up to two hours and its
      // questions PENDING against a dead session.
      sessionRepository.findOne.mockResolvedValue(activeSession);
      buildService.findCancellableRun.mockResolvedValue({ id: 'run-7' });

      await service.cancelSession('session-1', 1);

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ status: BuilderSessionStatus.CANCELLED }),
      );
      expect(buildService.cancelRun).toHaveBeenCalledWith({ id: 'run-7' }, 1);
    });

    it('still cancels the session when stopping the run fails', async () => {
      // The session is already CANCELLED in the DB by then; a GitHub hiccup
      // must not turn a successful cancel into a 500 for the admin.
      sessionRepository.findOne.mockResolvedValue(activeSession);
      buildService.findCancellableRun.mockRejectedValue(new Error('GH down'));

      await expect(service.cancelSession('session-1', 1)).resolves.toBeTruthy();
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ status: BuilderSessionStatus.CANCELLED }),
      );
    });

    it('is a no-op on the run side when nothing is in flight', async () => {
      sessionRepository.findOne.mockResolvedValue({
        ...activeSession,
        status: BuilderSessionStatus.INTERVIEWING,
      });
      buildService.findCancellableRun.mockResolvedValue(null);

      await service.cancelSession('session-1', 1);

      expect(buildService.cancelRun).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    it("lists everyone's non-archived sessions, each with its creator's name", async () => {
      sessionRepository.find.mockResolvedValue([
        { id: 'session-1', createdBy: 7 },
        { id: 'session-2', createdBy: 8 },
      ]);
      sessionRepository.findCreatorNames.mockResolvedValue(
        new Map([[7, 'Asha Rao']]),
      );

      const result = await service.listSessions();

      expect(sessionRepository.find).toHaveBeenCalledWith({
        where: { archivedAt: IsNull() },
        order: { updatedAt: 'DESC' },
      });
      expect(result).toEqual([
        { id: 'session-1', createdBy: 7, createdByName: 'Asha Rao' },
        { id: 'session-2', createdBy: 8, createdByName: null },
      ]);
    });

    it('narrows to one creator and status for the "Mine" filter', async () => {
      sessionRepository.find.mockResolvedValue([]);

      await service.listSessions({
        statuses: [BuilderSessionStatus.COMPLETED],
        createdBy: 7,
      });

      expect(sessionRepository.find).toHaveBeenCalledWith({
        where: {
          createdBy: 7,
          archivedAt: IsNull(),
          status: In([BuilderSessionStatus.COMPLETED]),
        },
        order: { updatedAt: 'DESC' },
      });
    });
  });

  describe('listArchivedSessions', () => {
    it('pages only archived rows, newest-archived first', async () => {
      sessionRepository.findAndCount.mockResolvedValue([
        [{ id: 'session-1', createdBy: 7 }],
        1,
      ]);
      sessionRepository.findCreatorNames.mockResolvedValue(
        new Map([[7, 'Asha Rao']]),
      );

      const result = await service.listArchivedSessions({
        limit: 12,
        offset: 0,
      });

      expect(sessionRepository.findAndCount).toHaveBeenCalledWith({
        where: { archivedAt: Not(IsNull()) },
        order: { archivedAt: 'DESC' },
        take: 12,
        skip: 0,
      });
      expect(result).toEqual({
        sessions: [
          { id: 'session-1', createdBy: 7, createdByName: 'Asha Rao' },
        ],
        totalCount: 1,
      });
    });
  });

  describe('archiveSession', () => {
    const sessionInStatus = (
      status: BuilderSessionStatus,
      archivedAt: Date | null = null,
    ) =>
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 1,
        status,
        archivedAt,
      });

    it.each([
      BuilderSessionStatus.COMPLETED,
      BuilderSessionStatus.FAILED,
      BuilderSessionStatus.CANCELLED,
    ])('archives a terminal session (%s)', async (status) => {
      sessionInStatus(status);

      await service.archiveSession('session-1', 1);

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { archivedAt: expect.any(Date), updatedBy: 1 },
      );
    });

    it.each([
      BuilderSessionStatus.INTERVIEWING,
      BuilderSessionStatus.PRD_READY,
      BuilderSessionStatus.BUILDING,
      BuilderSessionStatus.WAITING_FOR_INPUT,
    ])(
      'refuses to archive a session still needing attention (%s)',
      async (status) => {
        sessionInStatus(status);

        await expect(
          service.archiveSession('session-1', 1),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.archiveSession('session-1', 1)).rejects.toThrow(
          /COMPLETED, FAILED or CANCELLED/,
        );
        expect(sessionRepository.update).not.toHaveBeenCalled();
      },
    );

    it('is a no-op on an already-archived session', async () => {
      const archivedAt = new Date('2026-01-01');
      sessionInStatus(BuilderSessionStatus.COMPLETED, archivedAt);

      const result = await service.archiveSession('session-1', 1);

      expect(sessionRepository.update).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ archivedAt }));
    });

    it("archives another admin's session — the feed is shared", async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 2,
        status: BuilderSessionStatus.COMPLETED,
      });

      await service.archiveSession('session-1', 1);

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ archivedAt: expect.any(Date), updatedBy: 1 }),
      );
    });

    it('touches only the session row — no message, PRD or build side effects', async () => {
      sessionInStatus(BuilderSessionStatus.COMPLETED);

      await service.archiveSession('session-1', 1);

      expect(prdService.applyPatch).not.toHaveBeenCalled();
      expect(buildService.cancelRun).not.toHaveBeenCalled();
    });
  });

  describe('unarchiveSession', () => {
    it('clears archivedAt', async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 1,
        status: BuilderSessionStatus.COMPLETED,
        archivedAt: new Date('2026-01-01'),
      });

      await service.unarchiveSession('session-1', 1);

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { archivedAt: null, updatedBy: 1 },
      );
    });

    it('is a no-op on a session that is not archived', async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 1,
        status: BuilderSessionStatus.COMPLETED,
        archivedAt: null,
      });

      await service.unarchiveSession('session-1', 1);

      expect(sessionRepository.update).not.toHaveBeenCalled();
    });

    it("unarchives another admin's session — the feed is shared", async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 2,
        status: BuilderSessionStatus.COMPLETED,
        archivedAt: new Date('2026-01-01'),
      });

      await service.unarchiveSession('session-1', 1);

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { archivedAt: null, updatedBy: 1 },
      );
    });
  });
});
