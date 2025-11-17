import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioPathsService } from '../scenario-paths.service';
import { ScenarioUtil } from 'src/learn/util/scenario.util';
import { CreateScenarioPathDto } from '../../dto/create-scenario-path.dto';
import { ScenarioPaths } from '../../entity/scenario-paths.entity';
import { ScenarioPathItems } from '../../entity/scenario-path-items.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioPathStatus } from '../../type/scenario-paths.type';

describe('ScenarioPathsService', () => {
  let service: ScenarioPathsService;
  let dataSource: jest.Mocked<DataSource>;
  let scenarioUtil: jest.Mocked<ScenarioUtil>;
  let mockEntityManager: any;
  let mockScenarioPathRepo: jest.Mocked<Repository<ScenarioPaths>>;
  let mockScenarioPathItemRepo: jest.Mocked<Repository<ScenarioPathItems>>;

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
    } as any;

    mockScenarioPathItemRepo = {
      save: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    } as any;

    mockEntityManager = {
      getRepository: jest.fn((entity) => {
        if (entity === ScenarioPaths) {
          return mockScenarioPathRepo;
        }
        if (entity === ScenarioPathItems) {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioPathsService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ScenarioUtil,
          useValue: mockScenarioUtil,
        },
      ],
    }).compile();

    service = module.get<ScenarioPathsService>(ScenarioPathsService);
    dataSource = module.get(DataSource);
    scenarioUtil = module.get(ScenarioUtil);
  });

  afterEach(() => {
    jest.clearAllMocks();
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

    const mockSavedScenarioPath: ScenarioPaths = {
      id: 'test-path-id',
      title: mockCreateScenarioPathDto.title,
      description: mockCreateScenarioPathDto.description,
      coverImageUrl: mockCreateScenarioPathDto.coverImageUrl,
      isGlobal: false,
      status: ScenarioPathStatus.DRAFT,
      totalScenarios: 2,
    } as ScenarioPaths;

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
  });
});
