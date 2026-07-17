import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CaseSessionService } from '../case-session.service';
import { CaseSharedService } from '../case-shared.service';
import { CaseSessionRepository } from '../../repository/case-session.repository';
import { CaseSessionItemRepository } from '../../repository/case-session-item.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SessionItemStatus } from 'src/common/type/common.type';
import { CaseStatus } from '../../type/cases.type';
import { AppConfigService } from 'src/config/config.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
  },
}));

describe('CaseSessionService', () => {
  let service: CaseSessionService;
  let caseSessionRepository: jest.Mocked<CaseSessionRepository>;
  let caseSharedService: jest.Mocked<CaseSharedService>;
  let caseSessionItemRepository: jest.Mocked<CaseSessionItemRepository>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    const mockCaseSessionRepo = {
      findOne: jest.fn(),
    };

    const mockCaseSharedService = {
      getCasesWithSession: jest.fn(),
      getActiveCaseById: jest.fn(),
      getCaseWithScenarios: jest.fn(),
      getCaseItems: jest.fn(),
      getScenarioSessionById: jest.fn(),
      getCaseItemById: jest.fn(),
      getScenarioDataById: jest.fn(),
      getNextScenarioDataByCaseItemId: jest.fn(),
      getNextCaseItemByCurrentItemId: jest.fn(),
      getSessionGlimpseByScenarioSessionId: jest.fn(),
    };

    const mockCaseSessionItemRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    const mockDataSource = {
      transaction: jest.fn(),
    };

    const mockConfigService = {
      cases: {
        caseItemMinDurationForCompletion: 30,
      },
    };

    const mockSharedLanguageService = {
      getLanguagesByIds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaseSessionService,
        { provide: CaseSessionRepository, useValue: mockCaseSessionRepo },
        { provide: CaseSharedService, useValue: mockCaseSharedService },
        {
          provide: CaseSessionItemRepository,
          useValue: mockCaseSessionItemRepo,
        },
        { provide: DataSource, useValue: mockDataSource },
        { provide: AppConfigService, useValue: mockConfigService },
        { provide: SharedLanguageService, useValue: mockSharedLanguageService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<CaseSessionService>(CaseSessionService);
    caseSessionRepository = module.get(CaseSessionRepository);
    caseSharedService = module.get(CaseSharedService);
    caseSessionItemRepository = module.get(CaseSessionItemRepository);
    dataSource = module.get(DataSource);

    jest.clearAllMocks();
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(
      '40000000-0000-0000-0000-000000000001',
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserCases', () => {
    it('should return formatted user cases', async () => {
      caseSharedService.getCasesWithSession.mockResolvedValue({
        data: [
          {
            id: '10000000-0000-0000-0000-000000000001',
            title: 'Test Case',
            description: 'Desc',
            coverImageUrl: 'img.jpg',
            totalScenarios: 2,
            session: { completedScenarios: 1 },
          },
        ] as any,
        count: 1,
      });

      const result = await service.getUserCases();

      expect(result.count).toBe(1);
      expect(result.data[0].title).toBe('Test Case');
      expect(result.data[0].completedScenarios).toBe(1);
    });

    it('should return translated title and description when languageCode is present', async () => {
      caseSharedService.getCasesWithSession.mockResolvedValue({
        data: [
          {
            id: '1',
            title: 'English Title',
            description: 'English Desc',
            translations: {
              mr: { title: 'Marathi Title', description: 'Marathi Desc' },
            },
            session: { completedScenarios: 1 },
          },
        ] as any,
        count: 1,
      });

      const result = await service.getUserCases({ languageCode: 'mr' });

      expect(result.data[0].title).toBe('Marathi Title');
      expect(result.data[0].description).toBe('Marathi Desc');
    });
  });

  describe('getUserCaseItems', () => {
    it('should return case items with session status', async () => {
      caseSharedService.getActiveCaseById.mockResolvedValue({
        id: '10000000-0000-0000-0000-000000000001',
      } as any);
      caseSharedService.getCaseWithScenarios.mockResolvedValue({
        id: '10000000-0000-0000-0000-000000000001',
        title: 'Test Case',
        description: 'Test',
        coverImageUrl: 'img.jpg',
        status: CaseStatus.ACTIVE,
        isGlobal: false,
        totalScenarios: 2,
        scenarios: [
          {
            id: '20000000-0000-0000-0000-000000000001',
            scenarioId: 1,
            order: 1,
          },
          {
            id: '20000000-0000-0000-0000-000000000002',
            scenarioId: 2,
            order: 2,
          },
        ],
      } as any);
      caseSessionRepository.findOne.mockResolvedValue({
        id: '30000000-0000-0000-0000-000000000001',
        completedScenarios: 1,
        completedAt: null,
      } as any);
      caseSessionItemRepository.find.mockResolvedValue([
        {
          id: '60000000-0000-0000-0000-000000000001',
          caseItemId: '20000000-0000-0000-0000-000000000001',
          status: SessionItemStatus.COMPLETED,
        },
        {
          id: '60000000-0000-0000-0000-000000000002',
          caseItemId: '20000000-0000-0000-0000-000000000002',
          status: SessionItemStatus.UNLOCKED,
        },
      ] as any);

      const result = await service.getUserCaseItems(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(result.caseSessionId).toBe('30000000-0000-0000-0000-000000000001');
      expect(result.completedScenarios).toBe(1);
      expect(result.scenarios).toHaveLength(2);
    });

    it('should pass languageCode to getCaseWithScenarios in getUserCaseItems', async () => {
      caseSharedService.getActiveCaseById.mockResolvedValue({ id: '1' } as any);
      caseSharedService.getCaseWithScenarios.mockResolvedValue({
        id: '1',
        scenarios: [],
      } as any);

      await service.getUserCaseItems('1', 'mr');

      expect(caseSharedService.getCaseWithScenarios).toHaveBeenCalledWith(
        '1',
        expect.any(String),
        'mr',
      );
    });
  });

  describe('createUserCaseSession', () => {
    it('should create case session with transaction', async () => {
      caseSessionRepository.findOne.mockResolvedValue(null);

      dataSource.transaction.mockImplementation(async (cb: any) => {
        return cb({
          getRepository: jest.fn().mockReturnValue({
            create: jest.fn().mockReturnValue({}),
            save: jest.fn().mockResolvedValue({
              id: 'b0000000-0000-0000-0000-000000000001',
            }),
          }),
        });
      });

      caseSharedService.getCaseItems.mockResolvedValue([
        { id: '20000000-0000-0000-0000-000000000001', order: 1 },
      ] as any);

      await service.createUserCaseSession(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('getUserCaseSessionByCaseId', () => {
    it('should return user case session', async () => {
      const mockSession = {
        id: '30000000-0000-0000-0000-000000000001',
        caseId: '10000000-0000-0000-0000-000000000001',
        userId: 123,
      };
      caseSessionRepository.findOne.mockResolvedValue(mockSession as any);

      const result = await service.getUserCaseSessionByCaseId(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(result).toEqual(mockSession);
    });
  });

  describe('getCaseSessionByCaseId', () => {
    it('should return case session by case id', async () => {
      const mockSession = {
        id: '30000000-0000-0000-0000-000000000001',
        caseId: '10000000-0000-0000-0000-000000000001',
      };
      caseSessionRepository.findOne.mockResolvedValue(mockSession as any);

      const result = await service.getCaseSessionByCaseId(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(result).toEqual(mockSession);
    });
  });

  describe('handleEndCaseSession', () => {
    it('should process end case session when valid', async () => {
      caseSessionItemRepository.findOne.mockResolvedValue({
        id: '60000000-0000-0000-0000-000000000001',
        status: SessionItemStatus.UNLOCKED,
        caseItemId: '20000000-0000-0000-0000-000000000001',
        caseSessionId: '30000000-0000-0000-0000-000000000001',
      } as any);
      caseSharedService.getCaseItemById.mockResolvedValue({
        id: '20000000-0000-0000-0000-000000000001',
        minimumScore: 50,
      } as any);
      caseSessionRepository.findOne.mockResolvedValue({
        id: '30000000-0000-0000-0000-000000000001',
        completedScenarios: 0,
      } as any);

      dataSource.transaction.mockImplementation(async (cb: any) => {
        return cb({
          getRepository: jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue(undefined),
            create: jest.fn().mockReturnValue({}),
            save: jest.fn().mockResolvedValue({}),
          }),
        });
      });

      caseSharedService.getNextCaseItemByCurrentItemId.mockResolvedValue(null);

      await service.handleEndCaseSession({
        caseSessionItemId: '60000000-0000-0000-0000-000000000001',
        score: 80,
        callDuration: 60000,
      });

      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('getNextCaseItem', () => {
    it('should return null when scenario session has no caseSessionItemId', async () => {
      caseSharedService.getScenarioSessionById.mockResolvedValue({
        id: '70000000-0000-0000-0000-000000000001',
        caseSessionItemId: null,
      } as any);

      const result = await service.getNextCaseItem(
        '70000000-0000-0000-0000-000000000001',
      );

      expect(result).toBeNull();
    });
  });
});
