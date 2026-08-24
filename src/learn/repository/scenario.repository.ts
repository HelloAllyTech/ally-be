import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Scenarios } from '../entity/scenarios.entity';
import { AssignmentStatus, Pagination } from 'src/common/type/common.type';
import { User } from 'src/user/entity/user.entity';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ScenarioEvents } from '../entity/scenario-events.entity';
import { GetAdminScenarioDto } from '../dto/get-scenario.dto';
import {
  GetScenarioByIdOptions,
  ScenarioFilters,
} from '../type/scenario-filter.type';
import { ScenarioTriggerWarnings } from '../entity/scenario-trigger-warnings.entity';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';
import { GetScenarioDto } from '../dto/get-scenario.dto';
import { ScenarioStatus, ScenarioSortBy } from '../type/scenario.type';
import { ScenarioEngine } from '../enum/scenario-engine.enum';
import { ScenarioTenants } from '../entity/scenario-tenants.entity';
import { applyCohortVisibilityFilter } from 'src/cohort/query/cohort-restriction.query';
import { CohortContentType } from 'src/cohort/constants/cohort.constants';
import { ScenarioBehaviorInstruction } from '../entity/scenario-behavior-instruction.entity';
import { GetScenarioResponse } from '../interface/session.interface';

@Injectable()
export class ScenariosRepository extends Repository<Scenarios> {
  constructor(private dataSource: DataSource) {
    super(Scenarios, dataSource.createEntityManager());
  }
  async getScenarioWithTriggerWarningsByIds(ids: number[]) {
    if (ids.length === 0) {
      return [];
    }
    return this.createQueryBuilder('scenario')
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoinAndMapMany(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'tw',
        'tw.id = stw.triggerWarningId',
      )
      .where('scenario.id IN (:...ids)', { ids })
      .getMany();
  }

  async getScenarios(filters?: ScenarioFilters): Promise<{
    data: GetScenarioDto[];
    count: number;
  }> {
    const query = this.createQueryBuilder('scenario');
    if (filters?.tenantId) {
      query.innerJoin(
        ScenarioTenants,
        'scenarioTenant',
        'scenarioTenant.scenarioId = scenario.id AND scenarioTenant.tenantId = :tenantId',
        { tenantId: filters.tenantId },
      );
    }

    query.where('scenario.status IN (:...statuses)', {
      statuses: [ScenarioStatus.ACTIVE],
    });

    // ROLEPLAY_V2 shells must not surface in the learner catalog by default —
    // ordinary users would otherwise see them and hit the v2 rollout gate.
    // Only a v2-allowlisted requester opts in via includeRoleplayV2 (see
    // ScenarioService.getScenariosV2); every other caller (incl. the @Public
    // catalog endpoints) excludes them.
    if (!filters?.includeRoleplayV2) {
      query.andWhere('scenario.engine != :roleplayV2Engine', {
        roleplayV2Engine: ScenarioEngine.ROLEPLAY_V2,
      });
    }

    if (filters?.isPublic) {
      query.andWhere('scenario.isPublic = :isPublic', {
        isPublic: filters.isPublic,
      });
    }

    // Cohort narrowing, layer 2 on top of the scenario_tenants join above. Only
    // the learner catalog passes cohortScope; the admin list deliberately does
    // not, so an admin keeps seeing the scenarios they have restricted.
    //
    // No grace clause for scenarios: a roleplay is a single session with nothing
    // to resume, so "finish what you started" has no subject here. Courses and
    // cases, which do have resumable progress, pass one.
    if (filters?.cohortScope && filters.tenantId) {
      applyCohortVisibilityFilter(query, {
        alias: 'scenario',
        contentType: CohortContentType.SCENARIO,
        tenantId: filters.tenantId,
        cohortId: filters.cohortScope.cohortId,
      });
    }

    const selectColumns = [
      'scenario.id',
      'scenario.title',
      'scenario.scenario',
      'scenario.description',
      'scenario.coverImageUrl',
      'scenario.coverVideoUrl',
      'scenario.status',
      'scenario.isPublic',
      'scenario.metadata',
    ];

    if (filters?.languageCode) {
      selectColumns.push('scenario.translations');
    }

    const [data, count] = await query
      .select(selectColumns)
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoinAndMapMany(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'tw',
        'tw.id = stw.triggerWarningId',
      )
      .orderBy('scenario.createdAt', 'DESC')
      .addOrderBy('scenario.id', 'DESC')
      .getManyAndCount();

    return { data, count };
  }

  async getScenarioById(
    id: number,
    options?: GetScenarioByIdOptions,
  ): Promise<GetScenarioResponse | null> {
    const scenarioRepo = options?.em
      ? options.em?.getRepository(Scenarios)
      : this.dataSource.getRepository(Scenarios);
    const query = scenarioRepo.createQueryBuilder('scenario');
    if (options?.select) {
      const selectFields = options.select.map(
        (field) => `scenario.${String(field)}`,
      );
      if (
        options?.languageCode &&
        !selectFields.includes('scenario.translations')
      ) {
        selectFields.push('scenario.translations');
      }
      query?.select(selectFields);
    }
    query
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoinAndMapMany(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'tw',
        'tw.id = stw.triggerWarningId',
      )
      .where('scenario.id = :id', { id });

    if (options?.isPublic) {
      query.andWhere('scenario.isPublic = :isPublic', {
        isPublic: options?.isPublic,
      });
    }
    return await query.getOne();
  }
  async getAdminScenarios(
    scenarioFilters?: ScenarioFilters,
    options?: Pagination,
  ) {
    const {
      status,
      category,
      partnerOrgName,
      tenantId,
      assignmentStatus,
      search,
      isMultiTenantAdmin,
      userId,
    } = scenarioFilters ?? {};
    const query = this.createQueryBuilder('scenario')
      .leftJoin(User, 'user', 'scenario."createdBy"=user.id')
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoin(
        TriggerWarnings,
        'triggerWarnings',
        'triggerWarnings.id = stw.triggerWarningId',
      )
      .select(['scenario', 'user.name'])
      .addSelect(
        `COALESCE(json_agg(json_build_object('id', "triggerWarnings".id, 'name', "triggerWarnings".name)) FILTER (WHERE "triggerWarnings".id IS NOT NULL), '[]')`,
        'triggerWarnings',
      )
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'count')
          .from(ScenarioSessions, 'scenarioSessions')
          .where('scenarioSessions.scenarioId = scenario.id');
      }, 'usage')
      .addSelect((subQuery) => {
        return subQuery
          .select(
            `COALESCE(json_agg(json_build_object('id', "scenarioBehaviorInstruction"."id", 'category', "scenarioBehaviorInstruction"."category", 'stateInstructions', "scenarioBehaviorInstruction"."stateInstructions")), '[]')`,
          )
          .from(ScenarioBehaviorInstruction, 'scenarioBehaviorInstruction')
          .where('scenarioBehaviorInstruction.scenarioId = scenario.id');
      }, 'behaviorInstructions')
      .groupBy('scenario.id')
      .addGroupBy('user.name');

    this.applySearchFilter(query, search);

    // The v1 studio list owns SIMULATION scenarios only. Roleplay Studio v2
    // materialises thin ROLEPLAY_V2 shells in `scenarios` (real config lives in
    // roleplay_specs); they must never surface here. `engine` is NOT NULL with a
    // 'SIMULATION' default, so a plain inequality keeps every v1 row.
    query.andWhere('scenario.engine != :roleplayV2Engine', {
      roleplayV2Engine: ScenarioEngine.ROLEPLAY_V2,
    });

    if (isMultiTenantAdmin && userId) {
      query.andWhere(
        '(scenario.isPublic = true OR scenario.createdBy = :userId)',
        { userId },
      );
    }

    if (status) {
      const statuses = this.parseStringArray(status);
      if (statuses.length > 0) {
        query.andWhere('scenario.status IN (:...statuses)', {
          statuses,
        });
      }
    }

    if (category) {
      const categories = this.parseStringArray(category);
      if (categories.length > 0) {
        query.andWhere('scenario.category IN (:...categories)', {
          categories,
        });
      }
    }

    if (partnerOrgName && partnerOrgName.trim()) {
      query.andWhere('scenario.partnerOrgName ILIKE :partnerOrgName', {
        partnerOrgName: `%${partnerOrgName.trim()}%`,
      });
    }

    if (options?.sortBy) {
      if (options.sortBy === ScenarioSortBy.USAGE) {
        query.orderBy('usage', options.order as 'ASC' | 'DESC');
      } else {
        const sortColumn = this.getValidatedSortColumn(options.sortBy);
        if (sortColumn) {
          query.orderBy(
            `scenario.${sortColumn}`,
            options.order as 'ASC' | 'DESC',
          );
        }
      }
    }

    // Pagination
    if (options?.limit) {
      query.limit(options?.limit);
    }
    if (options?.offset) {
      query.offset(options?.offset);
    }

    if (tenantId) {
      query
        .leftJoin(
          'scenario_tenants',
          'scenarioTenants',
          '"scenarioTenants"."scenarioId" = scenario.id AND "scenarioTenants"."tenantId" = :tenantId',
          { tenantId },
        )
        .addSelect(
          'BOOL_OR("scenarioTenants".id IS NOT NULL)',
          'isAssignedToTenant',
        );

      if (assignmentStatus === AssignmentStatus.ASSIGNED) {
        query.andWhere('"scenarioTenants"."id" IS NOT NULL');
      } else if (assignmentStatus === AssignmentStatus.UNASSIGNED) {
        query.andWhere('"scenarioTenants"."id" IS NULL');
      }
    }
    return query.getRawMany();
  }

  async getAdminScenarioById(id: number): Promise<GetAdminScenarioDto | null> {
    return await this.createQueryBuilder('scenario')
      .leftJoinAndMapMany(
        'scenario.terminationEvents',
        ScenarioEvents,
        'scenarioEvents',
        'scenarioEvents.scenarioId = scenario.id AND scenarioEvents.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: true },
      )
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoinAndMapMany(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'triggerWarnings',
        'triggerWarnings.id = stw.triggerWarningId',
      )
      .where('scenario.id = :id', { id })
      .getOne();
  }

  private parseStringArray(value?: string): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  private applySearchFilter(
    query: SelectQueryBuilder<Scenarios>,
    search?: string,
  ) {
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;

      // Admin-list search only (single call site): matches the partner-org
      // tag as well as the title so typing a partner name surfaces its sims.
      query.andWhere(
        '(scenario.title ILIKE :search OR scenario.partnerOrgName ILIKE :search)',
        { search: searchTerm },
      );
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return null;
    }
    const validColumns = Object.values(ScenarioSortBy);
    return validColumns.includes(sortBy as ScenarioSortBy) ? sortBy : null;
  }

  // Soft-deleted scenarios are excluded automatically (query builder filters
  // on deletedAt IS NULL for entities with a @DeleteDateColumn).
  async existsWithCompetencyId(competencyId: string): Promise<boolean> {
    const count = await this.createQueryBuilder('scenario')
      .where('scenario.competencyId = :competencyId', { competencyId })
      .orWhere('scenario.competencyIds @> :competencyIdJson', {
        competencyIdJson: JSON.stringify([competencyId]),
      })
      .getCount();
    return count > 0;
  }
}
