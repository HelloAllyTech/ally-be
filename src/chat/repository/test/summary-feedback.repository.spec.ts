import { Test, TestingModule } from '@nestjs/testing';
import { SummaryFeedbackRepository } from '../summary-feedback.repository';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { SummaryFeedback } from '../../entity/summary-feedback.entity';

describe('SummaryFeedbackRepository', () => {
  let repository: SummaryFeedbackRepository;
  let dataSource: jest.Mocked<DataSource>;
  let entityManager: jest.Mocked<EntityManager>;
  let summaryFeedbackRepo: jest.Mocked<Repository<SummaryFeedback>>;

  const mockSummaryFeedback = {
    id: 1,
    chatId: 123,
    rating: 5,
    feedback: { comment: 'Great service' },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  beforeEach(async () => {
    summaryFeedbackRepo = {
      create: jest.fn(),
    } as any;

    entityManager = {
      getRepository: jest.fn().mockReturnValue(summaryFeedbackRepo),
    } as any;

    dataSource = {
      createEntityManager: jest.fn().mockReturnValue(entityManager),
      getRepository: jest.fn().mockReturnValue(summaryFeedbackRepo),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SummaryFeedbackRepository,
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    repository = module.get<SummaryFeedbackRepository>(
      SummaryFeedbackRepository,
    );

    // Mock the save method
    jest.spyOn(repository, 'save').mockResolvedValue(mockSummaryFeedback);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSummaryFeedback', () => {
    it('should create summary feedback without EntityManager and without feedback', async () => {
      const createdFeedback = { chatId: 123, rating: 5 };
      summaryFeedbackRepo.create.mockReturnValue(createdFeedback as any);

      const result = await repository.createSummaryFeedback(123, 5);

      expect(dataSource.getRepository).toHaveBeenCalledWith(SummaryFeedback);
      expect(summaryFeedbackRepo.create).toHaveBeenCalledWith({
        chatId: 123,
        rating: 5,
        feedback: undefined,
      });
      expect(repository.save).toHaveBeenCalledWith(createdFeedback);
      expect(result).toBe(mockSummaryFeedback);
    });

    it('should create summary feedback with EntityManager and with feedback', async () => {
      const feedback = { comment: 'Excellent support' };
      const createdFeedback = { chatId: 123, rating: 4, feedback };
      summaryFeedbackRepo.create.mockReturnValue(createdFeedback as any);

      const result = await repository.createSummaryFeedback(
        123,
        4,
        feedback,
        entityManager,
      );

      expect(entityManager.getRepository).toHaveBeenCalledWith(SummaryFeedback);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(summaryFeedbackRepo.create).toHaveBeenCalledWith({
        chatId: 123,
        rating: 4,
        feedback,
      });
      expect(repository.save).toHaveBeenCalledWith(createdFeedback);
      expect(result).toBe(mockSummaryFeedback);
    });
  });
});
