import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { ScenarioCharacter } from '../entity/scenario-character.entity';
import { ScenarioCharacterRepository } from '../repository/scenario-character.repository';
import { ScenarioCharacterGetOptions } from '../type/scenario-character.type';
import { ScenarioCharacterSortBy } from '../enum/scenario-character.enum';
import { ScenarioCharacterSortOrder } from '../enum/scenario-character.enum';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioCharacterRequestDto } from '../dto/scenario-character.dto';
import { ExecutionManager } from 'src/common/execution/execution-manager';

@Injectable()
export class ScenarioCharacterService {
  private readonly logger = LoggerService.getInstance(
    ScenarioCharacterService.name,
  );

  constructor(
    private readonly scenarioCharacterRepository: ScenarioCharacterRepository,
  ) {}

  async getScenarioCharacters(
    options: ScenarioCharacterGetOptions = {},
  ): Promise<{
    characters: ScenarioCharacter[];
    count: number;
  }> {
    const {
      search,
      limit = 15,
      offset = 0,
      sortBy = ScenarioCharacterSortBy.CREATED_AT,
      sortOrder = ScenarioCharacterSortOrder.DESC,
    } = options;

    return this.scenarioCharacterRepository.getScenarioCharactersQuery({
      search,
      limit: Number(limit),
      offset: Number(offset),
      sortBy,
      sortOrder,
    });
  }

  async createScenarioCharacter(
    dto: ScenarioCharacterRequestDto,
  ): Promise<ScenarioCharacter> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException();
    }

    const scenarioCharacter = this.scenarioCharacterRepository.create({
      ...dto,
      createdBy: Number(userId),
      updatedBy: Number(userId),
    });

    return await this.scenarioCharacterRepository.save(scenarioCharacter);
  }

  async getScenarioCharacterById(id: string): Promise<ScenarioCharacter> {
    const scenarioCharacter = await this.scenarioCharacterRepository.findOne({
      where: { id },
    });

    if (!scenarioCharacter) {
      this.logger.error(`Scenario character with ID ${id} not found`);
      throw new NotFoundException(`Scenario character with ID ${id} not found`);
    }

    return scenarioCharacter;
  }

  async updateScenarioCharacter(
    id: string,
    dto: ScenarioCharacterRequestDto,
  ): Promise<ScenarioCharacter> {
    await this.scenarioCharacterRepository.update(id, {
      ...dto,
      updatedAt: new Date(),
    });

    const scenarioCharacter = await this.getScenarioCharacterById(id);
    this.logger.info(`Scenario character updated: ${id}`);
    return scenarioCharacter!;
  }

  async deleteScenarioCharacter(id: string): Promise<{ success: boolean }> {
    await this.getScenarioCharacterById(id);
    await this.scenarioCharacterRepository.delete(id);
    this.logger.info(`Scenario character deleted: ${id}`);
    return { success: true };
  }

  async deleteScenarioCharacters(
    scenarioCharacterIds: string[],
  ): Promise<boolean> {
    if (scenarioCharacterIds.length === 0) {
      throw new BadRequestException(
        'At least one scenario character ID is required',
      );
    }

    const result = await this.scenarioCharacterRepository.delete({
      id: In(scenarioCharacterIds),
    });
    this.logger.info(
      `Scenario characters deleted: ${result.affected ?? 0} of ${scenarioCharacterIds.length} requested`,
    );
    return (result.affected ?? 0) > 0;
  }
}
