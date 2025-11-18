import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioPathSessionRepository } from '../repository/scenario-path-session.repository';

@Injectable()
export class ScenarioPathSessionService {
  private readonly logger = LoggerService.getInstance(
    ScenarioPathSessionService.name,
  );
  constructor(
    private readonly scenarioPathSessionRepository: ScenarioPathSessionRepository,
  ) {}

  async getScenarioPathSessionByScenarioPathId(scenarioPathId: string) {
    return this.scenarioPathSessionRepository.findOne({
      where: { scenarioPathId },
    });
  }
}
