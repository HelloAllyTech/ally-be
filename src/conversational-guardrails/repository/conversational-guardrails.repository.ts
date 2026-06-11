import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ConversationalGuardrails } from '../entity/conversational-guardrails.entity';
import { Pagination } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { MAX_GUARDRAILS_PER_SESSION } from '../constants/guardrails.constants';
import { ConversationalGuardrailsSortBy } from '../enum/conversational-guardrails-sort-by.enum';
import { ConversationalGuardrailKind } from '../enum/conversational-guardrails-kind.enum';

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

    if (search) {
      const searchTerm = `%${search.trim()}%`;
      this.logger.info(`Getting guardrails with search: ${searchTerm}`);
      query.where(
        'guardrail.name ILIKE :search OR guardrail.helperDialogue ILIKE :search OR guardrail.actorDialogue ILIKE :search',
        { search: searchTerm },
      );
    }

    if (options && options.limit == MAX_GUARDRAILS_PER_SESSION) {
      query.where('guardrail.active = :active', { active: true });
      query.orderBy('RANDOM()');
    }

    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }

    return query.getMany();
  }

  // SYSTEM guardrails are always injected into every session, regardless of
  // the random USER-guardrail sampling.
  async getSystemGuardrails() {
    return this.createQueryBuilder('guardrail')
      .where('guardrail.active = :active', { active: true })
      .andWhere('guardrail.kind = :kind', {
        kind: ConversationalGuardrailKind.SYSTEM,
      })
      .orderBy('guardrail.createdAt', 'ASC')
      .getMany();
  }

  // Random active USER guardrails for a session, excluding SYSTEM rows (which
  // are added separately so they are never crowded out by the random sample).
  async getRandomUserGuardrails(limit: number) {
    if (limit <= 0) {
      return [];
    }
    return this.createQueryBuilder('guardrail')
      .where('guardrail.active = :active', { active: true })
      .andWhere('guardrail.kind = :kind', {
        kind: ConversationalGuardrailKind.USER,
      })
      .orderBy('RANDOM()')
      .limit(limit)
      .getMany();
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
