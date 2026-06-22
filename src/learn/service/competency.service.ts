import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompetencyRepository } from '../repository/competency.repository';
import {
  CreateCompetencyDto,
  CreateCompetencyResponseDto,
  UpdateCompetencyDto,
} from '../dto/competency.dto';
import {
  GetCompetenciesResponseDto,
  CompetencyResponseDto,
} from '../dto/competency.dto';
import { Pagination } from 'src/common/type/common.type';
import { Competency } from '../entity/competency.entity';
import { CompetencyBehaviorRepository } from '../repository/competency-behavior.repository';
import {
  CompetencyBehavioursResponseDto,
  SetCompetencyBehavioursDto,
} from '../dto/competency-behavior.dto';
import { CompetencyBehaviorType } from '../enum/competency-behavior.enum';
import { BehaviorRepository } from '../repository/behavior.repository';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS } from '../constants/competency-behavior-instruction-templates.constants';

// Postgres unique-violation SQLSTATE. TypeORM surfaces it on the thrown error
// directly and/or on the wrapped driver error.
const PG_UNIQUE_VIOLATION = '23505';
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return (
    e?.code === PG_UNIQUE_VIOLATION ||
    e?.driverError?.code === PG_UNIQUE_VIOLATION
  );
}

@Injectable()
export class CompetencyService {
  constructor(
    private readonly competencyRepository: CompetencyRepository,
    private readonly competencyBehaviorRepository: CompetencyBehaviorRepository,
    private readonly behaviorRepository: BehaviorRepository,
  ) {}

  async createCompetency(
    createCompetencyDto: CreateCompetencyDto,
    createdBy?: number,
  ): Promise<CreateCompetencyResponseDto> {
    const isCustom = createCompetencyDto.isCustom ?? false;

    // Custom competencies are owned by their creator and get a server-generated
    // name so the index sequence (and the "{userId}_" prefix the client strips
    // for display) can't be spoofed.
    if (isCustom) {
      if (createdBy == null) {
        throw new ForbiddenException(
          'A custom competency requires an authenticated owner',
        );
      }
      return this.createCustomCompetency(createdBy);
    }

    const competency = this.competencyRepository.create({
      name: createCompetencyDto.name,
      isCustom,
      createdBy,
    });
    const saved = await this.competencyRepository.save(competency);
    return {
      id: saved.id,
      name: saved.name,
      isCustom: saved.isCustom,
    };
  }

  // The auto-name (`{userId}_custom_{N}`) is derived from a read-then-increment,
  // so two concurrent creates can race on the same N. A partial unique index on
  // (createdBy, name) WHERE isCustom turns that race into a unique violation
  // rather than a silent duplicate; retry a few times, recomputing the index,
  // before giving up.
  private async createCustomCompetency(
    createdBy: number,
  ): Promise<CreateCompetencyResponseDto> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const nextIndex =
        (await this.competencyRepository.getMaxCustomIndexForUser(createdBy)) +
        1;
      const name = `${createdBy}_custom_${nextIndex}`;
      try {
        const saved = await this.competencyRepository.save(
          this.competencyRepository.create({
            name,
            isCustom: true,
            createdBy,
          }),
        );
        return {
          id: saved.id,
          name: saved.name,
          isCustom: saved.isCustom,
        };
      } catch (error) {
        if (isUniqueViolation(error) && attempt < MAX_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
    // Unreachable: the loop either returns or throws on the final attempt.
    throw new Error('Failed to allocate a custom competency name');
  }

  async getCompetencies(
    name?: string,
    options?: Pagination,
    scope?: { includeOwnCustom?: boolean; userId?: number },
  ): Promise<GetCompetenciesResponseDto> {
    const { data, count } = await this.competencyRepository.getCompetencies(
      name,
      options,
      scope,
    );
    return {
      data: data.map((c) => this.mapToResponseDto(c)),
      count,
    };
  }

  async getCompetency(id: string): Promise<CompetencyResponseDto> {
    const competency = await this.competencyRepository.getCompetencyById(id);
    if (!competency) {
      throw new NotFoundException(`Competency with id ${id} not found`);
    }
    return this.mapToResponseDto(competency);
  }

  async updateCompetency(
    id: string,
    updateCompetencyDto: UpdateCompetencyDto,
    userId?: number,
  ): Promise<CompetencyResponseDto> {
    const competency = await this.competencyRepository.getCompetencyById(id);
    if (!competency) {
      throw new NotFoundException(`Competency with id ${id} not found`);
    }
    this.assertCanManage(competency, userId);
    competency.name = updateCompetencyDto.name;
    const saved = await this.competencyRepository.save(competency);
    return this.mapToResponseDto(saved);
  }

  async deleteCompetency(id: string, userId?: number): Promise<void> {
    const competency = await this.competencyRepository.getCompetencyById(id);
    if (!competency) {
      throw new NotFoundException(`Competency with id ${id} not found`);
    }
    this.assertCanManage(competency, userId);
    await this.competencyRepository.delete(id);
  }

  // A custom competency may only be renamed/deleted by its owner. Global
  // competencies remain managed by anyone with the EDIT_SCENARIO permission.
  private assertCanManage(competency: Competency, userId?: number): void {
    if (competency.isCustom && competency.createdBy !== userId) {
      throw new ForbiddenException(
        'You can only modify your own custom competencies',
      );
    }
  }

  async getCompetencyBehaviours(
    id: string,
  ): Promise<CompetencyBehavioursResponseDto> {
    const competency = await this.competencyRepository.getCompetencyById(id);
    if (!competency) {
      throw new NotFoundException(`Competency with id ${id} not found`);
    }

    let rows =
      await this.competencyBehaviorRepository.getBehavioursForCompetency(id);

    // No mappings yet → seed from the internal predefined-behaviours doc
    // (COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS) keyed by competency name, so
    // the defaults are persisted and available to the simulation auto-populate.
    // This runs on a GET (incl. the per-row list page), so it must be safe under
    // concurrency: the insert ignores conflicts and the whole seed is guarded —
    // a lost race just falls through to re-read whatever is now persisted.
    if (rows.length === 0) {
      const defaults = this.getPresetDefaults(competency.name);
      if (defaults.helpful.length || defaults.unhelpful.length) {
        try {
          const items = await this.buildBehaviourItems(
            defaults.helpful,
            defaults.unhelpful,
          );
          await this.competencyBehaviorRepository.addBehavioursIgnoreConflicts(
            id,
            items,
          );
        } catch {
          // Non-fatal: concurrent seed / transient error → read back below.
        }
        rows =
          await this.competencyBehaviorRepository.getBehavioursForCompetency(
            id,
          );
      }
    }

    return this.splitRows(rows);
  }

  async setCompetencyBehaviours(
    id: string,
    dto: SetCompetencyBehavioursDto,
  ): Promise<CompetencyBehavioursResponseDto> {
    await this.validateCompetencyId(id);
    await this.persistBehaviours(id, dto.helpful ?? [], dto.unhelpful ?? []);
    // Read back directly (not via getCompetencyBehaviours) so an intentionally
    // emptied competency isn't re-seeded with preset defaults.
    const rows =
      await this.competencyBehaviorRepository.getBehavioursForCompetency(id);
    return this.splitRows(rows);
  }

  private splitRows(
    rows: { id: string; name: string; type: CompetencyBehaviorType }[],
  ): CompetencyBehavioursResponseDto {
    return {
      helpful: rows
        .filter((r) => r.type === CompetencyBehaviorType.HELPFUL)
        .map((r) => ({ id: r.id, name: r.name })),
      unhelpful: rows
        .filter((r) => r.type === CompetencyBehaviorType.UNHELPFUL)
        .map((r) => ({ id: r.id, name: r.name })),
    };
  }

  private getPresetDefaults(competencyName: string): {
    helpful: string[];
    unhelpful: string[];
  } {
    const preset = COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS[competencyName];
    if (!preset) return { helpful: [], unhelpful: [] };
    return {
      helpful: preset
        .filter((p) => p.category === BehaviorInstructionCategory.SHOULD_DO)
        .map((p) => p.behaviorName),
      unhelpful: preset
        .filter((p) => p.category === BehaviorInstructionCategory.SHOULD_NOT_DO)
        .map((p) => p.behaviorName),
    };
  }

  // Resolves free-text behaviour names to behaviour-library ids (creating any
  // that don't exist) and replaces the competency's full mapping set.
  private async persistBehaviours(
    competencyId: string,
    helpfulNames: string[],
    unhelpfulNames: string[],
  ): Promise<void> {
    const items = await this.buildBehaviourItems(helpfulNames, unhelpfulNames);
    await this.competencyBehaviorRepository.replaceForCompetency(
      competencyId,
      items,
    );
  }

  // Builds the (behaviorId, type) mapping rows for a competency. A single
  // behaviour may map at most once per competency — the join table's unique key
  // is (competencyId, behaviorId). So the resolved ids are de-duplicated, and a
  // behaviour listed in BOTH helpful and unhelpful is kept as helpful only (it
  // can't be both), preventing a unique-constraint violation on save.
  private async buildBehaviourItems(
    helpfulNames: string[],
    unhelpfulNames: string[],
  ): Promise<{ behaviorId: string; type: CompetencyBehaviorType }[]> {
    const helpfulIds = await this.resolveBehaviourIds(helpfulNames);
    const helpfulSet = new Set(helpfulIds);
    const unhelpfulIds = (
      await this.resolveBehaviourIds(unhelpfulNames)
    ).filter((id) => !helpfulSet.has(id));
    return [
      ...helpfulIds.map((behaviorId) => ({
        behaviorId,
        type: CompetencyBehaviorType.HELPFUL,
      })),
      ...unhelpfulIds.map((behaviorId) => ({
        behaviorId,
        type: CompetencyBehaviorType.UNHELPFUL,
      })),
    ];
  }

  private async resolveBehaviourIds(names: string[]): Promise<string[]> {
    const cleaned = [
      ...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0)),
    ];
    if (cleaned.length === 0) return [];

    const existing = await this.behaviorRepository.getBehaviorsByNames(cleaned);
    const byLowerName = new Map(existing.map((b) => [b.name.toLowerCase(), b]));

    const toCreate = cleaned.filter((n) => !byLowerName.has(n.toLowerCase()));
    if (toCreate.length > 0) {
      const created = await this.behaviorRepository.save(
        toCreate.map((name) => this.behaviorRepository.create({ name })),
      );
      created.forEach((b) => byLowerName.set(b.name.toLowerCase(), b));
    }

    // De-duplicate by id: distinct input strings can map to the same behaviour
    // (e.g. "Empathy" / "empathy"), and the same id must not appear twice.
    return [
      ...new Set(cleaned.map((n) => byLowerName.get(n.toLowerCase())!.id)),
    ];
  }

  async validateCompetencyId(id: string): Promise<void> {
    const competency = await this.competencyRepository.getCompetencyById(id);
    if (!competency) {
      throw new NotFoundException(`Competency with id ${id} not found`);
    }
  }

  private mapToResponseDto(competency: Competency): CompetencyResponseDto {
    return {
      id: competency.id,
      name: competency.name,
      isCustom: competency.isCustom,
    };
  }
}
