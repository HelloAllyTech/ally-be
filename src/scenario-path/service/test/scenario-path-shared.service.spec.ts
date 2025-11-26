import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ScenarioPathSharedService } from '../scenario-path-shared.service';
import { ScenarioPathRepository } from '../../repository/scenario-path.repository';
import { ScenarioPathItemRepository } from '../../repository/scenario-path-item.repository';

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

describe('ScenarioPathSharedService', () => {
  let service: ScenarioPathSharedService;
  let scenarioPathRepository: jest.Mocked<ScenarioPathRepository>;
  let scenarioPathItemRepository: jest.Mocked<ScenarioPathItemRepository>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let scenarioPathTenantService: jest.Mocked<ScenarioPathTenantService>;

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
  };

  const mockScenarioPathTenantService = {
    getScenarioPathTenant: jest.fn(),
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
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
        {
          provide: ScenarioPathTenantService,
          useValue: mockScenarioPathTenantService,
        },
      ],
    }).compile();

    service = module.get<ScenarioPathSharedService>(ScenarioPathSharedService);
    scenarioPathRepository = module.get(ScenarioPathRepository);
    scenarioPathItemRepository = module.get(ScenarioPathItemRepository);
    scenarioSharedService = module.get(ScenarioSharedService);
    scenarioPathTenantService = module.get(ScenarioPathTenantService);

    jest.clearAllMocks();
  });

  describe('getScenarioPathsWithSession', () => {
    it('should return scenario paths with sessions', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
        tenantId: 'tenant',
        limit: 10,
        offset: 0,
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

    it('should return empty array when no scenario paths found', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
        tenantId: 'tenant',
      };

      const emptyResult: ScenarioPathsWithSession = {
        data: [],
        count: 0,
      };

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

    it('should return scenario path with scenarios when tenantId is provided and access is granted', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(mockScenarioPath);
      scenarioPathTenantService.getScenarioPathTenant.mockResolvedValue({
        id: 'mock-id',
        scenarioPathId: 'path-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      } as any);
      scenarioPathItemRepository.find.mockResolvedValue(mockScenarioPathItems);
      scenarioSharedService.getScenarioByIds.mockResolvedValue(mockScenarios);

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
      // FIXED: Service calls without filter
      expect(scenarioSharedService.getScenarioByIds).toHaveBeenCalledWith([
        1, 2,
      ]);
    });

    it('should return scenario path with scenarios when tenantId is not provided', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(mockScenarioPath);
      scenarioPathItemRepository.find.mockResolvedValue(mockScenarioPathItems);
      scenarioSharedService.getScenarioByIds.mockResolvedValue(mockScenarios);

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

      expect(scenarioSharedService.getScenarioByIds).toHaveBeenCalledWith([
        1, 2,
      ]);
    });

    it('should throw NotFoundException when scenario path not found', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getScenarioPathWithScenarios('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
      expect(scenarioPathItemRepository.find).not.toHaveBeenCalled();
      expect(
        scenarioPathTenantService.getScenarioPathTenant,
      ).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when tenant does not have access', async () => {
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
  });

  describe('getScenarioPathItems', () => {
    it('should return scenario path items sorted by order', async () => {
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
});
