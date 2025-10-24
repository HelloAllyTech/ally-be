import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { FeedbackService } from '../feedback.service';
import { Feedback } from 'src/common/entities/feedback.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let mockFeedbackRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let mockGetTenantId: jest.SpyInstance;

  const mockFeedback: Feedback = {
    feedbackId: 1,
    messageId: 1,
    userId: 2,
    rating: 5,
    modifiedContent: 'Great message',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCreateFeedbackDto = {
    messageId: 1,
    userId: 2,
    rating: 5,
    comment: 'Great message',
  };

  const mockUpdateFeedbackDto = {
    rating: 4,
    comment: 'Updated comment',
  };

  beforeEach(async () => {
    // Create mock functions
    mockFeedbackRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    // Mock ExecutionManager.getUserId()
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('2');

    // Mock ExecutionManager.getTenantId()
    mockGetTenantId = jest
      .spyOn(ExecutionManager, 'getTenantId')
      .mockReturnValue('test-tenant');

    const module = await Test.createTestingModule({
      providers: [
        FeedbackService,
        {
          provide: getRepositoryToken(Feedback),
          useValue: mockFeedbackRepository,
        },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create feedback successfully', async () => {
      mockFeedbackRepository.create.mockReturnValue(mockFeedback);
      mockFeedbackRepository.save.mockResolvedValue(mockFeedback);

      const result = await service.create(mockCreateFeedbackDto);

      expect(result).toEqual(mockFeedback);
      expect(mockFeedbackRepository.create).toHaveBeenCalledWith({
        ...mockCreateFeedbackDto,
        tenantId: 'test-tenant',
      });
      expect(mockFeedbackRepository.save).toHaveBeenCalledWith(mockFeedback);
    });

    it('should create feedback with minimal data', async () => {
      const minimalDto = {
        messageId: 1,
        userId: 2,
        rating: 3,
      };

      const expectedFeedback = {
        ...mockFeedback,
        comment: undefined,
      };

      mockFeedbackRepository.create.mockReturnValue(expectedFeedback);
      mockFeedbackRepository.save.mockResolvedValue(expectedFeedback);

      const result = await service.create(minimalDto);

      expect(result).toEqual(expectedFeedback);
      expect(mockFeedbackRepository.create).toHaveBeenCalledWith({
        ...minimalDto,
        tenantId: 'test-tenant',
      });
    });
  });

  describe('findByMessageId', () => {
    it('should return feedbacks for a message', async () => {
      const mockFeedbacks = [mockFeedback];
      mockFeedbackRepository.find.mockResolvedValue(mockFeedbacks);

      const result = await service.findByMessageId(1);

      expect(result).toEqual(mockFeedbacks);
      expect(mockFeedbackRepository.find).toHaveBeenCalledWith({
        where: { messageId: 1, tenantId: 'test-tenant', userId: 2 },
      });
    });

    it('should return empty array when no feedbacks found', async () => {
      mockFeedbackRepository.find.mockResolvedValue([]);

      const result = await service.findByMessageId(999);

      expect(result).toEqual([]);
      expect(mockFeedbackRepository.find).toHaveBeenCalledWith({
        where: { messageId: 999, tenantId: 'test-tenant', userId: 2 },
      });
    });
  });

  describe('update', () => {
    it('should update feedback successfully', async () => {
      const updatedFeedback = { ...mockFeedback, ...mockUpdateFeedbackDto };

      mockFeedbackRepository.findOne.mockResolvedValue(mockFeedback);
      mockFeedbackRepository.save.mockResolvedValue(updatedFeedback);

      const result = await service.update(1, mockUpdateFeedbackDto);

      expect(result).toEqual(updatedFeedback);
      expect(mockFeedbackRepository.findOne).toHaveBeenCalledWith({
        where: { feedbackId: 1, tenantId: 'test-tenant' },
      });
      expect(mockFeedbackRepository.save).toHaveBeenCalledWith({
        ...mockFeedback,
        ...mockUpdateFeedbackDto,
      });
    });

    it('should throw NotFoundException when feedback not found', async () => {
      mockFeedbackRepository.findOne.mockResolvedValue(null);

      await expect(service.update(999, mockUpdateFeedbackDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.update(999, mockUpdateFeedbackDto)).rejects.toThrow(
        'Feedback with ID 999 not found',
      );
    });

    it('should update feedback with partial data', async () => {
      const partialUpdateDto = { rating: 4 };
      const updatedFeedback = { ...mockFeedback, rating: 4 };

      mockFeedbackRepository.findOne.mockResolvedValue(mockFeedback);
      mockFeedbackRepository.save.mockResolvedValue(updatedFeedback);

      const result = await service.update(1, partialUpdateDto);

      expect(result).toEqual(updatedFeedback);
      expect(mockFeedbackRepository.save).toHaveBeenCalledWith({
        ...mockFeedback,
        rating: 4,
      });
    });

    it('should update feedback with empty update data', async () => {
      const emptyUpdateDto = {};

      mockFeedbackRepository.findOne.mockResolvedValue(mockFeedback);
      mockFeedbackRepository.save.mockResolvedValue(mockFeedback);

      const result = await service.update(1, emptyUpdateDto);

      expect(result).toEqual(mockFeedback);
      expect(mockFeedbackRepository.save).toHaveBeenCalledWith(mockFeedback);
    });
  });

  describe('error handling', () => {
    it('should handle database errors in create', async () => {
      const dbError = new Error('Database connection failed');
      mockFeedbackRepository.create.mockReturnValue(mockFeedback);
      mockFeedbackRepository.save.mockRejectedValue(dbError);

      await expect(service.create(mockCreateFeedbackDto)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should handle database errors in findByMessageId', async () => {
      const dbError = new Error('Database connection failed');
      mockFeedbackRepository.find.mockRejectedValue(dbError);

      await expect(service.findByMessageId(1)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should handle database errors in update', async () => {
      const dbError = new Error('Database connection failed');
      mockFeedbackRepository.findOne.mockResolvedValue(mockFeedback);
      mockFeedbackRepository.save.mockRejectedValue(dbError);

      await expect(service.update(1, mockUpdateFeedbackDto)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('tenant isolation', () => {
    it('should use correct tenant ID in create', async () => {
      mockGetTenantId.mockReturnValue('different-tenant');
      mockFeedbackRepository.create.mockReturnValue(mockFeedback);
      mockFeedbackRepository.save.mockResolvedValue(mockFeedback);

      await service.create(mockCreateFeedbackDto);

      expect(mockFeedbackRepository.create).toHaveBeenCalledWith({
        ...mockCreateFeedbackDto,
        tenantId: 'different-tenant',
      });
    });

    it('should use correct tenant ID in findByMessageId', async () => {
      mockGetTenantId.mockReturnValue('different-tenant');
      mockFeedbackRepository.find.mockResolvedValue([]);

      await service.findByMessageId(1);

      expect(mockFeedbackRepository.find).toHaveBeenCalledWith({
        where: { messageId: 1, tenantId: 'different-tenant', userId: 2 },
      });
    });

    it('should use correct tenant ID in update', async () => {
      mockGetTenantId.mockReturnValue('different-tenant');
      mockFeedbackRepository.findOne.mockResolvedValue(mockFeedback);
      mockFeedbackRepository.save.mockResolvedValue(mockFeedback);

      await service.update(1, mockUpdateFeedbackDto);

      expect(mockFeedbackRepository.findOne).toHaveBeenCalledWith({
        where: { feedbackId: 1, tenantId: 'different-tenant' },
      });
    });
  });

  describe('authorization', () => {
    it('should throw ForbiddenException when updating feedback from different user', async () => {
      const otherUserFeedback = { ...mockFeedback, userId: 999 };
      mockFeedbackRepository.findOne.mockResolvedValue(otherUserFeedback);

      await expect(service.update(1, mockUpdateFeedbackDto)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.update(1, mockUpdateFeedbackDto)).rejects.toThrow(
        'You can only update your own feedback',
      );
    });

    it('should allow update when feedback belongs to current user', async () => {
      const updatedFeedback = { ...mockFeedback, ...mockUpdateFeedbackDto };
      mockFeedbackRepository.findOne.mockResolvedValue(mockFeedback);
      mockFeedbackRepository.save.mockResolvedValue(updatedFeedback);

      const result = await service.update(1, mockUpdateFeedbackDto);

      expect(result).toEqual(updatedFeedback);
    });
  });
});
