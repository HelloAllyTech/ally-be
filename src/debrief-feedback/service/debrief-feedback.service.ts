import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebriefFeedback } from '../entity/debrief-feedback.entity';
import { SkillExperimentObservation } from 'src/skill-experiment/entity/skill-experiment-observation.entity';
import { SkillObservationStatus } from 'src/skill-experiment/enum/skill-experiment.enum';

@Injectable()
export class DebriefFeedbackService {
  constructor(
    @InjectRepository(DebriefFeedback)
    private readonly feedbackRepo: Repository<DebriefFeedback>,
    @InjectRepository(SkillExperimentObservation)
    private readonly observationRepo: Repository<SkillExperimentObservation>,
  ) {}

  async createFeedback(
    tenantId: string,
    scenarioSessionId: string,
    rating: 'positive' | 'negative',
    comment?: string,
  ) {
    const existing = await this.feedbackRepo.findOne({
      where: { scenarioSessionId },
    });
    if (existing) {
      throw new ConflictException('Feedback for this session already exists');
    }

    const feedback = this.feedbackRepo.create({
      tenantId,
      scenarioSessionId,
      rating,
      comment,
    });
    const savedFeedback = await this.feedbackRepo.save(feedback);

    // Link to skill experiment observation
    const observation = await this.observationRepo
      .createQueryBuilder('o')
      .where("o.context->>'scenarioSessionId' = :sessionId", {
        sessionId: scenarioSessionId,
      })
      .getOne();

    if (observation) {
      await this.observationRepo.update(observation.id, {
        status: SkillObservationStatus.JUDGED,
        score: rating === 'positive' ? 100 : 0,
        judgeSummary: 'User rated this debrief as helpful.',
        judgeModel: 'user-feedback',
        judgedAt: new Date(),
      });
    }

    return savedFeedback;
  }
}
