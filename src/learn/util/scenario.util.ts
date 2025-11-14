import { In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ScenariosRepository } from '../repository/scenario.repository';
import { Scenarios } from '../entity/scenarios.entity';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ScenarioUtil {
  private static readonly logger = LoggerService.getInstance(ScenarioUtil.name);
  constructor(private readonly scenariosRepository: ScenariosRepository) {}

  async getScenarioByIds(scenarioIds: number[]): Promise<Scenarios[]> {
    return this.scenariosRepository.findBy({
      id: In(scenarioIds),
    });
  }
}
