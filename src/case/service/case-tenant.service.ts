import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CaseTenantRepository } from '../repository/case-tenant.repository';
import { CreateCaseTenantDto } from '../dto/create-case-tenant.dto';
import { SuccessResponse } from 'src/common/type/common.type';
import { CaseTenantValidationShared } from './case-tenant-validation-shared';
import { DeleteCaseTenantDto } from '../dto/delete-case-tenant';

@Injectable()
export class CaseTenantService {
  constructor(
    private readonly caseTenantRepository: CaseTenantRepository,
    private readonly caseTenantValidationShared: CaseTenantValidationShared,
  ) {}

  async assignCasesToTenant(
    tenantId: string,
    createCaseTenantDto: CreateCaseTenantDto,
  ): Promise<SuccessResponse> {
    await this.caseTenantValidationShared.validateCaseTenant(
      createCaseTenantDto.caseIds,
      tenantId,
    );
    const caseTenant = await this.caseTenantRepository.getCaseTenant(
      createCaseTenantDto.caseIds,
      tenantId,
    );

    if (caseTenant.length > 0) {
      throw new ConflictException('Case-tenant mapping is already present');
    }

    const caseTenants = createCaseTenantDto.caseIds.map((caseId) => ({
      caseId,
      tenantId,
    }));
    return this.caseTenantRepository.createCaseTenants(caseTenants);
  }

  async removeCasesFromTenant(
    tenantId: string,
    deleteCaseTenantDto: DeleteCaseTenantDto,
  ): Promise<SuccessResponse> {
    await this.caseTenantValidationShared.validateCaseTenant(
      deleteCaseTenantDto.caseIds,
      tenantId,
    );
    const existingCaseTenant = await this.caseTenantRepository.getCaseTenant(
      deleteCaseTenantDto.caseIds,
      tenantId,
    );
    if (existingCaseTenant.length == 0) {
      throw new NotFoundException('No valid case-tenant found');
    }

    return this.caseTenantRepository.deleteByCaseIds(
      deleteCaseTenantDto.caseIds,
      tenantId,
    );
  }

  async getCaseTenant(tenantId: string, caseId: string) {
    return this.caseTenantRepository.findOne({
      where: { tenantId, caseId },
    });
  }
}
