import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { ScenarioPathTenant } from '../entity/scenario-path-tenant.entity';
import { SuccessResponse } from 'src/common/type/common.type';

@Injectable()
export class ScenarioPathTenantRepository extends Repository<ScenarioPathTenant> {
  constructor(private dataSource: DataSource) {
    super(ScenarioPathTenant, dataSource.createEntityManager());
  }

  async createScenarioPathTenants(
    scenarioPathTenants: Array<{ scenarioPathId: string; tenantId: string }>,
  ): Promise<SuccessResponse> {
    await this.save(this.create(scenarioPathTenants));
    return {
      success: true,
    };
  }

  async deleteByScenarioPathIds(
    scenarioPathIds: string[],
    tenantId: string,
  ): Promise<SuccessResponse> {
    const result = await this.delete({
      tenantId,
      scenarioPathId: In(scenarioPathIds),
    });
    return { success: result.affected !== 0 };
  }

  async getScenarioPathTenant(
    scenarioPathIds: string[],
    tenantId: string,
  ): Promise<ScenarioPathTenant[]> {
    return this.find({
      where: { tenantId, scenarioPathId: In(scenarioPathIds) },
    });
  }
}
