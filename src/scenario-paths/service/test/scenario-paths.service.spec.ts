import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioPathsService } from '../scenario-paths.service';

describe('ScenarioPathsService', () => {
  let service: ScenarioPathsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScenarioPathsService],
    }).compile();

    service = module.get<ScenarioPathsService>(ScenarioPathsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
