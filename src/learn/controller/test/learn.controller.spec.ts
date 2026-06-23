import { Test, TestingModule } from '@nestjs/testing';
import { LearnController } from '../learn.controller';
import { ScenarioService } from '../../service/scenario.service';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { ScenarioTenantService } from '../../service/scenario-tenant.service';
import { TriggerWarningsService } from '../../service/trigger-warnings.service';
import { ScenarioVersionService } from '../../service/scenario-version.service';
import { ScenarioSharedService } from '../../service/scenario-shared.service';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';
import { TokenUser } from 'src/auth/type/auth.types';
import { ScenarioStatus } from '../../type/scenario.type';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from '../../enum/scenario-session-status.enum';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';
import { DeleteCoverImageDto } from '../../dto/delete-cover-image.dto';
import { DeleteCoverVideoDto } from '../../dto/delete-cover-video.dto';
import { ScenarioVideoUploadRequestDto } from '../../dto/scenario-video-upload-request.dto';
import { ScenarioVideoUploadContentType } from '../../enum/scenario-video-upload-content-type';
import { AddScenarioTenantDto } from '../../dto/add-scenario-tenant.dto';
import { DeleteScenarioTenantDto } from '../../dto/delete-scenario-tenant.dto';
import { ScenarioVoiceSortBy } from '../../enum/scenario-voice-sort-by.enum';
import {
  Gender,
  GenderIdentity,
  SexualOrientation,
} from '../../enum/gender.enum';
import { ReviewStatus } from 'src/review/type/review.type';

describe('LearnController', () => {
  let controller: LearnController;
  let scenarioService: jest.Mocked<ScenarioService>;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;
  let scenarioTenantService: jest.Mocked<ScenarioTenantService>;

  const mockTokenUser: TokenUser = {
    id: 123,
    username: 'test@example.com',
    tenantId: 'tenant-123',
  };

  const mockScenarioResponse = {
    id: 1,
    title: 'Test Scenario',
    scenario: 'Test Scenario Content',
    description: 'Test Description',
    coverImageUrl: 'https://example.com/cover.jpg',
    coverVideoUrl: null,
    status: ScenarioStatus.ACTIVE,
    prompt: 'You are a counselor',
    isGlobal: false,
    metadata: {
      name: 'Test Client',
      age: 30,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 1,
    updatedBy: 1,
  };

  const mockScenarios = [mockScenarioResponse];

  const mockUserInfo = {
    id: 123,
    name: 'Test User',
    email: 'test@example.com',
    role: 'LEARNER',
  };

  const mockScenarioSessionResponse = {
    id: 'session-123',
    roomId: 'room-123',
    scenarioId: 1,
    counselorId: 123,
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    startedAt: new Date(),
    endedAt: new Date(),
    score: 85,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'tenant-123',
    scenario: mockScenarioResponse,
    counselor: mockUserInfo,
  };

  const mockCreateScenariosDto = {
    scenarios: [
      {
        title: 'New Scenario',
        description: 'New Description',
        coverImageUrl: 'https://example.com/new-cover.jpg',
        status: ScenarioStatus.ACTIVE,
        prompt: 'Test prompt',
        name: 'Test Name',
        age: 25,
        gender: Gender.FEMALE,
        genderIdentity: GenderIdentity.FEMALE_WOMAN,
        sexualOrientation: SexualOrientation.HETEROSEXUAL,
        currentLocation: 'New York',
        profession: 'Engineer',
        context: 'Test context',
        personality: 'Friendly',
        tone: 'Professional',
        openingStatements: ['Hello', 'Welcome'],
        isGlobal: false,
        optGuardrails: true,
        currentState: true,
      },
    ],
  };

  const mockUpdateScenarioDto = {
    title: 'Updated Scenario',
    description: 'Updated Description',
    coverImageUrl: 'https://example.com/updated-cover.jpg',
    status: ScenarioStatus.ACTIVE,
    prompt: 'Updated prompt',
  };

  const mockStartScenarioSessionDto = {
    scenarioId: 1,
    languageId: 4,
    language: 'en-IN',
  };

  const mockAddFeedbackDto = {
    rating: 5,
    feedback: 'Great session',
  };

  const mockAddFeedbackWithTagsDto = {
    rating: 4,
    feedback: 'Good session',
    tags: ['helpful', 'clear'],
  };

  const mockCreateScenarioEventsDto = {
    scenarioId: 1,
    events: [
      {
        id: 'event1',
        feedbackStatus: false,
        score: undefined,
        emoji: undefined,
        message: undefined,
        branchingStatus: false,
        branchInstruction: undefined,
        checklistVisibilityStatus: false,
      },
      {
        id: 'event2',
        feedbackStatus: false,
        score: undefined,
        emoji: undefined,
        message: undefined,
        branchingStatus: false,
        branchInstruction: undefined,
        checklistVisibilityStatus: false,
      },
      {
        id: 'event3',
        feedbackStatus: false,
        score: undefined,
        emoji: undefined,
        message: undefined,
        branchingStatus: false,
        branchInstruction: undefined,
        checklistVisibilityStatus: false,
      },
    ],
  };

  const mockDeleteScenarioEventsDto = {
    scenarioId: 1,
    eventIds: ['event1', 'event2'],
  };

  beforeEach(async () => {
    const mockScenarioService = {
      getScenarios: jest.fn(),
      getPublicScenarios: jest.fn(),
      getScenariosV2: jest.fn(),
      getScenario: jest.fn(),
      getAdminScenarios: jest.fn(),
      getAdminScenario: jest.fn(),
      deleteAdminScenario: jest.fn(),
      getPresignedUrlForScenarioCoverImage: jest.fn(),
      getPresignedUrlForScenarioCoverVideo: jest.fn(),
      createScenarios: jest.fn(),
      updateScenario: jest.fn(),
      mapEventsToScenario: jest.fn(),
      deleteScenarioEvents: jest.fn(),
      getScenarioEvents: jest.fn(),
      getScenarioVoices: jest.fn(),
      createScenarioVoice: jest.fn(),
      createScenarioVoices: jest.fn(),
      updateScenarioVoice: jest.fn(),
      deleteCoverImage: jest.fn(),
      deleteCoverVideo: jest.fn(),
      getScenarioVoiceLanguagesForAdmin: jest.fn(),
      getLanguagesForScenario: jest.fn(),
      duplicateScenario: jest.fn(),
      getBranchingInstructionDynamicShortcuts: jest.fn(),
    };

    const mockScenarioSessionService = {
      getScenarioSessions: jest.fn(),
      getAdminScenarioSessions: jest.fn(),
      getScenarioSession: jest.fn(),
      startScenarioSession: jest.fn(),
      previewScenario: jest.fn(),
      endPreviewScenario: jest.fn(),
      endScenarioSession: jest.fn(),
      addFeedbackToScenarioSession: jest.fn(),
      getMessagesByScenarioSessionId: jest.fn(),
      getScenarioSessionSkills: jest.fn(),
      getLatestScenarioSessionByScenarioPathSessionItemId: jest.fn(),
    };

    const mockScenarioTenantService = {
      assignScenariosToTenant: jest.fn(),
      removeScenariosFromTenant: jest.fn(),
      getScenarioTenant: jest.fn(),
    };

    const mockPermissionsService = {
      getUserRoles: jest.fn(),
      isMultiTenantAdmin: jest.fn(),
    };

    const mockTriggerWarningsService = {
      getTriggerWarnings: jest.fn(),
      createTriggerWarning: jest.fn(),
      assignTriggerWarningsToScenario: jest.fn(),
    };

    const mockScenarioSharedService = {
      getScenarioByIds: jest.fn(),
      getScenarioById: jest.fn(),
      getScenarioSessionById: jest.fn(),
      getUniqueLanguagesFromScenarioTranslations: jest.fn(),
      getMessagesByScenarioSessionId: jest.fn(),
    };

    const mockUserService = {
      getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LearnController],
      providers: [
        {
          provide: ScenarioService,
          useValue: mockScenarioService,
        },
        {
          provide: ScenarioSessionService,
          useValue: mockScenarioSessionService,
        },
        {
          provide: ScenarioTenantService,
          useValue: mockScenarioTenantService,
        },
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: TriggerWarningsService,
          useValue: mockTriggerWarningsService,
        },
        {
          provide: ScenarioVersionService,
          useValue: {
            listVersions: jest.fn(),
            getVersion: jest.fn(),
            createVersion: jest.fn(),
            updateVersion: jest.fn(),
            publishVersion: jest.fn(),
            deleteVersion: jest.fn(),
          },
        },
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: AppConfigService,
          useValue: {
            featureFlag: {
              termsAndAgreement: false,
            },
          },
        },
      ],
    }).compile();

    controller = module.get<LearnController>(LearnController);
    scenarioService = module.get(ScenarioService);
    scenarioSessionService = module.get(ScenarioSessionService);
    scenarioTenantService = module.get(ScenarioTenantService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should have all dependencies injected', () => {
      expect(scenarioService).toBeDefined();
      expect(scenarioSessionService).toBeDefined();
      expect(scenarioTenantService).toBeDefined();
    });
  });

  describe('getScenarios', () => {
    it('should return all scenarios', async () => {
      scenarioService.getScenarios.mockResolvedValue(mockScenarios as any);

      const result = await controller.getScenarios();

      expect(result).toEqual(mockScenarios);
      expect(scenarioService.getScenarios).toHaveBeenCalledTimes(1);
      expect(scenarioService.getScenarios).toHaveBeenCalledWith();
    });

    it('should return empty array when no scenarios exist', async () => {
      scenarioService.getScenarios.mockResolvedValue([]);

      const result = await controller.getScenarios();

      expect(result).toEqual([]);
      expect(scenarioService.getScenarios).toHaveBeenCalledTimes(1);
    });

    it('should handle errors from service', async () => {
      const error = new Error('Database error');
      scenarioService.getScenarios.mockRejectedValue(error);

      await expect(controller.getScenarios()).rejects.toThrow('Database error');
    });
  });

  describe('getPublicScenarios', () => {
    it('should return paginated public scenarios', async () => {
      const mockResponse = {
        data: mockScenarios,
        count: mockScenarios.length,
      };
      scenarioService.getPublicScenarios.mockResolvedValue(mockResponse as any);

      const result = await controller.getPublicScenarios();

      expect(result).toEqual(mockResponse);
      expect(scenarioService.getPublicScenarios).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPublicScenariosV2', () => {
    it('should return paginated scenarios for v2 and pass languageCode', async () => {
      const mockResponse = {
        data: mockScenarios,
        count: mockScenarios.length,
      };
      scenarioService.getScenariosV2.mockResolvedValue(mockResponse as any);

      const result = await controller.getPublicScenariosV2('mr');

      expect(result).toEqual(mockResponse);
      expect(scenarioService.getScenariosV2).toHaveBeenCalledTimes(1);
      expect(scenarioService.getScenariosV2).toHaveBeenCalledWith('mr');
    });
  });

  describe('getScenario', () => {
    it('should return a scenario by id and pass languageCode if provided', async () => {
      const scenarioId = 1;
      scenarioService.getScenario.mockResolvedValue(
        mockScenarioResponse as any,
      );

      const result = await controller.getScenario(scenarioId, 'mr');

      expect(result).toEqual(mockScenarioResponse);
      expect(scenarioService.getScenario).toHaveBeenCalledWith(
        scenarioId,
        {
          select: [
            'id',
            'title',
            'scenario',
            'description',
            'coverImageUrl',
            'coverVideoUrl',
            'status',
          ],
        },
        'mr',
      );
    });
  });

  describe('getAdminScenario', () => {
    it('should return a scenario by id for admin', async () => {
      const scenarioId = 1;
      scenarioService.getAdminScenario.mockResolvedValue(
        mockScenarioResponse as any,
      );

      const result = await controller.getAdminScenario(
        mockTokenUser,
        scenarioId,
      );

      expect(result).toEqual(mockScenarioResponse);
      expect(scenarioService.getAdminScenario).toHaveBeenCalledWith(
        scenarioId,
        mockTokenUser,
      );
    });
  });

  describe('getPresignedUrlForScenarioCoverImage', () => {
    it('should return presigned URL for scenario cover image upload', async () => {
      const uploadRequestDto = {
        fileName: 'test-image.jpg',
        fileSize: 1024000,
        contentType: 'image/jpeg' as any,
      };
      const expectedResponse = {
        presignedUrl: 'https://s3.amazonaws.com/presigned-url',
        coverImageUrl:
          'https://s3.amazonaws.com/scenario-cover-images/test.jpg',
      };

      scenarioService.getPresignedUrlForScenarioCoverImage.mockResolvedValue(
        expectedResponse,
      );

      const result =
        await controller.getPresignedUrlForScenarioCoverImage(uploadRequestDto);

      expect(result).toEqual(expectedResponse);
    });
  });

  describe('getPresignedUrlForScenarioCoverVideo', () => {
    it('should return presigned URL for scenario cover video upload', async () => {
      const uploadRequestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'test-video.mp4',
        fileSize: 5000000,
        duration: 30,
        contentType: ScenarioVideoUploadContentType.MP4,
      };
      const expectedResponse = {
        presignedUrl: 'https://s3.amazonaws.com/presigned-url-video',
        coverVideoUrl:
          'https://s3.amazonaws.com/scenario-cover-videos/test.mp4',
      };

      scenarioService.getPresignedUrlForScenarioCoverVideo.mockResolvedValue(
        expectedResponse,
      );

      const result =
        await controller.getPresignedUrlForScenarioCoverVideo(uploadRequestDto);

      expect(result).toEqual(expectedResponse);
    });
  });

  describe('deleteCoverVideo', () => {
    it('should delete cover video successfully', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/test.mp4',
      };
      const expectedResponse = { success: true };

      scenarioService.deleteCoverVideo.mockResolvedValue(expectedResponse);

      const result = await controller.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual(expectedResponse);
    });
  });

  describe('createScenario', () => {
    it('should create multiple scenarios', async () => {
      scenarioService.createScenarios.mockResolvedValue(mockScenarios as any);

      const result = await controller.createScenario(
        mockTokenUser,
        mockCreateScenariosDto,
      );

      expect(result).toEqual(mockScenarios);
      expect(scenarioService.createScenarios).toHaveBeenCalledWith(
        mockCreateScenariosDto,
        mockTokenUser.id,
      );
    });

    it('should handle validation errors', async () => {
      const error = new Error('Validation failed');
      scenarioService.createScenarios.mockRejectedValue(error);

      await expect(
        controller.createScenario(mockTokenUser, mockCreateScenariosDto),
      ).rejects.toThrow('Validation failed');
    });
  });

  describe('updateScenario', () => {
    it('should update a scenario by id', async () => {
      const scenarioId = 1;
      scenarioService.updateScenario.mockResolvedValue(true);

      const result = await controller.updateScenario(
        mockTokenUser,
        scenarioId,
        mockUpdateScenarioDto,
      );

      expect(result).toBe(true);
    });
  });

  describe('previewScenario', () => {
    it('should preview a scenario', async () => {
      const previewDto = { scenarioId: 1 };
      const expectedResponse = {
        roomName: 'preview-1-uuid',
        accessToken: {
          token: 'mock-token',
          roomName: 'preview-1-uuid',
          serverUrl: 'ws://livekit:7880',
        },
      };

      scenarioSessionService.previewScenario.mockResolvedValue(
        expectedResponse as any,
      );

      const result = await controller.previewScenario(
        mockTokenUser,
        previewDto as any,
      );

      expect(result).toEqual(expectedResponse);
    });
  });

  describe('endPreviewScenario', () => {
    it('should end a preview scenario', async () => {
      const roomName = 'preview-test-session-123';

      scenarioSessionService.endPreviewScenario.mockResolvedValue(undefined);

      const result = await controller.endPreviewScenario(roomName);

      expect(result).toBeUndefined();
    });
  });

  describe('deleteAdminScenario', () => {
    it('should delete a scenario by id', async () => {
      const scenarioId = 1;
      scenarioService.deleteAdminScenario.mockResolvedValue(true);

      const result = await controller.deleteAdminScenario(scenarioId);

      expect(result).toBe(true);
      expect(scenarioService.deleteAdminScenario).toHaveBeenCalledWith(
        scenarioId,
      );
    });
  });

  describe('getScenarioSessions', () => {
    it('should return scenario sessions for user with default parameters', async () => {
      const mockSessions = { data: [mockScenarioSessionResponse] };
      scenarioSessionService.getScenarioSessions.mockResolvedValue(
        mockSessions as any,
      );

      const result = await controller.getScenarioSessions(mockTokenUser);

      expect(result).toEqual(mockSessions);
      expect(scenarioSessionService.getScenarioSessions).toHaveBeenCalledWith(
        mockTokenUser.id,
        {
          limit: undefined,
          offset: undefined,
          sortBy: 'createdAt',
          order: 'DESC',
        },
        undefined,
        undefined,
      );
    });

    it('should pass languageCode when provided', async () => {
      const mockSessions = { data: [mockScenarioSessionResponse] };
      scenarioSessionService.getScenarioSessions.mockResolvedValue(
        mockSessions as any,
      );

      const result = await controller.getScenarioSessions(
        mockTokenUser,
        'ENDED',
        10,
        0,
        undefined,
        undefined,
        'mr',
      );

      expect(result).toEqual(mockSessions);
      expect(scenarioSessionService.getScenarioSessions).toHaveBeenCalledWith(
        mockTokenUser.id,
        {
          limit: 10,
          offset: 0,
          sortBy: 'createdAt',
          order: 'DESC',
        },
        'ENDED',
        'mr',
      );
    });
  });

  describe('getAdminScenarioSessions', () => {
    it('should return admin scenario sessions with default parameters', async () => {
      const mockSessions = { data: [mockScenarioSessionResponse] };
      scenarioSessionService.getAdminScenarioSessions.mockResolvedValue(
        mockSessions as any,
      );

      const result = await controller.getAdminScenarioSessions();

      expect(result).toEqual(mockSessions);
      expect(
        scenarioSessionService.getAdminScenarioSessions,
      ).toHaveBeenCalledWith(
        {
          limit: undefined,
          offset: undefined,
          sortBy: 'createdAt',
          order: 'DESC',
        },
        undefined,
      );
    });

    it('should pass languageCode when provided for admin scenario sessions', async () => {
      const mockSessions = { data: [mockScenarioSessionResponse] };
      scenarioSessionService.getAdminScenarioSessions.mockResolvedValue(
        mockSessions as any,
      );

      const result = await controller.getAdminScenarioSessions(
        10,
        0,
        undefined,
        undefined,
        'mr',
      );

      expect(result).toEqual(mockSessions);
      expect(
        scenarioSessionService.getAdminScenarioSessions,
      ).toHaveBeenCalledWith(
        {
          limit: 10,
          offset: 0,
          sortBy: 'createdAt',
          order: 'DESC',
        },
        'mr',
      );
    });
  });

  describe('getScenarioSession', () => {
    it('should return a scenario session by id', async () => {
      const sessionId = 'session-123';
      const mockSession = {
        ...mockScenarioSessionResponse,
        hasFeedback: true,
        sessionFeedback: { rating: 1, feedback: 'test', tags: ['test'] },
        reviewId: 'review-id',
        reviewStatus: ReviewStatus.HIDDEN,
        reviewNote: 'Review note',
        reviewCreatedAt: new Date(),
      };
      scenarioSessionService.getScenarioSession.mockResolvedValue(mockSession);

      const result = await controller.getScenarioSession(
        mockTokenUser,
        sessionId,
        true,
        'mr',
      );

      expect(result).toEqual(mockSession);
      expect(scenarioSessionService.getScenarioSession).toHaveBeenCalledWith(
        sessionId,
        mockTokenUser.id,
        true,
        'mr',
      );
    });
  });

  describe('getMessagesByScenarioSessionId', () => {
    it('should call scenario session service with pagination and includeTags when includeTags is true', async () => {
      const scenarioSessionId = 'session-123';
      const mockResponse = { messages: [], count: 0 };
      scenarioSessionService.getMessagesByScenarioSessionId.mockResolvedValue(
        mockResponse as any,
      );

      await controller.getMessagesByScenarioSessionId(
        scenarioSessionId,
        10,
        0,
        'createdAt',
        SortOrder.ASC,
        true,
      );

      expect(
        scenarioSessionService.getMessagesByScenarioSessionId,
      ).toHaveBeenCalledWith(
        scenarioSessionId,
        { limit: 10, offset: 0, sortBy: 'createdAt', order: SortOrder.ASC },
        { includeTags: true },
      );
    });

    it('should call scenario session service with includeTags false when includeTags is not "true"', async () => {
      const scenarioSessionId = 'session-456';
      scenarioSessionService.getMessagesByScenarioSessionId.mockResolvedValue({
        messages: [],
        count: 0,
      } as any);

      await controller.getMessagesByScenarioSessionId(
        scenarioSessionId,
        undefined,
        undefined,
        undefined,
        SortOrder.ASC,
        false,
      );

      expect(
        scenarioSessionService.getMessagesByScenarioSessionId,
      ).toHaveBeenCalledWith(
        scenarioSessionId,
        {
          limit: undefined,
          offset: undefined,
          sortBy: undefined,
          order: SortOrder.ASC,
        },
        { includeTags: false },
      );
    });
  });

  describe('getScenarioEvents', () => {
    it('should return scenario events with default parameters', async () => {
      const scenarioId = 1;
      const mockEvents = {
        data: [
          {
            eventId: 'event1',
            name: 'Event 1',
            feedbackStatus: false,
            score: 10,
            emoji: undefined,
            message: undefined,
            branchingStatus: false,
            branchInstruction: undefined,
            detectionConfig: undefined,
            checklistVisibilityStatus: false,
            tags: [],
          },
        ],
        count: 1,
      };
      scenarioService.getScenarioEvents.mockResolvedValue(mockEvents);

      const result = await controller.getScenarioEvents(scenarioId);

      expect(result).toEqual(mockEvents);
    });
  });

  describe('mapEventsToScenario', () => {
    it('should map events to scenario', async () => {
      const mockResult = {
        scenarioId: 1,
        events: mockCreateScenarioEventsDto.events.map((e) => ({
          id: e.id,
          feedbackStatus: e.feedbackStatus,
          score: e.score,
          emoji: e.emoji,
          message: e.message,
          branchingStatus: e.branchingStatus,
          branchInstruction: e.branchInstruction,
        })),
      };
      scenarioService.mapEventsToScenario.mockResolvedValue(mockResult as any);

      const result = await controller.mapEventsToScenario(
        mockCreateScenarioEventsDto,
      );

      expect(result).toEqual(mockResult);
    });
  });

  describe('deleteScenarioEvents', () => {
    it('should delete scenario events and return true when rows affected > 0', async () => {
      scenarioService.deleteScenarioEvents.mockResolvedValue(2);

      const result = await controller.deleteScenarioEvents(
        mockDeleteScenarioEventsDto,
      );

      expect(result).toBe(true);
    });

    it('should return false when no rows affected', async () => {
      scenarioService.deleteScenarioEvents.mockResolvedValue(0);

      const result = await controller.deleteScenarioEvents(
        mockDeleteScenarioEventsDto,
      );

      expect(result).toBe(false);
    });
  });

  describe('startScenarioSession', () => {
    it('should start a scenario session', async () => {
      const mockResult = {
        scenarioSession: {
          id: 'session-123',
          roomId: 'room-123',
          scenarioId: 1,
          counselorId: 123,
          status: ScenarioSessionStatus.ACTIVE,
          eventStatus: ScenarioSessionEventStatus.IN_PROGRESS,
          createdAt: new Date(),
          updatedAt: new Date(),
          tenantId: 'tenant-123',
        },
        accessToken: {
          token: 'mock-jwt-token',
          roomName: 'room-123',
          serverUrl: 'ws://localhost:7880',
        },
        scenario: {
          id: 1,
          title: 'Test Scenario',
          metadata: {
            openingStatements: ['Hello'],
          },
        },
      };
      scenarioSessionService.startScenarioSession.mockResolvedValue(
        mockResult as any,
      );

      const result = await controller.startScenarioSession(
        mockTokenUser,
        mockStartScenarioSessionDto,
      );

      expect(result).toEqual(mockResult);
    });
  });

  describe('endScenarioSession', () => {
    it('should end a scenario session', async () => {
      const scenarioSessionId = 'session-123';
      const mockResult = { message: 'Scenario session ended successfully' };
      scenarioSessionService.endScenarioSession.mockResolvedValue(mockResult);

      const result = await controller.endScenarioSession(
        mockTokenUser,
        scenarioSessionId,
      );

      expect(result).toEqual(mockResult);
    });
  });

  describe('addFeedbackToScenarioSession', () => {
    it('should add feedback without tags to a scenario session', async () => {
      const scenarioSessionId = 'session-123';
      const mockResult = {
        id: 'feedback-123',
        scenarioSessionId,
        rating: 5,
        feedback: 'Great session',
        tags: [],
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionService.addFeedbackToScenarioSession.mockResolvedValue(
        mockResult as any,
      );

      const result = await controller.addFeedbackToScenarioSession(
        mockTokenUser,
        scenarioSessionId,
        mockAddFeedbackDto,
      );

      expect(result).toEqual(mockResult);
      expect(
        scenarioSessionService.addFeedbackToScenarioSession,
      ).toHaveBeenCalledWith(
        scenarioSessionId,
        mockTokenUser.id,
        mockAddFeedbackDto,
      );
    });

    it('should add feedback with tags to a scenario session', async () => {
      const scenarioSessionId = 'session-123';
      const mockResult = {
        id: 'feedback-456',
        scenarioSessionId,
        rating: 4,
        feedback: 'Good session',
        tags: ['helpful', 'clear'],
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionService.addFeedbackToScenarioSession.mockResolvedValue(
        mockResult as any,
      );

      const result = await controller.addFeedbackToScenarioSession(
        mockTokenUser,
        scenarioSessionId,
        mockAddFeedbackWithTagsDto,
      );

      expect(result).toEqual(mockResult);
      expect(result.tags).toEqual(['helpful', 'clear']);
      expect(
        scenarioSessionService.addFeedbackToScenarioSession,
      ).toHaveBeenCalledWith(
        scenarioSessionId,
        mockTokenUser.id,
        mockAddFeedbackWithTagsDto,
      );
    });

    it('should add feedback with empty tags array', async () => {
      const scenarioSessionId = 'session-123';
      const dtoWithEmptyTags = { rating: 3, feedback: 'Ok session', tags: [] };
      const mockResult = {
        id: 'feedback-789',
        scenarioSessionId,
        rating: 3,
        feedback: 'Ok session',
        tags: [],
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionService.addFeedbackToScenarioSession.mockResolvedValue(
        mockResult as any,
      );

      const result = await controller.addFeedbackToScenarioSession(
        mockTokenUser,
        scenarioSessionId,
        dtoWithEmptyTags,
      );

      expect(result.tags).toEqual([]);
    });

    it('should handle errors from service', async () => {
      const scenarioSessionId = 'session-not-found';
      scenarioSessionService.addFeedbackToScenarioSession.mockRejectedValue(
        new Error('Scenario session not found'),
      );

      await expect(
        controller.addFeedbackToScenarioSession(
          mockTokenUser,
          scenarioSessionId,
          mockAddFeedbackDto,
        ),
      ).rejects.toThrow('Scenario session not found');
    });
  });

  describe('getScenarioVoices', () => {
    it('should return scenario voices with default parameters', async () => {
      const mockVoices: any[] = [
        {
          id: 'voice-1',
          name: 'Voice 1',
          voiceId: 'openai-voice-1',
          provider: 'openai',
        },
      ];
      scenarioService.getScenarioVoices.mockResolvedValue(mockVoices as any);

      const result = await controller.getScenarioVoices();

      expect(result).toEqual(mockVoices);
      expect(scenarioService.getScenarioVoices).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: undefined,
          order: SortOrder.ASC,
        },
      );
    });

    it('should return scenario voices with pagination and sorting', async () => {
      const mockVoices: any[] = [];
      scenarioService.getScenarioVoices.mockResolvedValue(mockVoices);

      const result = await controller.getScenarioVoices(
        10,
        0,
        ScenarioVoiceSortBy.NAME,
        SortOrder.DESC,
      );

      expect(result).toEqual(mockVoices);
      expect(scenarioService.getScenarioVoices).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        {
          limit: 10,
          offset: 0,
          sortBy: ScenarioVoiceSortBy.NAME,
          order: SortOrder.DESC,
        },
      );
    });

    it('should return scenario voices with search filter', async () => {
      const mockVoices: any[] = [];
      scenarioService.getScenarioVoices.mockResolvedValue(mockVoices);

      const result = await controller.getScenarioVoices(
        10,
        0,
        undefined,
        SortOrder.ASC,
        'priya',
      );

      expect(result).toEqual(mockVoices);
      expect(scenarioService.getScenarioVoices).toHaveBeenCalledWith(
        'priya',
        undefined,
        undefined,
        {
          limit: 10,
          offset: 0,
          sortBy: undefined,
          order: SortOrder.ASC,
        },
      );
    });

    it('should return scenario voices with providers filter', async () => {
      const mockVoices: any[] = [];
      scenarioService.getScenarioVoices.mockResolvedValue(mockVoices);

      const result = await controller.getScenarioVoices(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'google,azure',
      );

      expect(result).toEqual(mockVoices);
      expect(scenarioService.getScenarioVoices).toHaveBeenCalledWith(
        undefined,
        'google,azure',
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: undefined,
          order: SortOrder.ASC,
        },
      );
    });

    it('should return scenario voices with languageIds filter', async () => {
      const mockVoices: any[] = [];
      scenarioService.getScenarioVoices.mockResolvedValue(mockVoices);

      const result = await controller.getScenarioVoices(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '1,2',
      );

      expect(result).toEqual(mockVoices);
      expect(scenarioService.getScenarioVoices).toHaveBeenCalledWith(
        undefined,
        undefined,
        '1,2',
        {
          limit: undefined,
          offset: undefined,
          sortBy: undefined,
          order: SortOrder.ASC,
        },
      );
    });
  });
  describe('createScenarioVoices', () => {
    it('should create scenario voices', async () => {
      const createVoicesDto = {
        voices: [
          {
            id: 'voice-new',
            name: 'New Voice',
            voiceId: 'openai-voice-new',
            provider: 'openai',
            config: { speed: 1.0 },
            languageId: 1,
          },
        ],
      };
      const mockCreatedVoices = createVoicesDto.voices;

      scenarioService.createScenarioVoices.mockResolvedValue(
        mockCreatedVoices as any,
      );

      const result = await controller.createScenarioVoices(createVoicesDto);

      expect(result).toEqual(mockCreatedVoices);
    });
  });

  describe('updateScenarioVoice', () => {
    it('should update a scenario voice', async () => {
      const voiceId = 'voice-123';
      const updateDto = {
        name: 'Updated Voice Name',
      };
      scenarioService.updateScenarioVoice.mockResolvedValue(true);

      const result = await controller.updateScenarioVoice(voiceId, updateDto);

      expect(result).toBe(true);
    });
  });

  describe('deleteCoverImage', () => {
    it('should delete cover image successfully', async () => {
      const deleteCoverImageDto: DeleteCoverImageDto = {
        coverImageUrl:
          'https://bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/test.jpg',
      };
      const expectedResponse = { success: true };

      scenarioService.deleteCoverImage.mockResolvedValue(expectedResponse);

      const result = await controller.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual(expectedResponse);
    });
  });

  describe('assignScenarioToTenant', () => {
    it('should assign scenarios to tenant successfully', async () => {
      const tenantId = 'tenant-123';
      const addScenarioTenantDto: AddScenarioTenantDto = {
        scenarioIds: [1, 2, 3],
      };
      const expectedResponse = {
        success: true,
        count: 3,
      };

      scenarioTenantService.assignScenariosToTenant.mockResolvedValue(
        expectedResponse as any,
      );

      const result = await controller.assignScenariosToTenant(
        tenantId,
        addScenarioTenantDto,
      );

      expect(result).toEqual(expectedResponse);
      expect(
        scenarioTenantService.assignScenariosToTenant,
      ).toHaveBeenCalledWith(tenantId, addScenarioTenantDto);
    });

    it('should handle single scenario assignment', async () => {
      const tenantId = 'tenant-456';
      const addScenarioTenantDto: AddScenarioTenantDto = {
        scenarioIds: [5],
      };
      const expectedResponse = {
        success: true,
        count: 1,
      };

      scenarioTenantService.assignScenariosToTenant.mockResolvedValue(
        expectedResponse as any,
      );

      const result = await controller.assignScenariosToTenant(
        tenantId,
        addScenarioTenantDto,
      );

      expect(result).toEqual(expectedResponse);
    });

    it('should handle empty scenario list', async () => {
      const tenantId = 'tenant-123';
      const addScenarioTenantDto: AddScenarioTenantDto = {
        scenarioIds: [],
      };
      const expectedResponse = {
        success: true,
        count: 0,
      };

      scenarioTenantService.assignScenariosToTenant.mockResolvedValue(
        expectedResponse as any,
      );

      const result = await controller.assignScenariosToTenant(
        tenantId,
        addScenarioTenantDto,
      );

      expect(result).toEqual(expectedResponse);
    });

    it('should handle errors during scenario assignment', async () => {
      const tenantId = 'tenant-invalid';
      const addScenarioTenantDto: AddScenarioTenantDto = {
        scenarioIds: [1, 2],
      };
      const error = new Error('Tenant not found');

      scenarioTenantService.assignScenariosToTenant.mockRejectedValue(error);

      await expect(
        controller.assignScenariosToTenant(tenantId, addScenarioTenantDto),
      ).rejects.toThrow('Tenant not found');
    });
  });

  describe('removeScenarioFromTenants', () => {
    it('should remove scenarios from tenant successfully', async () => {
      const tenantId = 'tenant-123';
      const deleteScenarioTenantDto: DeleteScenarioTenantDto = {
        scenarioIds: [1, 2, 3],
      };
      const expectedResponse = {
        success: true,
        count: 3,
      };

      scenarioTenantService.removeScenariosFromTenant.mockResolvedValue(
        expectedResponse as any,
      );

      const result = await controller.removeScenariosFromTenant(
        tenantId,
        deleteScenarioTenantDto,
      );

      expect(result).toEqual(expectedResponse);
    });

    it('should handle single scenario removal', async () => {
      const tenantId = 'tenant-456';
      const deleteScenarioTenantDto: DeleteScenarioTenantDto = {
        scenarioIds: [5],
      };
      const expectedResponse = {
        success: true,
        count: 1,
      };

      scenarioTenantService.removeScenariosFromTenant.mockResolvedValue(
        expectedResponse as any,
      );

      const result = await controller.removeScenariosFromTenant(
        tenantId,
        deleteScenarioTenantDto,
      );

      expect(result).toEqual(expectedResponse);
    });

    it('should handle errors during scenario removal', async () => {
      const tenantId = 'tenant-invalid';
      const deleteScenarioTenantDto: DeleteScenarioTenantDto = {
        scenarioIds: [1, 2],
      };
      const error = new Error('Tenant not found');

      scenarioTenantService.removeScenariosFromTenant.mockRejectedValue(error);

      await expect(
        controller.removeScenariosFromTenant(tenantId, deleteScenarioTenantDto),
      ).rejects.toThrow('Tenant not found');
    });
  });

  describe('getLatestScenarioSessionByPathSessionItemId', () => {
    it('should return a scenario session when found', async () => {
      const pathSessionItemId = '550e8400-e29b-41d4-a716-446655440000';
      const mockSession = {
        ...mockScenarioSessionResponse,
        scenarioPathSessionItemId: pathSessionItemId,
      };
      scenarioSessionService.getLatestScenarioSessionByScenarioPathSessionItemId.mockResolvedValue(
        mockSession,
      );

      const result =
        await controller.getLatestScenarioSessionByPathSessionItemId(
          pathSessionItemId,
        );

      expect(result).toEqual(mockSession);
      expect(
        scenarioSessionService.getLatestScenarioSessionByScenarioPathSessionItemId,
      ).toHaveBeenCalledWith(pathSessionItemId);
      expect(
        scenarioSessionService.getLatestScenarioSessionByScenarioPathSessionItemId,
      ).toHaveBeenCalledTimes(1);
    });

    it('should return null when scenario session is not found', async () => {
      const pathSessionItemId = '550e8400-e29b-41d4-a716-446655440000';
      scenarioSessionService.getLatestScenarioSessionByScenarioPathSessionItemId.mockResolvedValue(
        null,
      );

      const result =
        await controller.getLatestScenarioSessionByPathSessionItemId(
          pathSessionItemId,
        );

      expect(result).toBeNull();
      expect(
        scenarioSessionService.getLatestScenarioSessionByScenarioPathSessionItemId,
      ).toHaveBeenCalledWith(pathSessionItemId);
    });

    it('should handle errors from service', async () => {
      const pathSessionItemId = '550e8400-e29b-41d4-a716-446655440000';
      const error = new Error('Database error');
      scenarioSessionService.getLatestScenarioSessionByScenarioPathSessionItemId.mockRejectedValue(
        error,
      );

      await expect(
        controller.getLatestScenarioSessionByPathSessionItemId(
          pathSessionItemId,
        ),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getScenarioVoiceLanguagesForAdmin', () => {
    const mockLanguages = [
      {
        language_id: 1,
        value: 'en-IN',
        label: 'English (India)',
        translationCode: 'en',
        voices: [
          {
            id: 'cxsx-shans-ssbs8w',
            name: 'Priya (Female)',
          },
        ],
      },
      {
        language_id: 2,
        value: 'hi-IN',
        label: 'Hindi (India)',
        translationCode: 'hi',
        voices: [
          {
            id: 'cxsx-shans-ssbs8q',
            name: 'Priya (Female)',
          },
        ],
      },
    ];

    it('should return languages with active filter', async () => {
      scenarioService.getScenarioVoiceLanguagesForAdmin.mockResolvedValue(
        mockLanguages,
      );
      const result = await controller.getScenarioVoiceLanguagesForAdmin(true);
      expect(result).toEqual(mockLanguages);
      expect(
        scenarioService.getScenarioVoiceLanguagesForAdmin,
      ).toHaveBeenCalledWith(true, undefined);
    });

    it('should return all languages when no filter is provided', async () => {
      scenarioService.getScenarioVoiceLanguagesForAdmin.mockResolvedValue(
        mockLanguages,
      );
      const result =
        await controller.getScenarioVoiceLanguagesForAdmin(undefined);
      expect(result).toEqual(mockLanguages);
      expect(
        scenarioService.getScenarioVoiceLanguagesForAdmin,
      ).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should handle errors from service', async () => {
      scenarioService.getScenarioVoiceLanguagesForAdmin.mockRejectedValue(
        new Error('Service error'),
      );
      await expect(
        controller.getScenarioVoiceLanguagesForAdmin(true),
      ).rejects.toThrow('Service error');
    });

    it('should return languages with voicesNeeded filter', async () => {
      scenarioService.getScenarioVoiceLanguagesForAdmin.mockResolvedValue(
        mockLanguages,
      );
      const result = await controller.getScenarioVoiceLanguagesForAdmin(
        undefined,
        true,
      );
      expect(result).toEqual(mockLanguages);
      expect(
        scenarioService.getScenarioVoiceLanguagesForAdmin,
      ).toHaveBeenCalledWith(undefined, true);
    });

    it('should return languages with both active and voicesNeeded filters', async () => {
      scenarioService.getScenarioVoiceLanguagesForAdmin.mockResolvedValue(
        mockLanguages,
      );
      const result = await controller.getScenarioVoiceLanguagesForAdmin(
        true,
        true,
      );
      expect(result).toEqual(mockLanguages);
      expect(
        scenarioService.getScenarioVoiceLanguagesForAdmin,
      ).toHaveBeenCalledWith(true, true);
    });
  });

  describe('getLanguagesForScenario', () => {
    const mockAvailableLanguages = [
      { language_id: 1, value: 'en-IN', label: 'English (India)' },
      { language_id: 2, value: 'hi-IN', label: 'Hindi (India)' },
    ];

    it('should return languages with both filters', async () => {
      scenarioService.getLanguagesForScenario.mockResolvedValue(
        mockAvailableLanguages,
      );
      const result = await controller.getLanguagesForScenario(true, true);
      expect(result).toEqual(mockAvailableLanguages);
      expect(scenarioService.getLanguagesForScenario).toHaveBeenCalledWith(
        true,
        true,
      );
    });

    it('should handle only active filter', async () => {
      scenarioService.getLanguagesForScenario.mockResolvedValue(
        mockAvailableLanguages,
      );
      const result = await controller.getLanguagesForScenario(true, undefined);
      expect(result).toEqual(mockAvailableLanguages);
      expect(scenarioService.getLanguagesForScenario).toHaveBeenCalledWith(
        true,
        undefined,
      );
    });

    it('should handle only hasVoices filter', async () => {
      scenarioService.getLanguagesForScenario.mockResolvedValue(
        mockAvailableLanguages,
      );
      const result = await controller.getLanguagesForScenario(undefined, true);
      expect(result).toEqual(mockAvailableLanguages);
      expect(scenarioService.getLanguagesForScenario).toHaveBeenCalledWith(
        undefined,
        true,
      );
    });

    it('should return all languages when no filters are provided', async () => {
      scenarioService.getLanguagesForScenario.mockResolvedValue(
        mockAvailableLanguages,
      );
      const result = await controller.getLanguagesForScenario(
        undefined,
        undefined,
      );
      expect(result).toEqual(mockAvailableLanguages);
      expect(scenarioService.getLanguagesForScenario).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });

    it('should handle errors from service', async () => {
      scenarioService.getLanguagesForScenario.mockRejectedValue(
        new Error('Service error'),
      );
      await expect(
        controller.getLanguagesForScenario(true, true),
      ).rejects.toThrow('Service error');
    });

    describe('duplicateScenario', () => {
      it('should duplicate a scenario by id', async () => {
        const scenarioId = 1;
        const mockDuplicatedScenario = {
          ...mockScenarioResponse,
          id: 999,
          title: 'Test Scenario (Copy)',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        scenarioService.duplicateScenario.mockResolvedValue(
          mockDuplicatedScenario as any,
        );
        const result = await controller.duplicateScenario(scenarioId);
        expect(result).toEqual(mockDuplicatedScenario);
        expect(scenarioService.duplicateScenario).toHaveBeenCalledWith(
          scenarioId,
        );
        expect(scenarioService.duplicateScenario).toHaveBeenCalledTimes(1);
      });

      it('should handle errors when scenario does not exist', async () => {
        const scenarioId = 999;
        const error = new Error('Scenario not found');
        scenarioService.duplicateScenario.mockRejectedValue(error);
        await expect(controller.duplicateScenario(scenarioId)).rejects.toThrow(
          'Scenario not found',
        );
      });
    });
  });

  describe('getBranchingInstructionDynamicShortcuts', () => {
    const mockShortcuts = ['end_session', 'restart', 'escalate'];

    it('should return dynamic branch shortcuts without scenarioId', async () => {
      scenarioService.getBranchingInstructionDynamicShortcuts.mockResolvedValue(
        mockShortcuts,
      );

      const result = await controller.getBranchingInstructionDynamicShortcuts();

      expect(result).toEqual(mockShortcuts);
      expect(
        scenarioService.getBranchingInstructionDynamicShortcuts,
      ).toHaveBeenCalledWith(undefined);
    });

    it('should return dynamic branch shortcuts for a specific scenario', async () => {
      const scenarioId = 1;
      scenarioService.getBranchingInstructionDynamicShortcuts.mockResolvedValue(
        mockShortcuts,
      );

      const result =
        await controller.getBranchingInstructionDynamicShortcuts(scenarioId);

      expect(result).toEqual(mockShortcuts);
      expect(
        scenarioService.getBranchingInstructionDynamicShortcuts,
      ).toHaveBeenCalledWith(scenarioId);
    });

    it('should return empty array when no shortcuts exist', async () => {
      scenarioService.getBranchingInstructionDynamicShortcuts.mockResolvedValue(
        [],
      );

      const result = await controller.getBranchingInstructionDynamicShortcuts();

      expect(result).toEqual([]);
    });

    it('should handle errors from service', async () => {
      scenarioService.getBranchingInstructionDynamicShortcuts.mockRejectedValue(
        new Error('Service error'),
      );

      await expect(
        controller.getBranchingInstructionDynamicShortcuts(),
      ).rejects.toThrow('Service error');
    });
  });
});
