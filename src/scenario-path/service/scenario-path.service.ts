import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
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
  MinimalScenarioPathData,
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
import { SuccessResponse } from 'src/common/type/common.type';
import { DuplicateScenarioPathResponseDto } from '../dto/duplicate-scenario-path-response.dto';
import { TenantService } from 'src/tenant/service/tenant.service';
import { ScenarioPathTenant } from '../entity/scenario-path-tenant.entity';
import { UpdateScenarioPathItemDto } from '../dto/update-scenario-path-item.dto';

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
    private tenantService: TenantService,
  ) {}

  async getScenarioPaths(
    filters?: ScenarioPathFilterOptions,
  ): Promise<GetScenarioPathsResponseDto> {
    if (filters?.tenantId) {
      const tenant = await this.tenantService.findById(filters.tenantId);
      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }
    }
    const result =
      await this.scenarioPathRepository.getAllScenarioPaths(filters);

    const scenarioPaths = result.data.map((scenarioPath: any) => {
      const { scenarioPathTenant, ...scenarioPathData } = scenarioPath;
      return {
        id: scenarioPathData.id,
        title: scenarioPathData.title,
        description: scenarioPathData.description,
        coverImageUrl: scenarioPathData.coverImageUrl,
        status: scenarioPathData.status,
        isGlobal: scenarioPathData.isGlobal,
        totalScenarios: scenarioPathData.totalScenarios,
        isAssignedToTenant: filters?.tenantId
          ? !!scenarioPathTenant
          : undefined,
        updatedAt: scenarioPathData.updatedAt,
      };
    });

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
    this.logger.info(
      `Create Scenario Path validation passed for the title: ${title}`,
    );
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
      if (scenarioPath.isGlobal) {
        const tenants = await this.tenantService.findAll();
        const tenantIds = tenants.map((tenant) => tenant.id);
        const scenarioPathTenantRepository =
          manager.getRepository(ScenarioPathTenant);
        const scenarioPathTenant = tenantIds.map((tenantId) =>
          scenarioPathTenantRepository.create({
            scenarioPathId: scenarioPath.id,
            tenantId,
          }),
        );
        await scenarioPathTenantRepository.save(scenarioPathTenant);
      }
      this.logger.info(`Scenario path ${scenarioPath.id} created successfully`);
      return this.getMinimalScenarioPathData(scenarioPath);
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

    const scenarioPathSession =
      await this.scenarioPathSessionService.getScenarioPathSessionByScenarioPathId(
        id,
      );

    if (
      scenarioPath.status === ScenarioPathStatus.ACTIVE &&
      status === ScenarioPathStatus.DRAFT
    ) {
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
    if (scenarioPathSession) {
      const isValidScenarioPathItems = this.validateUpdateScenarioPathItems(
        updateScenarioPathDto?.scenarios,
        scenarioPathItems,
      );
      if (!isValidScenarioPathItems) {
        throw new BadRequestException(
          'Cant add or remove any existing scenarios from a scenario path that has active sessions.',
        );
      }
    }

    await this.validateScenarioPath(updateScenarioPath);
    this.logger.info(`Update Scenario Path ${id} validation passed`);
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
      if (
        updatedScenarioPath &&
        updateScenarioPath.isGlobal !== scenarioPath.isGlobal
      ) {
        const tenants = await this.tenantService.findAll();
        const tenantIds = tenants.map((tenant) => tenant.id);
        const scenarioPathTenantRepo =
          manager.getRepository(ScenarioPathTenant);
        if (updatedScenarioPath?.isGlobal) {
          const scenarioPathTenantMappings = tenantIds.map((tenantId) => ({
            scenarioPathId: id,
            tenantId: tenantId,
          }));
          await scenarioPathTenantRepo.save(
            scenarioPathTenantRepo.create(scenarioPathTenantMappings),
          );
        } else {
          await scenarioPathTenantRepo.delete({
            scenarioPathId: id,
            tenantId: In(tenantIds),
          });
        }
      }
      this.logger.info(`Scenario path ${id} updated successfully`);

      return this.getMinimalScenarioPathData(updatedScenarioPath!);
    });
  }

  private async validateUpdateScenarioPathItems(
    inputScenarioPathItems?: UpdateScenarioPathItemDto[],
    existingScenarioPathItems?: UpdateScenarioPathItemDto[],
  ) {
    // If both are undefined, return true
    if (!inputScenarioPathItems && !existingScenarioPathItems) {
      return true;
    }

    // If one is undefined and the other is not, return false
    if (!inputScenarioPathItems || !existingScenarioPathItems) {
      return false;
    }

    if (inputScenarioPathItems.length !== existingScenarioPathItems.length)
      return false;

    // Check if all scenarioIds from input exist in existing and their orders match
    return inputScenarioPathItems.every((inputItem) => {
      return existingScenarioPathItems.some(
        (existingItem) =>
          existingItem.scenarioId === inputItem.scenarioId &&
          existingItem.order === inputItem.order,
      );
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
      this.logger.error(
        `Scenario Path: ${scenarioPath.id ?? scenarioPath.title} validation failed: Invalid scenario IDs: ${missingScenarioIds}`,
      );
      throw new BadRequestException(
        `Invalid scenario IDs: ${missingScenarioIds}`,
      );
    }
  }

  async deleteScenarioPath(id: string): Promise<SuccessResponse> {
    const scenarioPath = await this.scenarioPathRepository.findOne({
      where: { id },
    });
    if (!scenarioPath) {
      throw new NotFoundException('Scenario path not found');
    }

    const scenarioPathSession =
      await this.scenarioPathSessionService.getScenarioPathSessionByScenarioPathId(
        id,
      );
    if (scenarioPathSession) {
      this.logger.error(
        `Delete blocked: Scenario Path ${id} has active sessions.`,
      );
      throw new BadRequestException(
        'Cannot delete a scenario path with active sessions',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ScenarioPath).softDelete(id);
      await manager.getRepository(ScenarioPathItem).softDelete({
        scenarioPathId: id,
      });
      await manager
        .getRepository(ScenarioPathTenant)
        .softDelete({ scenarioPathId: id });
    });

    this.logger.info(`Scenario path ${id} deleted successfully`);
    return { success: true };
  }

  async duplicateScenarioPath(
    id: string,
  ): Promise<DuplicateScenarioPathResponseDto> {
    const scenarioPath = await this.scenarioPathRepository.findOne({
      where: { id },
    });
    if (!scenarioPath) {
      throw new NotFoundException('Scenario path not found');
    }

    const scenarioPathItems = await this.scenarioPathItemRepository.find({
      where: { scenarioPathId: id },
    });

    const newScenarioPath = {
      title: `Copy of ${scenarioPath.title}`,
      description: scenarioPath.description,
      coverImageUrl: scenarioPath.coverImageUrl,
      status: ScenarioPathStatus.DRAFT,
      isGlobal: scenarioPath.isGlobal,
      totalScenarios: scenarioPath.totalScenarios,
    };

    return await this.dataSource.transaction(async (manager) => {
      const scenarioPathRepo = manager.getRepository(ScenarioPath);
      const scenarioPathItemRepo = manager.getRepository(ScenarioPathItem);

      const newScenarioPathData = await scenarioPathRepo.save(newScenarioPath);

      if (scenarioPathItems.length > 0) {
        const newScenarioPathItems = scenarioPathItems.map((item) =>
          scenarioPathItemRepo.create({
            scenarioPathId: newScenarioPathData.id,
            scenarioId: item.scenarioId,
            order: item.order,
            messageTitle: item.messageTitle,
            messageContent: item.messageContent,
            minimumScore: item.minimumScore,
          }),
        );

        await scenarioPathItemRepo.save(newScenarioPathItems);
      }

      const tenants = await this.tenantService.findAll();
      const tenantIds = tenants.map((tenant) => tenant.id);
      const scenarioPathTenantRepository =
        manager.getRepository(ScenarioPathTenant);
      const scenarioPathTenant = tenantIds.map((tenantId) =>
        scenarioPathTenantRepository.create({
          scenarioPathId: newScenarioPathData.id,
          tenantId,
        }),
      );
      await scenarioPathTenantRepository.save(scenarioPathTenant);

      this.logger.info(`Scenario path ${id} duplicated successfully`);
      return this.getMinimalScenarioPathData(newScenarioPathData);
    });
  }

  private getMinimalScenarioPathData(
    scenarioPath: ScenarioPath,
  ): MinimalScenarioPathData {
    return {
      id: scenarioPath.id,
      title: scenarioPath.title,
      description: scenarioPath.description,
      coverImageUrl: scenarioPath.coverImageUrl,
      status: scenarioPath.status,
    };
  }
}
