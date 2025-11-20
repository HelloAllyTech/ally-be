import { Injectable } from '@nestjs/common';
import { ScenarioPathRepository } from '../repository/scenario-path.repository';
import {
  ScenarioPathsWithSession,
  ScenarioPathWithSessionFilterOptions,
} from '../type/scenario-paths.type';

@Injectable()
export class ScenarioPathSharedService {
  constructor(
    private readonly scenarioPathRepository: ScenarioPathRepository,
  ) {}

  async getScenarioPathsWithSession(
    filters: ScenarioPathWithSessionFilterOptions,
  ): Promise<ScenarioPathsWithSession> {
    const scenarioPaths =
      await this.scenarioPathRepository.getAllScenarioPathsWithSession(filters);
    return scenarioPaths;
  }
}
