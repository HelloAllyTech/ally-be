import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CreateScenarioPathDto,
  CreateScenarioPathResponseDto,
} from '../dto/create-scenario-path.dto';
import { GetScenarioPathsResponseDto } from '../dto/scenario-paths-response.dto';
import { ScenarioPath } from '../entity/scenario-path.entity';
import { ScenarioPathItem } from '../entity/scenario-path-item.entity';
import { ScenarioUtil } from 'src/learn/util/scenario.util';
import {
  ScenarioPathStatus,
  ScenarioPathFilterOptions,
} from '../type/scenario-paths.type';
import {
  SCENARIO_PATH_MAX_SCENARIOS,
  SCENARIO_PATH_MIN_SCENARIOS,
  SCENARIO_PATH_REQUIRED_FIELDS,
} from '../constants/scenario-path.constant';
import { ScenarioPathRepository } from '../repository/scenario-path.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';

@Injectable()
export class ScenarioPathService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scenarioUtil: ScenarioUtil,
    private readonly scenarioPathRepository: ScenarioPathRepository,
  ) {}

  async getScenarioPaths(
    filters?: ScenarioPathFilterOptions,
  ): Promise<GetScenarioPathsResponseDto> {
    const result = await this.scenarioPathRepository.findAll(filters);
    return result;
  }

  async createScenarioPath(
    createScenarioPathDto: CreateScenarioPathDto,
  ): Promise<CreateScenarioPathResponseDto> {
    const { title, description, coverImageUrl, isGlobal, status, scenarios } =
      createScenarioPathDto;
    await this.validateScenarios(createScenarioPathDto, status);
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    return await this.dataSource.transaction(async (manager) => {
      const scenarioPathRepo = manager.getRepository(ScenarioPath);
      const scenarioPath = await scenarioPathRepo.save({
        title,
        description,
        coverImageUrl,
        isGlobal,
        status,
        totalScenarios: scenarios?.length,
        ...(userId ? { createdBy: userId, updatedBy: userId } : {}),
      });

      if (scenarios && scenarios.length > 0) {
        const scenarioPathItemRepo = manager.getRepository(ScenarioPathItem);
        const items = scenarios.map((scenario) =>
          scenarioPathItemRepo.create({
            scenarioPathId: scenarioPath.id,
            scenarioId: scenario.scenarioId,
            order: scenario.order,
            messageTitle: scenario.messageTitle,
            messageContent: scenario.messageContent,
            minimumScore: scenario.minimumScore,
          }),
        );

        await scenarioPathItemRepo.save(items);
      }

      return {
        id: scenarioPath.id,
        title: scenarioPath.title,
        description: scenarioPath.description,
        coverImageUrl: scenarioPath.coverImageUrl,
        status: scenarioPath.status,
      };
    });
  }

  private async validateScenarios(
    createScenarioPathDto: CreateScenarioPathDto,
    status: ScenarioPathStatus,
  ) {
    const scenarios = createScenarioPathDto?.scenarios ?? [];
    const scenariosLength = scenarios.length;
    if (status === ScenarioPathStatus.ACTIVE) {
      const missingFields = SCENARIO_PATH_REQUIRED_FIELDS.filter(
        (field) => !createScenarioPathDto[field as keyof CreateScenarioPathDto],
      );
      if (missingFields.length > 0) {
        throw new BadRequestException(
          `The following required fields are missing: ${missingFields.join(', ')}`,
        );
      }

      if (scenariosLength < SCENARIO_PATH_MIN_SCENARIOS) {
        throw new BadRequestException(
          `A scenario path must contain at least ${SCENARIO_PATH_MIN_SCENARIOS} scenarios.`,
        );
      }

      if (scenariosLength > SCENARIO_PATH_MAX_SCENARIOS) {
        throw new BadRequestException(
          `A scenario path can contain at most ${SCENARIO_PATH_MAX_SCENARIOS} scenarios.`,
        );
      }
    }

    const scenarioIdsSet: Set<number> = new Set();
    const scenarioOrderSet: Set<number> = new Set();

    for (const scenario of scenarios) {
      if (scenarioIdsSet.has(scenario.scenarioId)) {
        throw new BadRequestException('Duplicate scenario found.');
      }
      if (scenarioOrderSet.has(scenario.order)) {
        throw new BadRequestException('Duplicate scenario order found.');
      }
      scenarioIdsSet.add(scenario.scenarioId);
      scenarioOrderSet.add(scenario.order);
    }

    for (let i = 1; i <= scenariosLength; i++) {
      if (!scenarioOrderSet.has(i)) {
        throw new BadRequestException(
          `Scenario order must be sequential starting from 1. Missing order: ${i}`,
        );
      }
    }

    const scenarioIds = [...scenarioIdsSet];

    const existingScenarios =
      await this.scenarioUtil.getScenarioByIds(scenarioIds);
    const existingScenarioIds = existingScenarios.map(
      (scenario) => scenario.id,
    );

    const missingScenarioIds = scenarioIds.filter(
      (id) => !existingScenarioIds.includes(id),
    );

    if (missingScenarioIds.length > 0) {
      throw new BadRequestException(
        `Invalid scenario IDs: ${missingScenarioIds}`,
      );
    }
  }
}
