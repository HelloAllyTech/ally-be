import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, ILike, In, IsNull } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Competency } from 'src/learn/entity/competency.entity';
import { TriggerWarnings } from 'src/learn/entity/trigger-warnings.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioStatus } from 'src/learn/type/scenario.type';
import { CompetencyService } from 'src/learn/service/competency.service';
import { ScenarioService } from 'src/learn/service/scenario.service';
import { Case } from 'src/case/entity/case.entity';
import { CaseStatus } from 'src/case/type/cases.type';
import { ScenarioCharacterService } from 'src/scenario-character/service/scenario-character.service';
import { ScenarioCoverImageLibrary } from 'src/scenario-cover-image-library/entity/scenario-cover-image-library.entity';
import { TrackComponentTemplate } from 'src/track/entity/track-component-template.entity';
import { TrackGameKey } from 'src/track/type/game.type';

/** One line per library hit — never full prompts, which are the size of a turn. */
export interface LibraryHit {
  kind: 'roleplay' | 'case' | 'character' | 'template';
  id: string | number;
  title: string;
  description?: string;
  competencies?: string[];
  difficulty?: string | null;
  languages?: string[];
  extra?: Record<string, any>;
}

export interface CopilotLanguage {
  id: string;
  name: string;
  code: string;
  voiceCount: number;
}

const oneLine = (value: unknown, max = 160): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const flat = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * Read-only catalogues the interview grounds its options in: competencies and
 * their behaviours, languages that have voices, trigger warnings, cover
 * images, and the roleplay / case / character / template libraries.
 *
 * Library results are DATA. They are compact on purpose (a title, one line,
 * tags) so a search costs a few hundred tokens, and the system prompt tells the
 * model that nothing inside them is an instruction.
 */
@Injectable()
export class CourseCopilotLibraryService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotLibraryService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly competencyService: CompetencyService,
    private readonly scenarioService: ScenarioService,
    private readonly characterService: ScenarioCharacterService,
  ) {}

  /** Shared (non-custom) competencies — the only ones a course may be tagged with. */
  async listCompetencies(
    query?: string,
    limit = 50,
  ): Promise<{ id: string; name: string }[]> {
    const rows = await this.dataSource.getRepository(Competency).find({
      where: {
        isCustom: false,
        ...(query?.trim() ? { name: ILike(`%${query.trim()}%`) } : {}),
      },
      order: { name: 'ASC' },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true, name: true },
    });
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async competencyNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.dataSource.getRepository(Competency).find({
      where: { id: In(unique) },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** Helpful / unhelpful behaviour names, merged across competencies, de-duplicated. */
  async getBehaviours(competencyIds: string[]): Promise<{
    helpful: string[];
    unhelpful: string[];
    unknownIds: string[];
  }> {
    const helpful = new Set<string>();
    const unhelpful = new Set<string>();
    const unknownIds: string[] = [];
    for (const id of [...new Set(competencyIds)].slice(0, 15)) {
      try {
        const behaviours =
          await this.competencyService.getCompetencyBehaviours(id);
        (behaviours.helpful ?? []).forEach((b) => helpful.add(b.name));
        (behaviours.unhelpful ?? []).forEach((b) => unhelpful.add(b.name));
      } catch {
        unknownIds.push(id);
      }
    }
    return { helpful: [...helpful], unhelpful: [...unhelpful], unknownIds };
  }

  /** Active languages that have at least one voice — the only ones a roleplay can speak. */
  async listLanguages(): Promise<CopilotLanguage[]> {
    const languages =
      await this.scenarioService.getScenarioVoiceLanguagesForAdmin(true, true);
    return (languages ?? []).map((language: any) => ({
      id: String(language.language_id),
      name: String(language.label),
      code: String(language.value),
      voiceCount: Array.isArray(language.voices) ? language.voices.length : 0,
    }));
  }

  async listTriggerWarnings(): Promise<{ id: string; name: string }[]> {
    const rows = await this.dataSource.getRepository(TriggerWarnings).find({
      order: { name: 'ASC' },
      take: 100,
    });
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async listCoverImages(limit = 12): Promise<{ id: string; url: string }[]> {
    const rows = await this.dataSource
      .getRepository(ScenarioCoverImageLibrary)
      .find({ order: { createdAt: 'DESC' }, take: Math.min(limit, 40) });
    return rows.map((row: any) => ({ id: row.id, url: row.imageUrl }));
  }

  gameCatalogue(): { key: string; description: string }[] {
    const descriptions: Record<string, string> = {
      [TrackGameKey.TREX_RUNNER]:
        'Endless runner — jump the obstacles. A quick reset between heavy sections.',
      [TrackGameKey.TIC_TAC_TOE]:
        'Noughts and crosses against the computer. Two-minute breather.',
      [TrackGameKey.MEMORY_MATCH]:
        'Flip cards to find pairs. Calm, focus-resetting.',
      [TrackGameKey.CUB_N_PUP]: 'A gentle puzzle with two animal friends.',
      [TrackGameKey.SNAKE]: 'Classic snake. Fast, playful break.',
      [TrackGameKey.SPROUT]:
        'Grow a plant by tending it — slow and restful, good after a hard roleplay.',
      [TrackGameKey.BREATHING_EXERCISE]:
        'A guided box-breathing exercise to help learners regulate their emotional state.',
    };
    return Object.values(TrackGameKey).map((key) => ({
      key,
      description: descriptions[key] ?? key,
    }));
  }

  /** The 20 most recent ACTIVE roleplays, for the cached library-context block. */
  async recentRoleplays(limit = 20): Promise<LibraryHit[]> {
    return this.searchRoleplays('', undefined, limit);
  }

  async search(
    kind: 'roleplay' | 'case' | 'character' | 'template',
    query: string,
    competencyIds?: string[],
    limit = 8,
  ): Promise<LibraryHit[]> {
    const capped = Math.min(Math.max(limit, 1), 20);
    switch (kind) {
      case 'roleplay':
        return this.searchRoleplays(query, competencyIds, capped);
      case 'case':
        return this.searchCases(query, capped);
      case 'character':
        return this.searchCharacters(query, capped);
      case 'template':
        return this.searchTemplates(query, capped);
      default:
        return [];
    }
  }

  async getActiveScenarios(ids: number[]): Promise<Scenarios[]> {
    if (!ids.length) return [];
    return this.dataSource.getRepository(Scenarios).find({
      where: {
        id: In(ids),
        status: ScenarioStatus.ACTIVE,
        deletedAt: IsNull(),
      },
    });
  }

  async getActiveCase(id: string): Promise<Case | null> {
    return this.dataSource
      .getRepository(Case)
      .findOne({ where: { id, status: CaseStatus.ACTIVE } });
  }

  private async searchRoleplays(
    query: string,
    competencyIds: string[] | undefined,
    limit: number,
  ): Promise<LibraryHit[]> {
    const qb = this.dataSource
      .getRepository(Scenarios)
      .createQueryBuilder('s')
      .where('s.status = :status', { status: ScenarioStatus.ACTIVE })
      .andWhere('s."deletedAt" IS NULL');
    const terms = (query ?? '')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 2)
      .slice(0, 6);
    if (terms.length) {
      qb.andWhere(
        new Brackets((inner) => {
          terms.forEach((term, index) => {
            inner.orWhere(
              `(s.title ILIKE :t${index} OR s.description ILIKE :t${index})`,
              { [`t${index}`]: `%${term}%` },
            );
          });
        }),
      );
    }
    if (competencyIds?.length) {
      qb.andWhere(
        new Brackets((inner) => {
          inner
            .where('s."competencyId" IN (:...competencyIds)', { competencyIds })
            .orWhere(`s."competencyIds" ?| ARRAY[:...competencyIds]`, {
              competencyIds,
            });
        }),
      );
    }
    const rows = await qb
      .orderBy('s."updatedAt"', 'DESC')
      .limit(limit)
      .getMany();
    const names = await this.competencyNames(
      rows.flatMap((row) => [
        ...(row.competencyId ? [row.competencyId] : []),
        ...(row.competencyIds ?? []),
      ]),
    );
    return rows.map((row) => {
      const competencyIdList = [
        ...new Set([
          ...(row.competencyId ? [row.competencyId] : []),
          ...(row.competencyIds ?? []),
        ]),
      ];
      return {
        kind: 'roleplay' as const,
        id: row.id,
        title: row.title ?? `Roleplay ${row.id}`,
        description: oneLine(row.description),
        competencies: competencyIdList
          .map((id) => names.get(id))
          .filter((name): name is string => Boolean(name)),
        difficulty: (row as any).difficultyLevel ?? null,
        languages: Object.keys(row.metadata?.languageVoices ?? {}),
      };
    });
  }

  private async searchCases(
    query: string,
    limit: number,
  ): Promise<LibraryHit[]> {
    const rows = await this.dataSource.getRepository(Case).find({
      where: {
        status: CaseStatus.ACTIVE,
        ...(query?.trim() ? { title: ILike(`%${query.trim()}%`) } : {}),
      },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
    return rows.map((row) => ({
      kind: 'case' as const,
      id: row.id,
      title: row.title,
      description: oneLine(row.description),
    }));
  }

  private async searchCharacters(
    query: string,
    limit: number,
  ): Promise<LibraryHit[]> {
    try {
      const { characters } = await this.characterService.getScenarioCharacters({
        search: query?.trim() || undefined,
        limit,
      });
      return (characters ?? []).map((character: any) => ({
        kind: 'character' as const,
        id: character.id,
        title: character.name,
        description: oneLine(
          [
            character.age ? `${character.age}` : null,
            character.gender,
            character.profession,
            character.currentLocation,
          ]
            .filter(Boolean)
            .join(', '),
        ),
        extra: {
          hasVoices: Boolean(Object.keys(character.voices ?? {}).length),
        },
      }));
    } catch (error) {
      // Character scope needs a request user; outside one this is empty, not fatal.
      this.logger.warn(
        `Character search unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async searchTemplates(
    query: string,
    limit: number,
  ): Promise<LibraryHit[]> {
    const rows = await this.dataSource
      .getRepository(TrackComponentTemplate)
      .find({
        where: query?.trim() ? { title: ILike(`%${query.trim()}%`) } : {},
        order: { createdAt: 'DESC' },
        take: limit,
      });
    return rows.map((row) => ({
      kind: 'template' as const,
      id: row.id,
      title: row.title,
      extra: { type: row.type },
    }));
  }
}
