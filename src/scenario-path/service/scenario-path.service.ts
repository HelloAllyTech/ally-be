import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CreateScenarioPathDto,
  CreateScenarioPathResponseDto,
} from '../dto/create-scenario-path.dto';
import { GetScenarioPathsResponseDto } from '../dto/scenario-paths-response.dto';
import { ScenarioPath } from '../entity/scenario-path.entity';
import { ScenarioPathItem } from '../entity/scenario-path-item.entity';
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
import { LoggerService } from '../../logger/logger.service';
import { ScenarioPathItemRepository } from '../repository/scenario-path-item.repository';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import {
  UpdateScenarioPathDto,
  UpdateScenarioPathResponseDto,
} from '../dto/update-scenario-path.dto';
import { ScenarioPathSessionService } from './scenario-path-session.service';
import { GetScenarioPathResponseDto } from '../dto/get-scenario-path.dto';
import { ScenarioPathSharedService } from './scenario-path-shared.service';

@Injectable()
export class ScenarioPathService {
  private readonly logger = LoggerService.getInstance(ScenarioPathService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly scenarioPathRepository: ScenarioPathRepository,
    private readonly scenarioPathItemRepository: ScenarioPathItemRepository,
    private readonly scenarioPathSessionService: ScenarioPathSessionService,
    private readonly scenarioPathSharedService: ScenarioPathSharedService,
  ) {}

  async getScenarioPaths(
    filters?: ScenarioPathFilterOptions,
  ): Promise<GetScenarioPathsResponseDto> {
    const result =
      await this.scenarioPathRepository.getAllScenarioPaths(filters);
    const scenarioPaths = result.data.map((scenarioPath) => ({
      id: scenarioPath.id,
      title: scenarioPath.title,
      description: scenarioPath.description,
      coverImageUrl: scenarioPath.coverImageUrl,
      status: scenarioPath.status,
      isGlobal: scenarioPath.isGlobal,
      totalScenarios: scenarioPath.totalScenarios,
      updatedAt: scenarioPath.updatedAt,
    }));
    return {
      data: scenarioPaths,
      count: result.count,
    };
  }

  async getScenarioPathById(id: string): Promise<GetScenarioPathResponseDto> {
    return this.scenarioPathSharedService.getScenarioPathWithScenarios(id);
  }

  async createScenarioPath(
    createScenarioPathDto: CreateScenarioPathDto,
  ): Promise<CreateScenarioPathResponseDto> {
    const { title, description, coverImageUrl, isGlobal, status, scenarios } =
      createScenarioPathDto;
    await this.validateScenarioPath(createScenarioPathDto);
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

  async updateScenarioPath(
    id: string,
    updateScenarioPathDto: UpdateScenarioPathDto,
  ): Promise<UpdateScenarioPathResponseDto> {
    const { title, description, coverImageUrl, isGlobal, status, scenarios } =
      updateScenarioPathDto;

    const scenarioPath = await this.scenarioPathRepository.findOne({
      where: { id },
    });
    if (!scenarioPath) {
      this.logger.error(`Scenario path not found for id: ${id}`);
      throw new NotFoundException('Scenario path not found');
    }

    if (
      scenarioPath.status === ScenarioPathStatus.ACTIVE &&
      status === ScenarioPathStatus.DRAFT
    ) {
      const scenarioPathSession =
        await this.scenarioPathSessionService.getScenarioPathSessionByScenarioPathId(
          id,
        );
      if (scenarioPathSession) {
        throw new BadRequestException(
          'This scenario path cannot be changed to draft because it has active sessions.',
        );
      }
    }

    let scenarioPathItems = scenarios;
    if (!scenarioPathItems) {
      const scenarioPathItemsData = await this.scenarioPathItemRepository.find({
        where: { scenarioPathId: id },
      });
      scenarioPathItems = scenarioPathItemsData.map((item) => ({
        scenarioId: item.scenarioId,
        order: item.order,
        messageTitle: item.messageTitle,
        messageContent: item.messageContent,
        minimumScore: item.minimumScore ?? 0,
      }));
    }

    const updateScenarioPath = {
      title: scenarioPath.title,
      description: scenarioPath.description,
      coverImageUrl: scenarioPath.coverImageUrl,
      isGlobal: scenarioPath.isGlobal,
      scenarios: scenarioPathItems,
      ...updateScenarioPathDto,
    };

    await this.validateScenarioPath(updateScenarioPath);
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    return await this.dataSource.transaction(async (manager) => {
      const scenarioPathRepo = manager.getRepository(ScenarioPath);
      scenarioPathRepo.update(id, {
        title,
        description,
        coverImageUrl,
        isGlobal,
        status,
        totalScenarios: scenarios?.length,
        ...(userId ? { updatedBy: userId } : {}),
      });

      if (scenarios) {
        const scenarioPathItemRepo = manager.getRepository(ScenarioPathItem);
        // Delete existing scenario path items
        await scenarioPathItemRepo.delete({ scenarioPathId: id });

        // Create new scenario path items
        if (scenarios.length > 0) {
          const items = scenarios.map((scenario) =>
            scenarioPathItemRepo.create({
              scenarioPathId: id,
              scenarioId: scenario.scenarioId,
              order: scenario.order,
              messageTitle: scenario.messageTitle,
              messageContent: scenario.messageContent,
              minimumScore: scenario.minimumScore,
            }),
          );

          await scenarioPathItemRepo.save(items);
        }
      }

      const updatedScenarioPath = await scenarioPathRepo.findOne({
        where: { id },
      });

      return {
        id: updatedScenarioPath!.id,
        title: updatedScenarioPath!.title,
        description: updatedScenarioPath!.description,
        coverImageUrl: updatedScenarioPath!.coverImageUrl,
        status: updatedScenarioPath!.status,
      };
    });
  }

  private async validateScenarioPath(
    scenarioPath: CreateScenarioPathDto & { id?: string },
  ) {
    const scenarios = scenarioPath?.scenarios ?? [];
    const scenariosLength = scenarios.length;
    if (scenarioPath.status === ScenarioPathStatus.ACTIVE) {
      const missingFields = SCENARIO_PATH_REQUIRED_FIELDS.filter(
        (field) => !scenarioPath[field as keyof CreateScenarioPathDto],
      );
      if (missingFields.length > 0) {
        this.logger.error(
          `Scenario path ${scenarioPath.id ?? scenarioPath.title} is missing the following required fields: ${missingFields.join(', ')}`,
        );
        throw new BadRequestException(
          `The following required fields are missing: ${missingFields.join(', ')}`,
        );
      }

      if (scenariosLength < SCENARIO_PATH_MIN_SCENARIOS) {
        this.logger.error(
          `Scenario path ${scenarioPath.id ?? scenarioPath.title} must contain at least ${SCENARIO_PATH_MIN_SCENARIOS} scenarios.`,
        );
        throw new BadRequestException(
          `A scenario path must contain at least ${SCENARIO_PATH_MIN_SCENARIOS} scenarios.`,
        );
      }

      if (scenariosLength > SCENARIO_PATH_MAX_SCENARIOS) {
        this.logger.error(
          `Scenario path ${scenarioPath.id ?? scenarioPath.title} can contain at most ${SCENARIO_PATH_MAX_SCENARIOS} scenarios.`,
        );
        throw new BadRequestException(
          `A scenario path can contain at most ${SCENARIO_PATH_MAX_SCENARIOS} scenarios.`,
        );
      }
    }

    // while editing a scenario path, when user removes all scenarios in the path, we don't need to validate any scenarios
    if (scenarioPath.scenarios && scenarioPath.scenarios.length === 0) {
      return;
    }

    const scenarioIdsSet: Set<number> = new Set();
    const scenarioOrderSet: Set<number> = new Set();

    for (const scenario of scenarios) {
      if (scenarioIdsSet.has(scenario.scenarioId)) {
        this.logger.error(
          `Scenario path ${scenarioPath.id ?? scenarioPath.title} has a duplicate scenario: ${scenario.scenarioId}.`,
        );
        throw new BadRequestException('Duplicate scenario found.');
      }
      if (scenarioOrderSet.has(scenario.order)) {
        this.logger.error(
          `Scenario path ${scenarioPath.id ?? scenarioPath.title} has a duplicate scenario order: ${scenario.order}.`,
        );
        throw new BadRequestException('Duplicate scenario order found.');
      }
      scenarioIdsSet.add(scenario.scenarioId);
      scenarioOrderSet.add(scenario.order);
    }

    for (let i = 1; i <= scenariosLength; i++) {
      if (!scenarioOrderSet.has(i)) {
        this.logger.error(
          `Scenario path ${scenarioPath.id ?? scenarioPath.title} has a missing scenario order: ${i}.`,
        );
        throw new BadRequestException(
          `Scenario order must be sequential starting from 1. Missing order: ${i}`,
        );
      }
    }

    const scenarioIds = [...scenarioIdsSet];

    const existingScenarios =
      await this.scenarioSharedService.getScenarioByIds(scenarioIds);
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
