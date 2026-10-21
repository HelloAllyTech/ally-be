import {
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
    // experiment and lock the learner out of the session's single row.
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

    // The debrief asks for a rating first and an optional comment second, as
    // two posts to this endpoint. A blank comment is no comment.
    const trimmedComment = comment?.trim() || undefined;

    const existing = await this.feedbackRepo.findOne({
      where: { scenarioSessionId, tenantId },
    });
    if (existing) {
      // The first rating stands: it has already judged the session's
      // skill-experiment observation, and the UI locks the thumbs once one is
      // picked. A later post only adds the comment, so the observation is not
      // re-judged.
      if (!trimmedComment) return existing;
      existing.comment = trimmedComment;
      return this.feedbackRepo.save(existing);
    }

    const feedback = this.feedbackRepo.create({
      tenantId,
      scenarioSessionId,
      rating,
      comment: trimmedComment,
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
