import { ForbiddenException } from '@nestjs/common';

import { BugHunterController } from '../bug-hunter.controller';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { TokenUser } from 'src/auth/type/auth.types';

/**
 * Direct-instantiation style, matching the rest of this module's specs
 * (e.g. bug-fix-session.service.spec.ts) rather than NestJS's TestingModule —
 * this controller has guards (`@RequireFeatureToggle`) that only ever run on
 * a real HTTP request, so calling the method directly needs no guard/provider
 * scaffolding to exercise its logic.
 */
describe('BugHunterController', () => {
  let controller: BugHunterController;
  let bugFixSessionService: {
    start: jest.Mock;
    release: jest.Mock;
    releasability: jest.Mock;
    cancelFixSession: jest.Mock;
  };
  const user: TokenUser = { id: 42, username: 'admin', tenantId: 'ally' };

  const findingRow = (overrides: Partial<BugFinding> = {}): BugFinding =>
    ({
      id: 'finding-1',
      runId: null,
      repo: 'ally-be',
      source: 'reported_bug',
      title: 'Terms link is not formatted correctly',
      description: 'desc',
      file: null,
      symbol: null,
      evidence: null,
      severity: null,
      proven: false,
      touchesGuardedPath: false,
      reportedBugId: null,
      status: BugFindingStatus.CANCELLED,
      prUrl: null,
      escalationQuestion: null,
      escalationAnswer: null,
      escalationAnsweredBy: null,
      escalationAnsweredAt: null,
      decidedBy: null,
      decidedAt: null,
      dispatchedAt: null,
      sessionRunUrl: null,
      sessionRunId: '99',
      releaseTag: null,
      releaseRunId: null,
      releaseRunUrl: null,
      releasedBy: null,
      releasedAt: null,
      cancelledBy: 42,
      cancelledAt: new Date('2026-08-19T10:00:00.000Z'),
      createdAt: new Date('2026-08-19T09:00:00.000Z'),
      updatedAt: new Date('2026-08-19T10:00:00.000Z'),
      ...overrides,
    }) as BugFinding;

  beforeEach(() => {
    bugFixSessionService = {
      start: jest.fn(),
      release: jest.fn(),
      releasability: jest.fn(),
      cancelFixSession: jest.fn(),
    };

    controller = new BugHunterController(
      {} as never,
      {} as never,
      {} as never,
      bugFixSessionService as never,
      {} as never,
    );
  });

  describe('cancelFixSession', () => {
    it('calls the service with the finding id and the authenticated user, and returns the updated finding', async () => {
      const cancelled = findingRow();
      bugFixSessionService.cancelFixSession.mockResolvedValue(cancelled);

      const result = await controller.cancelFixSession('finding-1', user);

      expect(bugFixSessionService.cancelFixSession).toHaveBeenCalledWith(
        'finding-1',
        42,
      );
      expect(result).toMatchObject({
        id: 'finding-1',
        status: BugFindingStatus.CANCELLED,
        sessionRunId: '99',
        cancelledBy: 42,
      });
    });

    it('propagates a ForbiddenException from the service (finding not in a cancellable status)', async () => {
      bugFixSessionService.cancelFixSession.mockRejectedValue(
        new ForbiddenException('not cancellable'),
      );

      await expect(
        controller.cancelFixSession('finding-1', user),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
