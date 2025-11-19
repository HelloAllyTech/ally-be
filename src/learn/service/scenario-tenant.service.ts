import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddScenarioTenantDto } from '../dto/add-scenario-tenant.dto';
import { ScenarioTenantRepository } from '../repository/scenario-tenant.repository';
import { DeleteScenarioTenantDto } from '../dto/delete-scenario-tenant.dto';
import { ScenarioTenantValidationUtil } from '../util/scenario-tenant-validation.util';

@Injectable()
export class ScenarioTenantService {
  constructor(
    private readonly scenarioTenantRepository: ScenarioTenantRepository,
    private readonly scenarioTenantValidationUtil: ScenarioTenantValidationUtil,
  ) {}

  async assignScenariosToTenant(
    tenantId: string,
    addScenarioTenantDto: AddScenarioTenantDto,
  ): Promise<{ success: boolean }> {
    await this.scenarioTenantValidationUtil.validateScenarioTenant(
      addScenarioTenantDto.scenarioIds,
      tenantId,
    );
    const scenarioTenant =
      await this.scenarioTenantRepository.getScenarioTenant(
        addScenarioTenantDto.scenarioIds,
        tenantId,
      );

    if (scenarioTenant.length > 0) {
      throw new ConflictException('Scenario-tenant mapping is already present');
    }

    const scenarioTenants = addScenarioTenantDto.scenarioIds.map(
      (scenarioId) => ({
        scenarioId,
        tenantId,
      }),
    );
    return this.scenarioTenantRepository.createScenarioTenants(scenarioTenants);
  }

  async removeScenariosFromTenant(
    tenantId: string,
    deleteScenarioTenantDto: DeleteScenarioTenantDto,
  ): Promise<{ success: boolean }> {
    await this.scenarioTenantValidationUtil.validateScenarioTenant(
      deleteScenarioTenantDto.scenarioIds,
      tenantId,
    );
    const existingScenarioTenant =
      await this.scenarioTenantRepository.getScenarioTenant(
        deleteScenarioTenantDto.scenarioIds,
        tenantId,
      );
    if (existingScenarioTenant.length == 0) {
      throw new NotFoundException('No valid scenario-tenant found');
    }

    return this.scenarioTenantRepository.deleteByScenarioIds(
      deleteScenarioTenantDto.scenarioIds,
      tenantId,
    );
  }

  async getScenarioTenant(tenantId: string, scenarioId: number) {
    return this.scenarioTenantRepository.find({
      where: { tenantId, scenarioId },
    });
  }
}
