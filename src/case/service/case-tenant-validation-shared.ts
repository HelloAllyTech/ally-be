import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { TenantService } from 'src/tenant/service/tenant.service';
import { CaseRepository } from '../repository/case.repository';

@Injectable()
export class CaseTenantValidationShared {
  constructor(
    private readonly tenantService: TenantService,
    private readonly caseRepository: CaseRepository,
  ) {}

  async validateCaseTenant(caseIds: string[], tenantId: string): Promise<void> {
    const tenant = await this.tenantService.findById(tenantId);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const uniqueCaseIds = new Set(caseIds);
    if (uniqueCaseIds.size !== caseIds.length) {
      throw new BadRequestException('Duplicate case ids');
    }

    const existingCases = await this.caseRepository.find({
      where: { id: In(caseIds) },
    });

    if (existingCases.length === 0) {
      throw new NotFoundException('No valid cases found');
    }
    const existingCaseIds = existingCases.map((c) => c.id);
    const missingCaseIds = caseIds.filter(
      (id) => !existingCaseIds.includes(id),
    );
    if (missingCaseIds.length > 0) {
      throw new NotFoundException(
        `Case ${missingCaseIds.join(', ')} do not exist`,
      );
    }
  }
}
