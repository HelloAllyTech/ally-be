import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { ScenarioCharacter } from '../entity/scenario-character.entity';
import { ScenarioCharacterRepository } from '../repository/scenario-character.repository';
import {
  ScenarioCharacterGetOptions,
  ScenarioCharacterWithOwner,
} from '../type/scenario-character.type';
import { CharacterLibraryAccessService } from './character-library-access.service';
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
    private readonly accessService: CharacterLibraryAccessService,
  ) {}

  async getScenarioCharacters(
    options: ScenarioCharacterGetOptions = {},
  ): Promise<{
    characters: ScenarioCharacterWithOwner[];
    count: number;
  }> {
    const {
      search,
      limit = 15,
      offset = 0,
      sortBy = ScenarioCharacterSortBy.CREATED_AT,
      sortOrder = ScenarioCharacterSortOrder.DESC,
    } = options;

    const scope = await this.accessService.resolveScope();

    const { characters, count } =
      await this.scenarioCharacterRepository.getScenarioCharactersQuery({
        search,
        limit: Number(limit),
        offset: Number(offset),
        sortBy,
        sortOrder,
        tenantId: scope.tenantId,
      });

    if (!scope.isPlatform) {
      return { characters, count };
    }

    return {
      characters: await this.withOwnerAttribution(characters),
      count,
    };
  }

  /**
   * Adds creator name and owning-org name to a page of characters. Platform
   * admins only — it answers "who made this", which is meaningless in a view
   * that already shows one org's rows and nothing else.
   */
  private async withOwnerAttribution(
    characters: ScenarioCharacter[],
  ): Promise<ScenarioCharacterWithOwner[]> {
    if (!characters.length) return characters;

    const userIds = [...new Set(characters.map((c) => c.createdBy))];
    const tenantIds = [
      ...new Set(
        characters
          .map((c) => c.tenantId)
          .filter((t): t is string => Boolean(t)),
      ),
    ];

    const { usersById, tenantNamesById } =
      await this.scenarioCharacterRepository.getCreatorAttribution(
        userIds,
        tenantIds,
      );

    return characters.map((character) => ({
      ...character,
      createdByName: usersById.get(character.createdBy),
      tenantName: character.tenantId
        ? (tenantNamesById.get(character.tenantId) ?? character.tenantId)
        : undefined,
    }));
  }

  async createScenarioCharacter(
    dto: ScenarioCharacterRequestDto,
  ): Promise<ScenarioCharacter> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException();
    }

    // A tenant admin's character is stamped with their tenant and is only ever
    // visible inside it. A platform admin's stays NULL — Ally-owned/global.
    const scope = await this.accessService.resolveScope();

    const scenarioCharacter = this.scenarioCharacterRepository.create({
      ...dto,
      tenantId: scope.tenantId,
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

    await this.assertInScope(scenarioCharacter);

    return scenarioCharacter;
  }

  /**
   * Fail a tenant-scoped caller who names a character outside their tenant —
   * an Ally-owned one or another org's. Guessing an id must not be a way past
   * the list filter, so this runs on every single-character path.
   */
  private async assertInScope(character: ScenarioCharacter): Promise<void> {
    const scope = await this.accessService.resolveScope();
    if (scope.isPlatform) return;
    if (character.tenantId !== scope.tenantId) {
      throw new ForbiddenException(
        'This character belongs to another organisation',
      );
    }
  }

  async updateScenarioCharacter(
    id: string,
    dto: ScenarioCharacterRequestDto,
  ): Promise<ScenarioCharacter> {
    // Re-reads first so a cross-tenant id 403s before anything is written. The
    // route also requires EDIT_SCENARIO_CHARACTER, which tenant admins do not
    // hold — this is the second lock on the same door.
    await this.getScenarioCharacterById(id);

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

    const scope = await this.accessService.resolveScope();

    const result = await this.scenarioCharacterRepository.delete({
      id: In(scenarioCharacterIds),
      // Bulk delete narrows on tenant too, so a tenant-scoped caller can never
      // sweep up global or another org's rows by id.
      ...(scope.isPlatform ? {} : { tenantId: scope.tenantId as string }),
    });
    this.logger.info(
      `Scenario characters deleted: ${result.affected ?? 0} of ${scenarioCharacterIds.length} requested`,
    );
    return (result.affected ?? 0) > 0;
  }
}
