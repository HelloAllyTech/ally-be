import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PreviewMonologueService } from '../preview-monologue.service';
import { PreviewMonologueRun } from '../../entity/preview-monologue-run.entity';
import { LoggerService } from '../../../logger/logger.service';

describe('PreviewMonologueService', () => {
  let service: PreviewMonologueService;
  let repository: {
    upsert: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);

    repository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreviewMonologueService,
        {
          provide: getRepositoryToken(PreviewMonologueRun),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get(PreviewMonologueService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('scenarioIdFromRoomName', () => {
    it('reads the scenario out of a preview room name', () => {
      expect(
        PreviewMonologueService.scenarioIdFromRoomName(
          'preview-450-2f0c1e5a-0000',
        ),
      ).toBe(450);
    });

    it('returns null for a learner session room', () => {
      expect(
        PreviewMonologueService.scenarioIdFromRoomName('ss_abc-123'),
      ).toBeNull();
    });
  });

  it('opens a run at preview start', async () => {
    await service.startRun({
      roomName: 'preview-450-abc',
      scenarioId: 450,
      languageId: 6,
      startedByUserId: 12,
    });

    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        roomName: 'preview-450-abc',
        scenarioId: 450,
        languageId: 6,
        startedByUserId: 12,
        turnCount: 0,
      }),
      ['roomName'],
    );
  });

  it('never throws out of startRun when the write fails', async () => {
    repository.upsert.mockRejectedValue(new Error('db down'));

    await expect(
      service.startRun({ roomName: 'preview-450-abc', scenarioId: 450 }),
    ).resolves.toBeUndefined();
  });

  it('attaches the monologue to an open run', async () => {
    repository.findOne.mockResolvedValue({
      roomName: 'preview-450-abc',
      turnCount: 0,
    });

    await service.recordMonologue('preview-450-abc', [{ turn: 1 }]);

    expect(repository.update).toHaveBeenCalledWith(
      {
        roomName: 'preview-450-abc',
        turnCount: expect.objectContaining({
          _type: 'lessThanOrEqual',
          _value: 1,
        }),
      },
      expect.objectContaining({ turnCount: 1 }),
    );
  });

  it('creates a row when the run was never opened', async () => {
    await service.recordMonologue('preview-450-abc', [{ turn: 1 }]);

    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: 450, turnCount: 1 }),
      ['roomName'],
    );
  });

  it('does not let a shorter re-send clobber a longer recording', async () => {
    // The agent ships the write-out twice by design; the early one can be short.
    repository.findOne.mockResolvedValue({
      roomName: 'preview-450-abc',
      turnCount: 9,
    });

    await service.recordMonologue('preview-450-abc', [{ turn: 1 }]);

    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('keeps the longer write even when both write-outs land in the same SQS batch and are processed concurrently', async () => {
    // Mirrors SqsPollingService.pollMessages: every message in a batch is
    // processed via Promise.all, so the agent's short early write-out and its
    // fuller final write-out for the same room can both call findOne before
    // either update commits, then race to write. Whichever commits last must
    // still lose if it is the shorter one — that only holds if the
    // check-then-write is atomic at the database, not just at read time.
    let row = { roomName: 'preview-450-abc', turnCount: 0, turns: [] as any[] };

    repository.findOne.mockImplementation(async () => ({ ...row }));

    let resolveLongCommitted: () => void;
    const longCommitted = new Promise<void>((resolve) => {
      resolveLongCommitted = resolve;
    });

    // Fake atomic UPDATE: only applies when the row's *current* turnCount
    // still satisfies the criteria's condition, checked against `row` as it
    // is at apply time (not the stale snapshot recordMonologue read earlier).
    repository.update.mockImplementation((criteria, partial) => {
      const apply = () => {
        const satisfiesCondition =
          criteria.turnCount === undefined ||
          row.turnCount <= criteria.turnCount.value;
        if (row.roomName === criteria.roomName && satisfiesCondition) {
          row = { ...row, ...partial };
          return { affected: 1 };
        }
        return { affected: 0 };
      };

      const isShortWrite = partial.turnCount === 1;
      if (isShortWrite) {
        // The short write's commit lands after the long write's, even though
        // nothing in the (buggy) code prevents it from winning anyway.
        return longCommitted.then(apply);
      }
      const result = apply();
      resolveLongCommitted();
      return Promise.resolve(result);
    });

    const fullMonologue = Array.from({ length: 9 }, (_, i) => ({ turn: i }));

    await Promise.all([
      service.recordMonologue('preview-450-abc', [{ turn: 1 }]),
      service.recordMonologue('preview-450-abc', fullMonologue),
    ]);

    expect(row.turnCount).toBe(9);
    expect(row.turns).toEqual(fullMonologue);
  });

  it('ignores a room that is not a preview', async () => {
    await service.recordMonologue('ss_abc-123', [{ turn: 1 }]);

    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('lists newest runs for a scenario with the runner resolved', async () => {
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 'run-1',
          roomName: 'preview-450-abc',
          scenarioId: 450,
          scenarioVersionId: null,
          languageId: 6,
          startedByUserId: 12,
          startedByName: 'Gopi',
          startedAt: new Date('2026-08-31T10:00:00Z'),
          endedAt: null,
          turnCount: '4',
        },
      ]),
    };
    repository.createQueryBuilder = jest.fn().mockReturnValue(qb);

    const runs = await service.listRunsForScenario(450);

    expect(qb.where).toHaveBeenCalledWith('run."scenarioId" = :scenarioId', {
      scenarioId: 450,
    });
    expect(qb.orderBy).toHaveBeenCalledWith('run."createdAt"', 'DESC');
    expect(runs[0]).toEqual(
      expect.objectContaining({ id: 'run-1', startedByName: 'Gopi' }),
    );
    // Raw rows come back with a string count; the list renders a number.
    expect(runs[0].turnCount).toBe(4);
    expect(runs[0]).not.toHaveProperty('turns');
  });

  it('404s on an unknown run', async () => {
    await expect(service.getRun('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
