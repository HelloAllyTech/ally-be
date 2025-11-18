import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioPathSessionService } from '../scenario-path-session.service';
import { ScenarioPathSessionRepository } from '../../repository/scenario-path-session.repository';
import { ScenarioPathSession } from '../../entity/scenario-path-session.entity';

describe('ScenarioPathSessionService', () => {
  let service: ScenarioPathSessionService;
  let repository: jest.Mocked<ScenarioPathSessionRepository>;

  const mockRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioPathSessionService,
        {
          provide: ScenarioPathSessionRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ScenarioPathSessionService>(
      ScenarioPathSessionService,
    );
    repository = module.get(ScenarioPathSessionRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioPathSessionByScenarioPathId', () => {
    it('should return scenario path session when found', async () => {
      const mockSession: ScenarioPathSession = {
        id: 'session-1',
        scenarioPathId: 'path-1',
      } as ScenarioPathSession;

      repository.findOne.mockResolvedValue(mockSession);

      const result =
        await service.getScenarioPathSessionByScenarioPathId('path-1');

      expect(result).toEqual(mockSession);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1' },
      });
    });

    it('should return null when scenario path session not found', async () => {
      repository.findOne.mockResolvedValue(null);

      const result =
        await service.getScenarioPathSessionByScenarioPathId('non-existent-id');

      expect(result).toBeNull();
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathId: 'non-existent-id' },
      });
    });
  });
});
