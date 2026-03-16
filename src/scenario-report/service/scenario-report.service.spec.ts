import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ScenarioReportService } from './scenario-report.service';
import { ScenarioReportRepository } from '../repository/scenario-report.repository';
import { ScenarioReportNotificationService } from './scenario-report-notification.service';
import { ScenarioReportTranscriptService } from './scenario-report-transcript.service';
import { AiService } from '../../ai/service/ai.service';
import { SharedLanguageService } from '../../language/service/shared-language.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { ScenarioReport } from '../entity/scenario-report.entity';
import { ScenarioReportStatus } from '../enum/scenario-report.enum';
import {
  SCENARIO_REPORT_END_STATUSES,
  SCENARIO_REPORT_TTL_SECONDS,
} from '../constants/scenario-report.constant';
import { RedisService } from '../../redis/service/redis.service';
import { TIME } from 'src/common/constants/time.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';

jest.mock('../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
  },
}));

describe('ScenarioReportService', () => {
  let service: ScenarioReportService;
  let scenarioReportRepository: jest.Mocked<ScenarioReportRepository>;
  let scenarioReportNotificationService: jest.Mocked<ScenarioReportNotificationService>;
  let scenarioReportTranscriptService: jest.Mocked<ScenarioReportTranscriptService>;
  let aiService: jest.Mocked<AiService>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let redisService: jest.Mocked<RedisService>;
  let permissionsService: jest.Mocked<PermissionsService>;

  const userId = 1;
  const scenarioId = 10;
  const reportId = 'report-uuid-1';
  const mockReport: Partial<ScenarioReport> = {
    id: reportId,
    scenarioId,
    status: ScenarioReportStatus.STARTED,
    createdBy: userId,
    updatedBy: userId,
    config: { helperAgentPrompt: 'prompt', languageId: 1, turns: 5 },
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn(),
      getAllScenarioReportsAndCount: jest.fn(),
      findRecentReportsByCreatedBy: jest.fn(),
    };

    const mockRedisService = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const mockNotificationService = {
      notifyUpdate: jest.fn(),
    };

    const mockTranscriptService = {
      addTranscripts: jest.fn().mockResolvedValue(undefined),
      getScenarioReportTranscripts: jest
        .fn()
        .mockResolvedValue({ messages: [], count: 0 }),
    };

    const mockAiService = {
      triggerScenarioReportGenerate: jest.fn().mockResolvedValue(undefined),
    };

    const mockSharedLanguageService = {
      getLanguagesByIds: jest
        .fn()
        .mockResolvedValue([{ id: 1, value: 'en', label: 'English' }]),
    };

    const mockScenarioSharedService = {
      createMetadataForScenario: jest
        .fn()
        .mockResolvedValue({ events: [], scenario: {} }),
      getAdminScenario: jest.fn().mockResolvedValue({
        id: scenarioId,
        title: 'Test Scenario',
      }),
      getScenarioById: jest.fn().mockResolvedValue({
        id: scenarioId,
        title: 'Test Scenario',
      }),
      getScenarioByIds: jest
        .fn()
        .mockImplementation((ids: number[]) =>
          Promise.resolve(ids.map((id) => ({ id, title: 'Test Scenario' }))),
        ),
      hasAllActiveScenarioMandatoryFields: jest.fn().mockReturnValue(true),
    };

    const mockOpenAITranslationsService = {
      translateText: jest
        .fn()
        .mockImplementation((text: string) => Promise.resolve(text)),
    };

    const mockPermissionsService = {
      isMultiTenantAdmin: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioReportService,
        {
          provide: ScenarioReportRepository,
          useValue: mockRepository,
        },
        {
          provide: ScenarioReportNotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: ScenarioReportTranscriptService,
          useValue: mockTranscriptService,
        },
        {
          provide: AiService,
          useValue: mockAiService,
        },
        {
          provide: SharedLanguageService,
          useValue: mockSharedLanguageService,
        },
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
        {
          provide: OpenAITranslationsService,
          useValue: mockOpenAITranslationsService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
      ],
    }).compile();

    service = module.get<ScenarioReportService>(ScenarioReportService);
    scenarioReportRepository = module.get(ScenarioReportRepository);
    scenarioReportNotificationService = module.get(
      ScenarioReportNotificationService,
    );
    scenarioReportTranscriptService = module.get(
      ScenarioReportTranscriptService,
    );
    aiService = module.get(AiService);
    sharedLanguageService = module.get(SharedLanguageService);
    scenarioSharedService = module.get(ScenarioSharedService);
    redisService = module.get(RedisService);
    permissionsService = module.get(PermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkForInProgressScenarioReports', () => {
    it('should throw BadRequestException when scenario has in-progress reports', async () => {
      scenarioReportRepository.find.mockResolvedValue([
        {
          id: 'r1',
          status: ScenarioReportStatus.IN_PROGRESS,
        } as ScenarioReport,
      ]);

      await expect(
        service.checkForInProgressScenarioReports(scenarioId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.checkForInProgressScenarioReports(scenarioId),
      ).rejects.toThrow(
        'There is already a scenario report in progress for this scenario',
      );
      expect(scenarioReportRepository.find).toHaveBeenCalledWith({
        where: { scenarioId, status: ScenarioReportStatus.IN_PROGRESS },
      });
    });

    it('should use custom error message when provided', async () => {
      scenarioReportRepository.find.mockResolvedValue([
        { id: 'r1' } as ScenarioReport,
      ]);

      await expect(
        service.checkForInProgressScenarioReports(
          scenarioId,
          'Custom error message',
        ),
      ).rejects.toThrow('Custom error message');
    });
  });

  describe('getScenarioReportById', () => {
    it('should throw NotFoundException when report does not exist', async () => {
      scenarioReportRepository.findOne.mockResolvedValue(null);

      await expect(service.getScenarioReportById(reportId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getScenarioReportById(reportId)).rejects.toThrow(
        'Scenario report not found',
      );
    });

    it('should return report when found', async () => {
      scenarioReportRepository.findOne.mockResolvedValue(
        mockReport as ScenarioReport,
      );

      const result = await service.getScenarioReportById(reportId);

      expect(result).toEqual({
        ...mockReport,
        scenarioTitle: 'Test Scenario',
        language: { id: 1, value: 'en', label: 'English' },
      });
      expect(scenarioReportRepository.findOne).toHaveBeenCalledWith({
        where: { id: reportId },
      });
    });

    it('should throw ForbiddenException when multi-tenant admin is not the creator of the scenario', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        userId.toString(),
      );
      scenarioReportRepository.findOne.mockResolvedValue(
        mockReport as ScenarioReport,
      );
      permissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      scenarioSharedService.getAdminScenario.mockResolvedValue({
        id: scenarioId,
        createdBy: 999,
      } as any);

      await expect(service.getScenarioReportById(reportId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(permissionsService.isMultiTenantAdmin).toHaveBeenCalledWith(
        userId,
      );
    });
  });

  describe('getScenarioReports', () => {
    it('should throw BadRequestException for invalid status values', async () => {
      await expect(
        service.getScenarioReports(scenarioId, 'INVALID,COMPLETED'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getScenarioReports(scenarioId, 'INVALID,COMPLETED'),
      ).rejects.toThrow(/Invalid status values/);
    });

    it('should filter by status list when statuses provided', async () => {
      const reports = [mockReport as ScenarioReport];
      scenarioReportRepository.getAllScenarioReportsAndCount.mockResolvedValue([
        reports,
        1,
      ]);

      const result = await service.getScenarioReports(
        scenarioId,
        'COMPLETED, CANCELLED',
      );

      expect(
        scenarioReportRepository.getAllScenarioReportsAndCount,
      ).toHaveBeenCalledWith(scenarioId, ['COMPLETED', 'CANCELLED'], undefined);
      expect(result).toEqual({
        data: [
          {
            ...mockReport,
            scenarioTitle: 'Test Scenario',
            language: { id: 1, value: 'en', label: 'English' },
          },
        ],
        count: 1,
      });
    });

    it('should not filter by status when statuses not provided', async () => {
      const reports = [mockReport as ScenarioReport];
      scenarioReportRepository.getAllScenarioReportsAndCount.mockResolvedValue([
        reports,
        1,
      ]);

      await service.getScenarioReports(scenarioId);

      expect(
        scenarioReportRepository.getAllScenarioReportsAndCount,
      ).toHaveBeenCalledWith(scenarioId, [], undefined);
    });
  });

  describe('cancelScenarioReport', () => {
    it('should throw ForbiddenException when user is not report creator', async () => {
      scenarioReportRepository.findOne.mockResolvedValue({
        ...mockReport,
        createdBy: 999,
      } as ScenarioReport);

      await expect(
        service.cancelScenarioReport(reportId, userId),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.cancelScenarioReport(reportId, userId),
      ).rejects.toThrow('You are not allowed to cancel this scenario report');
    });

    it('should throw BadRequestException when report is already in end status', async () => {
      for (const status of SCENARIO_REPORT_END_STATUSES) {
        scenarioReportRepository.findOne.mockResolvedValue({
          ...mockReport,
          status,
        } as ScenarioReport);

        await expect(
          service.cancelScenarioReport(reportId, userId),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.cancelScenarioReport(reportId, userId),
        ).rejects.toThrow(
          'Cannot cancel a scenario report that is already completed, cancelled, or failed',
        );
      }
    });

    it('should update to CANCELLED, delete Redis key, and notify when allowed', async () => {
      scenarioReportRepository.findOne.mockResolvedValue(
        mockReport as ScenarioReport,
      );

      const result = await service.cancelScenarioReport(reportId, userId);

      expect(result).toEqual({ success: true });
      expect(scenarioReportRepository.update).toHaveBeenCalledWith(reportId, {
        status: ScenarioReportStatus.CANCELLED,
        updatedBy: userId,
        endedAt: expect.any(Date),
      });
      expect(redisService.del).toHaveBeenCalledWith(
        `scenario-report:${reportId}`,
      );
      expect(
        scenarioReportNotificationService.notifyUpdate,
      ).toHaveBeenCalledWith(userId, reportId);
    });
  });

  describe('getFilteredScenarioReports', () => {
    it('should return data and count from findRecentReportsByCreatedBy', async () => {
      const reports = [mockReport];
      scenarioReportRepository.findRecentReportsByCreatedBy.mockResolvedValue(
        reports as ScenarioReport[],
      );

      const result = await service.getFilteredScenarioReports(userId, 60);

      expect(
        scenarioReportRepository.findRecentReportsByCreatedBy,
      ).toHaveBeenCalledWith(userId, 60);
      expect(result).toEqual({
        data: [
          {
            ...mockReport,
            scenarioTitle: 'Test Scenario',
            language: { id: 1, value: 'en', label: 'English' },
          },
        ],
        count: 1,
      });
    });

    it('should pass undefined lookbackMinutes when not provided', async () => {
      scenarioReportRepository.findRecentReportsByCreatedBy.mockResolvedValue(
        [],
      );

      await service.getFilteredScenarioReports(userId);

      expect(
        scenarioReportRepository.findRecentReportsByCreatedBy,
      ).toHaveBeenCalledWith(userId, undefined);
    });
  });

  describe('updateScenarioReport', () => {
    it('should return report without updating when report is in end status', async () => {
      for (const status of SCENARIO_REPORT_END_STATUSES) {
        scenarioReportRepository.findOne.mockResolvedValue({
          ...mockReport,
          status,
        } as ScenarioReport);

        const result = await service.updateScenarioReport(reportId, {
          metrics: { accuracy: 80 },
        });

        expect(result.status).toBe(status);
        expect(scenarioReportRepository.update).not.toHaveBeenCalled();
      }
    });

    it('should delete Redis key when updating to end status', async () => {
      scenarioReportRepository.findOne
        .mockResolvedValueOnce(mockReport as ScenarioReport)
        .mockResolvedValueOnce({
          ...mockReport,
          status: ScenarioReportStatus.COMPLETED,
        } as ScenarioReport);

      await service.updateScenarioReport(reportId, {
        status: ScenarioReportStatus.COMPLETED,
      });

      expect(redisService.del).toHaveBeenCalledWith(
        `scenario-report:${reportId}`,
      );
    });

    it('should update only provided fields and set endedAt when status is end status', async () => {
      const metrics = { accuracy: 85 };
      scenarioReportRepository.findOne
        .mockResolvedValueOnce(mockReport as ScenarioReport)
        .mockResolvedValueOnce({
          ...mockReport,
          metrics,
          status: ScenarioReportStatus.COMPLETED,
        } as ScenarioReport);

      await service.updateScenarioReport(reportId, {
        metrics,
        status: ScenarioReportStatus.COMPLETED,
      });

      expect(scenarioReportRepository.update).toHaveBeenCalledWith(
        reportId,
        expect.objectContaining({
          metrics,
          status: ScenarioReportStatus.COMPLETED,
          endedAt: expect.any(Date),
        }),
      );
      expect(
        scenarioReportNotificationService.notifyUpdate,
      ).toHaveBeenCalledWith(userId, reportId);
    });

    it('should call addTranscripts when transcripts are provided', async () => {
      const transcripts = [{ content: 'Hi', start_time: 0, role: 'user' }];
      scenarioReportRepository.findOne
        .mockResolvedValueOnce(mockReport as ScenarioReport)
        .mockResolvedValueOnce(mockReport as ScenarioReport);

      await service.updateScenarioReport(reportId, { transcripts });

      expect(
        scenarioReportTranscriptService.addTranscripts,
      ).toHaveBeenCalledWith(reportId, transcripts);
    });
  });

  describe('getScenarioReportTranscripts', () => {
    it('should throw BadRequestException when report is not COMPLETED', async () => {
      scenarioReportRepository.findOne.mockResolvedValue({
        ...mockReport,
        status: ScenarioReportStatus.IN_PROGRESS,
      } as ScenarioReport);

      await expect(
        service.getScenarioReportTranscripts(reportId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getScenarioReportTranscripts(reportId),
      ).rejects.toThrow(
        'Cannot get transcripts for a scenario report that is not completed',
      );
      expect(
        scenarioReportTranscriptService.getScenarioReportTranscripts,
      ).not.toHaveBeenCalled();
    });

    it('should return transcript service result when report is COMPLETED', async () => {
      const transcriptResult = { messages: [], count: 0 };
      scenarioReportRepository.findOne.mockResolvedValue({
        ...mockReport,
        status: ScenarioReportStatus.COMPLETED,
      } as ScenarioReport);
      scenarioReportTranscriptService.getScenarioReportTranscripts.mockResolvedValue(
        transcriptResult,
      );

      const result = await service.getScenarioReportTranscripts(reportId);

      expect(scenarioReportRepository.findOne).toHaveBeenCalledWith({
        where: { id: reportId },
      });
      expect(
        scenarioReportTranscriptService.getScenarioReportTranscripts,
      ).toHaveBeenCalledWith(reportId, undefined);
      expect(result).toEqual(transcriptResult);
    });
  });

  describe('createScenarioReport', () => {
    it('should throw BadRequestException when language ID is invalid', async () => {
      scenarioReportRepository.find.mockResolvedValue([]);
      sharedLanguageService.getLanguagesByIds.mockResolvedValue([]);

      await expect(
        service.createScenarioReport(
          scenarioId,
          { languageId: 999, turns: 5, helperAgentPrompt: 'p' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createScenarioReport(
          scenarioId,
          { languageId: 999, turns: 5, helperAgentPrompt: 'p' },
          userId,
        ),
      ).rejects.toThrow('Invalid language ID');
    });

    it('should throw when in-progress report exists for scenario', async () => {
      scenarioReportRepository.find.mockResolvedValue([
        {
          id: 'r1',
          status: ScenarioReportStatus.IN_PROGRESS,
        } as ScenarioReport,
      ]);

      await expect(
        service.createScenarioReport(
          scenarioId,
          { languageId: 1, turns: 5, helperAgentPrompt: 'p' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create report, notify, and trigger generation with correct config', async () => {
      scenarioReportRepository.find.mockResolvedValue([]);
      scenarioReportRepository.create.mockReturnValue(
        mockReport as ScenarioReport,
      );
      scenarioReportRepository.save.mockResolvedValue({
        ...mockReport,
        id: reportId,
        status: ScenarioReportStatus.STARTED,
        config: { languageId: 1, turns: 5, helperAgentPrompt: 'helper prompt' },
      } as ScenarioReport);
      scenarioReportRepository.findOne.mockResolvedValue({
        ...mockReport,
        status: ScenarioReportStatus.STARTED,
      } as ScenarioReport);

      const result = await service.createScenarioReport(
        scenarioId,
        { languageId: 1, turns: 5, helperAgentPrompt: 'helper prompt' },
        userId,
      );

      // Allow fire-and-forget triggerScenarioReportGeneration to complete
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(result).toEqual({
        id: reportId,
        status: ScenarioReportStatus.STARTED,
      });
      expect(scenarioReportRepository.create).toHaveBeenCalledWith({
        scenarioId,
        config: { languageId: 1, turns: 5, helperAgentPrompt: 'helper prompt' },
        createdBy: userId,
        updatedBy: userId,
      });
      expect(
        scenarioReportNotificationService.notifyUpdate,
      ).toHaveBeenCalledWith(userId, reportId);
      expect(
        scenarioSharedService.createMetadataForScenario,
      ).toHaveBeenCalledWith(scenarioId, 1);
      expect(aiService.triggerScenarioReportGenerate).toHaveBeenCalledWith({
        prompt: 'helper prompt',
        turns: 5,
        language: 'en',
        scenario_id: scenarioId,
        report_id: reportId,
        metadata: { events: [], scenario: {} },
      });
      expect(redisService.set).toHaveBeenCalledWith(
        `scenario-report:${reportId}`,
        reportId,
        SCENARIO_REPORT_TTL_SECONDS,
      );
    });

    it('should throw ForbiddenException when multi-tenant admin tries to generate report for someone else scenario', async () => {
      permissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      scenarioSharedService.getAdminScenario.mockResolvedValue({
        id: scenarioId,
        createdBy: 999,
      } as any);

      await expect(
        service.createScenarioReport(
          scenarioId,
          { languageId: 1, turns: 5, helperAgentPrompt: 'p' },
          userId,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(permissionsService.isMultiTenantAdmin).toHaveBeenCalledWith(
        userId,
      );
    });
  });

  describe('handleExpiredReport', () => {
    it('should do nothing when report not found', async () => {
      scenarioReportRepository.findOne.mockResolvedValue(null);

      await service.handleExpiredReportGeneration(reportId);

      expect(scenarioReportRepository.update).not.toHaveBeenCalled();
    });

    it('should do nothing when report already in end status', async () => {
      for (const status of SCENARIO_REPORT_END_STATUSES) {
        scenarioReportRepository.findOne.mockResolvedValue({
          ...mockReport,
          status,
        } as ScenarioReport);

        await service.handleExpiredReportGeneration(reportId);

        expect(scenarioReportRepository.update).not.toHaveBeenCalled();
      }
    });

    it('should mark report as FAILED when still pending and older than 30 min', async () => {
      const oldReport = {
        ...mockReport,
        status: ScenarioReportStatus.STARTED,
        createdAt: new Date(Date.now() - 31 * TIME.MINUTE_IN_MS),
      } as ScenarioReport;
      scenarioReportRepository.findOne.mockResolvedValue(oldReport);

      await service.handleExpiredReportGeneration(reportId);

      expect(scenarioReportRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: reportId }),
        expect.objectContaining({
          status: ScenarioReportStatus.FAILED,
          metadata: { error: 'Failed due to timeout' },
          endedAt: expect.any(Date),
        }),
      );
      expect(
        scenarioReportNotificationService.notifyUpdate,
      ).toHaveBeenCalledWith(userId, reportId);
    });
  });

  describe('markStaleReportsAsFailed', () => {
    it('should mark stale pending reports as FAILED', async () => {
      const staleReport = {
        ...mockReport,
        status: ScenarioReportStatus.STARTED,
        createdAt: new Date(Date.now() - 31 * TIME.MINUTE_IN_MS),
      } as ScenarioReport;
      scenarioReportRepository.find.mockResolvedValue([
        staleReport,
      ] as ScenarioReport[]);

      await service.markStaleReportsAsFailed();

      expect(scenarioReportRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: expect.anything(),
            createdAt: expect.anything(),
          }),
        }),
      );
      expect(scenarioReportRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.anything(),
          status: expect.anything(),
        }),
        expect.objectContaining({
          status: ScenarioReportStatus.FAILED,
          metadata: { error: 'Failed due to timeout' },
          endedAt: expect.any(Date),
        }),
      );
    });
  });
});
