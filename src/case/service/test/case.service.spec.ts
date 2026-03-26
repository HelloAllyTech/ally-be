import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CaseService } from '../case.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { TenantService } from 'src/tenant/service/tenant.service';
import { CaseRepository } from '../../repository/case.repository';
import { CaseSharedService } from '../case-shared.service';
import { CaseSessionService } from '../case-session.service';
import { CaseItemRepository } from '../../repository/case-item.repository';
import { CaseStatus, CaseTranslations } from '../../type/cases.type';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';

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

describe('CaseService', () => {
  let service: CaseService;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let caseRepository: jest.Mocked<CaseRepository>;
  let caseSharedService: jest.Mocked<CaseSharedService>;
  let caseSessionService: jest.Mocked<CaseSessionService>;
  let caseItemRepository: jest.Mocked<CaseItemRepository>;
  let dataSource: jest.Mocked<DataSource>;
  let openaiTranslationsService: jest.Mocked<OpenAITranslationsService>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;

  const mockCase = {
    id: '10000000-0000-0000-0000-000000000001',
    title: 'Test Case',
    description: 'Test description',
    coverImageUrl: 'https://example.com/image.jpg',
    status: CaseStatus.ACTIVE,
    isGlobal: false,
    totalScenarios: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaseService,
        {
          provide: ScenarioSharedService,
          useValue: {
            getScenarioByIds: jest.fn(),
            getUniqueLanguagesFromScenarioTranslations: jest.fn(),
          },
        },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        {
          provide: TenantService,
          useValue: { findById: jest.fn(), findAll: jest.fn() },
        },
        {
          provide: CaseRepository,
          useValue: { findOne: jest.fn(), getAllCases: jest.fn() },
        },
        {
          provide: CaseSharedService,
          useValue: { getCaseWithScenarios: jest.fn() },
        },
        {
          provide: CaseSessionService,
          useValue: { getCaseSessionByCaseId: jest.fn() },
        },
        { provide: CaseItemRepository, useValue: { find: jest.fn() } },
        {
          provide: OpenAITranslationsService,
          useValue: { translateObjectToLanguages: jest.fn() },
        },
        {
          provide: SharedLanguageService,
          useValue: { getValidLanguageCodes: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<CaseService>(CaseService);
    scenarioSharedService = module.get(ScenarioSharedService);
    caseRepository = module.get(CaseRepository);
    caseSharedService = module.get(CaseSharedService);
    caseSessionService = module.get(CaseSessionService);
    caseItemRepository = module.get(CaseItemRepository);
    dataSource = module.get(DataSource);
    openaiTranslationsService = module.get(OpenAITranslationsService);
    sharedLanguageService = module.get(SharedLanguageService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCases', () => {
    it('should return formatted cases', async () => {
      caseRepository.getAllCases.mockResolvedValue({
        data: [
          {
            id: '10000000-0000-0000-0000-000000000001',
            title: 'Test Case',
            description: 'Desc',
            coverImageUrl: 'img.jpg',
            status: CaseStatus.ACTIVE,
            isGlobal: false,
            totalScenarios: 2,
            updatedAt: new Date(),
            caseTenant: null,
          },
        ],
        count: 1,
      } as any);

      const result = await service.getCases();

      expect(result.count).toBe(1);
      expect(result.data[0].title).toBe('Test Case');
    });
  });

  describe('getCaseById', () => {
    it('should delegate to caseSharedService', async () => {
      caseSharedService.getCaseWithScenarios.mockResolvedValue({
        id: '10000000-0000-0000-0000-000000000001',
      } as any);

      const result = await service.getCaseById(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(result.id).toBe('10000000-0000-0000-0000-000000000001');
      expect(caseSharedService.getCaseWithScenarios).toHaveBeenCalledWith(
        '10000000-0000-0000-0000-000000000001',
      );
    });
  });

  describe('createCase', () => {
    it('should create a valid case with transaction', async () => {
      scenarioSharedService.getScenarioByIds.mockResolvedValue([
        { id: 1 },
        { id: 2 },
      ] as any);

      dataSource.transaction.mockImplementation(async (cb: any) => {
        return cb({
          getRepository: jest.fn().mockReturnValue({
            save: jest.fn().mockResolvedValue({
              id: 'a0000000-0000-0000-0000-000000000001',
              title: 'Case',
              description: 'Desc',
              coverImageUrl: 'img.jpg',
              status: CaseStatus.ACTIVE,
              isGlobal: false,
            }),
            create: jest.fn().mockImplementation((data) => data),
          }),
        });
      });

      const result = await service.createCase({
        title: 'Case',
        description: 'Desc',
        coverImageUrl: 'img.jpg',
        status: CaseStatus.ACTIVE,
        scenarios: [
          { scenarioId: 1, order: 1, minimumScore: 50 },
          { scenarioId: 2, order: 2, minimumScore: 60 },
        ],
      });

      expect(result.id).toBe('a0000000-0000-0000-0000-000000000001');
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('updateCase', () => {
    it('should throw NotFoundException when case not found', async () => {
      caseRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateCase('ffffffff-ffff-ffff-ffff-ffffffffffff', {
          title: 'Updated',
          status: CaseStatus.DRAFT,
        }),
      ).rejects.toThrow();
    });
  });

  describe('duplicateCase', () => {
    it('should duplicate case with transaction', async () => {
      caseRepository.findOne.mockResolvedValue(mockCase as any);
      caseItemRepository.find.mockResolvedValue([
        {
          id: '20000000-0000-0000-0000-000000000001',
          scenarioId: 1,
          order: 1,
        },
      ] as any);

      const savedCase = {
        ...mockCase,
        id: 'a0000000-0000-0000-0000-000000000001',
        title: `Copy of ${mockCase.title}`,
        status: CaseStatus.DRAFT,
      };
      dataSource.transaction.mockImplementation(async (cb: any) => {
        return cb({
          getRepository: jest.fn().mockReturnValue({
            save: jest.fn().mockResolvedValue(savedCase),
            create: jest.fn().mockImplementation((data) => data),
          }),
        });
      });

      const result = await service.duplicateCase(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.title).toContain('Copy of');
      expect(result.status).toBe(CaseStatus.DRAFT);
    });
  });

  describe('deleteCase', () => {
    it('should soft delete case when no active sessions', async () => {
      caseRepository.findOne.mockResolvedValue(mockCase as any);
      caseSessionService.getCaseSessionByCaseId.mockResolvedValue(null);

      dataSource.transaction.mockImplementation(async (cb: any) => {
        return cb({
          getRepository: jest.fn().mockReturnValue({
            softDelete: jest.fn().mockResolvedValue(undefined),
          }),
        });
      });

      const result = await service.deleteCase(
        '10000000-0000-0000-0000-000000000001',
      );

      expect(result).toEqual({ success: true });
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('checkIfTranslationRequired', () => {
    it('should return true if title is changed', () => {
      const oldData: CaseTranslations = { title: 'Old', description: 'Desc' };
      const newData: CaseTranslations = { title: 'New', description: 'Desc' };
      expect(
        (service as any).checkIfTranslationRequired(oldData, newData),
      ).toBe(true);
    });

    it('should return true if description is changed', () => {
      const oldData: CaseTranslations = { title: 'Title', description: 'Old' };
      const newData: CaseTranslations = { title: 'Title', description: 'New' };
      expect(
        (service as any).checkIfTranslationRequired(oldData, newData),
      ).toBe(true);
    });

    it('should return false if nothing is changed (case insensitive and trimmed)', () => {
      const oldData: CaseTranslations = {
        title: ' Title ',
        description: 'Desc',
      };
      const newData: CaseTranslations = { title: 'title', description: 'DESC' };
      expect(
        (service as any).checkIfTranslationRequired(oldData, newData),
      ).toBe(false);
    });
  });

  describe('createCaseTranslations', () => {
    it('should translate and update case repository', async () => {
      const caseId = '123';
      const caseData: CaseTranslations = {
        title: 'Title',
        description: 'Desc',
      };
      const mockResult = { mr: { title: 'Marathi' } };

      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [1],
      );
      sharedLanguageService.getValidLanguageCodes.mockResolvedValue(['mr']);
      openaiTranslationsService.translateObjectToLanguages.mockResolvedValue(
        mockResult,
      );
      caseRepository.update = jest.fn().mockResolvedValue(undefined);

      await (service as any).createCaseTranslations(caseId, caseData);

      expect(
        openaiTranslationsService.translateObjectToLanguages,
      ).toHaveBeenCalled();
      expect(caseRepository.update).toHaveBeenCalledWith(caseId, {
        translations: mockResult,
      });
    });

    it('should return early if no valid language codes found', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [],
      );
      await (service as any).createCaseTranslations('123', {});
      expect(
        openaiTranslationsService.translateObjectToLanguages,
      ).not.toHaveBeenCalled();
    });
  });
});
