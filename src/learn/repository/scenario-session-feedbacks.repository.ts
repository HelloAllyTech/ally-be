import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ScenarioSessionFeedbacks } from '../entity/scenario-session-feedbacks.entity';

@Injectable()
export class ScenarioSessionFeedbacksRepository extends Repository<ScenarioSessionFeedbacks> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessionFeedbacks, dataSource.createEntityManager());
  }

  async findByScenarioSessionId(
    scenarioSessionId: string,
    entityManager?: EntityManager,
  ): Promise<ScenarioSessionFeedbacks | null> {
    const repository = entityManager
      ? entityManager.getRepository(ScenarioSessionFeedbacks)
      : this;
    return repository.findOne({
      where: { scenarioSessionId },
    });
  }

  async createFeedback(
    data: Partial<ScenarioSessionFeedbacks>,
    entityManager?: EntityManager,
  ): Promise<ScenarioSessionFeedbacks> {
    const repository = entityManager
      ? entityManager.getRepository(ScenarioSessionFeedbacks)
      : this;
    const feedback = repository.create(data);
    return repository.save(feedback);
  }
}
