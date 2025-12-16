import { In, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { CreateTriggerWarningDto } from '../dto/trigger-warning.dto';
import { ScenarioTriggerWarnings } from '../entity/scenario-trigger-warnings.entity';
import { Pagination } from 'src/common/type/common.type';
import { TriggerWarningsRepository } from '../repository/trigger-warnings.repository';

@Injectable()
export class TriggerWarningsService {
  constructor(
    private triggerWarningsRepository: TriggerWarningsRepository,
    @InjectRepository(ScenarioTriggerWarnings)
    private triggerWarningsScenarioRepository: Repository<ScenarioTriggerWarnings>,
  ) {}

  async getTriggerWarnings(name?: string, options?: Pagination) {
    return await this.triggerWarningsRepository.getTriggerWarnings(
      name,
      options,
    );
  }

  async getTriggerWarningsByIds(ids: string[]) {
    return await this.triggerWarningsRepository.find({
      where: { id: In(ids) },
    });
  }

  async createTriggerWarning(createTriggerWarningDto: CreateTriggerWarningDto) {
    const triggerWarning = this.triggerWarningsRepository.create(
      createTriggerWarningDto,
    );
    return this.triggerWarningsRepository.save(triggerWarning);
  }

  async assignTriggerWarningsToScenario(
    scenarioId: number,
    triggerWarningIds: string[],
  ) {
    const scenarioTriggerWarnings =
      this.triggerWarningsScenarioRepository.create(
        triggerWarningIds.map((triggerWarningId) => ({
          scenarioId,
          triggerWarningId,
        })),
      );
    return this.triggerWarningsScenarioRepository.save(scenarioTriggerWarnings);
  }
}
