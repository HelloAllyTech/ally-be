import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { ScenarioPathSessionRepository } from '../repository/scenario-path-session.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  ScenarioPathSessionFilterOptions,
  SessionItemStatus,
} from '../type/scenario-path-session-items.type';
import { ScenarioPathSortBy } from '../type/scenario-paths.type';
import { ScenarioPathSessionsResponseDto } from '../dto/scenario-path-sessions.dto';
import { ScenarioPathSharedService } from './scenario-path-shared.service';
import { ScenarioPathSessionItemRepository } from '../repository/scenario-path-session-item.repository';
import { ScenarioPathSession } from '../entity/scenario-path-session.entity';
import { ScenarioPathSessionItem } from '../entity/scenario-path-session-item.entity';
import { AppConfigService } from 'src/config/config.service';

@Injectable()
export class ScenarioPathSessionService {
  private readonly logger = LoggerService.getInstance(
    ScenarioPathSessionService.name,
  );
  constructor(
    private readonly scenarioPathSessionRepository: ScenarioPathSessionRepository,
    private readonly scenarioPathSharedService: ScenarioPathSharedService,
    private readonly scenarioPathSessionItemRepository: ScenarioPathSessionItemRepository,
    private readonly dataSource: DataSource,
    private readonly configService: AppConfigService,
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
        sortBy: filters?.sortBy as ScenarioPathSortBy | undefined,
        order: filters?.order,
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
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return this.scenarioPathSessionRepository.findOne({
      where: { scenarioPathId, userId: Number(userId) },
    });
  }

  async getUserScenarioPathItems(scenarioPathId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new NotFoundException('Tenant not found');
    }
    const scenarioPathWithScenarios =
      await this.scenarioPathSharedService.getScenarioPathWithScenarios(
        scenarioPathId,
        tenantId,
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
        scenarioPathSessionId: null,
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
      scenarioPathSessionId: scenarioPathSession.id,
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

  async createUserPathSession(scenarioPathId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const existingScenarioPathSession =
      await this.getScenarioPathSessionByScenarioPathId(scenarioPathId);
    if (existingScenarioPathSession?.id)
      throw new BadRequestException('Scenario path session already exists');

    return await this.dataSource.transaction(
      async (entityManager: EntityManager) => {
        const scenarioPathSessionRepo =
          entityManager.getRepository(ScenarioPathSession);
        const scenarioPathSessionItemRepo = entityManager.getRepository(
          ScenarioPathSessionItem,
        );
        const scenarioPathSessionEntityInstance =
          scenarioPathSessionRepo.create({
            scenarioPathId,
            userId: Number(userId),
            startedAt: new Date(),
            completedScenarios: 0,
          });
        const scenarioPathSession = await scenarioPathSessionRepo.save(
          scenarioPathSessionEntityInstance,
        );
        const scenarioPathItems =
          await this.scenarioPathSharedService.getScenarioPathItems(
            scenarioPathId,
          );
        if (!scenarioPathItems || scenarioPathItems.length === 0) {
          throw new BadRequestException(
            'No sub simulations available for this scenario path',
          );
        }
        //Taking the first element as the list is sorted by order
        const scenarioPathSessionItemEntityInstance =
          scenarioPathSessionItemRepo.create({
            scenarioPathSessionId: scenarioPathSession.id,
            scenarioPathItemId: scenarioPathItems[0].id,
            userId: Number(userId),
            status: SessionItemStatus.UNLOCKED,
          });
        const scenarioPathSessionItem = await scenarioPathSessionItemRepo.save(
          scenarioPathSessionItemEntityInstance,
        );
        return {
          scenarioPathSessionItemId: scenarioPathSessionItem.id,
        };
      },
    );
  }

  async getNextScenarioPathItem(scenarioSessionId: string) {
    const scenarioSessionItem =
      await this.scenarioPathSharedService.getScenarioSessionById(
        scenarioSessionId,
      );
    const scenarioPathSessionItemId =
      scenarioSessionItem?.scenarioPathSessionItemId;
    if (!scenarioPathSessionItemId) {
      return null;
    }
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const currentPathSessionItem =
      await this.scenarioPathSessionItemRepository.findOne({
        where: { id: scenarioPathSessionItemId, userId: Number(userId) },
      });
    if (!currentPathSessionItem) {
      throw new BadRequestException('Scenario path session item not found');
    }
    const nextScenarioData =
      await this.scenarioPathSharedService.getNextScenarioDataByPathItemId(
        currentPathSessionItem?.scenarioPathItemId,
      );
    const nextScenarioSessionItem =
      await this.scenarioPathSessionItemRepository.findOne({
        where: { scenarioPathItemId: nextScenarioData?.pathItem?.id },
      });
    const currentPathItem =
      await this.scenarioPathSharedService.getScenarioPathItemById(
        currentPathSessionItem.scenarioPathItemId,
      );
    if (!nextScenarioSessionItem) {
      return null;
    }

    return {
      nextScenarioSessionItem,
      nextScenarioData,
      currentPathItem,
    };
  }

  async handleEndScenarioPathSession({
    scenarioPathSessionItemId,
    score,
    callDuration = 0,
  }: {
    scenarioPathSessionItemId: string;
    score: number;
    callDuration: number;
  }) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const callDurationInSeconds = (callDuration ?? 0) / 1000;
    const callDurationRequiredForCompletionInSeconds =
      this.configService.simulationPath
        .simulationPathItemMinDurationForCompletion ?? 0;
    if (callDurationInSeconds < callDurationRequiredForCompletionInSeconds) {
      return;
    }

    const currentScenarioPathSessionItem =
      await this.scenarioPathSessionItemRepository.findOne({
        where: { id: scenarioPathSessionItemId },
      });
    if (!currentScenarioPathSessionItem) {
      throw new BadRequestException('Scenario path session item not found');
    }
    const currentScenarioPathItem =
      await this.scenarioPathSharedService.getScenarioPathItemById(
        currentScenarioPathSessionItem.scenarioPathItemId,
      );
    if (!currentScenarioPathItem) {
      throw new BadRequestException('Scenario path item not found');
    }

    // Score less than minimum score -> cant make the session complete
    if (
      currentScenarioPathItem?.minimumScore !== undefined &&
      score < currentScenarioPathItem?.minimumScore
    )
      return;

    const currentScenarioPathSession =
      await this.scenarioPathSessionRepository.findOne({
        where: { id: currentScenarioPathSessionItem.scenarioPathSessionId },
      });
    if (!currentScenarioPathSession) {
      throw new BadRequestException('Scenario path session not found');
    }

    return await this.dataSource.transaction(
      async (entityManager: EntityManager) => {
        const scenarioPathSessionItemRepo = entityManager.getRepository(
          ScenarioPathSessionItem,
        );
        const scenarioPathSessionRepo =
          entityManager.getRepository(ScenarioPathSession);

        await scenarioPathSessionItemRepo.update(
          currentScenarioPathSessionItem.id,
          {
            status: SessionItemStatus.COMPLETED,
          },
        );

        const nextScenarioPathItem =
          await this.scenarioPathSharedService.getNextPathItemByCurrentItemId(
            currentScenarioPathSessionItem.scenarioPathItemId,
          );

        // All sub items are complete
        if (!nextScenarioPathItem) {
          await scenarioPathSessionRepo.update(currentScenarioPathSession.id, {
            completedAt: new Date(),
            completedScenarios:
              (currentScenarioPathSession?.completedScenarios ?? 0) + 1,
          });
          return;
        }
        await scenarioPathSessionRepo.update(currentScenarioPathSession.id, {
          completedScenarios:
            (currentScenarioPathSession?.completedScenarios ?? 0) + 1,
        });
        const nextScenarioPathSessionItem =
          await this.scenarioPathSessionItemRepository.findOne({
            where: { scenarioPathItemId: nextScenarioPathItem?.id },
          });
        if (!nextScenarioPathSessionItem?.id) {
          // No entry created for next scenario
          const nextSessionItemEntity = scenarioPathSessionItemRepo.create({
            scenarioPathSessionId: currentScenarioPathSession.id,
            scenarioPathItemId: nextScenarioPathItem.id,
            userId: Number(userId),
            status: SessionItemStatus.UNLOCKED,
          });
          await scenarioPathSessionItemRepo.save(nextSessionItemEntity);
          return;
        }
        if (
          nextScenarioPathSessionItem?.id &&
          nextScenarioPathSessionItem?.status === SessionItemStatus.LOCKED
        ) {
          await scenarioPathSessionItemRepo.update(
            nextScenarioPathSessionItem.id,
            {
              status: SessionItemStatus.UNLOCKED,
            },
          );
        }
        return;
      },
    );
  }
}
