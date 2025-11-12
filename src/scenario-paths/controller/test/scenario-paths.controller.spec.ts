import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioPathsController } from '../scenario-paths.controller';

describe('ScenarioPathsController', () => {
  let controller: ScenarioPathsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioPathsController],
    }).compile();

    controller = module.get<ScenarioPathsController>(ScenarioPathsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
