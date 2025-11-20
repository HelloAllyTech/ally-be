import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioPathSessionRepository } from '../repository/scenario-path-session.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioPathSessionFilterOptions } from '../type/scenario-path-session-items.type';
import { ScenarioPathSessionsResponseDto } from '../dto/scenario-path-sessions.dto';
import { ScenarioPathSharedService } from './scenario-path-shared.service';

@Injectable()
export class ScenarioPathSessionService {
  private readonly logger = LoggerService.getInstance(
    ScenarioPathSessionService.name,
  );
  constructor(
    private readonly scenarioPathSessionRepository: ScenarioPathSessionRepository,
    private readonly scenarioPathSharedService: ScenarioPathSharedService,
  ) {}

  async getScenarioPathSessions(
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
}
