// TODO: Handle correctly - util created to resolve circular dependency

import { In } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ScenariosRepository } from '../repository/scenario.repository';
import { Scenarios } from '../entity/scenarios.entity';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';

@Injectable()
export class ScenarioSharedService {
  private static readonly logger = LoggerService.getInstance(
    ScenarioSharedService.name,
  );
  constructor(
    private readonly scenariosRepository: ScenariosRepository,
    private scenarioSessionRepository: ScenarioSessionRepository,
  ) {}

  async getScenarioByIds(scenarioIds: number[]): Promise<Scenarios[]> {
    return this.scenariosRepository.findBy({
      id: In(scenarioIds),
    });
  }

  async getScenarioSessionByScenarioPathSessionItemId(
    scenarioPathSessionItemId: string,
  ) {
    return this.scenarioSessionRepository.findOne({
      where: { scenarioPathSessionItemId },
    });
  }
}
