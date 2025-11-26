import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { ScenariosRepository } from 'src/learn/repository/scenario.repository';
import { TenantService } from 'src/tenant/service/tenant.service';

@Injectable()
export class ScenarioTenantValidationShared {
  constructor(
    private readonly tenantService: TenantService,
    private readonly scenariosRepository: ScenariosRepository,
  ) {}

  async validateScenarioTenant(
    scenarioIds: number[],
    tenantId: string,
  ): Promise<void> {
    const tenant = await this.tenantService.findById(tenantId);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const uniqueScenarioIds = new Set(scenarioIds);
    if (uniqueScenarioIds.size !== scenarioIds.length) {
      throw new BadRequestException('Duplicate scenario ids');
    }

    const existingScenarios = await this.scenariosRepository.find({
      where: { id: In(scenarioIds) },
    });

    if (existingScenarios.length === 0) {
      throw new NotFoundException('No valid scenarios found');
    }
    const existingScenarioIds = existingScenarios.map((s) => s.id);
    const missingScenarioIds = scenarioIds.filter(
      (id) => !existingScenarioIds.includes(id),
    );
    if (missingScenarioIds.length > 0) {
      throw new NotFoundException(
        `Scenarios ${missingScenarioIds.join(', ')} do not exist`,
      );
    }
  }
}
