import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import { Languages } from '../entity/languages.entity';
import { Injectable } from '@nestjs/common';
import { Pagination } from 'src/common/type/common.type';
import { LanguageSortBy } from '../enum/language-sort-by.enum';

@Injectable()
export class LanguagesRepository extends Repository<Languages> {
  constructor(private dataSource: DataSource) {
    super(Languages, dataSource.createEntityManager());
  }

  getLanguagesById(ids: number[]): Promise<Languages[]> {
    return this.find({
      where: { id: In(ids), active: true },
    });
  }

  /**
   * Which of `voiceIds` are still active catalog voices, and for which
   * language. Raw SQL on `scenario_voices` rather than its repository: that
   * lives in the learn module, which already imports this one.
   */
  async getActiveScenarioVoices(
    voiceIds: string[],
  ): Promise<{ id: string; languageId: number }[]> {
    if (!voiceIds.length) return [];
    const rows: { id: string; languageId: number | string }[] =
      await this.dataSource.query(
        `SELECT "id", "languageId" FROM "scenario_voices"
         WHERE "active" = true AND "id"::text = ANY($1::text[])`,
        [voiceIds],
      );
    return rows.map((row) => ({
      id: row.id,
      languageId: Number(row.languageId),
    }));
  }

  getLanguageByLanguageCode(languageCode: string): Promise<Languages | null> {
    return this.findOne({ where: { translationCode: languageCode } });
  }

  getByTranslationCodes(codes: string[]): Promise<Languages[]> {
    if (!codes.length) return Promise.resolve([]);
    return this.find({
      where: { translationCode: In(codes), active: true },
    });
  }

  getLanguageByValue(value: string): Promise<Languages | null> {
    return this.findOne({ where: { value } });
  }

  getLanguages(
    searchName?: string,
    options?: Pagination,
  ): Promise<Languages[]> {
    const query = this.createQueryBuilder('language');

    if (searchName) {
      query
        .andWhere(
          '(language.value ILIKE :searchName OR language.label ILIKE :searchName)',
        )
        .setParameters({
          searchName: `%${searchName}%`,
        });
    }
    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }
    return query.getMany();
  }

  private applySorting(
    query: SelectQueryBuilder<Languages>,
    options: Pagination,
  ) {
    const sortColumn = this.getValidatedSortColumn(
      options.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`language.${sortColumn}`, options.order || 'ASC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return LanguageSortBy.CREATED_AT;
    }
    const validColumns = Object.values(LanguageSortBy);
    return validColumns.includes(sortBy as LanguageSortBy)
      ? sortBy
      : LanguageSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<Languages>,
    options: Pagination,
  ) {
    if (options.offset) {
      query.offset(options.offset);
    }
    if (options.limit) {
      query.limit(options.limit);
    }
  }
}
