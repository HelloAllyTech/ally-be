import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { DebriefFeedbackService } from '../debrief-feedback.service';
import { DebriefFeedback } from '../../entity/debrief-feedback.entity';
import { SkillExperimentObservation } from 'src/skill-experiment/entity/skill-experiment-observation.entity';
import { SkillObservationStatus } from 'src/skill-experiment/enum/skill-experiment.enum';

describe('DebriefFeedbackService', () => {
  let service: DebriefFeedbackService;
  let feedbackRepo: any;
  let observationRepo: any;
  let queryBuilder: any;

  beforeEach(async () => {
    feedbackRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => ({ ...x, id: 'f-1' })),
    };
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    observationRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebriefFeedbackService,
        {
          provide: getRepositoryToken(DebriefFeedback),
          useValue: feedbackRepo,
        },
        {
          provide: getRepositoryToken(SkillExperimentObservation),
          useValue: observationRepo,
        },
      ],
    }).compile();

    service = module.get<DebriefFeedbackService>(DebriefFeedbackService);
  });

  it('saves feedback and updates matching observation', async () => {
    const sessionId = 'sess-1';
    feedbackRepo.findOne.mockResolvedValue(null);
    queryBuilder.getOne.mockResolvedValue({ id: 'obs-1' });

    const result = await service.createFeedback(
      'tenant-1',
      sessionId,
      'positive',
      'Nice',
    );

    expect(result.id).toBe('f-1');
    expect(feedbackRepo.save).toHaveBeenCalled();
    expect(observationRepo.update).toHaveBeenCalledWith('obs-1', {
      status: SkillObservationStatus.JUDGED,
      score: 100,
      judgeSummary: 'User rated this debrief as helpful.',
      judgeModel: 'user-feedback',
      judgedAt: expect.any(Date),
    });
  });

  it('throws ConflictException if feedback already exists', async () => {
    feedbackRepo.findOne.mockResolvedValue({ id: 'existing' });

    await expect(
      service.createFeedback('tenant-1', 'sess-1', 'positive'),
    ).rejects.toThrow(ConflictException);
  });
});
