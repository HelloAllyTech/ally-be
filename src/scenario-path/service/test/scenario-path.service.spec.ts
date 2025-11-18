import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioPathService } from '../scenario-path.service';
import { CreateScenarioPathDto } from '../../dto/create-scenario-path.dto';
import { ScenarioPath } from '../../entity/scenario-path.entity';
import { ScenarioPathItem } from '../../entity/scenario-path-item.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioPathStatus } from '../../type/scenario-paths.type';
import { ScenarioPathRepository } from '../../repository/scenario-path.repository';
import { ScenarioPathFilterOptions } from '../../type/scenario-paths.type';
import { ScenarioPathItemRepository } from '../../repository/scenario-path-item.repository';
import { NotFoundException } from '@nestjs/common';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioPathSessionService } from '../scenario-path-session.service';
import { UpdateScenarioPathDto } from '../../dto/update-scenario-path.dto';

// Mock ExecutionManager
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

describe('ScenarioPathService', () => {
  let service: ScenarioPathService;
  let dataSource: jest.Mocked<DataSource>;
  let scenarioUtil: jest.Mocked<ScenarioSharedService>;
  let scenarioPathRepository: jest.Mocked<ScenarioPathRepository>;
  let scenarioPathItemRepository: jest.Mocked<ScenarioPathItemRepository>;
  let scenarioPathSessionService: jest.Mocked<ScenarioPathSessionService>;
  let mockEntityManager: any;
  let mockScenarioPathRepo: jest.Mocked<Repository<ScenarioPath>>;
  let mockScenarioPathItemRepo: jest.Mocked<Repository<ScenarioPathItem>>;

  const mockScenarios: Scenarios[] = [
    { id: 1, title: 'Scenario 1' } as Scenarios,
    { id: 2, title: 'Scenario 2' } as Scenarios,
    { id: 3, title: 'Scenario 3' } as Scenarios,
  ];

  beforeEach(async () => {
    mockScenarioPathRepo = {
      save: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    } as any;

    mockScenarioPathItemRepo = {
      save: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    } as any;

    mockEntityManager = {
      getRepository: jest.fn((entity) => {
        if (entity === ScenarioPath) {
          return mockScenarioPathRepo;
        }
        if (entity === ScenarioPathItem) {
          return mockScenarioPathItemRepo;
        }
        return {};
      }),
    };

    const mockDataSource = {
      transaction: jest.fn((callback) => callback(mockEntityManager)),
      createEntityManager: jest.fn(),
    };

    const mockScenarioUtil = {
      getScenarioByIds: jest.fn(),
    };

    const mockScenarioPathRepository = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    };

    const mockScenarioPathItemRepository = {
      find: jest.fn(),
    };

    const mockScenarioPathSessionService = {
      getScenarioPathSessionByScenarioPathId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioPathService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioUtil,
        },
        {
          provide: ScenarioPathRepository,
          useValue: mockScenarioPathRepository,
        },
        {
          provide: ScenarioPathItemRepository,
          useValue: mockScenarioPathItemRepository,
        },
        {
          provide: ScenarioPathSessionService,
          useValue: mockScenarioPathSessionService,
        },
      ],
    }).compile();

    service = module.get<ScenarioPathService>(ScenarioPathService);
    dataSource = module.get(DataSource);
    scenarioUtil = module.get(ScenarioSharedService);
    scenarioPathRepository = module.get(ScenarioPathRepository);
    scenarioPathItemRepository = module.get(ScenarioPathItemRepository);
    scenarioPathSessionService = module.get(ScenarioPathSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(undefined);
  });

  describe('getScenarioPaths', () => {
    const mockScenarioPaths: ScenarioPath[] = [
      {
        id: 'path-1',
        title: 'Path 1',
        description: 'Description 1',
        status: ScenarioPathStatus.ACTIVE,
      } as ScenarioPath,
      {
        id: 'path-2',
        title: 'Path 2',
        description: 'Description 2',
        status: ScenarioPathStatus.DRAFT,
      } as ScenarioPath,
    ];

    it('should return scenario paths without filters', async () => {
      const expectedResult = {
        data: mockScenarioPaths,
        count: 2,
      };
      scenarioPathRepository.findAll.mockResolvedValue(expectedResult);

      const result = await service.getScenarioPaths();

      expect(result).toEqual(expectedResult);
      expect(scenarioPathRepository.findAll).toHaveBeenCalledWith(undefined);
    });

    it('should return scenario paths with status filter', async () => {
      const filters: ScenarioPathFilterOptions = {
        status: ScenarioPathStatus.ACTIVE,
      };
      const expectedResult = {
        data: [mockScenarioPaths[0]],
        count: 1,
      };
      scenarioPathRepository.findAll.mockResolvedValue(expectedResult);

      const result = await service.getScenarioPaths(filters);

      expect(result).toEqual(expectedResult);
      expect(scenarioPathRepository.findAll).toHaveBeenCalledWith(filters);
    });

    it('should return scenario paths with pagination filters', async () => {
      const filters: ScenarioPathFilterOptions = {
        offset: 10,
        limit: 5,
      };
      const expectedResult = {
        data: mockScenarioPaths,
        count: 2,
      };
      scenarioPathRepository.findAll.mockResolvedValue(expectedResult);

      const result = await service.getScenarioPaths(filters);

      expect(result).toEqual(expectedResult);
      expect(scenarioPathRepository.findAll).toHaveBeenCalledWith(filters);
    });

    it('should return scenario paths with search filter', async () => {
      const filters: ScenarioPathFilterOptions = {
        search: 'Path 1',
      };
      const expectedResult = {
        data: [mockScenarioPaths[0]],
        count: 1,
      };
      scenarioPathRepository.findAll.mockResolvedValue(expectedResult);

      const result = await service.getScenarioPaths(filters);

      expect(result).toEqual(expectedResult);
      expect(scenarioPathRepository.findAll).toHaveBeenCalledWith(filters);
    });

    it('should return scenario paths with all filters', async () => {
      const filters: ScenarioPathFilterOptions = {
        status: ScenarioPathStatus.ACTIVE,
        offset: 0,
        limit: 10,
        search: 'Path',
      };
      const expectedResult = {
        data: mockScenarioPaths,
        count: 2,
      };
      scenarioPathRepository.findAll.mockResolvedValue(expectedResult);

      const result = await service.getScenarioPaths(filters);

      expect(result).toEqual(expectedResult);
      expect(scenarioPathRepository.findAll).toHaveBeenCalledWith(filters);
    });

    it('should return empty array when no scenario paths found', async () => {
      const expectedResult = {
        data: [],
        count: 0,
      };
      scenarioPathRepository.findAll.mockResolvedValue(expectedResult);

      const result = await service.getScenarioPaths();

      expect(result).toEqual(expectedResult);
      expect(scenarioPathRepository.findAll).toHaveBeenCalledWith(undefined);
    });
  });

  describe('createScenarioPath', () => {
    const mockCreateScenarioPathDto: CreateScenarioPathDto = {
      title: 'Test Scenario Path',
      description: 'Test Description',
      coverImageUrl: 'https://example.com/image.jpg',
      isGlobal: false,
      status: ScenarioPathStatus.DRAFT,
      scenarios: [
        {
          scenarioId: 1,
          order: 1,
          minimumScore: 0,
          messageTitle: 'Message 1',
          messageContent: 'Content 1',
        },
        {
          scenarioId: 2,
          order: 2,
          minimumScore: 75,
          messageTitle: 'Message 2',
          messageContent: 'Content 2',
        },
      ],
    };

    const mockSavedScenarioPath: ScenarioPath = {
      id: 'test-path-id',
      title: mockCreateScenarioPathDto.title,
      description: mockCreateScenarioPathDto.description,
      coverImageUrl: mockCreateScenarioPathDto.coverImageUrl,
      isGlobal: false,
      status: ScenarioPathStatus.DRAFT,
      totalScenarios: 2,
    } as ScenarioPath;

    it('should successfully create a scenario path with items', async () => {
      scenarioUtil.getScenarioByIds.mockResolvedValue([
        mockScenarios[0],
        mockScenarios[1],
      ]);
      mockScenarioPathRepo.save.mockResolvedValue(mockSavedScenarioPath);
      mockScenarioPathItemRepo.create.mockImplementation((item) => item as any);
      mockScenarioPathItemRepo.save.mockResolvedValue([] as any);

      const result = await service.createScenarioPath(
        mockCreateScenarioPathDto,
      );

      expect(result).toEqual({
        id: mockSavedScenarioPath.id,
        title: mockSavedScenarioPath.title,
        description: mockSavedScenarioPath.description,
        coverImageUrl: mockSavedScenarioPath.coverImageUrl,
        status: mockSavedScenarioPath.status,
      });
      expect(scenarioUtil.getScenarioByIds).toHaveBeenCalledWith([1, 2]);
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(mockScenarioPathItemRepo.create).toHaveBeenCalledTimes(2);
    });

    it('should throw BadRequestException when scenario IDs are invalid', async () => {
      scenarioUtil.getScenarioByIds.mockResolvedValue([mockScenarios[0]]);

      await expect(
        service.createScenarioPath(mockCreateScenarioPathDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when duplicate order values exist', async () => {
      const dtoWithDuplicateOrder: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        scenarios: [
          {
            scenarioId: 1,
            order: 1,
            minimumScore: 0,
          },
          {
            scenarioId: 2,
            order: 1,
            minimumScore: 75,
          },
        ],
      };

      await expect(
        service.createScenarioPath(dtoWithDuplicateOrder),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when duplicate scenario IDs exist', async () => {
      const dtoWithDuplicateScenarioId: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        scenarios: [
          {
            scenarioId: 1,
            order: 1,
            minimumScore: 0,
          },
          {
            scenarioId: 1,
            order: 2,
            minimumScore: 75,
          },
        ],
      };

      await expect(
        service.createScenarioPath(dtoWithDuplicateScenarioId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when order values are not sequential', async () => {
      const dtoWithNonSequentialOrder: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        scenarios: [
          {
            scenarioId: 1,
            order: 1,
            minimumScore: 0,
          },
          {
            scenarioId: 2,
            order: 3,
            minimumScore: 75,
          },
        ],
      };

      await expect(
        service.createScenarioPath(dtoWithNonSequentialOrder),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create scenario path with empty scenarios array', async () => {
      const dtoWithoutScenarios: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        scenarios: [],
      };
      scenarioUtil.getScenarioByIds.mockResolvedValue([]);
      mockScenarioPathRepo.save.mockResolvedValue({
        ...mockSavedScenarioPath,
        totalScenarios: 0,
      });

      const result = await service.createScenarioPath(dtoWithoutScenarios);

      expect(result).toBeDefined();
      expect(mockScenarioPathItemRepo.create).not.toHaveBeenCalled();
      expect(mockScenarioPathItemRepo.save).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when status is ACTIVE and title is missing', async () => {
      const dtoWithoutTitle: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        status: ScenarioPathStatus.ACTIVE,
        title: undefined,
      };

      await expect(service.createScenarioPath(dtoWithoutTitle)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when status is ACTIVE and description is missing', async () => {
      const dtoWithoutDescription: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        status: ScenarioPathStatus.ACTIVE,
        description: undefined,
      };

      await expect(
        service.createScenarioPath(dtoWithoutDescription),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when status is ACTIVE and coverImageUrl is missing', async () => {
      const dtoWithoutCoverImage: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        status: ScenarioPathStatus.ACTIVE,
        coverImageUrl: undefined,
      };

      await expect(
        service.createScenarioPath(dtoWithoutCoverImage),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when status is ACTIVE and scenarios count is less than minimum', async () => {
      const dtoWithInsufficientScenarios: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        status: ScenarioPathStatus.ACTIVE,
        scenarios: [
          {
            scenarioId: 1,
            order: 1,
            minimumScore: 0,
          },
        ],
      };
      scenarioUtil.getScenarioByIds.mockResolvedValue([mockScenarios[0]]);

      await expect(
        service.createScenarioPath(dtoWithInsufficientScenarios),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when status is ACTIVE and scenarios count exceeds maximum', async () => {
      const scenarios = Array.from({ length: 21 }, (_, i) => ({
        scenarioId: i + 1,
        order: i + 1,
        minimumScore: 0,
      }));
      const dtoWithTooManyScenarios: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        status: ScenarioPathStatus.ACTIVE,
        scenarios,
      };
      scenarioUtil.getScenarioByIds.mockResolvedValue(
        scenarios.map((s) => ({ id: s.scenarioId }) as Scenarios),
      );

      await expect(
        service.createScenarioPath(dtoWithTooManyScenarios),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow DRAFT status without required fields', async () => {
      const dtoDraftWithoutRequiredFields: CreateScenarioPathDto = {
        title: undefined,
        description: undefined,
        coverImageUrl: undefined,
        status: ScenarioPathStatus.DRAFT,
        scenarios: [
          {
            scenarioId: 1,
            order: 1,
            minimumScore: 0,
          },
        ],
      };
      scenarioUtil.getScenarioByIds.mockResolvedValue([mockScenarios[0]]);
      mockScenarioPathRepo.save.mockResolvedValue({
        ...mockSavedScenarioPath,
        title: null as any,
        description: undefined,
        coverImageUrl: undefined,
      });
      mockScenarioPathItemRepo.create.mockImplementation((item) => item as any);
      mockScenarioPathItemRepo.save.mockResolvedValue([] as any);

      const result = await service.createScenarioPath(
        dtoDraftWithoutRequiredFields,
      );

      expect(result).toBeDefined();
      expect(result.title).toBeFalsy();
    });

    it('should allow DRAFT status with less than minimum scenarios', async () => {
      const dtoDraftWithOneScenario: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        status: ScenarioPathStatus.DRAFT,
        scenarios: [
          {
            scenarioId: 1,
            order: 1,
            minimumScore: 0,
          },
        ],
      };
      scenarioUtil.getScenarioByIds.mockResolvedValue([mockScenarios[0]]);
      mockScenarioPathRepo.save.mockResolvedValue({
        ...mockSavedScenarioPath,
        totalScenarios: 1,
      });
      mockScenarioPathItemRepo.create.mockImplementation((item) => item as any);
      mockScenarioPathItemRepo.save.mockResolvedValue([] as any);

      const result = await service.createScenarioPath(dtoDraftWithOneScenario);

      expect(result).toBeDefined();
    });

    it('should create scenario path with maximum allowed scenarios for ACTIVE status', async () => {
      const scenarios = Array.from({ length: 20 }, (_, i) => ({
        scenarioId: i + 1,
        order: i + 1,
        minimumScore: 0,
        messageTitle: `Message ${i + 1}`,
        messageContent: `Content ${i + 1}`,
      }));
      const dtoWithMaxScenarios: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        status: ScenarioPathStatus.ACTIVE,
        scenarios,
      };
      scenarioUtil.getScenarioByIds.mockResolvedValue(
        scenarios.map((s) => ({ id: s.scenarioId }) as Scenarios),
      );
      mockScenarioPathRepo.save.mockResolvedValue({
        ...mockSavedScenarioPath,
        totalScenarios: 20,
      });
      mockScenarioPathItemRepo.create.mockImplementation((item) => item as any);
      mockScenarioPathItemRepo.save.mockResolvedValue([] as any);

      const result = await service.createScenarioPath(dtoWithMaxScenarios);

      expect(result).toBeDefined();
      expect(mockScenarioPathItemRepo.create).toHaveBeenCalledTimes(20);
    });

    it('should create scenario path with minimum required scenarios for ACTIVE status', async () => {
      const dtoWithMinScenarios: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        status: ScenarioPathStatus.ACTIVE,
        scenarios: [
          {
            scenarioId: 1,
            order: 1,
            minimumScore: 0,
            messageTitle: 'Message 1',
            messageContent: 'Content 1',
          },
          {
            scenarioId: 2,
            order: 2,
            minimumScore: 75,
            messageTitle: 'Message 2',
            messageContent: 'Content 2',
          },
        ],
      };
      scenarioUtil.getScenarioByIds.mockResolvedValue([
        mockScenarios[0],
        mockScenarios[1],
      ]);
      mockScenarioPathRepo.save.mockResolvedValue({
        ...mockSavedScenarioPath,
        totalScenarios: 2,
      });
      mockScenarioPathItemRepo.create.mockImplementation((item) => item as any);
      mockScenarioPathItemRepo.save.mockResolvedValue([] as any);

      const result = await service.createScenarioPath(dtoWithMinScenarios);

      expect(result).toBeDefined();
      expect(mockScenarioPathItemRepo.create).toHaveBeenCalledTimes(2);
    });

    it('should correctly set totalScenarios based on scenarios array length', async () => {
      scenarioUtil.getScenarioByIds.mockResolvedValue([
        mockScenarios[0],
        mockScenarios[1],
        mockScenarios[2],
      ]);
      const dtoWithThreeScenarios: CreateScenarioPathDto = {
        ...mockCreateScenarioPathDto,
        scenarios: [
          {
            scenarioId: 1,
            order: 1,
            minimumScore: 0,
          },
          {
            scenarioId: 2,
            order: 2,
            minimumScore: 75,
          },
          {
            scenarioId: 3,
            order: 3,
            minimumScore: 80,
          },
        ],
      };
      mockScenarioPathRepo.save.mockResolvedValue({
        ...mockSavedScenarioPath,
        totalScenarios: 3,
      });
      mockScenarioPathItemRepo.create.mockImplementation((item) => item as any);
      mockScenarioPathItemRepo.save.mockResolvedValue([] as any);

      await service.createScenarioPath(dtoWithThreeScenarios);

      expect(mockScenarioPathRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          totalScenarios: 3,
        }),
      );
    });
  });

  describe('getScenarioPathById', () => {
    const mockScenarioPath: ScenarioPath = {
      id: 'path-1',
      title: 'Path 1',
      description: 'Description 1',
      coverImageUrl: 'https://example.com/image.jpg',
      status: ScenarioPathStatus.ACTIVE,
      isGlobal: false,
    } as ScenarioPath;

    const mockScenarioPathItems: ScenarioPathItem[] = [
      {
        id: 'item-1',
        scenarioPathId: 'path-1',
        scenarioId: 1,
        order: 1,
        messageTitle: 'Message 1',
        messageContent: 'Content 1',
        minimumScore: 0,
      } as ScenarioPathItem,
      {
        id: 'item-2',
        scenarioPathId: 'path-1',
        scenarioId: 2,
        order: 2,
        messageTitle: 'Message 2',
        messageContent: 'Content 2',
        minimumScore: 75,
      } as ScenarioPathItem,
    ];

    it('should return scenario path with scenarios by id', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(mockScenarioPath);
      scenarioPathItemRepository.find.mockResolvedValue(mockScenarioPathItems);
      scenarioUtil.getScenarioByIds.mockResolvedValue([
        {
          id: 1,
          title: 'Scenario 1',
          description: 'Desc 1',
          coverImageUrl: 'url1',
        } as Scenarios,
        {
          id: 2,
          title: 'Scenario 2',
          description: 'Desc 2',
          coverImageUrl: 'url2',
        } as Scenarios,
      ]);

      const result = await service.getScenarioPathById('path-1');

      expect(result).toEqual({
        id: mockScenarioPath.id,
        title: mockScenarioPath.title,
        description: mockScenarioPath.description,
        coverImageUrl: mockScenarioPath.coverImageUrl,
        status: mockScenarioPath.status,
        isGlobal: mockScenarioPath.isGlobal,
        scenarios: [
          {
            scenarioId: mockScenarioPathItems[0].scenarioId,
            order: mockScenarioPathItems[0].order,
            messageTitle: mockScenarioPathItems[0].messageTitle,
            messageContent: mockScenarioPathItems[0].messageContent,
            minimumScore: mockScenarioPathItems[0].minimumScore,
            title: 'Scenario 1',
            description: 'Desc 1',
            coverImageUrl: 'url1',
          },
          {
            scenarioId: mockScenarioPathItems[1].scenarioId,
            order: mockScenarioPathItems[1].order,
            messageTitle: mockScenarioPathItems[1].messageTitle,
            messageContent: mockScenarioPathItems[1].messageContent,
            minimumScore: mockScenarioPathItems[1].minimumScore,
            title: 'Scenario 2',
            description: 'Desc 2',
            coverImageUrl: 'url2',
          },
        ],
      });
      expect(scenarioPathRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'path-1' },
      });
      expect(scenarioPathItemRepository.find).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1' },
      });
      expect(scenarioUtil.getScenarioByIds).toHaveBeenCalledWith([1, 2]);
    });

    it('should throw NotFoundException when scenario path not found', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getScenarioPathById('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
      expect(scenarioPathItemRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('updateScenarioPath', () => {
    const mockScenarioPath: ScenarioPath = {
      id: 'path-1',
      title: 'Original Title',
      description: 'Original Description',
      coverImageUrl: 'https://example.com/original.jpg',
      status: ScenarioPathStatus.DRAFT,
      isGlobal: false,
    } as ScenarioPath;

    const mockUpdateScenarioPathDto: UpdateScenarioPathDto = {
      title: 'Updated Title',
      description: 'Updated Description',
      status: ScenarioPathStatus.DRAFT,
      scenarios: [
        {
          scenarioId: 1,
          order: 1,
          minimumScore: 0,
          messageTitle: 'Message 1',
          messageContent: 'Content 1',
        },
        {
          scenarioId: 2,
          order: 2,
          minimumScore: 75,
          messageTitle: 'Message 2',
          messageContent: 'Content 2',
        },
      ],
    };

    const mockExistingScenarioPathItems: ScenarioPathItem[] = [
      {
        id: 'item-1',
        scenarioPathId: 'path-1',
        scenarioId: 1,
        order: 1,
        messageTitle: 'Old Message 1',
        messageContent: 'Old Content 1',
        minimumScore: 0,
      } as ScenarioPathItem,
    ];

    it('should successfully update a scenario path', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(mockScenarioPath);
      scenarioUtil.getScenarioByIds.mockResolvedValue([
        mockScenarios[0],
        mockScenarios[1],
      ]);
      mockScenarioPathRepo.update.mockResolvedValue(undefined as any);
      mockScenarioPathRepo.findOne.mockResolvedValue({
        ...mockScenarioPath,
        ...mockUpdateScenarioPathDto,
        totalScenarios: 2,
      });
      mockScenarioPathItemRepo.delete.mockResolvedValue(undefined as any);
      mockScenarioPathItemRepo.create.mockImplementation((item) => item as any);
      mockScenarioPathItemRepo.save.mockResolvedValue([] as any);

      const result = await service.updateScenarioPath(
        'path-1',
        mockUpdateScenarioPathDto,
      );

      expect(result).toEqual({
        id: 'path-1',
        title: 'Updated Title',
        description: 'Updated Description',
        coverImageUrl: mockScenarioPath.coverImageUrl,
        status: ScenarioPathStatus.DRAFT,
      });
      expect(scenarioPathRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'path-1' },
      });
      expect(mockScenarioPathRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'path-1' },
      });
      expect(mockScenarioPathItemRepo.delete).toHaveBeenCalledWith({
        scenarioPathId: 'path-1',
      });
      expect(mockScenarioPathItemRepo.create).toHaveBeenCalledTimes(2);
      expect(scenarioPathItemRepository.find).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when scenario path not found', async () => {
      scenarioPathRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateScenarioPath(
          'non-existent-id',
          mockUpdateScenarioPathDto,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when trying to change ACTIVE to DRAFT with active sessions', async () => {
      const activeScenarioPath: ScenarioPath = {
        ...mockScenarioPath,
        status: ScenarioPathStatus.ACTIVE,
      };
      const updateToDraft: UpdateScenarioPathDto = {
        ...mockUpdateScenarioPathDto,
        status: ScenarioPathStatus.DRAFT,
      };

      scenarioPathRepository.findOne.mockResolvedValue(activeScenarioPath);
      scenarioPathSessionService.getScenarioPathSessionByScenarioPathId.mockResolvedValue(
        {
          id: 'session-1',
        } as any,
      );

      await expect(
        service.updateScenarioPath('path-1', updateToDraft),
      ).rejects.toThrow(BadRequestException);
      expect(
        scenarioPathSessionService.getScenarioPathSessionByScenarioPathId,
      ).toHaveBeenCalledWith('path-1');
    });

    it('should allow changing ACTIVE to DRAFT when no active sessions exist', async () => {
      const activeScenarioPath: ScenarioPath = {
        ...mockScenarioPath,
        status: ScenarioPathStatus.ACTIVE,
      };
      const updateToDraft: UpdateScenarioPathDto = {
        ...mockUpdateScenarioPathDto,
        status: ScenarioPathStatus.DRAFT,
      };

      scenarioPathRepository.findOne.mockResolvedValue(activeScenarioPath);
      scenarioPathSessionService.getScenarioPathSessionByScenarioPathId.mockResolvedValue(
        null,
      );
      scenarioUtil.getScenarioByIds.mockResolvedValue([
        mockScenarios[0],
        mockScenarios[1],
      ]);
      mockScenarioPathRepo.update.mockResolvedValue(undefined as any);
      mockScenarioPathRepo.findOne.mockResolvedValue({
        ...activeScenarioPath,
        ...updateToDraft,
        totalScenarios: 2,
      });
      mockScenarioPathItemRepo.delete.mockResolvedValue(undefined as any);
      mockScenarioPathItemRepo.create.mockImplementation((item) => item as any);
      mockScenarioPathItemRepo.save.mockResolvedValue([] as any);

      const result = await service.updateScenarioPath('path-1', updateToDraft);

      expect(result.status).toBe(ScenarioPathStatus.DRAFT);
      expect(
        scenarioPathSessionService.getScenarioPathSessionByScenarioPathId,
      ).toHaveBeenCalledWith('path-1');
    });

    it('should use existing scenarios when scenarios not provided in update', async () => {
      const updateWithoutScenarios: UpdateScenarioPathDto = {
        title: 'Updated Title',
        status: ScenarioPathStatus.DRAFT,
      };

      scenarioPathRepository.findOne.mockResolvedValue(mockScenarioPath);
      scenarioPathItemRepository.find.mockResolvedValue(
        mockExistingScenarioPathItems,
      );
      scenarioUtil.getScenarioByIds.mockResolvedValue([mockScenarios[0]]);
      mockScenarioPathRepo.update.mockResolvedValue(undefined as any);
      mockScenarioPathRepo.findOne.mockResolvedValue({
        ...mockScenarioPath,
        title: 'Updated Title',
        totalScenarios: 1,
      });
      mockScenarioPathItemRepo.delete.mockResolvedValue(undefined as any);
      mockScenarioPathItemRepo.create.mockImplementation((item) => item as any);
      mockScenarioPathItemRepo.save.mockResolvedValue([] as any);

      await service.updateScenarioPath('path-1', updateWithoutScenarios);

      expect(scenarioPathRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'path-1' },
      });
      expect(mockScenarioPathRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'path-1' },
      });
      expect(scenarioPathItemRepository.find).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1' },
      });
      expect(scenarioUtil.getScenarioByIds).toHaveBeenCalledWith([1]);
      // When scenarios is not provided, items are not deleted or recreated
      expect(mockScenarioPathItemRepo.delete).not.toHaveBeenCalled();
      expect(mockScenarioPathItemRepo.create).not.toHaveBeenCalled();
    });
  });
});
