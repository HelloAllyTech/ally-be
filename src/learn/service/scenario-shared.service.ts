// TODO: Handle correctly - util created to resolve circular dependency

import { In } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ScenariosRepository } from '../repository/scenario.repository';
import { Scenarios } from '../entity/scenarios.entity';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ScenarioFilters } from '../type/scenario-filter.type';
import { GetScenarioDto } from '../dto/get-scenario.dto';

@Injectable()
export class ScenarioSharedService {
  private static readonly logger = LoggerService.getInstance(
    ScenarioSharedService.name,
  );
  constructor(
    private readonly scenariosRepository: ScenariosRepository,
    private scenarioSessionRepository: ScenarioSessionRepository,
  ) {}

  async getScenarioByIds(
    scenarioIds: number[],
    filters?: ScenarioFilters,
  ): Promise<Scenarios[]> {
    return this.scenariosRepository.findBy({
      id: In(scenarioIds),
      ...(filters?.status && { status: In([filters.status]) }),
    });
  }

  async getScenarioWithTriggerWarningsByIds(
    scenarioIds: number[],
  ): Promise<GetScenarioDto[]> {
    return this.scenariosRepository.getScenarioWithTriggerWarningsByIds(
      scenarioIds,
    );
  }

  async getScenarioById(scenarioId: number): Promise<Scenarios | null> {
    return this.scenariosRepository.findOne({
      where: { id: scenarioId },
    });
  }

  async getScenarioSessionById(
    scenarioSessionId: string,
  ): Promise<ScenarioSessions | null> {
    return this.scenarioSessionRepository.findOne({
      where: { id: scenarioSessionId },
    });
  }
}
