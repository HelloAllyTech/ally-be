import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddScenarioTenantDto } from '../dto/add-scenario-tenant.dto';
import { ScenarioTenantRepository } from '../repository/scenario-tenant.repository';
import { DeleteScenarioTenantDto } from '../dto/delete-scenario-tenant.dto';
import { ScenarioTenantValidationShared } from './scenario-tenant-validation-shared';
import { SuccessResponse } from 'src/common/type/common.type';
import { AuditLogService } from 'src/audit/service/audit-log.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import {
  AUDIT_ACTIONS,
  AUDIT_EVENTS,
} from 'src/audit/constants/audit-event.constants';

@Injectable()
export class ScenarioTenantService {
  constructor(
    private readonly scenarioTenantRepository: ScenarioTenantRepository,
    private readonly scenarioTenantValidationShared: ScenarioTenantValidationShared,
    private readonly auditLogService: AuditLogService,
    private permissionsService: PermissionsService,
  ) {}

  async assignScenariosToTenant(
    tenantId: string,
    addScenarioTenantDto: AddScenarioTenantDto,
  ): Promise<SuccessResponse> {
    await this.scenarioTenantValidationShared.validateScenarioTenant(
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

    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    const isMultiTenantAdmin = userId
      ? await this.permissionsService.isMultiTenantAdmin(userId)
      : false;

    if (isMultiTenantAdmin) {
      this.auditLogService.log({
        eventType: AUDIT_EVENTS.MULTI_TENANT_ADMIN_ASSIGNED_SCENARIO_TO_TENANT,
        details: {
          action: AUDIT_ACTIONS.ASSIGN_SCENARIO_TENANT,
          tenantId,
          scenarioIds: addScenarioTenantDto.scenarioIds,
          userId,
        },
      });
    }

    return this.scenarioTenantRepository.createScenarioTenants(scenarioTenants);
  }

  async removeScenariosFromTenant(
    tenantId: string,
    deleteScenarioTenantDto: DeleteScenarioTenantDto,
  ): Promise<SuccessResponse> {
    await this.scenarioTenantValidationShared.validateScenarioTenant(
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

    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    const isMultiTenantAdmin = userId
      ? await this.permissionsService.isMultiTenantAdmin(userId)
      : false;

    if (isMultiTenantAdmin) {
      this.auditLogService.log({
        eventType: AUDIT_EVENTS.MULTI_TENANT_ADMIN_REMOVED_SCENARIO_FROM_TENANT,
        details: {
          action: AUDIT_ACTIONS.REMOVE_SCENARIO_TENANT,
          tenantId,
          scenarioIds: deleteScenarioTenantDto.scenarioIds,
          userId,
        },
      });
    }

    return this.scenarioTenantRepository.deleteByScenarioIds(
      deleteScenarioTenantDto.scenarioIds,
      tenantId,
    );
  }

  async getScenarioTenant(tenantId: string, scenarioId: number) {
    return this.scenarioTenantRepository.findOne({
      where: { tenantId, scenarioId },
    });
  }
}
