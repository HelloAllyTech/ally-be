import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDailyScores } from './entity/user-daily-scores.entity';
import { UserDailyScoreRepository } from './repository/user-daily-score.repository';
import { CommunityController } from './controller/community.controller';
import { LeaderboardService } from './service/leaderboard.service';
import { CommunitySharedService } from './service/community-shared.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserDailyScores])],
  controllers: [CommunityController],
  providers: [
    LeaderboardService,
    CommunitySharedService,
    UserDailyScoreRepository,
  ],
  exports: [CommunitySharedService],
})
export class CommunityModule {}
