import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from 'src/authorization/authorization.module';
import { CommunityModule } from 'src/community/community.module';
import { ProgressController } from './controller/progress.controller';
import { ProgressEventConsumer } from './consumer/progress.event.consumer';
import { UserProgress } from './entity/user-progress.entity';
import { XpEvent } from './entity/xp-event.entity';
import { UserProgressRepository } from './repository/user-progress.repository';
import { XpEventRepository } from './repository/xp-event.repository';
import { ProgressService } from './service/progress.service';
import { ProgressSharedService } from './service/progress-shared.service';
import { ProgressTenantResolver } from './service/progress-tenant.resolver';
import { XpAwardService } from './service/xp-award.service';

/**
 * Learner Progress — XP, levels and the personal dashboard.
 *
 * Nothing here is imported by the modules it reacts to. Session and track XP arrive as
 * in-process events, which keeps this module a leaf and avoids a forwardRef against
 * LearnModule and TrackModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([XpEvent, UserProgress]),
    CommunityModule,
    AuthorizationModule,
  ],
  controllers: [ProgressController],
  providers: [
    ProgressService,
    ProgressSharedService,
    XpAwardService,
    ProgressTenantResolver,
    ProgressEventConsumer,
    XpEventRepository,
    UserProgressRepository,
  ],
  exports: [ProgressService, ProgressSharedService],
})
export class ProgressModule {}
