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

  async getUserScenarioPathSessionItemsIfExist(scenarioPathId: string) {
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
      return null;
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

  async createUserPathSession(scenarioPathId: string) {
    const scenarioPathWithScenarios =
      await this.scenarioPathSharedService.getScenarioPathWithScenarios(
        scenarioPathId,
      );

    const userSessionEntityInstance = this.scenarioPathSessionRepository.create(
      {
        scenarioPathId,
        userId: Number(ExecutionManager.getUserId()),
        startedAt: new Date(),
        completedScenarios: 0,
      },
    );
    const userSession = await this.scenarioPathSessionRepository.save(
      userSessionEntityInstance,
    );
    const scenarioPathItems =
      await this.scenarioPathSharedService.getScenarioPathItems(scenarioPathId);
    const scenarioPathItemsEntityInstances = scenarioPathItems.map((item) =>
      this.scenarioPathSessionItemRepository.create({
        scenarioPathSessionId: userSession.id,
        scenarioPathItemId: item.id,
        userId: Number(ExecutionManager.getUserId()),
        status:
          item?.order > 1
            ? SessionItemStatus.LOCKED
            : SessionItemStatus.UNLOCKED,
      }),
    );
    const savedScenarioPathSessionItems =
      await this.scenarioPathSessionItemRepository.save(
        scenarioPathItemsEntityInstances,
      );

    const sessionItemsMap = new Map(
      savedScenarioPathSessionItems.map((item) => [
        item.scenarioPathItemId,
        item,
      ]),
    );

    return {
      ...scenarioPathWithScenarios,
      completedScenarios: userSession.completedScenarios,
      completedAt: userSession.completedAt,
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

  async getNextUnlockedScenarioPathItem(scenarioPathSessionId: string) {
    return this.scenarioPathSessionItemRepository
      .createQueryBuilder('sessionItem')
      .innerJoin(
        'scenario_path_items',
        'pathItem',
        'pathItem.id = sessionItem.scenarioPathItemId',
      )
      .where('sessionItem.scenarioPathSessionId = :scenarioPathSessionId', {
        scenarioPathSessionId,
      })
      .andWhere('sessionItem.status = :status', {
        status: SessionItemStatus.UNLOCKED,
      })
      .orderBy('pathItem.order', 'ASC')
      .getOne();
  }

  async getUserPathSessionById(scenarioPathSessionId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return this.scenarioPathSessionRepository.findOne({
      where: { id: scenarioPathSessionId, userId: Number(userId) },
    });
  }

  async startUserPathSession(scenarioPathId: string, scenarioId: number) {
    let currentUserSession =
      await this.getUserScenarioPathSessionItemsIfExist(scenarioPathId);
    if (!currentUserSession) {
      currentUserSession = await this.createUserPathSession(scenarioPathId);
    }
    // get the current scenario path session item from scenarioId and currentUserSession.scenarioPathSessionId
    const currentScenarioPathSessionItem = currentUserSession.scenarios.find(
      (scenario) => scenario.scenarioId === scenarioId,
    );
    if (currentScenarioPathSessionItem?.status === SessionItemStatus.LOCKED) {
      throw new BadRequestException(
        'The scenario is LOCKED. Please complete the previous scenario first.',
      );
    }
    return {
      scenarioPathSessionId: currentUserSession.id,
      scenarioPathSessionItemId: currentScenarioPathSessionItem?.id,
      scenarioPathId: scenarioPathId,
      scenarioId: scenarioId,
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
    if (score >= (scenarioPathItem?.minimumScore ?? 0)) {
      const scenarioPathSession =
        await this.scenarioPathSessionRepository.findOne({
          where: { id: scenarioPathSessionItem.scenarioPathSessionId },
        });
      if (!scenarioPathSession) {
        throw new BadRequestException('Scenario path session not found');
      }
      const currentScenarioPathSession = await this.getUserPathSessionById(
        scenarioPathSession.id,
      );
      await this.updatePathSessionItem(scenarioPathSessionItem.id, {
        status: SessionItemStatus.COMPLETED,
      });

      const nextScenarioPathItem = await this.getNextUnlockedScenarioPathItem(
        scenarioPathSession.id,
      );
      if (nextScenarioPathItem) {
        await this.updatePathSessionItem(nextScenarioPathItem.id, {
          status: SessionItemStatus.UNLOCKED,
        });
        await this.updatePathSession(scenarioPathSession.id, {
          completedScenarios:
            (currentScenarioPathSession?.completedScenarios ?? 0) + 1,
        });
      } else {
        await this.updatePathSession(scenarioPathSession.id, {
          completedAt: new Date(),
          completedScenarios:
            (currentScenarioPathSession?.completedScenarios ?? 0) + 1,
        });
      }
    }
  }
}
