import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioUtil } from '../scenario-service.util';
import { ScenariosRepository } from '../../repository/scenario.repository';
import { Scenarios } from '../../entity/scenarios.entity';

describe('ScenarioUtil', () => {
  let util: ScenarioUtil;
  let scenariosRepository: jest.Mocked<ScenariosRepository>;

  const mockScenarios: Scenarios[] = [
    { id: 1, title: 'Scenario 1' } as Scenarios,
    { id: 2, title: 'Scenario 2' } as Scenarios,
    { id: 3, title: 'Scenario 3' } as Scenarios,
  ];

  beforeEach(async () => {
    const mockScenariosRepository = {
      findBy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioUtil,
        {
          provide: ScenariosRepository,
          useValue: mockScenariosRepository,
        },
      ],
    }).compile();

    util = module.get<ScenarioUtil>(ScenarioUtil);
    scenariosRepository = module.get(ScenariosRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioByIds', () => {
    it('should return scenarios when IDs exist', async () => {
      const scenarioIds = [1, 2, 3];
      scenariosRepository.findBy.mockResolvedValue(mockScenarios);

      const result = await util.getScenarioByIds(scenarioIds);

      expect(result).toEqual(mockScenarios);
      expect(scenariosRepository.findBy).toHaveBeenCalled();
    });
  });
});
