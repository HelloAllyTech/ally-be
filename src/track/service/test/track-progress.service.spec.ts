import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppConfigService } from 'src/config/config.service';
import { TrackProgressService } from '../track-progress.service';
import { TrackItemProgressRepository } from '../../repository/track-item-progress.repository';
import { TrackItemRepository } from '../../repository/track-item.repository';
import { TrackItemType } from '../../type/track.type';

const mockDataSource = {
  transaction: jest.fn(),
  getRepository: jest.fn(() => ({
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  })),
};

const mockConfigService = {
  simulationPath: {
    simulationPathItemMinDurationForCompletion: 0,
  },
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockTrackItemProgressRepository = {
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  countUsersCompletedByTrackItem: jest.fn(),
};

const mockTrackItemRepository = {
  findOne: jest.fn(),
  find: jest.fn(),
};

describe('TrackProgressService', () => {
  let service: TrackProgressService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackProgressService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: AppConfigService, useValue: mockConfigService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        {
          provide: TrackItemProgressRepository,
          useValue: mockTrackItemProgressRepository,
        },
        { provide: TrackItemRepository, useValue: mockTrackItemRepository },
      ],
    }).compile();

    service = module.get<TrackProgressService>(TrackProgressService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getEffectiveCompletionCriteria', () => {
    it('should return criteria from version when lock exists', async () => {
      const progress = { id: 'progress-id', trackItemId: 'item-id' };
      const lock = {
        trackItemProgressId: 'progress-id',
        criteriaVersionId: 'version-id',
      };
      const version = {
        id: 'version-id',
        completionCriteria: { minScore: 90 },
      };

      const getRepoMock = jest.fn();
      const progressRepoMock = {
        findOne: jest.fn().mockResolvedValue(progress),
      };
      const lockRepoMock = { findOne: jest.fn().mockResolvedValue(lock) };
      const versionRepoMock = { findOne: jest.fn().mockResolvedValue(version) };

      getRepoMock.mockImplementation((repo: any) => {
        if (repo.name === 'TrackItemProgress') return progressRepoMock;
        if (repo.name === 'TrackItemProgressCriteriaLock') return lockRepoMock;
        if (repo.name === 'TrackItemCompletionCriteriaVersion')
          return versionRepoMock;
        return { findOne: jest.fn() };
      });
      mockDataSource.getRepository = getRepoMock;

      const criteria = await (service as any).getEffectiveCompletionCriteria(
        'progress-id',
      );
      expect(criteria).toEqual({ minScore: 90 });
    });

    it('should return criteria from item when no lock exists', async () => {
      const progress = { id: 'progress-id', trackItemId: 'item-id' };
      const item = { id: 'item-id', completionCriteria: { minScore: 80 } };

      const getRepoMock = jest.fn();
      const progressRepoMock = {
        findOne: jest.fn().mockResolvedValue(progress),
      };
      const lockRepoMock = { findOne: jest.fn().mockResolvedValue(null) };
      const itemRepoMock = { findOne: jest.fn().mockResolvedValue(item) };

      getRepoMock.mockImplementation((repo: any) => {
        if (repo.name === 'TrackItemProgress') return progressRepoMock;
        if (repo.name === 'TrackItemProgressCriteriaLock') return lockRepoMock;
        if (repo.name === 'TrackItem') return itemRepoMock;
        return { findOne: jest.fn() };
      });
      mockDataSource.getRepository = getRepoMock;

      const criteria = await (service as any).getEffectiveCompletionCriteria(
        'progress-id',
      );
      expect(criteria).toEqual({ minScore: 80 });
    });
  });

  describe('completeItem', () => {
    it('should create a lock on completion if one does not exist', async () => {
      const progress = {
        id: 'progress-id',
        trackItemId: 'item-id',
        trackEnrollmentId: 'enroll-id',
      };
      const item = {
        id: 'item-id',
        trackId: 'track-id',
        completionCriteria: { minScore: 80 },
      };
      const enrollment = { id: 'enroll-id' };
      const version = {
        id: 'version-id',
        completionCriteria: { minScore: 80 },
      };

      const mockLockRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(),
      };
      const mockVersionRepo = {
        findOne: jest.fn().mockResolvedValue(version),
        save: jest.fn(),
      };
      const mockProgressRepo = {
        findOne: jest.fn().mockResolvedValue(progress),
        find: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      };
      const mockItemRepo = {
        findOne: jest.fn().mockResolvedValue(item),
        find: jest.fn().mockResolvedValue([]),
      };
      const mockEnrollmentRepo = {
        findOne: jest.fn().mockResolvedValue(enrollment),
        update: jest.fn(),
      };

      mockDataSource.transaction.mockImplementation(async (cb) => {
        return cb({
          getRepository: (repo: any) => {
            if (repo.name === 'TrackItemProgressCriteriaLock')
              return mockLockRepo;
            if (repo.name === 'TrackItemCompletionCriteriaVersion')
              return mockVersionRepo;
            if (repo.name === 'TrackItemProgress') return mockProgressRepo;
            if (repo.name === 'TrackItem') return mockItemRepo;
            if (repo.name === 'TrackEnrollment') return mockEnrollmentRepo;
            return { find: jest.fn().mockResolvedValue([]) };
          },
        });
      });

      await service.completeItem('progress-id', {});

      expect(mockLockRepo.save).toHaveBeenCalledWith({
        trackItemProgressId: 'progress-id',
        criteriaVersionId: 'version-id',
      });
    });
  });

  describe('reevaluateProgress', () => {
    it('should complete items that now meet the criteria', async () => {
      const enrollmentId = 'enroll-id';
      const progress1 = {
        id: 'progress-1',
        trackItemId: 'item-1',
        status: 'UNLOCKED',
        score: 85,
      };
      const item1 = {
        id: 'item-1',
        type: TrackItemType.ROLEPLAY,
        completionCriteria: { minScore: 90 },
      };
      const progress2 = {
        id: 'progress-2',
        trackItemId: 'item-2',
        status: 'UNLOCKED',
      };
      const item2 = {
        id: 'item-2',
        type: TrackItemType.QUIZ,
        completionCriteria: { passScore: 80 },
      };
      const attempt2 = { scorePct: 85 };

      const completeItemSpy = jest
        .spyOn(service, 'completeItem')
        .mockResolvedValue(null as any);

      const getRepoMock = jest.fn();
      const progressRepoMock = {
        find: jest.fn().mockResolvedValue([progress1, progress2]),
      };
      const itemRepoMock = {
        findOne: jest.fn().mockImplementation(({ where: { id } }) => {
          if (id === 'item-1') return item1;
          if (id === 'item-2') return item2;
          return null;
        }),
      };
      const quizAttemptRepoMock = {
        findOne: jest.fn().mockResolvedValue(attempt2),
      };

      const lockRepoMock = { findOne: jest.fn().mockResolvedValue(null) };

      getRepoMock.mockImplementation((repo: any) => {
        if (repo.name === 'TrackItemProgress') return progressRepoMock;
        if (repo.name === 'TrackItem') return itemRepoMock;
        if (repo.name === 'TrackQuizAttempt') return quizAttemptRepoMock;
        if (repo.name === 'TrackItemProgressCriteriaLock') return lockRepoMock;
        return { findOne: jest.fn(), find: jest.fn() };
      });
      mockDataSource.getRepository = getRepoMock;

      // Mock getEffectiveCompletionCriteria to return new criteria
      const getEffectiveCompletionCriteriaSpy = jest.spyOn(
        service as any,
        'getEffectiveCompletionCriteria',
      );
      getEffectiveCompletionCriteriaSpy.mockImplementation(
        async (progressId) => {
          if (progressId === 'progress-1') return { minScore: 80 };
          if (progressId === 'progress-2') return { passScore: 80 };
          return null;
        },
      );

      await service.reevaluateProgress(enrollmentId);

      expect(completeItemSpy).toHaveBeenCalledWith('progress-1', {});
      expect(completeItemSpy).toHaveBeenCalledWith('progress-2', {});

      completeItemSpy.mockRestore();
      getEffectiveCompletionCriteriaSpy.mockRestore();
    });
  });
});
