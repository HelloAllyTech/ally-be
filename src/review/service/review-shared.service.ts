import { Injectable } from '@nestjs/common';
import { ReviewRepository } from '../repository/review.repository';

@Injectable()
export class ReviewSharedService {
  constructor(private readonly reviewRepository: ReviewRepository) {}

  async getReviewByScenarioSessionId(scenarioSessionId: string) {
    return this.reviewRepository.findOne({ where: { scenarioSessionId } });
  }
}
