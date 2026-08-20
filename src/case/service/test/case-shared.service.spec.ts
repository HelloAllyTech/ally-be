import { CohortVisibilityService } from 'src/cohort/service/cohort-visibility.service';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CaseSharedService } from '../case-shared.service';
import { CaseRepository } from '../../repository/case.repository';
import { CaseTenantRepository } from '../../repository/case-tenant.repository';
import { CaseItemRepository } from '../../repository/case-item.repository';
import { CaseSessionItemRepository } from '../../repository/case-session-item.repository';
import { CaseSessionRepository } from '../../repository/case-session.repository';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { CaseTenantService } from '../case-tenant.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SessionItemStatus } from 'src/common/type/common.type';
import { CaseStatus } from '../../type/cases.type';
import { Case } from '../../entity/case.entity';
import { CaseItem } from '../../entity/case-item.entity';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
    getTenantId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

describe('CaseSharedService', () => {
  let service: CaseSharedService;
  let caseRepository: jest.Mocked<CaseRepository>;
  let caseItemRepository: jest.Mocked<CaseItemRepository>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let caseSessionItemRepository: jest.Mocked<CaseSessionItemRepository>;
  let caseSessionRepository: jest.Mocked<CaseSessionRepository>;
  let caseTenantService: jest.Mocked<CaseTenantService>;

  const mockCase = {
    id: '10000000-0000-0000-0000-000000000001',
    title: 'Test Case',
    description: 'Test description',
    coverImageUrl: 'https://example.com/image.jpg',
    status: CaseStatus.ACTIVE,
    isGlobal: false,
    totalScenarios: 2,
  } as Case;

  const mockCaseItems: CaseItem[] = [
    {
      id: '20000000-0000-0000-0000-000000000001',
      caseId: '10000000-0000-0000-0000-000000000001',
      scenarioId: 1,
      order: 1,
      messageTitle: 'Message 1',
      messageContent: 'Content 1',
      minimumScore: 50,
    } as CaseItem,
    {
      id: '20000000-0000-0000-0000-000000000002',
      caseId: '10000000-0000-0000-0000-000000000001',
      scenarioId: 2,
      order: 2,
      messageTitle: 'Message 2',
      messageContent: 'Content 2',
      minimumScore: 60,
    } as CaseItem,
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaseSharedService,
        {
          provide: CaseRepository,
          useValue: { findOne: jest.fn(), getAllCasesWithSession: jest.fn() },
        },
        { provide: CaseTenantRepository, useValue: { findOne: jest.fn() } },
        {
          provide: CaseItemRepository,
          useValue: { find: jest.fn(), findOne: jest.fn() },
        },
        {
          provide: ScenarioSharedService,
          useValue: {
            getScenarioWithTriggerWarningsByIds: jest.fn(),
            getScenarioSessionById: jest.fn(),
            getScenarioById: jest.fn(),
            getPreviousScenarioSessionByCaseSessionItemId: jest.fn(),
            getScenarioSessionDetailsByScenarioSessionId: jest.fn(),
            getSessionGlimpseByScenarioSessionId: jest.fn(),
          },
        },
        {
          provide: CaseTenantService,
          useValue: { getCaseTenant: jest.fn() },
        },
        {
          provide: CaseSessionItemRepository,
          useValue: { findOne: jest.fn() },
        },
        { provide: CaseSessionRepository, useValue: { findOne: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        {
          // Defaults to allowing access so the existing expectations — written
          // before cohorts existed — keep asserting the tenant-assignment
          // behaviour they were about. The cohort layer has its own coverage.
          provide: CohortVisibilityService,
          useValue: { canAccess: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    service = module.get<CaseSharedService>(CaseSharedService);
    caseRepository = module.get(CaseRepository);
    caseItemRepository = module.get(CaseItemRepository);
    scenarioSharedService = module.get(ScenarioSharedService);
    caseSessionItemRepository = module.get(CaseSessionItemRepository);
    caseSessionRepository = module.get(CaseSessionRepository);
    caseTenantService = module.get(CaseTenantService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCasesWithSession', () => {
    it('should return cases with session data', async () => {
      const mockResult = { data: [], count: 0 };
      caseRepository.getAllCasesWithSession.mockResolvedValue(
        mockResult as any,
      );

      const result = await service.getCasesWithSession({
        userId: 123,
        tenantId: '40000000-0000-0000-0000-000000000001',
        status: CaseStatus.ACTIVE,
      });

      expect(result).toEqual(mockResult);
    });
  });

  describe('getCaseWithScenarios', () => {
    it('should return case with scenarios', async () => {
      caseRepository.findOne.mockResolvedValue(mockCase);
      caseItemRepository.find.mockResolvedValue(mockCaseItems);
      scenarioSharedService.getScenarioWithTriggerWarningsByIds.mockResolvedValue(
        [
          {
            id: 1,
            title: 'Scenario 1',
            description: 'Desc 1',
            coverImageUrl: 'img1',
            coverVideoUrl: 'vid1',
            triggerWarnings: [],
          },
          {
            id: 2,
            title: 'Scenario 2',
            description: 'Desc 2',
            coverImageUrl: 'img2',
            coverVideoUrl: 'vid2',
            triggerWarnings: [],
          },
        ] as any,
      );

      const result = await service.getCaseWithScenarios(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(result.id).toBe('10000000-0000-0000-0000-000000000001');
      expect(result.scenarios).toHaveLength(2);
    });

    it('should return translated title and description when languageCode is provided', async () => {
      caseRepository.findOne.mockResolvedValue({
        ...mockCase,
        translations: {
          mr: { title: 'Marathi Title', description: 'Marathi Desc' },
        },
      } as any);
      caseItemRepository.find.mockResolvedValue([]);
      scenarioSharedService.getScenarioWithTriggerWarningsByIds.mockResolvedValue(
        [],
      );

      const result = await service.getCaseWithScenarios(
        '10000000-0000-0000-0000-000000000001',
        undefined,
        'mr',
      );

      expect(result.title).toBe('Marathi Title');
      expect(result.description).toBe('Marathi Desc');
    });

    it('should return translated title and description for scenarios when languageCode is provided', async () => {
      caseRepository.findOne.mockResolvedValue(mockCase);
      caseItemRepository.find.mockResolvedValue([mockCaseItems[0]]);
      scenarioSharedService.getScenarioWithTriggerWarningsByIds.mockResolvedValue(
        [
          {
            id: 1,
            title: 'Scenario 1',
            description: 'Desc 1',
            translations: {
              mr: { title: 'मराठी शीर्षक', description: 'मराठी वर्णन' },
            },
          },
        ] as any,
      );

      const result = await service.getCaseWithScenarios(
        '10000000-0000-0000-0000-000000000001',
        undefined,
        'mr',
      );

      expect(result.scenarios[0].title).toBe('मराठी शीर्षक');
      expect(result.scenarios[0].description).toBe('मराठी वर्णन');
    });

    it('should fallback to default scenario title and description when translations are missing', async () => {
      caseRepository.findOne.mockResolvedValue(mockCase);
      caseItemRepository.find.mockResolvedValue([mockCaseItems[0]]);
      scenarioSharedService.getScenarioWithTriggerWarningsByIds.mockResolvedValue(
        [
          {
            id: 1,
            title: 'Scenario 1',
            description: 'Desc 1',
            translations: {
              mr: { title: 'मराठी शीर्षक' }, // Missing description
            },
          },
        ] as any,
      );

      const result = await service.getCaseWithScenarios(
        '10000000-0000-0000-0000-000000000001',
        undefined,
        'mr',
      );

      expect(result.scenarios[0].title).toBe('मराठी शीर्षक');
      expect(result.scenarios[0].description).toBe('Desc 1'); // Fallback
    });

    it('should throw NotFoundException when case is not found', async () => {
      caseRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getCaseWithScenarios('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when organization access is denied', async () => {
      caseRepository.findOne.mockResolvedValue(mockCase);
      caseTenantService.getCaseTenant.mockResolvedValue(null);

      await expect(
        service.getCaseWithScenarios(
          '10000000-0000-0000-0000-000000000001',
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getActiveCaseById', () => {
    it('should return active case', async () => {
      caseRepository.findOne.mockResolvedValue(mockCase);

      const result = await service.getActiveCaseById(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(result).toEqual(mockCase);
    });
  });

  describe('getCaseItems', () => {
    it('should return case items', async () => {
      caseItemRepository.find.mockResolvedValue(mockCaseItems);

      const result = await service.getCaseItems(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(result).toEqual(mockCaseItems);
    });
  });

  describe('getCaseItemById', () => {
    it('should return case item by id', async () => {
      caseItemRepository.findOne.mockResolvedValue(mockCaseItems[0]);

      const result = await service.getCaseItemById(
        '20000000-0000-0000-0000-000000000001',
      );

      expect(result).toEqual(mockCaseItems[0]);
    });
  });

  describe('getNextCaseItemByCurrentItemId', () => {
    it('should return next case item', async () => {
      caseItemRepository.findOne
        .mockResolvedValueOnce(mockCaseItems[0])
        .mockResolvedValueOnce(mockCaseItems[1]);

      const result = await service.getNextCaseItemByCurrentItemId(
        '20000000-0000-0000-0000-000000000001',
      );

      expect(result).toEqual(mockCaseItems[1]);
    });
  });

  describe('getPreviousCaseItemByCurrentItemId', () => {
    it('should return previous case item', async () => {
      caseItemRepository.findOne
        .mockResolvedValueOnce(mockCaseItems[1])
        .mockResolvedValueOnce(mockCaseItems[0]);

      const result = await service.getPreviousCaseItemByCurrentItemId(
        '20000000-0000-0000-0000-000000000002',
      );

      expect(result).toEqual(mockCaseItems[0]);
    });
  });

  describe('getPermittedCaseSessionItemBySessionItemId', () => {
    it('should return case session item for authenticated user', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      const mockSessionItem = {
        id: '80000000-0000-0000-0000-000000000001',
        userId: 123,
        status: SessionItemStatus.UNLOCKED,
      };
      caseSessionItemRepository.findOne.mockResolvedValue(
        mockSessionItem as any,
      );

      const result = await service.getPermittedCaseSessionItemBySessionItemId(
        '80000000-0000-0000-0000-000000000001',
      );

      expect(result).toEqual(mockSessionItem);
    });
  });

  describe('getCaseSessionById', () => {
    it('should return case session for authenticated user', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      caseSessionRepository.findOne.mockResolvedValue({
        id: '30000000-0000-0000-0000-000000000001',
      } as any);

      const result = await service.getCaseSessionById(
        '30000000-0000-0000-0000-000000000001',
      );

      expect(result).toBeDefined();
    });
  });

  describe('getPreviousCaseMemory', () => {
    it('should return cumulative memory from previous session', async () => {
      caseSessionItemRepository.findOne
        .mockResolvedValueOnce({
          id: '80000000-0000-0000-0000-000000000001',
          caseItemId: '20000000-0000-0000-0000-000000000002',
          caseSessionId: '30000000-0000-0000-0000-000000000001',
          userId: 123,
        } as any)
        .mockResolvedValueOnce({
          id: '80000000-0000-0000-0000-000000000002',
          caseSessionId: '30000000-0000-0000-0000-000000000001',
          caseItemId: '20000000-0000-0000-0000-000000000001',
          userId: 123,
        } as any);

      caseItemRepository.findOne
        .mockResolvedValueOnce(mockCaseItems[1])
        .mockResolvedValueOnce(mockCaseItems[0]);

      scenarioSharedService.getPreviousScenarioSessionByCaseSessionItemId.mockResolvedValue(
        { id: '90000000-0000-0000-0000-000000000001' } as any,
      );
      scenarioSharedService.getScenarioSessionDetailsByScenarioSessionId.mockResolvedValue(
        {
          summary: {
            feedback: {
              cumulativeMemory: 'Previous session memory content',
            },
          },
        } as any,
      );

      const result = await service.getPreviousCaseMemory(
        '80000000-0000-0000-0000-000000000001',
      );

      expect(result).toBe('Previous session memory content');
    });
  });
});
