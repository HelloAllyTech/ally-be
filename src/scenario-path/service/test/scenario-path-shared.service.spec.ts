import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ScenarioPathSharedService } from '../scenario-path-shared.service';
import { ScenarioPathRepository } from '../../repository/scenario-path.repository';
import { ScenarioPathItemRepository } from '../../repository/scenario-path-item.repository';
import { ScenarioPathSessionRepository } from '../../repository/scenario-path-session.repository';
import { ScenarioPathSessionItemRepository } from '../../repository/scenario-path-session-item.repository';
import {
  ScenarioPathsWithSession,
  ScenarioPathWithSessionFilterOptions,
  ScenarioPathStatus,
} from '../../type/scenario-paths.type';
import { ScenarioPath } from '../../entity/scenario-path.entity';
import { ScenarioPathSession } from '../../entity/scenario-path-session.entity';
import { ScenarioPathItem } from '../../entity/scenario-path-item.entity';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ScenarioPathTenantService } from '../scenario-path-tenant.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';

import { In } from 'typeorm';
import { SessionItemStatus } from 'src/common/type/common.type';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
    getTenantId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

describe('ScenarioPathSharedService', () => {
  let service: ScenarioPathSharedService;
  let scenarioPathRepository: jest.Mocked<ScenarioPathRepository>;
  let scenarioPathItemRepository: jest.Mocked<ScenarioPathItemRepository>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let scenarioPathTenantService: jest.Mocked<ScenarioPathTenantService>;
  let scenarioPathSessionRepository: jest.Mocked<ScenarioPathSessionRepository>;
  let scenarioPathSessionItemRepository: jest.Mocked<ScenarioPathSessionItemRepository>;

  const mockScenarioPathRepository = {
    getAllScenarioPathsWithSession: jest.fn(),
    findOne: jest.fn(),
  };

  const mockScenarioPathItemRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockScenarioSharedService = {
    getScenarioByIds: jest.fn(),
    getScenarioSessionById: jest.fn(),
    getScenarioWithTriggerWarningsByIds: jest.fn(),
  };

  const mockScenarioPathTenantService = {
    getScenarioPathTenant: jest.fn(),
  };

  const mockScenarioPathSessionRepository = {
    findOne: jest.fn(),
  };

  const mockScenarioPathSessionItemRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioPathSharedService,
        {
          provide: ScenarioPathRepository,
          useValue: mockScenarioPathRepository,
        },
        {
          provide: ScenarioPathItemRepository,
          useValue: mockScenarioPathItemRepository,
        },
        { provide: ScenarioSharedService, useValue: mockScenarioSharedService },
        {
          provide: ScenarioPathTenantService,
          useValue: mockScenarioPathTenantService,
        },
        {
          provide: ScenarioPathSessionRepository,
          useValue: mockScenarioPathSessionRepository,
        },
        {
          provide: ScenarioPathSessionItemRepository,
          useValue: mockScenarioPathSessionItemRepository,
        },
      ],
    }).compile();

    service = module.get<ScenarioPathSharedService>(ScenarioPathSharedService);
    scenarioPathRepository = module.get(ScenarioPathRepository);
    scenarioPathItemRepository = module.get(ScenarioPathItemRepository);
    scenarioSharedService = module.get(ScenarioSharedService);
    scenarioPathTenantService = module.get(ScenarioPathTenantService);
    scenarioPathSessionRepository = module.get(ScenarioPathSessionRepository);
    scenarioPathSessionItemRepository = module.get(
      ScenarioPathSessionItemRepository,
    );

    jest.clearAllMocks();
  });

  afterEach(() => {
    (ExecutionManager.getUserId as jest.Mock).mockReset();
    (ExecutionManager.getTenantId as jest.Mock).mockReset();
    (ExecutionManager.getExecutionId as jest.Mock).mockReset();
  });

  describe('getScenarioPathsWithSession', () => {
    it('returns scenario paths with sessions', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
        tenantId: 'tenant',
        limit: 10,
        offset: 0,
        status: ScenarioPathStatus.DRAFT,
      };
      const mockResult: ScenarioPathsWithSession = {
        data: [
          {
            id: 'path-1',
            title: 'Path 1',
            description: 'Description 1',
            coverImageUrl: 'https://example.com/image1.jpg',
            status: ScenarioPathStatus.ACTIVE,
            isGlobal: false,
            totalScenarios: 5,
            createdAt: new Date(),
            updatedAt: new Date(),
            session: {
              id: 'session-1',
              scenarioPathId: 'path-1',
              userId: 123,
              completedScenarios: 2,
              startedAt: new Date(),
              completedAt: undefined,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as ScenarioPathSession,
          } as ScenarioPath & { session: ScenarioPathSession },
        ],
        count: 1,
      };

      scenarioPathRepository.getAllScenarioPathsWithSession.mockResolvedValue(
        mockResult,
      );

      const result = await service.getScenarioPathsWithSession(filters);

      expect(result).toEqual(mockResult);
      expect(
        scenarioPathRepository.getAllScenarioPathsWithSession,
      ).toHaveBeenCalledWith(filters);
    });

    it('returns empty array when no scenario paths found', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
        tenantId: 'tenant',
        status: ScenarioPathStatus.DRAFT,
      };

      const emptyResult: ScenarioPathsWithSession = { data: [], count: 0 };

      scenarioPathRepository.getAllScenarioPathsWithSession.mockResolvedValue(
        emptyResult,
      );

      const result = await service.getScenarioPathsWithSession(filters);

      expect(result).toEqual(emptyResult);
      expect(
        scenarioPathRepository.getAllScenarioPathsWithSession,
      ).toHaveBeenCalledWith(filters);
    });
  });

  describe('getScenarioPathWithScenarios', () => {
    const mockScenarioPath: ScenarioPath = {
      id: 'path-1',
      title: 'Path 1',
      description: 'Description 1',
      coverImageUrl: 'https://example.com/image.jpg',
      status: ScenarioPathStatus.ACTIVE,
      isGlobal: false,
      totalScenarios: 2,
    } as ScenarioPath;

    const mockScenarioPathItems: ScenarioPathItem[] = [
      {
        id: 'item-1',
        scenarioPathId: 'path-1',
        scenarioId: 1,
        order: 1,
        messageTitle: 'Message 1',
        messageContent: 'Content 1',
        minimumScore: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ScenarioPathItem,
      {
        id: 'item-2',
        scenarioPathId: 'path-1',
        scenarioId: 2,
        order: 2,
        messageTitle: 'Message 2',
        minimumScore: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ScenarioPathItem,
    ];

    const mockScenarios = [
      {
        id: 1,
        title: 'Scenario 1',
        description: 'Description 1',
        coverImageUrl: 'https://example.com/scenario1.jpg',
        coverVideoUrl: 'https://example.com/scenario1.mp4',
        status: 'ACTIVE' as any,
        isGlobal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        title: 'Scenario 2',
        description: 'Description 2',
        coverImageUrl: 'https://example.com/scenario2.jpg',
        status: 'ACTIVE' as any,
        isGlobal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any;

    it('returns scenario path with scenarios when tenantId is provided and access is granted', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(mockScenarioPath);
      scenarioPathTenantService.getScenarioPathTenant.mockResolvedValue({
        id: 'mock-id',
        scenarioPathId: 'path-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      } as any);
      scenarioPathItemRepository.find.mockResolvedValue(mockScenarioPathItems);
      scenarioSharedService.getScenarioWithTriggerWarningsByIds.mockResolvedValue(
        mockScenarios,
      );

      const result = await service.getScenarioPathWithScenarios(
        'path-1',
        'tenant-1',
      );

      expect(result).toEqual({
        id: 'path-1',
        title: 'Path 1',
        description: 'Description 1',
        coverImageUrl: 'https://example.com/image.jpg',
        status: ScenarioPathStatus.ACTIVE,
        isGlobal: false,
        totalScenarios: 2,
        scenarios: [
          {
            id: 'item-1',
            scenarioId: 1,
            order: 1,
            messageTitle: 'Message 1',
            messageContent: 'Content 1',
            minimumScore: 80,
            title: 'Scenario 1',
            description: 'Description 1',
            coverImageUrl: 'https://example.com/scenario1.jpg',
            coverVideoUrl: 'https://example.com/scenario1.mp4',
          },
          {
            id: 'item-2',
            scenarioId: 2,
            order: 2,
            messageTitle: 'Message 2',
            messageContent: undefined,
            minimumScore: 0,
            title: 'Scenario 2',
            description: 'Description 2',
            coverImageUrl: 'https://example.com/scenario2.jpg',
            coverVideoUrl: undefined,
          },
        ],
      });

      expect(scenarioPathRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'path-1' },
      });
      expect(
        scenarioPathTenantService.getScenarioPathTenant,
      ).toHaveBeenCalledWith('tenant-1', 'path-1');
      expect(scenarioPathItemRepository.find).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1' },
      });
      expect(
        scenarioSharedService.getScenarioWithTriggerWarningsByIds,
      ).toHaveBeenCalledWith([1, 2]);
    });

    it('returns scenario path with scenarios when tenantId is not provided', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(mockScenarioPath);
      scenarioPathItemRepository.find.mockResolvedValue(mockScenarioPathItems);
      scenarioSharedService.getScenarioWithTriggerWarningsByIds.mockResolvedValue(
        mockScenarios,
      );

      const result = await service.getScenarioPathWithScenarios('path-1');

      expect(result).toEqual({
        id: 'path-1',
        title: 'Path 1',
        description: 'Description 1',
        coverImageUrl: 'https://example.com/image.jpg',
        status: ScenarioPathStatus.ACTIVE,
        isGlobal: false,
        totalScenarios: 2,
        scenarios: [
          {
            id: 'item-1',
            scenarioId: 1,
            order: 1,
            messageTitle: 'Message 1',
            messageContent: 'Content 1',
            minimumScore: 80,
            title: 'Scenario 1',
            description: 'Description 1',
            coverImageUrl: 'https://example.com/scenario1.jpg',
            coverVideoUrl: 'https://example.com/scenario1.mp4',
          },
          {
            id: 'item-2',
            scenarioId: 2,
            order: 2,
            messageTitle: 'Message 2',
            messageContent: undefined,
            minimumScore: 0,
            title: 'Scenario 2',
            description: 'Description 2',
            coverImageUrl: 'https://example.com/scenario2.jpg',
            coverVideoUrl: undefined,
          },
        ],
      });

      expect(scenarioPathRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'path-1' },
      });
      expect(
        scenarioPathTenantService.getScenarioPathTenant,
      ).not.toHaveBeenCalled();
      expect(scenarioPathItemRepository.find).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1' },
      });
      expect(
        scenarioSharedService.getScenarioWithTriggerWarningsByIds,
      ).toHaveBeenCalledWith([1, 2]);
    });

    it('throws BadRequestException when tenant does not have access', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(mockScenarioPath);
      scenarioPathTenantService.getScenarioPathTenant.mockResolvedValue(null);

      await expect(
        service.getScenarioPathWithScenarios('path-1', 'tenant-1'),
      ).rejects.toThrow(BadRequestException);
      expect(
        scenarioPathTenantService.getScenarioPathTenant,
      ).toHaveBeenCalledWith('tenant-1', 'path-1');
      expect(scenarioPathItemRepository.find).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when scenario path is not found', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getScenarioPathWithScenarios('non-existent'),
      ).rejects.toThrow(NotFoundException);

      expect(scenarioPathRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent' },
      });
    });

    it('returns translated title and description when languageCode is provided', async () => {
      const mockScenarioPathWithTranslations = {
        ...mockScenarioPath,
        translations: {
          es: {
            title: 'Título en español',
            description: 'Descripción en español',
          },
        },
      } as any;

      const mockScenariosWithTranslations = [
        {
          id: 1,
          title: 'Scenario 1',
          description: 'Description 1',
          translations: {
            es: { title: 'Escenario 1', description: 'Descripción 1' },
          },
        },
      ] as any;

      const mockItems = [mockScenarioPathItems[0]];

      scenarioPathRepository.findOne.mockResolvedValue(
        mockScenarioPathWithTranslations,
      );
      scenarioPathItemRepository.find.mockResolvedValue(mockItems);
      scenarioSharedService.getScenarioWithTriggerWarningsByIds.mockResolvedValue(
        mockScenariosWithTranslations,
      );

      const result = await service.getScenarioPathWithScenarios(
        'path-1',
        undefined,
        'es',
      );

      expect(result.title).toBe('Título en español');
      expect(result.description).toBe('Descripción en español');
      expect(result.scenarios[0].title).toBe('Escenario 1');
      expect(result.scenarios[0].description).toBe('Descripción 1');
    });

    it('falls back to default title and description when languageCode is provided but translations are missing', async () => {
      const mockScenarioPathWithTranslations = {
        ...mockScenarioPath,
        translations: {
          fr: { title: 'Titre en français' }, // missing description
        },
      } as any;

      const mockScenariosWithTranslations = [
        {
          id: 1,
          title: 'Scenario 1',
          description: 'Description 1',
          translations: {}, // empty translations
        },
      ] as any;

      const mockItems = [mockScenarioPathItems[0]];

      scenarioPathRepository.findOne.mockResolvedValue(
        mockScenarioPathWithTranslations,
      );
      scenarioPathItemRepository.find.mockResolvedValue(mockItems);
      scenarioSharedService.getScenarioWithTriggerWarningsByIds.mockResolvedValue(
        mockScenariosWithTranslations,
      );

      const result = await service.getScenarioPathWithScenarios(
        'path-1',
        undefined,
        'fr',
      );

      expect(result.title).toBe('Titre en français');
      expect(result.description).toBe('Description 1'); // Fallback
      expect(result.scenarios[0].title).toBe('Scenario 1'); // Fallback
      expect(result.scenarios[0].description).toBe('Description 1'); // Fallback
    });
  });

  describe('getScenarioPathItems', () => {
    it('returns scenario path items sorted by order', async () => {
      const mockItems: ScenarioPathItem[] = [
        { id: '1', scenarioPathId: 'path-1', order: 1 } as ScenarioPathItem,
        { id: '2', scenarioPathId: 'path-1', order: 2 } as ScenarioPathItem,
      ];
      scenarioPathItemRepository.find.mockResolvedValue(mockItems);

      const result = await service.getScenarioPathItems('path-1');

      expect(scenarioPathItemRepository.find).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1' },
        order: { order: 'ASC' },
      });
      expect(result).toEqual(mockItems);
    });
  });

  describe('getScenarioPathItemById', () => {
    it('returns scenario path item when found', async () => {
      const mockItem = {
        id: 'item-1',
        scenarioPathId: 'path-1',
      } as ScenarioPathItem;
      scenarioPathItemRepository.findOne.mockResolvedValue(mockItem);

      const result = await service.getScenarioPathItemById('item-1');

      expect(result).toEqual(mockItem);
      expect(scenarioPathItemRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'item-1' },
      });
    });

    it('returns null when scenario path item not found', async () => {
      scenarioPathItemRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioPathItemById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getScenarioPathSessionById', () => {
    it('returns scenario path session when user is authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      const mockSession = { id: 'session-1', userId: 123 } as any;
      scenarioPathSessionRepository.findOne.mockResolvedValue(mockSession);

      const result = await service.getScenarioPathSessionById('session-1');

      expect(result).toEqual(mockSession);
      expect(scenarioPathSessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'session-1', userId: 123 },
      });
    });

    it('throws UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);

      await expect(
        service.getScenarioPathSessionById('session-1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getPermittedPathSessionItemBySessionItemId', () => {
    it('returns session item when user is authenticated and item is unlocked', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      const mockItem = {
        id: 'item-1',
        userId: 123,
        status: SessionItemStatus.UNLOCKED,
      } as any;
      scenarioPathSessionItemRepository.findOne.mockResolvedValue(mockItem);

      const result =
        await service.getPermittedPathSessionItemBySessionItemId('item-1');

      expect(result).toEqual(mockItem);
      expect(scenarioPathSessionItemRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: 'item-1',
          userId: 123,
          status: In([SessionItemStatus.UNLOCKED, SessionItemStatus.COMPLETED]),
        },
      });
    });

    it('throws UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);

      await expect(
        service.getPermittedPathSessionItemBySessionItemId('item-1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getScenarioPathTenant', () => {
    it('delegates to scenarioPathTenantService', async () => {
      const mockTenant = { id: 'tenant-1' } as any;
      scenarioPathTenantService.getScenarioPathTenant.mockResolvedValue(
        mockTenant,
      );

      const result = await service.getScenarioPathTenant('tenant-1', 'path-1');

      expect(result).toEqual(mockTenant);
      expect(
        scenarioPathTenantService.getScenarioPathTenant,
      ).toHaveBeenCalledWith('tenant-1', 'path-1');
    });
  });
});
