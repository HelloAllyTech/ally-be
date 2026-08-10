import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { ScenarioPathRepository } from '../repository/scenario-path.repository';
import {
  ScenarioPathStatus,
  ScenarioPathsWithSession,
  ScenarioPathWithSessionFilterOptions,
} from '../type/scenario-paths.type';
import { ScenarioPathItemRepository } from '../repository/scenario-path-item.repository';
import { ScenarioPathItem } from '../entity/scenario-path-item.entity';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { GetScenarioPathResponseDto } from '../dto/get-scenario-path.dto';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioPathTenantService } from './scenario-path-tenant.service';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioPathSessionRepository } from '../repository/scenario-path-session.repository';
import { ScenarioPathSessionItemRepository } from '../repository/scenario-path-session-item.repository';
import { SessionItemStatus } from 'src/common/type/common.type';

@Injectable()
export class ScenarioPathSharedService {
  private readonly logger = LoggerService.getInstance(
    ScenarioPathSharedService.name,
  );
  constructor(
    private readonly scenarioPathRepository: ScenarioPathRepository,
    private readonly scenarioPathItemRepository: ScenarioPathItemRepository,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly scenarioPathTenantService: ScenarioPathTenantService,
    private readonly scenarioPathSessionRepository: ScenarioPathSessionRepository,
    private readonly scenarioPathSessionItemRepository: ScenarioPathSessionItemRepository,
  ) {}

  async getScenarioPathsWithSession(
    filters: ScenarioPathWithSessionFilterOptions,
  ): Promise<ScenarioPathsWithSession> {
    const scenarioPaths =
      await this.scenarioPathRepository.getAllScenarioPathsWithSession(filters);
    return scenarioPaths;
  }

  async getScenarioPathWithScenarios(
    scenarioPathId: string,
    tenantId?: string,
    languageCode?: string,
  ): Promise<GetScenarioPathResponseDto> {
    const result = await this.scenarioPathRepository.findOne({
      where: { id: scenarioPathId },
    });
    if (!result) {
      this.logger.error(`Scenario path not found for id: ${scenarioPathId}`);
      throw new NotFoundException('Scenario path not found');
    }
    if (tenantId) {
      const scenarioPathTenant =
        await this.scenarioPathTenantService.getScenarioPathTenant(
          tenantId,
          scenarioPathId,
        );
      if (!scenarioPathTenant) {
        throw new BadRequestException('Organization access denied');
      }
    }

    const scenarioPathItems = await this.scenarioPathItemRepository.find({
      where: { scenarioPathId },
    });

    const scenarioIds = scenarioPathItems.map((item) => item.scenarioId);

    const scenariosData =
      await this.scenarioSharedService.getScenarioWithTriggerWarningsByIds(
        scenarioIds,
      );
    const scenariosDataMap = new Map(
      scenariosData.map((scenario) => [scenario.id, scenario]),
    );

    const scenarios = scenarioPathItems.map((item) => {
      const scenarioData = scenariosDataMap.get(item.scenarioId);
      return {
        id: item.id,
        scenarioId: item.scenarioId,
        order: item.order,
        messageTitle: item.messageTitle,
        messageContent: item.messageContent,
        minimumScore: item.minimumScore,
        title:
          languageCode && scenarioData?.translations?.[languageCode]?.title
            ? scenarioData?.translations?.[languageCode]?.title
            : scenarioData?.title,
        description:
          languageCode &&
          scenarioData?.translations?.[languageCode]?.description
            ? scenarioData?.translations?.[languageCode]?.description
            : scenarioData?.description,
        coverImageUrl: scenarioData?.coverImageUrl,
        coverVideoUrl: scenarioData?.coverVideoUrl,
        triggerWarnings: scenarioData?.triggerWarnings,
        metadata: {
          languageVoices: scenarioData?.metadata?.languageVoices,
        },
      };
    });

    return {
      id: result.id,
      title:
        languageCode && result.translations?.[languageCode]?.title
          ? result.translations?.[languageCode]?.title
          : result.title,
      description:
        languageCode && result.translations?.[languageCode]?.description
          ? result.translations?.[languageCode]?.description
          : result.description,
      coverImageUrl: result.coverImageUrl,
      status: result.status,
      isGlobal: result.isGlobal,
      totalScenarios: result.totalScenarios,
      scenarios,
    };
  }

  async getScenarioPathItems(
    scenarioPathId: string,
  ): Promise<ScenarioPathItem[]> {
    return this.scenarioPathItemRepository.find({
      where: { scenarioPathId },
      order: { order: 'ASC' },
    });
  }

  async getScenarioPathItemById(
    scenarioPathItemId: string,
  ): Promise<ScenarioPathItem | null> {
    return this.scenarioPathItemRepository.findOne({
      where: { id: scenarioPathItemId },
    });
  }

  async getScenarioDataByPathItemId(scenarioPathItemId: string) {
    const scenarioPathItem = await this.scenarioPathItemRepository.findOne({
      where: { id: scenarioPathItemId },
    });
    if (!scenarioPathItem) {
      return null;
    }
    const scenarioData = await this.getScenarioDataById(
      scenarioPathItem.scenarioId,
    );
    if (!scenarioData) {
      return null;
    }
    return { ...scenarioData, pathItem: scenarioPathItem };
  }

  async getScenarioDataById(scenarioId: number) {
    return await this.scenarioSharedService.getScenarioById(scenarioId);
  }

  async getNextPathItemByCurrentItemId(
    scenarioPathItemId: string,
  ): Promise<ScenarioPathItem | null> {
    const scenarioPathItem = await this.scenarioPathItemRepository.findOne({
      where: { id: scenarioPathItemId },
    });
    if (!scenarioPathItem) {
      return null;
    }
    return await this.scenarioPathItemRepository.findOne({
      where: {
        scenarioPathId: scenarioPathItem.scenarioPathId,
        order: scenarioPathItem.order + 1,
      },
    });
  }

  async getNextScenarioDataByPathItemId(scenarioPathItemId: string): Promise<{
    scenario: Scenarios | null;
    pathItem: ScenarioPathItem;
  } | null> {
    const nextScenarioPathItem =
      await this.getNextPathItemByCurrentItemId(scenarioPathItemId);
    if (!nextScenarioPathItem) {
      return null;
    }
    const scenarioData = await this.scenarioSharedService.getScenarioById(
      nextScenarioPathItem.scenarioId,
    );
    return { scenario: scenarioData, pathItem: nextScenarioPathItem };
  }

  async getPathItemById(pathItemId: string): Promise<ScenarioPathItem | null> {
    return this.scenarioPathItemRepository.findOne({
      where: { id: pathItemId },
    });
  }

  async getScenarioSessionById(
    scenarioSessionId: string,
  ): Promise<ScenarioSessions | null> {
    return await this.scenarioSharedService.getScenarioSessionById(
      scenarioSessionId,
    );
  }

  async getScenarioPathItemByScenarioId(scenarioId: number) {
    return this.scenarioPathItemRepository.findOne({ where: { scenarioId } });
  }

  async getScenarioPathSessionById(scenarioPathSessionId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return this.scenarioPathSessionRepository.findOne({
      where: { id: scenarioPathSessionId, userId: Number(userId) },
    });
  }

  async getPermittedPathSessionItemBySessionItemId(
    scenarioPathSessionItemId: string,
  ) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return this.scenarioPathSessionItemRepository.findOne({
      where: {
        id: scenarioPathSessionItemId,
        userId: Number(userId),
        status: In([SessionItemStatus.UNLOCKED, SessionItemStatus.COMPLETED]),
      },
    });
  }

  async getScenarioPathTenant(tenantId: string, scenarioPathId: string) {
    return this.scenarioPathTenantService.getScenarioPathTenant(
      tenantId,
      scenarioPathId,
    );
  }

  async getActiveScenarioPathById(scenarioPathId: string) {
    return this.scenarioPathRepository.findOne({
      where: { id: scenarioPathId, status: ScenarioPathStatus.ACTIVE },
    });
  }
}
