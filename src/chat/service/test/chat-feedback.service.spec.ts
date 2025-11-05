import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChatFeedbackService } from '../chat-feedback.service';
import { CallDetailsRepository } from '../../repository/call-details.repository';
import { SummaryFeedbackRepository } from '../../repository/summary-feedback.repository';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from '../../../common/constants/chat.constants';
import { CallDetails } from 'src/chat/entity/call.details.entity';

describe('ChatFeedbackService', () => {
  let service: ChatFeedbackService;
  let callDetailsRepository: CallDetailsRepository;
  let summaryFeedbackRepository: SummaryFeedbackRepository;
  let dataSource: DataSource;

  const mockCallDetails: CallDetails = {
    id: 1,
    chatId: 1,
    startTime: new Date('2024-01-01T10:00:00Z'),
    endTime: new Date('2024-01-01T10:30:00Z'),
    callDuration: 1800,
    callInfo: {
      provider: AudioChatProvider.WEBRTC,
      platform: AudioChatPlatform.WEB,
      notes: 'Existing notes',
    },
    summary: undefined,
    noOfNudges: 2,
    noOfStages: 3,
    transcript: 'Test transcript',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockFeedback = {
    id: 1,
    chatId: 1,
    rating: 5,
    feedback: { comment: 'Great session!', issues: [] },
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Mock ExecutionManager
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('test-tenant');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFeedbackService,
        {
          provide: CallDetailsRepository,
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: SummaryFeedbackRepository,
          useValue: {
            createSummaryFeedback: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ChatFeedbackService>(ChatFeedbackService);
    callDetailsRepository = module.get<CallDetailsRepository>(
      CallDetailsRepository,
    );
    summaryFeedbackRepository = module.get<SummaryFeedbackRepository>(
      SummaryFeedbackRepository,
    );
    dataSource = module.get<DataSource>(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addNoteToSession', () => {
    it('should add note to session successfully', async () => {
      const noteDto = { content: 'Test note content' };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      const result = await service.addNoteToSession(1, noteDto);

      expect(callDetailsRepository.findOne).toHaveBeenCalledWith({
        where: { chatId: 1, tenantId: 'test-tenant' },
      });
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            ...mockCallDetails.callInfo,
            notes: 'Test note content',
          },
        },
      );
      expect(result).toEqual({ notes: 'Test note content' });
    });

    it('should update existing notes', async () => {
      const noteDto = { content: 'Updated note content' };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      const result = await service.addNoteToSession(1, noteDto);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            ...mockCallDetails.callInfo,
            notes: 'Updated note content',
          },
        },
      );
      expect(result).toEqual({ notes: 'Updated note content' });
    });

    it('should handle call details with empty callInfo', async () => {
      const callDetailsWithoutInfo = {
        ...mockCallDetails,
        callInfo: undefined,
      };
      const noteDto = { content: 'New note' };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(callDetailsWithoutInfo as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      const result = await service.addNoteToSession(1, noteDto);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            notes: 'New note',
          },
        },
      );
      expect(result).toEqual({ notes: 'New note' });
    });

    it('should throw NotFoundException when call details not found', async () => {
      const noteDto = { content: 'Test note' };

      jest.spyOn(callDetailsRepository, 'findOne').mockResolvedValue(null);

      await expect(service.addNoteToSession(1, noteDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.addNoteToSession(1, noteDto)).rejects.toThrow(
        'Call details not found for chat 1',
      );

      expect(callDetailsRepository.update).not.toHaveBeenCalled();
    });

    it('should handle empty note content', async () => {
      const noteDto = { content: '' };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      const result = await service.addNoteToSession(1, noteDto);

      expect(result).toEqual({ notes: '' });
    });

    it('should preserve other callInfo properties', async () => {
      const noteDto = { content: 'Test note' };
      const callDetailsWithExtraInfo = {
        ...mockCallDetails,
        callInfo: {
          ...mockCallDetails.callInfo,
          summaryName: 'Session 1',
          clientTalkingPercentage: 0.6,
        },
      };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(callDetailsWithExtraInfo as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.addNoteToSession(1, noteDto);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            ...callDetailsWithExtraInfo.callInfo,
            notes: 'Test note',
          },
        },
      );
    });
  });

  describe('addFeedbackToChat', () => {
    it('should add feedback to chat successfully', async () => {
      const summaryFeedbackDto = {
        rating: 5,
        feedback: {
          comment: 'Great session!',
          issues: [],
        },
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === CallDetails) {
            return {
              findOne: jest.fn().mockResolvedValue(mockCallDetails),
              update: jest.fn().mockResolvedValue({}),
            };
          }
          return null;
        }),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation(async (callback: any) => {
          return callback(mockEntityManager);
        });

      jest
        .spyOn(summaryFeedbackRepository, 'createSummaryFeedback')
        .mockResolvedValue(mockFeedback as any);

      const result = await service.addFeedbackToChat(1, summaryFeedbackDto);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(CallDetails);
      expect(
        summaryFeedbackRepository.createSummaryFeedback,
      ).toHaveBeenCalledWith(
        1,
        5,
        { comment: 'Great session!', issues: [] },
        mockEntityManager,
      );
      expect(result).toEqual({
        message: 'Feedback added successfully',
        feedback: mockFeedback,
      });
    });

    it('should set isSummaryFeedbackAdded flag', async () => {
      const summaryFeedbackDto = {
        rating: 4,
        feedback: {
          comment: 'Good session',
          issues: ['minor issue'],
        },
      };

      const mockCallDetailsRepo = {
        findOne: jest.fn().mockResolvedValue(mockCallDetails),
        update: jest.fn().mockResolvedValue({}),
      };

      const mockEntityManager = {
        getRepository: jest.fn(() => mockCallDetailsRepo),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation(async (callback: any) => {
          return callback(mockEntityManager);
        });

      jest
        .spyOn(summaryFeedbackRepository, 'createSummaryFeedback')
        .mockResolvedValue(mockFeedback as any);

      await service.addFeedbackToChat(1, summaryFeedbackDto);

      expect(mockCallDetailsRepo.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            ...mockCallDetails.callInfo,
            isSummaryFeedbackAdded: true,
          },
        },
      );
    });

    it('should throw NotFoundException when call details not found', async () => {
      const summaryFeedbackDto = {
        rating: 5,
        feedback: {
          comment: 'Test',
          issues: [],
        },
      };

      const mockCallDetailsRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      };

      const mockEntityManager = {
        getRepository: jest.fn(() => mockCallDetailsRepo),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation(async (callback: any) => {
          return callback(mockEntityManager);
        });

      await expect(
        service.addFeedbackToChat(1, summaryFeedbackDto),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.addFeedbackToChat(1, summaryFeedbackDto),
      ).rejects.toThrow('Call details not found for chat 1');

      expect(
        summaryFeedbackRepository.createSummaryFeedback,
      ).not.toHaveBeenCalled();
    });

    it('should handle call details with empty callInfo', async () => {
      const summaryFeedbackDto = {
        rating: 5,
        feedback: {
          comment: 'Test',
          issues: [],
        },
      };

      const callDetailsWithoutInfo = {
        ...mockCallDetails,
        callInfo: undefined,
      };

      const mockCallDetailsRepo = {
        findOne: jest.fn().mockResolvedValue(callDetailsWithoutInfo),
        update: jest.fn().mockResolvedValue({}),
      };

      const mockEntityManager = {
        getRepository: jest.fn(() => mockCallDetailsRepo),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation(async (callback: any) => {
          return callback(mockEntityManager);
        });

      jest
        .spyOn(summaryFeedbackRepository, 'createSummaryFeedback')
        .mockResolvedValue(mockFeedback as any);

      await service.addFeedbackToChat(1, summaryFeedbackDto);

      expect(mockCallDetailsRepo.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            isSummaryFeedbackAdded: true,
          },
        },
      );
    });

    it('should handle feedback with multiple issues', async () => {
      const summaryFeedbackDto = {
        rating: 3,
        feedback: {
          comment: 'Session had some issues',
          issues: ['audio quality', 'connection problems', 'delayed responses'],
        },
      };

      const mockCallDetailsRepo = {
        findOne: jest.fn().mockResolvedValue(mockCallDetails),
        update: jest.fn().mockResolvedValue({}),
      };

      const mockEntityManager = {
        getRepository: jest.fn(() => mockCallDetailsRepo),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation(async (callback: any) => {
          return callback(mockEntityManager);
        });

      jest
        .spyOn(summaryFeedbackRepository, 'createSummaryFeedback')
        .mockResolvedValue(mockFeedback as any);

      const result = await service.addFeedbackToChat(1, summaryFeedbackDto);

      expect(
        summaryFeedbackRepository.createSummaryFeedback,
      ).toHaveBeenCalledWith(
        1,
        3,
        {
          comment: 'Session had some issues',
          issues: ['audio quality', 'connection problems', 'delayed responses'],
        },
        mockEntityManager,
      );
      expect(result).toEqual({
        message: 'Feedback added successfully',
        feedback: mockFeedback,
      });
    });

    it('should preserve other callInfo properties when adding feedback', async () => {
      const summaryFeedbackDto = {
        rating: 5,
        feedback: {
          comment: 'Test',
          issues: [],
        },
      };

      const callDetailsWithExtraInfo = {
        ...mockCallDetails,
        callInfo: {
          ...mockCallDetails.callInfo,
          summaryName: 'Session 1',
          clientTalkingPercentage: 0.6,
          notes: 'Existing notes',
        },
      };

      const mockCallDetailsRepo = {
        findOne: jest.fn().mockResolvedValue(callDetailsWithExtraInfo),
        update: jest.fn().mockResolvedValue({}),
      };

      const mockEntityManager = {
        getRepository: jest.fn(() => mockCallDetailsRepo),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation(async (callback: any) => {
          return callback(mockEntityManager);
        });

      jest
        .spyOn(summaryFeedbackRepository, 'createSummaryFeedback')
        .mockResolvedValue(mockFeedback as any);

      await service.addFeedbackToChat(1, summaryFeedbackDto);

      expect(mockCallDetailsRepo.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            ...callDetailsWithExtraInfo.callInfo,
            isSummaryFeedbackAdded: true,
          },
        },
      );
    });

    it('should handle transaction rollback on error', async () => {
      const summaryFeedbackDto = {
        rating: 5,
        feedback: {
          comment: 'Test',
          issues: [],
        },
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockRejectedValue(new Error('Transaction failed'));

      await expect(
        service.addFeedbackToChat(1, summaryFeedbackDto),
      ).rejects.toThrow('Transaction failed');
    });
  });
});
