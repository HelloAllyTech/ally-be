import { Test } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ChatSummaryService } from '../chat-summary.service';
import { ChatService } from '../chat.service';
import { CallDetails } from 'src/common/entities/call.details.entity';
import {
  Chat,
  ChatStatus,
  ChatSummaryStatus,
} from 'src/common/entities/chat.entity';
import { TokenUser } from 'src/auth/type/auth.types';
import { UserRole } from 'src/common/constants/user.constants';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from 'src/common/constants/chat.constants';
import { SettingsService } from 'src/settings/service/settings.service';
import { UserService } from 'src/user/user.service';
import { PermissionValidator } from 'src/auth/service/permission-validator.service';

describe('ChatSummaryService', () => {
  let service: ChatSummaryService;
  let mockChatService: {
    getChatWithCallDetails: jest.Mock;
  };
  let mockSettingsService: {
    getSummaryFieldsConfig: jest.Mock;
  };
  let mockUserService: {
    get: jest.Mock;
  };
  let mockPermissionValidator: {
    validatePermissions: jest.Mock;
  };

  const mockTokenUser: TokenUser = {
    id: 2, // counselor ID
    username: 'testuser',
    role: UserRole.COUNSELOR,
    tenantId: 'test-tenant',
  };

  const mockChat: Chat = {
    id: 1,
    clientId: 1,
    counselorId: 2,
    roomId: 1,
    status: ChatStatus.ENDED,
    summaryStatus: ChatSummaryStatus.SUCCESS,
    startedAt: new Date('2023-01-01T10:00:00Z'),
    endedAt: new Date('2023-01-01T11:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'test-tenant',
    externalId: undefined,
  };

  const mockCallDetails: CallDetails = {
    id: 1,
    chatId: 1,
    startTime: new Date('2023-01-01T10:00:00Z'),
    endTime: new Date('2023-01-01T11:00:00Z'),
    callDuration: 3600,
    callInfo: {
      provider: AudioChatProvider.WEBRTC,
      platform: AudioChatPlatform.WEB,
      summaryName: 'Test Call Summary',
    },
    summary: {
      callId: 'test-call-1',
      callDuration: 3600,
      callDate: '2023-01-01',
      callTime: '10:00:00',
      clientId: '1',
      counsellor: 'Jane Smith',
      callType: 'audio',
      age: 25,
      gender: 'female',
      profession: 'student',
      relationshipStatus: 'single',
      languages: [{ language: 'en', percentage: 100 }],
      location: 'New York',
      codeOfConcern: 'anxiety',
      sessionSummary:
        'Client discussed anxiety issues and coping strategies were provided.',
      counselingProcessFlow: 'intake',
      keyConcerns: 'anxiety and stress',
      subjectiveObservations: 'Client appeared anxious',
      objectiveObservations: 'Client was fidgeting',
      assessment: 'Mild anxiety',
      dominantFeelings: 'anxiety, worry',
      issuesWorkedOn: 'stress management',
      keyTherapeuticTechniques: 'CBT, mindfulness',
      referralsProvided: null,
      homework: 'Practice breathing exercises',
      planForNextCall: 'Continue CBT techniques',
      tags: [
        { tag: 'urgent', positivity_rating: 0.2 },
        { tag: 'follow-up', positivity_rating: 0.8 },
      ],
      listeningShare: 0.7,
      reflectiveQuestionsAsked: 5,
      openEndedQuestionsAsked: 3,
      emotionalLift: 'positive',
      callQuality: 5,
      newCallFollowUp: 'scheduled',
    },
    noOfNudges: 3,
    noOfStages: 2,
    transcript:
      'Client: I have been feeling anxious lately.\nCounselor: Can you tell me more about what triggers your anxiety?',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Create mock functions
    mockChatService = {
      getChatWithCallDetails: jest.fn(),
    };

    mockSettingsService = {
      getSummaryFieldsConfig: jest
        .fn()
        .mockResolvedValue([
          'callId',
          'callDuration',
          'callDate',
          'callTime',
          'clientId',
          'counsellor',
          'callType',
          'age',
          'gender',
          'profession',
          'relationshipStatus',
          'languages',
          'location',
          'codeOfConcern',
          'sessionSummary',
          'counselingProcessFlow',
          'keyConcerns',
          'subjectiveObservations',
          'objectiveObservations',
          'assessment',
          'dominantFeelings',
          'issuesWorkedOn',
          'keyTherapeuticTechniques',
          'referralsProvided',
          'homework',
          'planForNextCall',
          'tags',
          'listeningShare',
          'reflectiveQuestionsAsked',
          'openEndedQuestionsAsked',
          'emotionalLift',
          'callQuality',
          'newCallFollowUp',
        ]),
    };

    mockUserService = {
      get: jest.fn().mockResolvedValue({
        id: 2,
        name: 'Jane Smith',
        email: 'jane@example.com',
      }),
    };

    mockPermissionValidator = {
      validatePermissions: jest.fn().mockResolvedValue(true),
    };

    const module = await Test.createTestingModule({
      providers: [
        ChatSummaryService,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: SettingsService,
          useValue: mockSettingsService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: PermissionValidator,
          useValue: mockPermissionValidator,
        },
      ],
    }).compile();

    service = module.get<ChatSummaryService>(ChatSummaryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset permission validator mock to return true by default
    mockPermissionValidator.validatePermissions.mockResolvedValue(true);
  });

  describe('exportSummary', () => {
    it('should export summary successfully for client', async () => {
      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: mockChat,
        callDetails: mockCallDetails,
      });

      const result = await service.exportSummary(mockTokenUser, 1);

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('fileName');
      expect(result.fileName).toBe('Test Call Summary');
      expect(result.summary).toContain('Chat Summary');
      expect(result.summary).toContain('Client ID: 1');
      expect(result.summary).toContain('Counselor: Jane Smith');
      expect(result.summary).toContain('Call Duration (seconds): 3600');
      expect(result.summary).toContain('Call Quality: 5');
      expect(result.summary).toContain(
        'Tags: urgent (Positivity: 0.2), follow-up (Positivity: 0.8)',
      );
      expect(result.summary).toContain(
        'Session Summary: Client discussed anxiety issues and coping strategies were provided.',
      );
      expect(result.summary).toContain(
        'Homework: Practice breathing exercises',
      );
    });

    it('should export summary successfully for counselor', async () => {
      const counselorUser: TokenUser = {
        ...mockTokenUser,
        id: 2,
        role: UserRole.COUNSELOR,
      };

      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: mockChat,
        callDetails: mockCallDetails,
      });

      const result = await service.exportSummary(counselorUser, 1);

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('fileName');
      expect(result.fileName).toBe('Test Call Summary');
      expect(result.summary).toContain('Chat Summary');
    });

    it('should export summary with minimal data', async () => {
      const minimalCallDetails: CallDetails = {
        ...mockCallDetails,
        callInfo: {},
        summary: undefined,
        transcript: '',
        noOfNudges: 0,
        noOfStages: 0,
      };

      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: mockChat,
        callDetails: minimalCallDetails,
      });

      const result = await service.exportSummary(mockTokenUser, 1);

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('fileName');
      expect(result.summary).toContain('Chat Summary');
      expect(result.summary).toContain('Call Duration (seconds): 3600');
      expect(result.summary).toContain('Call Quality: N/A');
      expect(result.summary).toContain('Tags: N/A');
      expect(result.summary).toContain('Session Summary: N/A');
      expect(result.summary).not.toContain('Notes:');
      expect(result.summary).not.toContain('Transcript:');
    });

    it('should handle missing call details', async () => {
      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: mockChat,
        callDetails: null,
      });

      const result = await service.exportSummary(mockTokenUser, 1);

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('fileName');
      expect(result.summary).toContain('Chat Summary');
      expect(result.summary).toContain('Call Duration (seconds): N/A');
      expect(result.summary).toContain('Call Quality: N/A');
    });

    it('should throw NotFoundException when chat not found', async () => {
      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: null,
        callDetails: null,
      });

      await expect(service.exportSummary(mockTokenUser, 999)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.exportSummary(mockTokenUser, 999)).rejects.toThrow(
        'Chat with ID 999 not found',
      );
    });

    it('should throw ForbiddenException when user is not authorized', async () => {
      const unauthorizedUser: TokenUser = {
        id: 999, // Different user ID
        username: 'unauthorized',
        role: UserRole.COUNSELOR,
        tenantId: 'test-tenant',
      };

      const chatWithDifferentCounselor: Chat = {
        ...mockChat,
        counselorId: 888, // Different counselor ID
      };

      // Mock validatePermissions to return false for unauthorized user
      mockPermissionValidator.validatePermissions.mockResolvedValue(false);

      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: chatWithDifferentCounselor,
        callDetails: mockCallDetails,
      });

      await expect(service.exportSummary(unauthorizedUser, 1)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.exportSummary(unauthorizedUser, 1)).rejects.toThrow(
        'You are not authorized to export this chat summary',
      );
    });

    it('should allow SUPER_ADMIN to export any chat summary', async () => {
      const superAdminUser: TokenUser = {
        id: 999,
        username: 'superadmin',
        role: UserRole.SUPER_ADMIN,
        tenantId: 'test-tenant',
      };

      const chatWithDifferentCounselor: Chat = {
        ...mockChat,
        counselorId: 888, // Different counselor ID
      };

      // Ensure validatePermissions returns true for super admin
      mockPermissionValidator.validatePermissions.mockResolvedValue(true);

      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: chatWithDifferentCounselor,
        callDetails: mockCallDetails,
      });

      const result = await service.exportSummary(superAdminUser, 1);

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('fileName');
      expect(result.summary).toContain('Chat Summary');
    });

    it('should format duration correctly for different durations', async () => {
      const shortCallDetails: CallDetails = {
        ...mockCallDetails,
        callDuration: 300, // 5 minutes
      };

      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: mockChat,
        callDetails: shortCallDetails,
      });

      const result = await service.exportSummary(mockTokenUser, 1);

      expect(result.summary).toContain('Call Duration (seconds): 300');
    });

    it('should format duration correctly for hours and minutes', async () => {
      const longCallDetails: CallDetails = {
        ...mockCallDetails,
        callDuration: 5400, // 1 hour 30 minutes
      };

      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: mockChat,
        callDetails: longCallDetails,
      });

      const result = await service.exportSummary(mockTokenUser, 1);

      expect(result.summary).toContain('Call Duration (seconds): 5400');
    });

    it('should handle empty tags array', async () => {
      const callDetailsWithEmptyTags: CallDetails = {
        ...mockCallDetails,
        summary: {
          callId: 'test-call-1',
          callDuration: 3600,
          callDate: '2023-01-01',
          callTime: '10:00:00',
          clientId: '1',
          counsellor: 'Jane Smith',
          callType: 'audio',
          age: 25,
          gender: 'female',
          profession: 'student',
          relationshipStatus: 'single',
          languages: [{ language: 'en', percentage: 100 }],
          location: 'New York',
          codeOfConcern: 'anxiety',
          sessionSummary:
            'Client discussed anxiety issues and coping strategies were provided.',
          counselingProcessFlow: 'intake',
          keyConcerns: 'anxiety and stress',
          subjectiveObservations: 'Client appeared anxious',
          objectiveObservations: 'Client was fidgeting',
          assessment: 'Mild anxiety',
          dominantFeelings: 'anxiety, worry',
          issuesWorkedOn: 'stress management',
          keyTherapeuticTechniques: 'CBT, mindfulness',
          referralsProvided: null,
          homework: 'Practice breathing exercises',
          planForNextCall: 'Continue CBT techniques',
          tags: [],
          listeningShare: 0.7,
          reflectiveQuestionsAsked: 5,
          openEndedQuestionsAsked: 3,
          emotionalLift: 'positive',
          callQuality: 5,
          newCallFollowUp: 'scheduled',
        },
      };

      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: mockChat,
        callDetails: callDetailsWithEmptyTags,
      });

      const result = await service.exportSummary(mockTokenUser, 1);

      expect(result.summary).toContain('Tags: N/A');
    });

    it('should handle null summary', async () => {
      const callDetailsWithNullSummary: CallDetails = {
        ...mockCallDetails,
        summary: undefined,
      };

      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: mockChat,
        callDetails: callDetailsWithNullSummary,
      });

      const result = await service.exportSummary(mockTokenUser, 1);

      expect(result.summary).toContain('Call Quality: N/A');
      expect(result.summary).toContain('Tags: N/A');
      expect(result.summary).toContain('Session Summary: N/A');
      expect(result.summary).toContain('Homework: N/A');
    });

    it('should generate correct filename with chat ID', async () => {
      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: { ...mockChat, id: 123 },
        callDetails: mockCallDetails,
      });

      const result = await service.exportSummary(mockTokenUser, 123);

      expect(result.fileName).toBe('Test Call Summary');
    });

    it('should include all required sections in summary', async () => {
      mockChatService.getChatWithCallDetails.mockResolvedValue({
        chat: mockChat,
        callDetails: mockCallDetails,
      });

      const result = await service.exportSummary(mockTokenUser, 1);

      const summary = result.summary;
      expect(summary).toContain('Chat Summary');
      expect(summary).toContain('Call ID: 1');
      expect(summary).toContain('Call Date:');
      expect(summary).toContain('Call Duration (seconds):');
      expect(summary).toContain('Client ID:');
      expect(summary).toContain('Counselor:');
      expect(summary).toContain('Call Quality:');
      expect(summary).toContain('Tags:');
      expect(summary).toContain('Session Summary:');
    });
  });
});
