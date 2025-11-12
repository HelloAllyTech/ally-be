import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FeedbackService } from '../feedback.service';
import { Feedback } from 'src/chat/entity/feedback.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { FeedbackRepository } from 'src/chat/repository/feedback.repository';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let mockFeedbackRepository: {
    createFeedback: jest.Mock;
    findByMessageId: jest.Mock;
    updateFeedback: jest.Mock;
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
      createFeedback: jest.fn(),
      findByMessageId: jest.fn(),
      updateFeedback: jest.fn(),
    };

    // Mock ExecutionManager
    mockGetTenantId = jest
      .spyOn(ExecutionManager, 'getTenantId')
      .mockReturnValue('test-tenant');

    const module = await Test.createTestingModule({
      providers: [
        FeedbackService,
        {
          provide: FeedbackRepository,
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
      mockFeedbackRepository.createFeedback.mockResolvedValue(mockFeedback);

      const result = await service.create(mockCreateFeedbackDto);

      expect(result).toEqual(mockFeedback);
      expect(mockFeedbackRepository.createFeedback).toHaveBeenCalledWith({
        ...mockCreateFeedbackDto,
        tenantId: 'test-tenant',
      });
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

      mockFeedbackRepository.createFeedback.mockResolvedValue(expectedFeedback);

      const result = await service.create(minimalDto);

      expect(result).toEqual(expectedFeedback);
      expect(mockFeedbackRepository.createFeedback).toHaveBeenCalledWith({
        ...minimalDto,
        tenantId: 'test-tenant',
      });
    });
  });

  describe('findByMessageId', () => {
    it('should return feedbacks for a message', async () => {
      const mockFeedbacks = [mockFeedback];
      mockFeedbackRepository.findByMessageId.mockResolvedValue(mockFeedbacks);

      const result = await service.findByMessageId(1);

      expect(result).toEqual(mockFeedbacks);
      expect(mockFeedbackRepository.findByMessageId).toHaveBeenCalledWith(
        1,
        'test-tenant',
      );
    });

    it('should return empty array when no feedbacks found', async () => {
      mockFeedbackRepository.findByMessageId.mockResolvedValue([]);

      const result = await service.findByMessageId(999);

      expect(result).toEqual([]);
      expect(mockFeedbackRepository.findByMessageId).toHaveBeenCalledWith(
        999,
        'test-tenant',
      );
    });
  });

  describe('update', () => {
    it('should update feedback successfully', async () => {
      const updatedFeedback = { ...mockFeedback, ...mockUpdateFeedbackDto };
      mockFeedbackRepository.updateFeedback.mockResolvedValue(updatedFeedback);

      const result = await service.update(1, mockUpdateFeedbackDto);

      expect(result).toEqual(updatedFeedback);
      expect(mockFeedbackRepository.updateFeedback).toHaveBeenCalledWith(
        1,
        mockUpdateFeedbackDto,
        'test-tenant',
      );
    });

    it('should throw NotFoundException when feedback not found', async () => {
      mockFeedbackRepository.updateFeedback.mockResolvedValue(null);

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
      mockFeedbackRepository.updateFeedback.mockResolvedValue(updatedFeedback);

      const result = await service.update(1, partialUpdateDto);

      expect(result).toEqual(updatedFeedback);
      expect(mockFeedbackRepository.updateFeedback).toHaveBeenCalledWith(
        1,
        partialUpdateDto,
        'test-tenant',
      );
    });

    it('should update feedback with empty update data', async () => {
      const emptyUpdateDto = {};
      mockFeedbackRepository.updateFeedback.mockResolvedValue(mockFeedback);

      const result = await service.update(1, emptyUpdateDto);

      expect(result).toEqual(mockFeedback);
      expect(mockFeedbackRepository.updateFeedback).toHaveBeenCalledWith(
        1,
        emptyUpdateDto,
        'test-tenant',
      );
    });
  });

  describe('error handling', () => {
    it('should handle database errors in create', async () => {
      const dbError = new Error('Database connection failed');
      mockFeedbackRepository.createFeedback.mockRejectedValue(dbError);

      await expect(service.create(mockCreateFeedbackDto)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should handle database errors in findByMessageId', async () => {
      const dbError = new Error('Database connection failed');
      mockFeedbackRepository.findByMessageId.mockRejectedValue(dbError);

      await expect(service.findByMessageId(1)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should handle database errors in update', async () => {
      const dbError = new Error('Database connection failed');
      mockFeedbackRepository.updateFeedback.mockRejectedValue(dbError);

      await expect(service.update(1, mockUpdateFeedbackDto)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('tenant isolation', () => {
    it('should use correct tenant ID in create', async () => {
      mockGetTenantId.mockReturnValue('different-tenant');
      mockFeedbackRepository.createFeedback.mockResolvedValue(mockFeedback);

      await service.create(mockCreateFeedbackDto);

      expect(mockFeedbackRepository.createFeedback).toHaveBeenCalledWith({
        ...mockCreateFeedbackDto,
        tenantId: 'different-tenant',
      });
    });

    it('should use correct tenant ID in findByMessageId', async () => {
      mockGetTenantId.mockReturnValue('different-tenant');
      mockFeedbackRepository.findByMessageId.mockResolvedValue([]);

      await service.findByMessageId(1);

      expect(mockFeedbackRepository.findByMessageId).toHaveBeenCalledWith(
        1,
        'different-tenant',
      );
    });

    it('should use correct tenant ID in update', async () => {
      mockGetTenantId.mockReturnValue('different-tenant');
      mockFeedbackRepository.updateFeedback.mockResolvedValue(mockFeedback);

      await service.update(1, mockUpdateFeedbackDto);

      expect(mockFeedbackRepository.updateFeedback).toHaveBeenCalledWith(
        1,
        mockUpdateFeedbackDto,
        'different-tenant',
      );
    });
  });
});
