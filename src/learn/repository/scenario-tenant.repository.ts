import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { ScenarioTenants } from '../entity/scenario-tenants.entity';
import { ScenarioTenantsResponseDto } from '../dto/scenario-tenant-response.dto';

@Injectable()
export class ScenarioTenantRepository extends Repository<ScenarioTenants> {
  constructor(private dataSource: DataSource) {
    super(ScenarioTenants, dataSource.createEntityManager());
  }

  async createScenarioTenants(
    scenarioTenants: Array<{ scenarioId: number; tenantId: string }>,
  ): Promise<ScenarioTenantsResponseDto> {
    await this.save(this.create(scenarioTenants));
    return {
      success: true,
    };
  }

  async deleteByTenantsIds(
    scenarioId: number,
    tenantIds: string[],
  ): Promise<ScenarioTenantsResponseDto> {
    const result = await this.delete({
      scenarioId,
      tenantId: In(tenantIds),
    });
    return { success: result.affected !== 0 };
  }

  async deleteByScenarioIds(
    scenarioIds: number[],
    tenantId: string,
  ): Promise<ScenarioTenantsResponseDto> {
    const result = await this.delete({ tenantId, scenarioId: In(scenarioIds) });
    return { success: result.affected !== 0 };
  }

  async getScenarioTenant(
    scenarioIds: number[],
    tenantId: string,
  ): Promise<ScenarioTenants[]> {
    return this.find({ where: { tenantId, scenarioId: In(scenarioIds) } });
  }
}
