import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
import { ScenarioPathSession } from '../entity/scenario-path-session.entity';
import { ScenarioPathSessionItem } from '../entity/scenario-path-session-item.entity';
import { SCENARIO_MIN_DURATION_FOR_COMPLETION } from '../constants/scenario-path.constant';

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
    const scenarioPaths =
      await this.scenarioPathSharedService.getScenarioPathsWithSession({
        userId: Number(userId),
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

  async updatePathSessionItem(
    scenarioPathSessionItemId: string,
    updatePathSessionItemDto: Partial<ScenarioPathSessionItem>,
  ) {
    return this.scenarioPathSessionItemRepository.update(
      scenarioPathSessionItemId,
      updatePathSessionItemDto,
    );
  }

  async updatePathSession(
    scenarioPathSessionId: string,
    updatePathSessionDto: Partial<ScenarioPathSession>,
  ) {
    return this.scenarioPathSessionRepository.update(
      scenarioPathSessionId,
      updatePathSessionDto,
    );
  }

  async updatePathSessionItemByPathSessionIdAndOrder(
    scenarioPathSessionItemId: string,
    updatePathSessionItemDto: Partial<ScenarioPathSessionItem>,
  ) {
    return this.scenarioPathSessionItemRepository.update(
      scenarioPathSessionItemId,
      updatePathSessionItemDto,
    );
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

  async startUserPathSession(scenarioPathId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const existingScenarioPathSession =
      await this.getUserScenarioPathItems(scenarioPathId);
    if (existingScenarioPathSession.scenarioPathSessionId)
      return {
        ...existingScenarioPathSession,
        currentScenario:
          existingScenarioPathSession?.scenarios?.find(
            (scenario) => scenario.status === SessionItemStatus.UNLOCKED,
          ) ?? null,
      };

    // If no scenario path session created
    const scenarioPathSessionEntityInstance =
      this.scenarioPathSessionRepository.create({
        scenarioPathId,
        userId: Number(userId),
        startedAt: new Date(),
        completedScenarios: 0,
      });
    const scenarioPathSession = await this.scenarioPathSessionRepository.save(
      scenarioPathSessionEntityInstance,
    );

    const scenarioPathItems =
      await this.scenarioPathSharedService.getScenarioPathItems(scenarioPathId);

    let scenarioPathSessionItem: ScenarioPathSessionItem | undefined;
    if (scenarioPathItems && scenarioPathItems?.[0]) {
      //Taking the first element as the list is sorted by order
      const scenarioPathSessionItemEntityInstance =
        this.scenarioPathSessionItemRepository.create({
          scenarioPathSessionId: scenarioPathSession.id,
          scenarioPathItemId: scenarioPathItems[0].id,
          userId: Number(userId),
          status: SessionItemStatus.UNLOCKED,
        });
      scenarioPathSessionItem =
        await this.scenarioPathSessionItemRepository.save(
          scenarioPathSessionItemEntityInstance,
        );
    }
    return {
      ...existingScenarioPathSession,
      scenarioPathSessionId: scenarioPathSession.id,
      completedAt: scenarioPathSession.completedAt,
      completedScenarios: scenarioPathSession.completedScenarios,
      currentScenario: {
        ...scenarioPathSessionItem,
        sessionId: scenarioPathSessionItem?.id,
      },
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
    if (callDurationInSeconds < SCENARIO_MIN_DURATION_FOR_COMPLETION) {
      return;
    }

    const scenarioPathSessionItem =
      await this.scenarioPathSessionItemRepository.findOne({
        where: { id: scenarioPathSessionItemId },
      });
    if (!scenarioPathSessionItem) {
      throw new BadRequestException('Scenario path session item not found');
    }
    const scenarioPathItem =
      await this.scenarioPathSharedService.getScenarioPathItemById(
        scenarioPathSessionItem.scenarioPathItemId,
      );
    if (!scenarioPathItem) {
      throw new BadRequestException('Scenario path item not found');
    }

    // Score less than minimum score -> cant make the session complete
    if (score < (scenarioPathItem?.minimumScore ?? 0)) return;

    const scenarioPathSession =
      await this.scenarioPathSessionRepository.findOne({
        where: { id: scenarioPathSessionItem.scenarioPathSessionId },
      });
    if (!scenarioPathSession) {
      throw new BadRequestException('Scenario path session not found');
    }
    await this.updatePathSessionItem(scenarioPathSessionItem.id, {
      status: SessionItemStatus.COMPLETED,
    });

    const nextScenarioPathItem =
      await this.scenarioPathSharedService.getNextScenarioPathItem(
        scenarioPathSession.id,
      );
    // All sub items are complete
    if (!nextScenarioPathItem) {
      await this.updatePathSession(scenarioPathSession.id, {
        completedAt: new Date(),
        completedScenarios: (scenarioPathSession?.completedScenarios ?? 0) + 1,
      });
    }
    await this.updatePathSession(scenarioPathSession.id, {
      completedScenarios: (scenarioPathSession?.completedScenarios ?? 0) + 1,
    });
    if (!nextScenarioPathItem?.pathSessionItem?.status) {
      // No entry created for next scenario
      const nextItemEntity = this.scenarioPathSessionItemRepository.create({
        scenarioPathSessionId: scenarioPathSession.id,
        scenarioPathItemId: nextScenarioPathItem?.id,
        userId: Number(userId),
        status: SessionItemStatus.UNLOCKED,
      });
      await this.scenarioPathSessionItemRepository.save(nextItemEntity);
      return;
    }
    if (
      nextScenarioPathItem?.pathSessionItem?.status === SessionItemStatus.LOCKED
    ) {
      await this.updatePathSessionItem(
        nextScenarioPathItem?.pathSessionItem?.id,
        {
          status: SessionItemStatus.UNLOCKED,
        },
      );
    }
    return;
  }
}
