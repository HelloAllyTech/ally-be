import { Injectable } from '@nestjs/common';
import { DataSource, Raw, Repository, SelectQueryBuilder } from 'typeorm';
import { ScenarioVoices } from '../entity/scenario-voices.entity';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioVoiceSortBy } from '../enum/scenario-voice-sort-by.enum';

@Injectable()
export class ScenarioVoicesRepository extends Repository<ScenarioVoices> {
  constructor(private dataSource: DataSource) {
    super(ScenarioVoices, dataSource.createEntityManager());
  }

  async getScenarioVoices(
    searchName: string | undefined,
    providers: string | undefined,
    languageIds: string | undefined,
    options: Pagination,
  ): Promise<ScenarioVoices[]> {
    const query = this.createQueryBuilder('scenarioVoice');

    if (searchName) {
      query
        .andWhere(
          '(scenarioVoice.name ILIKE :searchName OR scenarioVoice.provider ILIKE :searchName)',
        )
        .setParameters({
          searchName: `%${searchName}%`,
        });
    }

    if (providers) {
      const providerList = providers.split(',');
      query.andWhere('scenarioVoice.provider IN (:...providers)', {
        providers: providerList,
      });
    }

    if (languageIds) {
      const languageIdList = languageIds.split(',').map((id) => Number(id));
      query.andWhere('scenarioVoice.languageId IN (:...languageIds)', {
        languageIds: languageIdList,
      });
    }
    this.applySorting(query, options);
    this.applyPagination(query, options);
    return query.getMany();
  }

  private applySorting(
    query: SelectQueryBuilder<ScenarioVoices>,
    options: Pagination,
  ) {
    const sortColumn = this.getValidatedSortColumn(
      options.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`scenarioVoice.${sortColumn}`, options.order || 'ASC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return ScenarioVoiceSortBy.CREATED_AT;
    }
    const validColumns = Object.values(ScenarioVoiceSortBy);
    return validColumns.includes(sortBy as ScenarioVoiceSortBy)
      ? sortBy
      : ScenarioVoiceSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<ScenarioVoices>,
    options: Pagination,
  ) {
    if (options.offset) {
      query.offset(options.offset);
    }
    if (options.limit) {
      query.limit(options.limit);
    }
  }

  async getLanguagesWithVoices(active?: boolean, voicesNeeded?: boolean) {
    const query = this.createQueryBuilder()
      .select('la.id', 'language_id')
      .addSelect('la.value', 'value')
      .addSelect('la.label', 'label')
      .addSelect(
        voicesNeeded
          ? `jsonb_agg(DISTINCT jsonb_build_object('id', sv.id, 'name', sv.name, 'provider',sv.provider))`
          : `'[]'::jsonb`,
        'voices',
      )
      .from('languages', 'la')
      .innerJoin('scenario_voices', 'sv', 'la.id = sv.languageId')
      .groupBy('la.id, la.value, la.label')
      .having('COUNT(sv.id) > 0');

    if (active !== undefined) {
      query.where('la.active = :active', { active });
      query.andWhere('sv.active = :active', { active });
    } else {
      query.where('la.active = true');
      query.andWhere('sv.active = true');
    }

    const rows = await query.getRawMany();

    if (!rows) {
      return [];
    }

    return rows.map((r) => ({
      language_id: Number(r.language_id),
      value: r.value,
      label: r.label,
      voices: typeof r.voices === 'string' ? JSON.parse(r.voices) : r.voices,
    }));
  }

  async getLanguagesForScenario(active?: boolean, hasVoices?: boolean) {
    const query = this.createQueryBuilder()
      .select('CAST(la.id AS INTEGER)', 'language_id')
      .addSelect('la.value', 'value')
      .addSelect('la.label', 'label')
      .addSelect('la.active', 'active')
      .addSelect('la.translationCode', 'translationCode')
      // IMPORTANT: start from the languages table so `la` refers to languages
      .from('languages', 'la')
      .leftJoin('scenario_voices', 'sv', 'sv.languageId = la.id');

    // always dedupe by language
    query.groupBy('la.id, la.value, la.label');

    // hasVoices filter (both male & female)
    if (hasVoices) {
      query
        .andWhere(`sv.config->>'gender' IN ('male', 'female')`)
        .having(`COUNT(DISTINCT LOWER(sv.config->>'gender')) = 2`);
    }

    // active filter — pass boolean (or cast if your column is text)
    if (active !== undefined) {
      query.andWhere('la.active = :active', { active });
    } else {
      query.andWhere('la.active = true');
    }

    return await query.getRawMany();
  }

  async getVoiceWithLanguageCode(voiceId: string) {
    return this.createQueryBuilder('sv')
      .select('sv.id', 'id')
      .addSelect('sv.name', 'name')
      .addSelect('sv.provider', 'provider')
      .addSelect('sv.config', 'config')
      .addSelect('sv.languageId', 'languageId')
      .addSelect('la.value', 'languageCode')
      .innerJoin('languages', 'la', 'la.id = sv.languageId')
      .where('sv.id = :voiceId', { voiceId })
      .getRawOne();
  }

  async getFallbackVoice(languageId: number, gender: string) {
    return await this.findOne({
      select: ['id', 'name', 'config'],
      where: {
        languageId,
        config: Raw((alias) => `${alias} ->> 'gender' = :gender`, { gender }),
      },
    });
  }
}
