import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackRepository } from '../feedback.repository';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { Feedback } from '../../entity/feedback.entity';

describe('FeedbackRepository', () => {
  let repository: FeedbackRepository;
  let entityManager: EntityManager;

  const mockFeedback: Feedback = {
    feedbackId: 1,
    modifiedContent: 'Test content',
    rating: 4.5,
    messageId: 1,
    userId: 1,
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
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<FeedbackRepository>(FeedbackRepository);
    entityManager = mockEntityManager as unknown as EntityManager;

    mockDataSource.createEntityManager.mockReturnValue({});
    mockDataSource.getRepository.mockReturnValue(mockRepository);
    mockEntityManager.getRepository.mockReturnValue(mockRepository);

    // Setup spies on inherited methods
    jest.spyOn(repository, 'create').mockImplementation(mockRepository.create);
    jest.spyOn(repository, 'save').mockImplementation(mockRepository.save);
    jest.spyOn(repository, 'find').mockImplementation(mockRepository.find);
    jest
      .spyOn(repository, 'findOne')
      .mockImplementation(mockRepository.findOne);
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockImplementation(mockRepository.createQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createFeedback', () => {
    it('should create and save a new feedback', async () => {
      const feedbackData: Partial<Feedback> = {
        modifiedContent: 'Test content',
        rating: 4.5,
        messageId: 1,
        userId: 1,
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
      const feedbackData: Partial<Feedback> = {
        modifiedContent: 'Test content',
        rating: 4.5,
        messageId: 1,
        userId: 1,
        tenantId: 'test-tenant',
      };

      mockRepository.create.mockReturnValue(mockFeedback);
      mockRepository.save.mockResolvedValue(mockFeedback);

      const result = await repository.createFeedback(
        feedbackData,
        entityManager,
      );

      expect(result).toEqual(mockFeedback);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Feedback);
      expect(mockRepository.create).toHaveBeenCalledWith(feedbackData);
      expect(mockRepository.save).toHaveBeenCalledWith(mockFeedback);
    });
  });

  describe('findByMessageId', () => {
    it('should find feedback by messageId and tenantId', async () => {
      const feedbacks = [mockFeedback];
      mockRepository.find.mockResolvedValue(feedbacks);

      const result = await repository.findByMessageId(1, 'test-tenant');

      expect(result).toEqual(feedbacks);
      expect(repository.find).toHaveBeenCalledWith({
        where: { messageId: 1, tenantId: 'test-tenant' },
      });
    });

    it('should use entityManager when provided', async () => {
      const feedbacks = [mockFeedback];
      mockRepository.find.mockResolvedValue(feedbacks);

      const result = await repository.findByMessageId(
        1,
        'test-tenant',
        entityManager,
      );

      expect(result).toEqual(feedbacks);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Feedback);
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { messageId: 1, tenantId: 'test-tenant' },
      });
    });
  });

  describe('findById', () => {
    it('should find feedback by id and tenantId', async () => {
      mockRepository.findOne.mockResolvedValue(mockFeedback);

      const result = await repository.findById(1, 'test-tenant');

      expect(result).toEqual(mockFeedback);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { feedbackId: 1, tenantId: 'test-tenant' },
      });
    });

    it('should return null if feedback not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById(999, 'test-tenant');

      expect(result).toBeNull();
    });

    it('should use entityManager when provided', async () => {
      mockRepository.findOne.mockResolvedValue(mockFeedback);

      const result = await repository.findById(1, 'test-tenant', entityManager);

      expect(result).toEqual(mockFeedback);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Feedback);
    });
  });

  describe('updateFeedback', () => {
    it('should update and return the feedback', async () => {
      const updateData: Partial<Feedback> = {
        rating: 5.0,
        modifiedContent: 'Updated content',
      };

      const updatedFeedback = { ...mockFeedback, ...updateData };

      jest.spyOn(repository, 'findById').mockResolvedValue(mockFeedback);
      mockRepository.save.mockResolvedValue(updatedFeedback);

      const result = await repository.updateFeedback(
        1,
        updateData,
        'test-tenant',
      );

      expect(result).toEqual(updatedFeedback);
      expect(repository.findById).toHaveBeenCalledWith(
        1,
        'test-tenant',
        undefined,
      );
      expect(repository.save).toHaveBeenCalled();
    });

    it('should return null if feedback not found', async () => {
      jest.spyOn(repository, 'findById').mockResolvedValue(null);

      const result = await repository.updateFeedback(
        999,
        { rating: 5.0 },
        'test-tenant',
      );

      expect(result).toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('should use entityManager when provided', async () => {
      const updateData: Partial<Feedback> = { rating: 5.0 };
      const updatedFeedback = { ...mockFeedback, ...updateData };

      jest.spyOn(repository, 'findById').mockResolvedValue(mockFeedback);
      mockRepository.save.mockResolvedValue(updatedFeedback);

      const result = await repository.updateFeedback(
        1,
        updateData,
        'test-tenant',
        entityManager,
      );

      expect(result).toEqual(updatedFeedback);
      expect(repository.findById).toHaveBeenCalledWith(
        1,
        'test-tenant',
        entityManager,
      );
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Feedback);
    });
  });

  describe('deleteFeedbackByChatId', () => {
    it('should delete feedback by chatId and return true', async () => {
      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      } as unknown as SelectQueryBuilder<Feedback>;

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await repository.deleteFeedbackByChatId(1, 'test-tenant');

      expect(result).toBe(true);
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith(
        'feedback',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'messages',
        'message',
        'message.id = feedback.messageId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'message.chatId = :chatId',
        { chatId: 1 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'feedback.tenantId = :tenantId',
        { tenantId: 'test-tenant' },
      );
    });

    it('should return false if no feedback deleted', async () => {
      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      } as unknown as SelectQueryBuilder<Feedback>;

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await repository.deleteFeedbackByChatId(
        999,
        'test-tenant',
      );

      expect(result).toBe(false);
    });

    it('should use entityManager when provided', async () => {
      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      } as unknown as SelectQueryBuilder<Feedback>;

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await repository.deleteFeedbackByChatId(
        1,
        'test-tenant',
        entityManager,
      );

      expect(result).toBe(true);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Feedback);
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith(
        'feedback',
      );
    });
  });
});
