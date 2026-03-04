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

  getLanguageByLanguageCode(languageCode: string): Promise<Languages | null> {
    return this.findOne({ where: { translationCode: languageCode } });
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
