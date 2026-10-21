import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebriefFeedback } from '../entity/debrief-feedback.entity';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { SkillExperimentObservation } from 'src/skill-experiment/entity/skill-experiment-observation.entity';
import { SkillObservationStatus } from 'src/skill-experiment/enum/skill-experiment.enum';

@Injectable()
export class DebriefFeedbackService {
  constructor(
    @InjectRepository(DebriefFeedback)
    private readonly feedbackRepo: Repository<DebriefFeedback>,
    @InjectRepository(SkillExperimentObservation)
    private readonly observationRepo: Repository<SkillExperimentObservation>,
    @InjectRepository(ScenarioSessions)
    private readonly scenarioSessionRepo: Repository<ScenarioSessions>,
  ) {}

  async createFeedback(
    tenantId: string,
    userId: number,
    scenarioSessionId: string,
    rating: 'positive' | 'negative',
    comment?: string,
  ) {
    // Only the learner who ran the session may rate its debrief. The rating
    // judges the session's skill-experiment observation, and feedback is one
    // row per session, so anyone else rating first would both steer the
    // experiment and lock the learner out with a 409.
    const scenarioSession = await this.scenarioSessionRepo.findOne({
      where: { id: scenarioSessionId, tenantId },
      select: { id: true, counselorId: true },
    });
    if (!scenarioSession) {
      throw new NotFoundException('Scenario session not found');
    }
    if (scenarioSession.counselorId !== userId) {
      throw new ForbiddenException(
        'Only the learner who ran this session can rate its debrief',
      );
    }

    const existing = await this.feedbackRepo.findOne({
      where: { scenarioSessionId, tenantId },
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
      .andWhere('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.skillError IS NULL')
      .getOne();

    if (observation) {
      await this.observationRepo.update(observation.id, {
        status: SkillObservationStatus.JUDGED,
        score: rating === 'positive' ? 100 : 0,
        judgeSummary:
          rating === 'positive'
            ? 'User rated this debrief as helpful.'
            : 'User rated this debrief as not helpful.',
        judgeModel: 'user-feedback',
        judgedAt: new Date(),
      });
    }

    return savedFeedback;
  }
}
