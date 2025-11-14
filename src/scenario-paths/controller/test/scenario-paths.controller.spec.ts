import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioPathsController } from '../scenario-paths.controller';
import { ScenarioPathsService } from '../../service/scenario-paths.service';
import { CreateScenarioPathDto } from '../../dto/create-scenario-path.dto';
import { ScenarioPathStatus } from '../../type/scenario-paths.type';
import { BadRequestException } from '@nestjs/common';

jest.mock('../../../auth/decorators/auth-permissions.decorator', () => ({
  AuthPermissions: () => () => {},
}));

describe('ScenarioPathsController', () => {
  let controller: ScenarioPathsController;
  let service: jest.Mocked<ScenarioPathsService>;

  const mockScenarioPathsService = {
    createScenarioPath: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioPathsController],
      providers: [
        {
          provide: ScenarioPathsService,
          useValue: mockScenarioPathsService,
        },
      ],
    }).compile();

    controller = module.get<ScenarioPathsController>(ScenarioPathsController);
    service = module.get(ScenarioPathsService);
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
        },
      ],
    };

    it('should successfully create a scenario path', async () => {
      const expectedResult = { success: true };
      service.createScenarioPath.mockResolvedValue(expectedResult);

      const result = await controller.createScenarioPath(
        mockCreateScenarioPathDto,
      );

      expect(result).toEqual(expectedResult);
      expect(service.createScenarioPath).toHaveBeenCalledWith(
        mockCreateScenarioPathDto,
      );
    });

    it('should throw BadRequestException when service throws BadRequestException', async () => {
      const error = new BadRequestException('Invalid scenario IDs: [1]');
      service.createScenarioPath.mockRejectedValue(error);

      await expect(
        controller.createScenarioPath(mockCreateScenarioPathDto),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
