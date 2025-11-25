import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioPathController } from '../scenario-path.controller';
import { ScenarioPathService } from '../../service/scenario-path.service';
import { ScenarioPathTenantService } from '../../service/scenario-path-tenant.service';
import { CreateScenarioPathDto } from '../../dto/create-scenario-path.dto';
import {
  ScenarioPathStatus,
  ScenarioPathSortBy,
  SortOrder,
} from '../../type/scenario-paths.type';
import { ScenarioPath } from '../../entity/scenario-path.entity';
import { CreateScenarioPathTenantDto } from '../../dto/create-scenario-path-tenant.dto';
import { DeleteScenarioPathTenantDto } from '../../dto/delete-scenario-path-tenant.dto';

jest.mock('../../../auth/decorators/auth-permissions.decorator', () => ({
  AuthPermissions: () => () => {},
}));

describe('ScenarioPathController', () => {
  let controller: ScenarioPathController;
  let service: jest.Mocked<ScenarioPathService>;
  let tenantService: jest.Mocked<ScenarioPathTenantService>;

  const mockScenarioPathService = {
    createScenarioPath: jest.fn(),
    getScenarioPaths: jest.fn(),
    getScenarioPathById: jest.fn(),
    updateScenarioPath: jest.fn(),
    deleteScenarioPath: jest.fn(),
    duplicateScenarioPath: jest.fn(),
  };

  const mockScenarioPathTenantService = {
    assignScenarioPathsToTenant: jest.fn(),
    removeScenarioPathsFromTenant: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioPathController],
      providers: [
        {
          provide: ScenarioPathService,
          useValue: mockScenarioPathService,
        },
        {
          provide: ScenarioPathTenantService,
          useValue: mockScenarioPathTenantService,
        },
      ],
    }).compile();

    controller = module.get<ScenarioPathController>(ScenarioPathController);
    service = module.get(ScenarioPathService);
    tenantService = module.get(ScenarioPathTenantService);
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
        tenantId: undefined,
        sortBy: ScenarioPathSortBy.UPDATED_AT,
        order: SortOrder.DESC,
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
        status: [ScenarioPathStatus.ACTIVE],
        offset: 0,
        limit: 10,
        search: 'Path',
        tenantId: undefined,
        sortBy: ScenarioPathSortBy.UPDATED_AT,
        order: SortOrder.DESC,
      });
    });

    it('should return scenario paths filtered by tenantId', async () => {
      const expectedResult = {
        data: mockScenarioPaths,
        count: 2,
      };
      service.getScenarioPaths.mockResolvedValue(expectedResult);

      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      const result = await controller.getScenarioPaths(
        undefined,
        undefined,
        undefined,
        undefined,
        tenantId,
      );

      expect(result).toEqual(expectedResult);
      expect(service.getScenarioPaths).toHaveBeenCalledWith({
        status: undefined,
        offset: undefined,
        limit: undefined,
        search: undefined,
        tenantId,
        sortBy: ScenarioPathSortBy.UPDATED_AT,
        order: SortOrder.DESC,
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
      totalScenarios: 1,
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

  describe('deleteScenarioPath', () => {
    it('should successfully delete a scenario path', async () => {
      const expectedResult = { success: true };
      service.deleteScenarioPath.mockResolvedValue(expectedResult);

      const result = await controller.deleteScenarioPath('path-1');

      expect(result).toEqual(expectedResult);
      expect(service.deleteScenarioPath).toHaveBeenCalledWith('path-1');
    });
  });

  describe('duplicateScenarioPath', () => {
    it('should successfully duplicate a scenario path', async () => {
      const expectedResult = {
        id: 'duplicated-path-id',
        title: 'Copy of Path 1',
        description: 'Description 1',
        coverImageUrl: 'https://example.com/image.jpg',
        status: ScenarioPathStatus.DRAFT,
      };
      service.duplicateScenarioPath.mockResolvedValue(expectedResult);

      const result = await controller.duplicateScenarioPath('path-1');

      expect(result).toEqual(expectedResult);
      expect(service.duplicateScenarioPath).toHaveBeenCalledWith('path-1');
    });
  });

  describe('assignScenarioToTenant', () => {
    it('should successfully assign scenario paths to tenant', async () => {
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      const createDto: CreateScenarioPathTenantDto = {
        scenarioPathIds: ['path-1', 'path-2', 'path-3'],
      };
      const expectedResult = {
        success: true,
      };

      tenantService.assignScenarioPathsToTenant.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.assignScenarioPathsToTenant(
        tenantId,
        createDto,
      );

      expect(result).toEqual(expectedResult);
      expect(tenantService.assignScenarioPathsToTenant).toHaveBeenCalledWith(
        tenantId,
        createDto,
      );
    });
  });

  describe('removeScenarioFromTenants', () => {
    it('should successfully remove scenario paths from tenant', async () => {
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      const deleteDto: DeleteScenarioPathTenantDto = {
        scenarioPathIds: ['path-1', 'path-2'],
      };
      const expectedResult = {
        success: true,
      };

      tenantService.removeScenarioPathsFromTenant.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.removeScenarioPathsFromTenant(
        tenantId,
        deleteDto,
      );

      expect(result).toEqual(expectedResult);
      expect(tenantService.removeScenarioPathsFromTenant).toHaveBeenCalledWith(
        tenantId,
        deleteDto,
      );
    });
  });
});
