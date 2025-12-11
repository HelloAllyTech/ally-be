import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScenarioPathSessionRepository } from '../repository/scenario-path-session.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  ScenarioPathSessionFilterOptions,
  SessionItemStatus,
} from '../type/scenario-path-session-items.type';
import {
  ScenarioPathSortBy,
  ScenarioPathStatus,
} from '../type/scenario-paths.type';
import { ScenarioPathSessionsResponseDto } from '../dto/scenario-path-sessions.dto';
import { ScenarioPathSharedService } from './scenario-path-shared.service';
import { ScenarioPathSessionItemRepository } from '../repository/scenario-path-session-item.repository';
import { ScenarioPathSession } from '../entity/scenario-path-session.entity';
import { ScenarioPathSessionItem } from '../entity/scenario-path-session-item.entity';
import { AppConfigService } from 'src/config/config.service';
import { GetUpcomingScenarioPathItemResponseDto } from '../dto/get-scenario-path.dto';
import { LoggerService } from 'src/logger/logger.service';

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
        status: ScenarioPathStatus.ACTIVE,
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

  async getUserScenarioPathSessionByScenarioPathId(scenarioPathId: string) {
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

  async createUserPathSession(scenarioPathId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const existingScenarioPathSession =
      await this.getUserScenarioPathSessionByScenarioPathId(scenarioPathId);
    if (existingScenarioPathSession?.id) {
      this.logger.error(
        `Scenario path session already exists for userId: ${userId} and scenarioPathId: ${scenarioPathId}`,
      );
      throw new BadRequestException('Scenario path session already exists');
    }

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
          this.logger.error(
            `Error: No scenario path items available for userId: ${userId} and scenarioPathId: ${scenarioPathId}`,
          );
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

  async getNextScenarioPathItem(
    scenarioSessionId: string,
  ): Promise<GetUpcomingScenarioPathItemResponseDto | null> {
    const currentScenarioSession =
      await this.scenarioPathSharedService.getScenarioSessionById(
        scenarioSessionId,
      );
    const scenarioPathSessionItemId =
      currentScenarioSession?.scenarioPathSessionItemId;
    if (!scenarioPathSessionItemId) {
      this.logger.info(
        `Scenario path session item not found for scenarioSessionId: ${scenarioSessionId}`,
      );
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
      this.logger.error(
        `Error: Scenario path session item not found for userId: ${userId} and scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
      );
      throw new BadRequestException('Scenario path session item not found');
    }
    const currentPathItem =
      await this.scenarioPathSharedService.getScenarioPathItemById(
        currentPathSessionItem.scenarioPathItemId,
      );
    let currentScenarioData;
    if (currentPathItem?.scenarioId) {
      currentScenarioData =
        await this.scenarioPathSharedService.getScenarioDataById(
          currentPathItem?.scenarioId,
        );
    }
    const currentScenarioPathSession =
      await this.scenarioPathSessionRepository.findOne({
        where: { scenarioPathId: currentPathItem?.scenarioPathId },
      });

    const currentSession = {
      scenarioId: currentScenarioData?.id,
      title: currentScenarioData?.title,
      description: currentScenarioData?.description,
      coverImageUrl: currentScenarioData?.coverImageUrl,
      coverVideoUrl: currentScenarioData?.coverVideoUrl,
      scenarioPathSessionItemStatus: currentPathSessionItem?.status,
      scenarioPathSessionItemId: currentPathSessionItem?.id,
      transitionMessageTitle: currentPathItem?.messageTitle,
      transitionMessageContent: currentPathItem?.messageContent,
      isScenarioPathSessionCompleted: !!currentScenarioPathSession?.completedAt,
      eventStatus: currentScenarioSession?.eventStatus,
    };
    if (
      currentPathSessionItem?.status !== SessionItemStatus.COMPLETED ||
      !!currentScenarioPathSession?.completedAt
    ) {
      return {
        currentSession,
      };
    }

    const nextScenarioData =
      await this.scenarioPathSharedService.getNextScenarioDataByPathItemId(
        currentPathSessionItem?.scenarioPathItemId,
      );
    let nextScenarioSessionItem;
    if (nextScenarioData?.pathItem?.id) {
      nextScenarioSessionItem =
        await this.scenarioPathSessionItemRepository.findOne({
          where: { scenarioPathItemId: nextScenarioData?.pathItem?.id },
        });
    }

    const upcomingScenario = nextScenarioData
      ? {
          id: nextScenarioData?.scenario?.id,
          title: nextScenarioData?.scenario?.title,
          description: nextScenarioData?.scenario?.description,
          coverImageUrl: nextScenarioData?.scenario?.coverImageUrl,
          coverVideoUrl: nextScenarioData?.scenario?.coverVideoUrl,
          scenarioPathSessionItemStatus: nextScenarioSessionItem?.status,
          order: nextScenarioData?.pathItem?.order,
          scenarioPathSessionItemId: nextScenarioSessionItem?.id,
        }
      : undefined;

    return {
      currentSession,
      upcomingScenario,
    };
  }

  async handleEndScenarioPathSession({
    scenarioPathSessionItemId,
    score,
    callDuration = 0,
  }: {
    scenarioPathSessionItemId: string;
    score?: number;
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
      this.logger.info(
        `Call duration ${callDurationInSeconds} is less than required ${callDurationRequiredForCompletionInSeconds} for scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
      );
      return;
    }

    const currentScenarioPathSessionItem =
      await this.scenarioPathSessionItemRepository.findOne({
        where: { id: scenarioPathSessionItemId },
      });
    if (!currentScenarioPathSessionItem) {
      this.logger.error(
        `Scenario path session item not found for scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
      );
      throw new BadRequestException('Scenario path session item not found');
    }

    if (currentScenarioPathSessionItem.status === SessionItemStatus.COMPLETED) {
      this.logger.info(
        `Scenario path session item already completed for scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
      );
      return;
    }

    const currentScenarioPathItem =
      await this.scenarioPathSharedService.getScenarioPathItemById(
        currentScenarioPathSessionItem.scenarioPathItemId,
      );
    if (!currentScenarioPathItem) {
      this.logger.error(
        `Error: Scenario path item not found for scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
      );
      throw new BadRequestException('Scenario path item not found');
    }

    // Score less than minimum score -> cant make the session complete
    if (
      currentScenarioPathItem?.minimumScore !== undefined &&
      (score ?? 0) < currentScenarioPathItem?.minimumScore
    ) {
      this.logger.info(
        `Score ${score} is less than minimum score ${currentScenarioPathItem?.minimumScore} for scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
      );
      return;
    }

    const currentScenarioPathSession =
      await this.scenarioPathSessionRepository.findOne({
        where: { id: currentScenarioPathSessionItem.scenarioPathSessionId },
      });
    if (!currentScenarioPathSession) {
      this.logger.error(
        `Error: Scenario path session not found for scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
      );
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
          this.logger.info(
            `All scenario path items are complete for scenarioPathSessionId: ${currentScenarioPathSession.id}`,
          );
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
          this.logger.info(
            `Unlocked next scenario path item for scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
          );
          return;
        }
        if (
          nextScenarioPathSessionItem?.id &&
          nextScenarioPathSessionItem?.status === SessionItemStatus.LOCKED
        ) {
          this.logger.info(
            `Next scenario path item is locked for scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
          );
          await scenarioPathSessionItemRepo.update(
            nextScenarioPathSessionItem.id,
            {
              status: SessionItemStatus.UNLOCKED,
            },
          );
          this.logger.info(
            `Unlocked next scenario path item for scenarioPathSessionItemId: ${scenarioPathSessionItemId}`,
          );
        }
        return;
      },
    );
  }
}
