import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Prompt } from '../entity/prompt.entity';
import { Injectable } from '@nestjs/common';
import { Pagination } from 'src/common/type/common.type';
import { PromptSortBy } from '../enum/prompt-sort-by.enum';
import {
  PromptResponse,
  PromptDetailResponse,
} from '../type/prompt-response.type';

@Injectable()
export class PromptsRepository extends Repository<Prompt> {
  constructor(private dataSource: DataSource) {
    super(Prompt, dataSource.createEntityManager());
  }

  getPromptById(id: string): Promise<PromptDetailResponse | null> {
    return this.createQueryBuilder('prompt')
      .leftJoin(
        'prompts_versions',
        'pv',
        '"prompt"."id" = "pv"."promptId" AND "pv"."version" = "prompt"."currentVersion"',
      )
      .addSelect('pv.prompt', 'prompt')
      .addSelect('prompt.defaultPrompt', 'defaultPrompt')
      .addSelect('prompt.category', 'category')
      .addSelect('prompt.useDashboardOverride', 'useDashboardOverride')
      .addSelect('prompt.isObsolete', 'isObsolete')
      .addSelect('prompt.kind', 'kind')
      .addSelect('prompt.promptType', 'promptType')
      .addSelect('prompt.hasStates', 'hasStates')
      .addSelect('prompt.availableVariables', 'availableVariables')
      .addSelect('prompt.usesBlocks', 'usesBlocks')
      .addSelect('prompt.provider', 'provider')
      .addSelect('prompt.model', 'model')
      .addSelect('CAST(prompt.temperature AS double precision)', 'temperature')
      .where('prompt.id = :id', { id })
      .getRawOne() as unknown as Promise<PromptDetailResponse | null>;
  }

  /**
   * List prompts filtered by promptType (e.g. 'main_agent' to populate the
   * studio variant picker). Returns the same shape as getPrompts().
   */
  getPromptsByType(promptType: string): Promise<PromptResponse[]> {
    return this.createQueryBuilder('prompt')
      .leftJoin(
        'prompts_versions',
        'pv',
        '"prompt"."id" = "pv"."promptId" AND "pv"."version" = "prompt"."currentVersion"',
      )
      .select('prompt.id', 'id')
      .addSelect('prompt.promptCode', 'promptCode')
      .addSelect('prompt.name', 'name')
      .addSelect('prompt.description', 'description')
      .addSelect('prompt.category', 'category')
      .addSelect('prompt.createdAt', 'createdAt')
      .addSelect('pv.prompt', 'prompt')
      .addSelect('prompt.defaultPrompt', 'defaultPrompt')
      .addSelect('prompt.useDashboardOverride', 'useDashboardOverride')
      .addSelect('prompt.isObsolete', 'isObsolete')
      .addSelect('prompt.kind', 'kind')
      .addSelect('prompt.promptType', 'promptType')
      .addSelect('prompt.hasStates', 'hasStates')
      .addSelect('prompt.availableVariables', 'availableVariables')
      .addSelect('prompt.usesBlocks', 'usesBlocks')
      .addSelect('prompt.provider', 'provider')
      .addSelect('prompt.model', 'model')
      .addSelect('CAST(prompt.temperature AS double precision)', 'temperature')
      .where('prompt.promptType = :promptType', { promptType })
      .andWhere('prompt.isObsolete = false')
      .orderBy('prompt.name', 'ASC')
      .getRawMany() as unknown as Promise<PromptResponse[]>;
  }

  getPrompts(
    searchName?: string,
    options?: Pagination,
  ): Promise<PromptResponse[]>;
  getPrompts(
    searchName?: string,
    includeBlocks?: boolean,
    options?: Pagination,
  ): Promise<PromptResponse[]>;
  getPrompts(
    searchName?: string,
    arg2?: boolean | Pagination,
    arg3?: Pagination,
  ): Promise<PromptResponse[]> {
    const includeBlocks = typeof arg2 === 'boolean' ? arg2 : true;
    const options = typeof arg2 === 'boolean' ? arg3 : arg2;

    const query = this.createQueryBuilder('prompt')
      .leftJoin(
        'prompts_versions',
        'pv',
        '"prompt"."id" = "pv"."promptId" AND "pv"."version" = "prompt"."currentVersion"',
      )
      .select('prompt.id', 'id')
      .addSelect('prompt.promptCode', 'promptCode')
      .addSelect('prompt.name', 'name')
      .addSelect('prompt.description', 'description')
      .addSelect('prompt.category', 'category')
      .addSelect('prompt.createdAt', 'createdAt')
      .addSelect('pv.prompt', 'prompt')
      .addSelect('prompt.defaultPrompt', 'defaultPrompt')
      .addSelect('prompt.useDashboardOverride', 'useDashboardOverride')
      .addSelect('prompt.isObsolete', 'isObsolete')
      .addSelect('prompt.kind', 'kind')
      .addSelect('prompt.promptType', 'promptType')
      .addSelect('prompt.hasStates', 'hasStates')
      .addSelect('prompt.availableVariables', 'availableVariables')
      .addSelect('prompt.usesBlocks', 'usesBlocks')
      .addSelect('prompt.provider', 'provider')
      .addSelect('prompt.model', 'model')
      .addSelect('CAST(prompt.temperature AS double precision)', 'temperature')
      .where('prompt.defaultPrompt IS NOT NULL');

    if (!includeBlocks) {
      query.andWhere('(prompt.kind IS NULL OR prompt.kind != :blockKind)', {
        blockKind: 'block',
      });
    }

    if (searchName) {
      query
        .andWhere(
          '(prompt.promptCode ILIKE :searchName OR prompt.name ILIKE :searchName OR prompt.description ILIKE :searchName) OR (pv.prompt ILIKE :searchName)',
        )
        .setParameters({
          searchName: `%${searchName}%`,
        });
    }
    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }

    return query.getRawMany() as unknown as Promise<PromptResponse[]>;
  }

  private applySorting(query: SelectQueryBuilder<Prompt>, options: Pagination) {
    const sortColumn = this.getValidatedSortColumn(
      options.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`prompt.${sortColumn}`, options.order || 'ASC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return PromptSortBy.CREATED_AT;
    }
    const validColumns = Object.values(PromptSortBy);
    return validColumns.includes(sortBy as PromptSortBy)
      ? sortBy
      : PromptSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<Prompt>,
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
