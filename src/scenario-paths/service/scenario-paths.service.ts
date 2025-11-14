import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateScenarioPathDto } from '../dto/create-scenario-path.dto';
import { Scenario } from '../type/scenario-path-session-items.type';
import { ScenarioPaths } from '../entity/scenario-paths.entity';
import { ScenarioPathItems } from '../entity/scenario-path-items.entity';
import { ScenarioUtil } from 'src/learn/util/scenario.util';

@Injectable()
export class ScenarioPathsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scenarioUtil: ScenarioUtil,
  ) {}

  async createScenarioPath(createScenarioPathDto: CreateScenarioPathDto) {
    await this.validateScenarios(createScenarioPathDto.scenarios);

    return await this.dataSource.transaction(async (manager) => {
      const scenarioPathRepo = manager.getRepository(ScenarioPaths);
      const scenarioPath = await scenarioPathRepo.save({
        title: createScenarioPathDto.title,
        description: createScenarioPathDto.description,
        coverImageUrl: createScenarioPathDto.coverImageUrl,
        isGlobal: createScenarioPathDto.isGlobal || false,
        status: createScenarioPathDto.status,
        totalScenarios: createScenarioPathDto.scenarios.length,
      });

      const scenarioPathItemRepo = manager.getRepository(ScenarioPathItems);
      const items = createScenarioPathDto.scenarios.map((scenario) =>
        scenarioPathItemRepo.create({
          scenarioPathId: scenarioPath.id,
          scenarioId: scenario.scenarioId,
          order: scenario.order,
          message: scenario.message,
          minimumScore: scenario.minimumScore,
        }),
      );

      await scenarioPathItemRepo.save(items);

      return { success: true };
    });
  }

  private async validateScenarios(scenarios: Scenario[]) {
    const scenarioIds: number[] = [];
    const scenarioOrderSet = new Set<number>();

    for (const scenario of scenarios) {
      scenarioIds.push(scenario.scenarioId);
      if (scenarioOrderSet.has(scenario.order)) {
        throw new BadRequestException('Scenario order values must be unique');
      }
      scenarioOrderSet.add(scenario.order);
    }
    const existingScenarios =
      await this.scenarioUtil.getScenarioByIds(scenarioIds);
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
