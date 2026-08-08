import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDailyScores } from './entity/user-daily-scores.entity';
import { UserDailyScoreRepository } from './repository/user-daily-score.repository';
import { CommunityController } from './controller/community.controller';
import { PracticeStreakController } from './controller/practice-streak.controller';
import { LeaderboardService } from './service/leaderboard.service';
import { PracticeStreakService } from './service/practice-streak.service';
import { CommunitySharedService } from './service/community-shared.service';
import { CommunityEventConsumer } from './consumer/community.event.consumer';
import { TenantModule } from 'src/tenant/tenant.module';
import { BadgeStreakMilestoneSharedService } from 'src/badge/service/badge-streak-milestone-shared.service';
import { StreakReminderService } from './service/streak-reminder.service';
import { StreakReminderSchedulerRegistrationService } from './service/streak-reminder-scheduler-registration.service';
import { RedisModule } from 'src/redis/redis.module';
import { AwsModule } from 'src/aws/aws.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserDailyScores]),
    TenantModule,
    RedisModule,
    AwsModule,
  ],
  controllers: [CommunityController, PracticeStreakController],
  providers: [
    LeaderboardService,
    PracticeStreakService,
    CommunitySharedService,
    CommunityEventConsumer,
    UserDailyScoreRepository,
    // Lives in the badge folder but is provided here, the same way TenantModule
    // provides BadgeTenantSharedService. BadgeModule imports CommunityModule and
    // exports nothing, so injecting it normally would require a forwardRef.
    BadgeStreakMilestoneSharedService,
    StreakReminderService,
    StreakReminderSchedulerRegistrationService,
  ],
  exports: [CommunitySharedService],
})
export class CommunityModule {}
