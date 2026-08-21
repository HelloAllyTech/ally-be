import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LearnerSupervisorMemory } from '../../entity/learner-supervisor-memory.entity';
import { LearnerSupervisorMemoryService } from '../learner-supervisor-memory.service';

describe('LearnerSupervisorMemoryService', () => {
  let service: LearnerSupervisorMemoryService;
  let repo: {
    findOne: jest.Mock;
    upsert: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      upsert: jest.fn(async () => undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearnerSupervisorMemoryService,
        {
          provide: getRepositoryToken(LearnerSupervisorMemory),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get(LearnerSupervisorMemoryService);
  });

  describe('getSupervisorMemoryPrompt', () => {
    it('reports the true total once a learner has more debriefed sessions than the recent trail keeps', async () => {
      // The trail is capped at MAX_RECENT_SESSIONS (5) entries, but this
      // learner has been debriefed 50 times.
      repo.findOne.mockResolvedValue({
        memory: {
          focusAreas: ['pacing'],
          trajectory: 'improving',
          nextTime: 'slow down',
          totalSessions: 50,
          recentSessions: Array.from({ length: 5 }, (_, i) => ({
            scenarioSessionId: `session-${i}`,
            at: new Date().toISOString(),
          })),
        },
      });

      const prompt = await service.getSupervisorMemoryPrompt(1, 'tenant-1');

      expect(prompt).toContain('Sessions debriefed with them so far: 50');
    });
  });

  describe('recordFromEvaluation', () => {
    it('keeps incrementing totalSessions past the capped recentSessions trail', async () => {
      repo.findOne.mockResolvedValue({
        memory: {
          totalSessions: 50,
          recentSessions: Array.from({ length: 5 }, (_, i) => ({
            scenarioSessionId: `session-${i}`,
            at: new Date().toISOString(),
          })),
        },
      });

      await service.recordFromEvaluation(1, 'tenant-1', 'session-new', {
        focus_areas: [],
        trajectory: '',
        next_time: '',
      });

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          memory: expect.objectContaining({ totalSessions: 51 }),
        }),
        expect.anything(),
      );
    });
  });
});
