import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioPathSessionRepository } from '../repository/scenario-path-session.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  ScenarioPathSessionFilterOptions,
  SessionItemStatus,
} from '../type/scenario-path-session-items.type';
import { ScenarioPathSessionsResponseDto } from '../dto/scenario-path-sessions.dto';
import { ScenarioPathSharedService } from './scenario-path-shared.service';
import { ScenarioPathSessionItemRepository } from '../repository/scenario-path-session-item.repository';

@Injectable()
export class ScenarioPathSessionService {
  private readonly logger = LoggerService.getInstance(
    ScenarioPathSessionService.name,
  );
  constructor(
    private readonly scenarioPathSessionRepository: ScenarioPathSessionRepository,
    private readonly scenarioPathSharedService: ScenarioPathSharedService,
    private readonly scenarioPathSessionItemRepository: ScenarioPathSessionItemRepository,
  ) {}

  async getUserScenarioPaths(
    filters?: ScenarioPathSessionFilterOptions,
  ): Promise<ScenarioPathSessionsResponseDto> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const scenarioPaths =
      await this.scenarioPathSharedService.getScenarioPathsWithSession({
        userId: Number(userId),
        tenantId,
        limit: filters?.limit,
        offset: filters?.offset,
      });

    const { data, count } = scenarioPaths;

    const formattedData = data.map((scenarioPath) => ({
      id: scenarioPath.id,
      title: scenarioPath.title,
      description: scenarioPath.description,
      coverImageUrl: scenarioPath.coverImageUrl,
      totalScenarios: scenarioPath.totalScenarios,
      completedScenarios: scenarioPath.session?.completedScenarios,
    }));

    return {
      data: formattedData,
      count,
    };
  }

  async getScenarioPathSessionByScenarioPathId(scenarioPathId: string) {
    return this.scenarioPathSessionRepository.findOne({
      where: { scenarioPathId },
    });
  }

  async getUserScenarioPathItems(scenarioPathId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }

    const scenarioPathWithScenarios =
      await this.scenarioPathSharedService.getScenarioPathWithScenarios(
        scenarioPathId,
      );

    const scenarioPathSession =
      await this.scenarioPathSessionRepository.findOne({
        where: { scenarioPathId, userId: Number(userId) },
      });

    if (!scenarioPathSession) {
      return {
        ...scenarioPathWithScenarios,
        completedScenarios: 0,
        completedAt: null,
        scenarios: scenarioPathWithScenarios.scenarios.map((scenario) => ({
          ...scenario,
          sessionId: null,
          status:
            scenario.order > 1
              ? SessionItemStatus.LOCKED
              : SessionItemStatus.UNLOCKED,
        })),
      };
    }

    const scenarioPathSessionItems =
      await this.scenarioPathSessionItemRepository.find({
        where: { scenarioPathSessionId: scenarioPathSession.id },
      });

    const sessionItemsMap = new Map(
      scenarioPathSessionItems.map((item) => [item.scenarioPathItemId, item]),
    );

    return {
      ...scenarioPathWithScenarios,
      completedScenarios: scenarioPathSession.completedScenarios,
      completedAt: scenarioPathSession.completedAt,
      scenarios: scenarioPathWithScenarios.scenarios.map((scenario) => {
        const scenarioPathSessionItem = sessionItemsMap.get(scenario.id);
        return {
          ...scenario,
          sessionId: scenarioPathSessionItem?.id,
          status: scenarioPathSessionItem?.status || SessionItemStatus.LOCKED,
        };
      }),
    };
  }
}
