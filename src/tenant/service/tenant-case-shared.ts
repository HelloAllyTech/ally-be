import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Case } from 'src/case/entity/case.entity';
import { CaseTenant } from 'src/case/entity/case-tenant.entity';

@Injectable()
export class TenantCaseSharedService {
  private static readonly logger = LoggerService.getInstance(
    TenantCaseSharedService.name,
  );

  constructor() {}

  async assignGlobalCasesToTenant(
    tenantId: string,
    entityManager: EntityManager,
  ): Promise<void> {
    const caseRepo = entityManager.getRepository(Case);

    const globalCases = await caseRepo.find({
      where: { isGlobal: true },
    });

    if (globalCases.length === 0) {
      TenantCaseSharedService.logger.warn('No global cases found to assign');
      return;
    }

    const caseTenantRepo = entityManager.getRepository(CaseTenant);

    const mappings = globalCases.map((caseEntity) => ({
      caseId: caseEntity.id,
      tenantId,
    }));

    await caseTenantRepo.insert(mappings);
  }
}
