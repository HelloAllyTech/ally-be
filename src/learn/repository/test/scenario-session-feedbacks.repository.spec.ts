import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioSessionFeedbacksRepository } from '../scenario-session-feedbacks.repository';
import { DataSource, EntityManager } from 'typeorm';
import { ScenarioSessionFeedbacks } from '../../entity/scenario-session-feedbacks.entity';

describe('ScenarioSessionFeedbacksRepository', () => {
  let repository: ScenarioSessionFeedbacksRepository;
  let entityManager: EntityManager;

  const mockFeedback: ScenarioSessionFeedbacks = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    scenarioSessionId: '123e4567-e89b-12d3-a456-426614174001',
    rating: 5,
    feedback: 'Great session!',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDataSource = {
    createEntityManager: jest.fn(),
    getRepository: jest.fn(),
  };

  const mockEntityManager = {
    getRepository: jest.fn(),
  };

  const mockRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionFeedbacksRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<ScenarioSessionFeedbacksRepository>(
      ScenarioSessionFeedbacksRepository,
    );
    entityManager = mockEntityManager as unknown as EntityManager;

    mockDataSource.createEntityManager.mockReturnValue({});
    mockDataSource.getRepository.mockReturnValue(mockRepository);
    mockEntityManager.getRepository.mockReturnValue(mockRepository);

    // Setup spies on inherited methods
    jest
      .spyOn(repository, 'findOne')
      .mockImplementation(mockRepository.findOne);
    jest.spyOn(repository, 'create').mockImplementation(mockRepository.create);
    jest.spyOn(repository, 'save').mockImplementation(mockRepository.save);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByScenarioSessionId', () => {
    it('should find feedback by scenario session ID', async () => {
      mockRepository.findOne.mockResolvedValue(mockFeedback);

      const result = await repository.findByScenarioSessionId(
        '123e4567-e89b-12d3-a456-426614174001',
      );

      expect(result).toEqual(mockFeedback);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { scenarioSessionId: '123e4567-e89b-12d3-a456-426614174001' },
      });
    });

    it('should return null if feedback not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result =
        await repository.findByScenarioSessionId('non-existent-id');

      expect(result).toBeNull();
    });

    it('should use entityManager when provided', async () => {
      mockRepository.findOne.mockResolvedValue(mockFeedback);

      const result = await repository.findByScenarioSessionId(
        '123e4567-e89b-12d3-a456-426614174001',
        entityManager,
      );

      expect(result).toEqual(mockFeedback);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(
        ScenarioSessionFeedbacks,
      );
    });
  });

  describe('createFeedback', () => {
    it('should create and save feedback', async () => {
      const feedbackData: Partial<ScenarioSessionFeedbacks> = {
        scenarioSessionId: '123e4567-e89b-12d3-a456-426614174001',
        rating: 5,
        feedback: 'Great session!',
        tenantId: 'test-tenant',
      };

      mockRepository.create.mockReturnValue(mockFeedback);
      mockRepository.save.mockResolvedValue(mockFeedback);

      const result = await repository.createFeedback(feedbackData);

      expect(result).toEqual(mockFeedback);
      expect(repository.create).toHaveBeenCalledWith(feedbackData);
      expect(repository.save).toHaveBeenCalledWith(mockFeedback);
    });

    it('should use entityManager when provided', async () => {
      const feedbackData: Partial<ScenarioSessionFeedbacks> = {
        scenarioSessionId: '123e4567-e89b-12d3-a456-426614174001',
        rating: 5,
        feedback: 'Great session!',
        tenantId: 'test-tenant',
      };

      mockRepository.create.mockReturnValue(mockFeedback);
      mockRepository.save.mockResolvedValue(mockFeedback);

      const result = await repository.createFeedback(
        feedbackData,
        entityManager,
      );

      expect(result).toEqual(mockFeedback);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(
        ScenarioSessionFeedbacks,
      );
      expect(mockRepository.create).toHaveBeenCalledWith(feedbackData);
      expect(mockRepository.save).toHaveBeenCalledWith(mockFeedback);
    });

    it('should create feedback with minimal data', async () => {
      const minimalData: Partial<ScenarioSessionFeedbacks> = {
        scenarioSessionId: '123e4567-e89b-12d3-a456-426614174001',
        rating: 3,
        tenantId: 'test-tenant',
      };

      const minimalFeedback = { ...mockFeedback, feedback: undefined };
      mockRepository.create.mockReturnValue(minimalFeedback);
      mockRepository.save.mockResolvedValue(minimalFeedback);

      const result = await repository.createFeedback(minimalData);

      expect(result).toEqual(minimalFeedback);
      expect(repository.create).toHaveBeenCalledWith(minimalData);
    });
  });
});
