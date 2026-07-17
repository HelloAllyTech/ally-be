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

@Module({
  imports: [TypeOrmModule.forFeature([UserDailyScores]), TenantModule],
  controllers: [CommunityController, PracticeStreakController],
  providers: [
    LeaderboardService,
    PracticeStreakService,
    CommunitySharedService,
    CommunityEventConsumer,
    UserDailyScoreRepository,
  ],
  exports: [CommunitySharedService],
})
export class CommunityModule {}
