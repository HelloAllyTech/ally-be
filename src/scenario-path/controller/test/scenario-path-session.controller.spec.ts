import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioPathSessionController } from '../scenario-path-session.controller';
import { ScenarioPathSessionService } from '../../service/scenario-path-session.service';
import { ScenarioPathSessionsResponseDto } from '../../dto/scenario-path-sessions.dto';

jest.mock('../../../auth/decorators/auth-permissions.decorator', () => ({
  AuthPermissions: () => () => {},
}));

describe('ScenarioPathSessionController', () => {
  let controller: ScenarioPathSessionController;
  let service: jest.Mocked<ScenarioPathSessionService>;

  const mockScenarioPathSessionService = {
    getScenarioPathSessions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioPathSessionController],
      providers: [
        {
          provide: ScenarioPathSessionService,
          useValue: mockScenarioPathSessionService,
        },
      ],
    }).compile();

    controller = module.get<ScenarioPathSessionController>(
      ScenarioPathSessionController,
    );
    service = module.get(ScenarioPathSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioPathSessions', () => {
    const mockResponse: ScenarioPathSessionsResponseDto = {
      data: [
        {
          id: 'path-1',
          title: 'Path 1',
          description: 'Description 1',
          coverImageUrl: 'https://example.com/image.jpg',
          totalScenarios: 5,
          completedScenarios: 2,
        },
        {
          id: 'path-2',
          title: 'Path 2',
          description: 'Description 2',
          totalScenarios: 3,
          completedScenarios: 1,
        },
      ],
      count: 2,
    };

    it('should return scenario path sessions without query parameters', async () => {
      service.getScenarioPathSessions.mockResolvedValue(mockResponse);

      const result = await controller.getScenarioPathSessions();

      expect(result).toEqual(mockResponse);
      expect(service.getScenarioPathSessions).toHaveBeenCalledWith({
        offset: undefined,
        limit: undefined,
      });
    });

    it('should return scenario path sessions with query parameters', async () => {
      service.getScenarioPathSessions.mockResolvedValue(mockResponse);

      const result = await controller.getScenarioPathSessions(10, 20);

      expect(result).toEqual(mockResponse);
      expect(service.getScenarioPathSessions).toHaveBeenCalledWith({
        offset: 10,
        limit: 20,
      });
    });
  });
});
