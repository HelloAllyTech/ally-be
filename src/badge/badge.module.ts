import { forwardRef, Module } from '@nestjs/common';
import { BadgeUserRepository } from './repository/badge-user.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadgeController } from './controller/badge.controller';
import { BadgeService } from './service/badge.service';
import { BadgeTenantService } from './service/badge-tenant.service';
import { BadgeRepository } from './repository/badge.repository';
import { BadgeGroupRepository } from './repository/badge-group.repository';
import { BadgeTenantRepository } from './repository/badge-tenant.repository';
import { Badge } from './entity/badge.entity';
import { BadgeUser } from './entity/badge-user.entity';
import { BadgeGroup } from './entity/badge-group.entity';
import { BadgeTenant } from './entity/badge-tenant.entity';
import { TenantModule } from '../tenant/tenant.module';
import { BadgeUserService } from './service/badge-user.service';
import { AuthorizationModule } from 'src/authorization/authorization.module';
import { CommunityModule } from 'src/community/community.module';
import { ScenarioSessionReviewModule } from 'src/scenario-session-review/scenario-session-review.module';
import { BadgeEventConsumer } from './consumer/badge.event.consumer';
import { BadgeAwardService } from './service/badge-award.service';
import { AwsModule } from 'src/aws/aws.module';
import { AuditModule } from 'src/audit/audit.module';
import { UserModule } from 'src/user/user.module';
import { LanguageModule } from 'src/language/language.module';
import { LearnModule } from 'src/learn/learn.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Badge, BadgeUser, BadgeGroup, BadgeTenant]),
    TenantModule,
    AuthorizationModule,
    forwardRef(() => ScenarioSessionReviewModule),
    CommunityModule,
    AwsModule,
    AuditModule,
    forwardRef(() => UserModule),
    LanguageModule,
    forwardRef(() => LearnModule),
  ],
  controllers: [BadgeController],
  providers: [
    BadgeService,
    BadgeTenantService,
    BadgeRepository,
    BadgeGroupRepository,
    BadgeUserRepository,
    BadgeTenantRepository,
    BadgeUserService,
    BadgeEventConsumer,
    BadgeAwardService,
  ],
})
export class BadgeModule {}
