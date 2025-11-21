import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { TenantService } from 'src/tenant/service/tenant.service';
import { ScenarioPathRepository } from '../repository/scenario-path.repository';

@Injectable()
export class ScenarioPathTenantValidationShared {
  constructor(
    private readonly tenantService: TenantService,
    private readonly scenarioPathRepository: ScenarioPathRepository,
  ) {}

  async validateScenarioPathTenant(
    scenarioPathIds: string[],
    tenantId: string,
  ): Promise<void> {
    const tenant = await this.tenantService.findById(tenantId);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const uniqueScenarioIds = new Set(scenarioPathIds);
    if (uniqueScenarioIds.size !== scenarioPathIds.length) {
      throw new BadRequestException('Duplicate scenario path ids');
    }

    const existingScenarioPaths = await this.scenarioPathRepository.find({
      where: { id: In(scenarioPathIds) },
    });

    if (existingScenarioPaths.length === 0) {
      throw new NotFoundException('No valid scenario paths found');
    }
    const existingScenarioPathIds = existingScenarioPaths.map((s) => s.id);
    const missingScenarioPathIds = scenarioPathIds.filter(
      (id) => !existingScenarioPathIds.includes(id),
    );
    if (missingScenarioPathIds.length > 0) {
      throw new NotFoundException(
        `Scenario path${missingScenarioPathIds.join(', ')} do not exist`,
      );
    }
  }
}
