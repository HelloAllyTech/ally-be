import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateScenarioPathTenantDto } from '../dto/create-scenario-path-tenant.dto';
import { ScenarioPathTenantRepository } from '../repository/scenario-path-tenant.repository';
import { ScenarioPathTenantValidationShared } from './scenario-tenant-validation-shared';
import { DeleteScenarioPathTenantDto } from '../dto/delete-scenario-path-tenant.dto';
import { SuccessResponse } from 'src/common/type/common.type';

@Injectable()
export class ScenarioPathTenantService {
  constructor(
    private readonly scenarioPathTenantRepository: ScenarioPathTenantRepository,
    private readonly scenarioPathTenantValidationShared: ScenarioPathTenantValidationShared,
  ) {}

  async assignScenarioPathsToTenant(
    tenantId: string,
    createScenarioPathTenantDto: CreateScenarioPathTenantDto,
  ): Promise<SuccessResponse> {
    await this.scenarioPathTenantValidationShared.validateScenarioPathTenant(
      createScenarioPathTenantDto.scenarioPathIds,
      tenantId,
    );
    const scenarioTenant =
      await this.scenarioPathTenantRepository.getScenarioPathTenant(
        createScenarioPathTenantDto.scenarioPathIds,
        tenantId,
      );

    if (scenarioTenant.length > 0) {
      throw new ConflictException('Scenario-tenant mapping is already present');
    }

    const scenarioTenants = createScenarioPathTenantDto.scenarioPathIds.map(
      (scenarioPathId) => ({
        scenarioPathId,
        tenantId,
      }),
    );
    return this.scenarioPathTenantRepository.createScenarioPathTenants(
      scenarioTenants,
    );
  }

  async removeScenarioPathsFromTenant(
    tenantId: string,
    deleteScenarioTenantDto: DeleteScenarioPathTenantDto,
  ): Promise<SuccessResponse> {
    await this.scenarioPathTenantValidationShared.validateScenarioPathTenant(
      deleteScenarioTenantDto.scenarioPathIds,
      tenantId,
    );
    const existingScenarioTenant =
      await this.scenarioPathTenantRepository.getScenarioPathTenant(
        deleteScenarioTenantDto.scenarioPathIds,
        tenantId,
      );
    if (existingScenarioTenant.length == 0) {
      throw new NotFoundException('No valid scenario-tenant found');
    }

    return this.scenarioPathTenantRepository.deleteByScenarioPathIds(
      deleteScenarioTenantDto.scenarioPathIds,
      tenantId,
    );
  }

  async getScenarioPathTenant(tenantId: string, scenarioPathId: string) {
    return this.scenarioPathTenantRepository.findOne({
      where: { tenantId, scenarioPathId },
    });
  }
}
