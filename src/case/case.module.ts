import { Module, forwardRef } from '@nestjs/common';
import { LearnModule } from 'src/learn/learn.module';
import { TenantModule } from 'src/tenant/tenant.module';
import { CaseController } from './controller/case.controller';
import { CaseService } from './service/case.service';
import { CaseRepository } from './repository/case.repository';
import { CaseSharedService } from './service/case-shared.service';
import { CaseTenantService } from './service/case-tenant.service';
import { CaseItemRepository } from './repository/case-item.repository';
import { CaseTenantRepository } from './repository/case-tenant.repository';
import { CaseSessionRepository } from './repository/case-session.repository';
import { CaseSessionService } from './service/case-session.service';
import { CaseTenantValidationShared } from './service/case-tenant-validation-shared';
import { CaseSessionItemRepository } from './repository/case-session-item.repository';
import { CaseSessionController } from './controller/case-session.controller';

@Module({
  imports: [forwardRef(() => LearnModule), TenantModule],
  controllers: [CaseController, CaseSessionController],
  providers: [
    CaseService,
    CaseRepository,
    CaseSharedService,
    CaseTenantService,
    CaseItemRepository,
    CaseTenantRepository,
    CaseSessionRepository,
    CaseSessionService,
    CaseTenantValidationShared,
    CaseSessionItemRepository,
    CaseSessionRepository,
  ],
  exports: [CaseSharedService, CaseSessionService],
})
export class CaseModule {}
