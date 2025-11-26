import { forwardRef, Module } from '@nestjs/common';
import { ScenarioPathController } from './controller/scenario-path.controller';
import { ScenarioPathService } from './service/scenario-path.service';
import { ScenarioPathRepository } from './repository/scenario-path.repository';
import { ScenarioPathItemRepository } from './repository/scenario-path-item.repository';
import { ScenarioPathSessionService } from './service/scenario-path-session.service';
import { ScenarioPathSessionRepository } from './repository/scenario-path-session.repository';
import { ScenarioPathSessionItemRepository } from './repository/scenario-path-session-item.repository';
import { ScenarioPathSharedService } from './service/scenario-path-shared.service';
import { ScenarioPathSessionController } from './controller/scenario-path-session.controller';
import { LearnModule } from 'src/learn/learn.module';
import { TenantModule } from 'src/tenant/tenant.module';
import { ScenarioPathTenantService } from './service/scenario-path-tenant.service';
import { ScenarioPathTenantRepository } from './repository/scenario-path-tenant.repository';
import { ScenarioPathTenantValidationShared } from './service/scenario-tenant-validation-shared';

@Module({
  imports: [forwardRef(() => LearnModule), TenantModule],
  controllers: [ScenarioPathController, ScenarioPathSessionController],
  providers: [
    ScenarioPathService,
    ScenarioPathSharedService,
    ScenarioPathRepository,
    ScenarioPathItemRepository,
    ScenarioPathSessionService,
    ScenarioPathSessionRepository,
    ScenarioPathSessionItemRepository,
    ScenarioPathTenantService,
    ScenarioPathTenantRepository,
    ScenarioPathTenantValidationShared,
  ],
  exports: [
    ScenarioPathService,
    ScenarioPathSessionService,
    ScenarioPathRepository,
    ScenarioPathItemRepository,
    ScenarioPathSharedService,
    ScenarioPathTenantService,
  ],
})
export class ScenarioPathModule {}
