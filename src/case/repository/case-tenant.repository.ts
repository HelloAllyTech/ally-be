import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { CaseTenant } from '../entity/case-tenant.entity';
import { SuccessResponse } from 'src/common/type/common.type';

@Injectable()
export class CaseTenantRepository extends Repository<CaseTenant> {
  constructor(private dataSource: DataSource) {
    super(CaseTenant, dataSource.createEntityManager());
  }

  async createCaseTenants(
    caseTenants: Array<{ caseId: string; tenantId: string }>,
  ): Promise<SuccessResponse> {
    await this.save(this.create(caseTenants));
    return {
      success: true,
    };
  }

  async getCaseTenant(
    caseIds: string[],
    tenantId: string,
  ): Promise<CaseTenant[]> {
    return this.find({
      where: { tenantId, caseId: In(caseIds) },
    });
  }

  async deleteByCaseIds(
    caseIds: string[],
    tenantId: string,
  ): Promise<SuccessResponse> {
    const result = await this.delete({
      tenantId,
      caseId: In(caseIds),
    });
    return { success: result.affected !== 0 };
  }
}
