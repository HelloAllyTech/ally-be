import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioPathController } from '../scenario-path.controller';
import { ScenarioPathService } from '../../service/scenario-path.service';
import { CreateScenarioPathDto } from '../../dto/create-scenario-path.dto';
import { ScenarioPathStatus } from '../../type/scenario-paths.type';
import { ScenarioPath } from '../../entity/scenario-path.entity';

jest.mock('../../../auth/decorators/auth-permissions.decorator', () => ({
  AuthPermissions: () => () => {},
}));

describe('ScenarioPathController', () => {
  let controller: ScenarioPathController;
  let service: jest.Mocked<ScenarioPathService>;

  const mockScenarioPathService = {
    createScenarioPath: jest.fn(),
    getScenarioPaths: jest.fn(),
    getScenarioPathById: jest.fn(),
    updateScenarioPath: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioPathController],
      providers: [
        {
          provide: ScenarioPathService,
          useValue: mockScenarioPathService,
        },
      ],
    }).compile();

    controller = module.get<ScenarioPathController>(ScenarioPathController);
    service = module.get(ScenarioPathService);
  });

  afterEach(() => {
    jest.clearAllMocks();
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

    it('should return scenario paths without query parameters', async () => {
      const expectedResult = {
        data: mockScenarioPaths,
        count: 2,
      };
      service.getScenarioPaths.mockResolvedValue(expectedResult);

      const result = await controller.getScenarioPaths();

      expect(result).toEqual(expectedResult);
      expect(service.getScenarioPaths).toHaveBeenCalledWith({
        status: undefined,
        offset: undefined,
        limit: undefined,
        search: undefined,
      });
    });

    it('should return scenario paths with query parameters', async () => {
      const expectedResult = {
        data: mockScenarioPaths,
        count: 2,
      };
      service.getScenarioPaths.mockResolvedValue(expectedResult);

      const result = await controller.getScenarioPaths(
        ScenarioPathStatus.ACTIVE,
        0,
        10,
        'Path',
      );

      expect(result).toEqual(expectedResult);
      expect(service.getScenarioPaths).toHaveBeenCalledWith({
        status: ScenarioPathStatus.ACTIVE,
        offset: 0,
        limit: 10,
        search: 'Path',
      });
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
        },
      ],
    };

    it('should successfully create a scenario path', async () => {
      const expectedResult = {
        id: 'test-path-id',
        title: 'Test Scenario Path',
        description: 'Test Description',
        coverImageUrl: 'https://example.com/image.jpg',
        status: ScenarioPathStatus.DRAFT,
      };
      service.createScenarioPath.mockResolvedValue(expectedResult);

      const result = await controller.createScenarioPath(
        mockCreateScenarioPathDto,
      );

      expect(result).toEqual(expectedResult);
      expect(service.createScenarioPath).toHaveBeenCalledWith(
        mockCreateScenarioPathDto,
      );
    });
  });

  describe('getScenarioPathById', () => {
    const mockScenarioPath = {
      id: 'path-1',
      title: 'Path 1',
      description: 'Description 1',
      coverImageUrl: 'https://example.com/image.jpg',
      status: ScenarioPathStatus.ACTIVE,
      isGlobal: false,
      scenarios: [
        {
          id: 'item-1',
          scenarioId: 1,
          order: 1,
          messageTitle: 'Message 1',
          messageContent: 'Content 1',
          minimumScore: 0,
          title: 'Scenario 1',
          description: 'Scenario Description 1',
          coverImageUrl: 'https://example.com/scenario1.jpg',
        },
      ],
    };

    it('should return scenario path by id', async () => {
      service.getScenarioPathById.mockResolvedValue(mockScenarioPath);

      const result = await controller.getScenarioPathById('path-1');

      expect(result).toEqual(mockScenarioPath);
      expect(service.getScenarioPathById).toHaveBeenCalledWith('path-1');
    });
  });

  describe('updateScenarioPath', () => {
    const mockUpdateScenarioPathDto = {
      title: 'Updated Scenario Path',
      description: 'Updated Description',
      status: ScenarioPathStatus.DRAFT,
      scenarios: [
        {
          scenarioId: 1,
          order: 1,
          minimumScore: 0,
        },
      ],
    };

    it('should successfully update a scenario path', async () => {
      const expectedResult = {
        id: 'path-1',
        title: 'Updated Scenario Path',
        description: 'Updated Description',
        coverImageUrl: 'https://example.com/image.jpg',
        status: ScenarioPathStatus.DRAFT,
      };
      service.updateScenarioPath.mockResolvedValue(expectedResult);

      const result = await controller.updateScenarioPath(
        'path-1',
        mockUpdateScenarioPathDto,
      );

      expect(result).toEqual(expectedResult);
      expect(service.updateScenarioPath).toHaveBeenCalledWith(
        'path-1',
        mockUpdateScenarioPathDto,
      );
    });
  });
});
