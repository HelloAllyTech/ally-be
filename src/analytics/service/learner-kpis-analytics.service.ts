import { Injectable } from '@nestjs/common';
import {
  LearnerKpisQueryDto,
  LearnerKpisResponseDto,
  LearnerSignupPointDto,
} from '../dto/learner-kpis-analytics.dto';
import { LearnerKpisAnalyticsRepository } from '../repository/learner-kpis-analytics.repository';

@Injectable()
export class LearnerKpisAnalyticsService {
  constructor(private readonly repository: LearnerKpisAnalyticsRepository) {}

  async getLearnerKpis(
    query: LearnerKpisQueryDto,
  ): Promise<LearnerKpisResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const [activity, signups] = await Promise.all([
      this.repository.getActivitySummary(tenantId),
      this.repository.getSignupsByMonth(tenantId),
    ]);

    let cumulative = 0;
    const signupsByMonth: LearnerSignupPointDto[] = signups.map((row) => {
      cumulative += row.newLearners;
      return {
        month: row.month,
        newLearners: row.newLearners,
        cumulativeLearners: cumulative,
      };
    });

    return {
      summary: {
        totalLearners: cumulative,
        activeLearners: activity.activeLearners,
        totalCompletedSessions: activity.totalCompletedSessions,
      },
      signupsByMonth,
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
