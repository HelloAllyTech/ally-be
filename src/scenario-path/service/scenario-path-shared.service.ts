import { Injectable, NotFoundException } from '@nestjs/common';
import { ScenarioPathRepository } from '../repository/scenario-path.repository';
import {
  ScenarioPathsWithSession,
  ScenarioPathWithSessionFilterOptions,
} from '../type/scenario-paths.type';
import { ScenarioPathItemRepository } from '../repository/scenario-path-item.repository';
import { ScenarioPathItem } from '../entity/scenario-path-item.entity';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { GetScenarioPathResponseDto } from '../dto/get-scenario-path.dto';
import { SessionItemStatus } from '../type/scenario-path-session-items.type';
import { ScenarioPathSessionItem } from '../entity/scenario-path-session-item.entity';

@Injectable()
export class ScenarioPathSharedService {
  private readonly logger = LoggerService.getInstance(
    ScenarioPathSharedService.name,
  );
  constructor(
    private readonly scenarioPathRepository: ScenarioPathRepository,
    private readonly scenarioPathItemRepository: ScenarioPathItemRepository,
    private readonly scenarioSharedService: ScenarioSharedService,
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
  ): Promise<GetScenarioPathResponseDto> {
    const result = await this.scenarioPathRepository.findOne({
      where: { id: scenarioPathId },
    });
    if (!result) {
      this.logger.error(`Scenario path not found for id: ${scenarioPathId}`);
      throw new NotFoundException('Scenario path not found');
    }

    const scenarioPathItems = await this.scenarioPathItemRepository.find({
      where: { scenarioPathId },
    });

    const scenarioIds = scenarioPathItems.map((item) => item.scenarioId);

    const scenariosData =
      await this.scenarioSharedService.getScenarioByIds(scenarioIds);
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
        minimumScore: item.minimumScore ?? 0,
        title: scenarioData?.title,
        description: scenarioData?.description,
        coverImageUrl: scenarioData?.coverImageUrl,
        coverVideoUrl: scenarioData?.coverVideoUrl,
      };
    });

    return {
      id: result.id,
      title: result.title,
      description: result.description,
      coverImageUrl: result.coverImageUrl,
      status: result.status,
      isGlobal: result.isGlobal,
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

  async getNextScenarioPathItem(scenarioPathSessionId: string): Promise<
    | (ScenarioPathItem & {
        pathSessionItem: ScenarioPathSessionItem | null;
      })
    | null
  > {
    const result = await this.scenarioPathItemRepository
      .createQueryBuilder('scenarioPathItem')
      .leftJoinAndMapOne(
        'scenarioPathItem.pathSessionItem',
        'scenario_path_session_items',
        'pathSessionItem',
        'pathSessionItem.scenarioPathItemId = scenarioPathItem.id AND pathSessionItem.scenarioPathSessionId = :scenarioPathSessionId',
        { scenarioPathSessionId },
      )
      .where(
        '(pathSessionItem.status != :status OR pathSessionItem.status IS NULL)',
        {
          status: SessionItemStatus.COMPLETED,
        },
      )
      .orderBy('scenarioPathItem.order', 'ASC')
      .getOne();

    if (!result) {
      return null;
    }

    return result as ScenarioPathItem & {
      pathSessionItem: ScenarioPathSessionItem | null;
    };
  }
}
