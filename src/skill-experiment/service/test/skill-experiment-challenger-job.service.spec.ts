import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SkillExperimentChallengerJobService } from '../skill-experiment-challenger-job.service';
import { DebriefFeedback } from '../../../debrief-feedback/entity/debrief-feedback.entity';
import { SkillExperiment } from '../../entity/skill-experiment.entity';
import { SkillExperimentVariant } from '../../entity/skill-experiment-variant.entity';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { SkillExperimentStateService } from '../skill-experiment-state.service';
import {
  SkillExperimentStatus,
  SkillVariantStatus,
} from '../../../skill-experiment/enum/skill-experiment.enum';

describe('SkillExperimentChallengerJobService', () => {
  let service: SkillExperimentChallengerJobService;
  let feedbackRepo: any;
  let experimentRepo: any;
  let variantRepo: any;
  let llm: any;
  let promptService: any;
  let state: any;

  beforeEach(async () => {
    const feedbackQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };
    feedbackRepo = {
      createQueryBuilder: jest.fn(() => feedbackQueryBuilder),
    };
    experimentRepo = {
      find: jest.fn(),
      update: jest.fn(),
    };
    variantRepo = {
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => ({ ...x, id: 'new-v' })),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: 1 }),
      })),
    };
    llm = {
      complete: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          revisedPrompt: 'Revised Prompt',
          changeSummary: 'Changed something',
          hypothesis: 'Better',
        }),
        model: 'test-model',
      }),
    };
    promptService = {
      getPromptByCode: jest.fn().mockResolvedValue('System Prompt'),
    };
    state = {
      retireVariant: jest.fn(),
      logEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillExperimentChallengerJobService,
        {
          provide: getRepositoryToken(DebriefFeedback),
          useValue: feedbackRepo,
        },
        {
          provide: getRepositoryToken(SkillExperiment),
          useValue: experimentRepo,
        },
        {
          provide: getRepositoryToken(SkillExperimentVariant),
          useValue: variantRepo,
        },
        { provide: LlmCompletionService, useValue: llm },
        { provide: PromptSharedService, useValue: promptService },
        { provide: SkillExperimentStateService, useValue: state },
      ],
    }).compile();

    service = module.get<SkillExperimentChallengerJobService>(
      SkillExperimentChallengerJobService,
    );
  });

  it('correctly fetches feedback and generates a new prompt', async () => {
    const experiment = {
      id: 'exp-1',
      promptCode: 'ally_ai_scenario_scenario_evaluation',
      status: SkillExperimentStatus.TESTING,
      championVariantId: 'v1',
      run: 1,
      rubric: [],
      variantsDrafted: 1,
      challengerTrafficPercent: 10,
    };
    experimentRepo.find.mockResolvedValue([experiment]);
    const mockFeedbacks = [
      { rating: 'positive', comment: 'Good', createdAt: new Date() },
      { rating: 'negative', comment: 'Bad', createdAt: new Date() },
    ];
    feedbackRepo.createQueryBuilder().getMany.mockResolvedValue(mockFeedbacks);
    variantRepo.findOneBy.mockResolvedValue({
      id: 'v1',
      content: 'Old content',
      label: 'V1',
    });
    variantRepo.findOne.mockResolvedValue({
      id: 'v-orig',
      content: 'Original content',
      isOriginal: true,
    });

    await service.run();

    expect(feedbackRepo.createQueryBuilder).toHaveBeenCalled();
    expect(llm.complete).toHaveBeenCalled();
    expect(variantRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Revised Prompt',
        status: SkillVariantStatus.CHALLENGER,
      }),
    );
    expect(experimentRepo.update).toHaveBeenCalledWith('exp-1', {
      challengerVariantId: 'new-v',
      variantsDrafted: 2,
    });
  });
});
