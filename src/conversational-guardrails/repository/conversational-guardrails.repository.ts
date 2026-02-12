import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ConversationalGuardrails } from '../entity/conversational-guardrails.entity';
import { Pagination } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';

export enum ConversationalGuardrailsSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  HELPER_DIALOGUE = 'helperDialogue',
  NAME = 'name',
}

@Injectable()
export class ConversationalGuardrailsRepository extends Repository<ConversationalGuardrails> {
  private readonly logger = LoggerService.getInstance(
    ConversationalGuardrailsRepository.name,
  );

  constructor(private dataSource: DataSource) {
    super(ConversationalGuardrails, dataSource.createEntityManager());
  }

  async getGuardrails(search?: string, options?: Pagination) {
    const query = this.createQueryBuilder('guardrail');
    this.logger.info(`Getting guardrails with search: ${search}`);

    if (search) {
      const searchTerm = `%${search.trim()}%`;
      query.where(
        'guardrail.name ILIKE :search OR guardrail.helperDialogue ILIKE :search OR guardrail.actorDialogue ILIKE :search',
        { search: searchTerm },
      );
    }

    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }

    return query.getMany();
  }

  async getActiveGuardrails() {
    return this.createQueryBuilder('guardrail')
      .where('guardrail.active = :active', { active: true })
      .getMany();
  }

  async getRandomGuardrails(limit: number = 25) {
    return this.createQueryBuilder('guardrail')
      .where('guardrail.active = :active', { active: true })
      .orderBy('RANDOM()')
      .limit(limit)
      .getMany();
  }

  async countGuardrails(search?: string) {
    const query = this.createQueryBuilder('guardrail');

    if (search) {
      const searchTerm = `%${search.trim()}%`;
      query.where(
        'guardrail.name ILIKE :search OR guardrail.helperDialogue ILIKE :search OR guardrail.actorDialogue ILIKE :search',
        { search: searchTerm },
      );
    }

    return query.getCount();
  }

  private applySorting(
    query: SelectQueryBuilder<ConversationalGuardrails>,
    options: Pagination,
  ) {
    const sortColumn = this.getValidatedSortColumn(
      options.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`guardrail.${sortColumn}`, options.order || 'ASC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return ConversationalGuardrailsSortBy.CREATED_AT;
    }
    const validColumns = Object.values(ConversationalGuardrailsSortBy);
    return validColumns.includes(sortBy as ConversationalGuardrailsSortBy)
      ? sortBy
      : ConversationalGuardrailsSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<ConversationalGuardrails>,
    options: Pagination,
  ) {
    if (options.offset !== undefined) {
      query.offset(options.offset);
    }
    if (options.limit) {
      query.limit(options.limit);
    }
  }
}
