import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DebriefFeedbackService } from '../debrief-feedback.service';
import { DebriefFeedback } from '../../entity/debrief-feedback.entity';
import { SkillExperimentObservation } from 'src/skill-experiment/entity/skill-experiment-observation.entity';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { SkillObservationStatus } from 'src/skill-experiment/enum/skill-experiment.enum';

describe('DebriefFeedbackService', () => {
  let service: DebriefFeedbackService;
  let feedbackRepo: any;
  let observationRepo: any;
  let queryBuilder: any;
  let scenarioSessionRepo: any;

  const LEARNER_ID = 42;

  beforeEach(async () => {
    feedbackRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => ({ id: 'f-1', ...x })),
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
    scenarioSessionRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'sess-1', counselorId: LEARNER_ID }),
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
        {
          provide: getRepositoryToken(ScenarioSessions),
          useValue: scenarioSessionRepo,
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
      LEARNER_ID,
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

  it('records a negative rating as not helpful with score 0', async () => {
    feedbackRepo.findOne.mockResolvedValue(null);
    queryBuilder.getOne.mockResolvedValue({ id: 'obs-1' });

    await service.createFeedback('tenant-1', LEARNER_ID, 'sess-1', 'negative');

    expect(observationRepo.update).toHaveBeenCalledWith(
      'obs-1',
      expect.objectContaining({
        score: 0,
        judgeSummary: 'User rated this debrief as not helpful.',
      }),
    );
  });

  describe('when the session already has feedback', () => {
    const existingRow = () => ({
      id: 'existing',
      tenantId: 'tenant-1',
      scenarioSessionId: 'sess-1',
      rating: 'positive' as const,
      comment: null,
    });

    it('adds the comment to the existing row instead of rejecting', async () => {
      feedbackRepo.findOne.mockResolvedValue(existingRow());

      const result = await service.createFeedback(
        'tenant-1',
        LEARNER_ID,
        'sess-1',
        'positive',
        'Specific and kind.',
      );

      expect(feedbackRepo.create).not.toHaveBeenCalled();
      expect(feedbackRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'existing',
          rating: 'positive',
          comment: 'Specific and kind.',
        }),
      );
      expect(result).toMatchObject({
        id: 'existing',
        comment: 'Specific and kind.',
      });
    });

    it('keeps the first rating and does not re-judge the observation', async () => {
      feedbackRepo.findOne.mockResolvedValue(existingRow());

      const result = await service.createFeedback(
        'tenant-1',
        LEARNER_ID,
        'sess-1',
        'negative',
        'Changed my mind',
      );

      expect(feedbackRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ rating: 'positive' }),
      );
      expect(result.rating).toBe('positive');
      expect(observationRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(observationRepo.update).not.toHaveBeenCalled();
    });

    it('returns the stored row unchanged when no comment is given', async () => {
      const row = existingRow();
      feedbackRepo.findOne.mockResolvedValue(row);

      const result = await service.createFeedback(
        'tenant-1',
        LEARNER_ID,
        'sess-1',
        'positive',
      );

      expect(result).toBe(row);
      expect(feedbackRepo.save).not.toHaveBeenCalled();
      expect(observationRepo.update).not.toHaveBeenCalled();
    });

    it('treats a blank comment as no comment', async () => {
      feedbackRepo.findOne.mockResolvedValue({
        ...existingRow(),
        comment: 'Earlier note',
      });

      const result = await service.createFeedback(
        'tenant-1',
        LEARNER_ID,
        'sess-1',
        'positive',
        '   ',
      );

      expect(feedbackRepo.save).not.toHaveBeenCalled();
      expect(result.comment).toBe('Earlier note');
    });
  });

  it('trims the comment and stores a blank one as none on first post', async () => {
    feedbackRepo.findOne.mockResolvedValue(null);
    queryBuilder.getOne.mockResolvedValue(null);

    await service.createFeedback(
      'tenant-1',
      LEARNER_ID,
      'sess-1',
      'positive',
      '  Clear next steps.  ',
    );
    expect(feedbackRepo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ comment: 'Clear next steps.' }),
    );

    await service.createFeedback(
      'tenant-1',
      LEARNER_ID,
      'sess-1',
      'positive',
      '  ',
    );
    expect(feedbackRepo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ comment: undefined }),
    );
  });

  it('looks the session up within the caller tenant', async () => {
    feedbackRepo.findOne.mockResolvedValue(null);
    queryBuilder.getOne.mockResolvedValue(null);

    await service.createFeedback('tenant-1', LEARNER_ID, 'sess-1', 'positive');

    expect(scenarioSessionRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1', tenantId: 'tenant-1' },
      }),
    );
  });

  it('rejects a session that does not exist in the tenant', async () => {
    scenarioSessionRepo.findOne.mockResolvedValue(null);

    await expect(
      service.createFeedback('tenant-1', LEARNER_ID, 'sess-1', 'positive'),
    ).rejects.toThrow(NotFoundException);
    expect(feedbackRepo.save).not.toHaveBeenCalled();
    expect(observationRepo.update).not.toHaveBeenCalled();
  });

  it('rejects a rating from anyone but the learner who ran the session', async () => {
    await expect(
      service.createFeedback('tenant-1', 7, 'sess-1', 'negative'),
    ).rejects.toThrow(ForbiddenException);
    expect(feedbackRepo.findOne).not.toHaveBeenCalled();
    expect(feedbackRepo.save).not.toHaveBeenCalled();
    expect(observationRepo.update).not.toHaveBeenCalled();
  });
});
