import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';

export class CommunitySharedService {
  constructor(
    private readonly userDailyScoreRepository: UserDailyScoreRepository,
  ) {}
}
