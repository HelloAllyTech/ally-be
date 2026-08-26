import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BuilderSessionService } from '../builder-session.service';
import { BuilderSessionStatus } from '../../enum/builder.enum';
import { BUILDER_MAX_ACTIVE_SESSIONS_PER_TENANT } from '../../constants/builder.constants';

describe('BuilderSessionService', () => {
  let service: BuilderSessionService;
  let sessionRepository: {
    save: jest.Mock;
    create: jest.Mock;
    count: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    slugExists: jest.Mock;
  };
  let prdService: {
    getOrCreateDoc: jest.Mock;
    applyPatch: jest.Mock;
    computeReadiness: jest.Mock;
  };

  beforeEach(() => {
    sessionRepository = {
      save: jest.fn(async (session) => ({ id: 'session-1', ...session })),
      create: jest.fn((session) => session),
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      slugExists: jest.fn().mockResolvedValue(false),
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

    service = new BuilderSessionService(
      sessionRepository as any,
      {} as any,
      prdService as any,
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

  describe('getSession', () => {
    it("refuses another admin's session", async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        createdBy: 2,
      });

      await expect(service.getSession('session-1', 1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
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
  });
});
