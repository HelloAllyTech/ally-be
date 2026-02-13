// TODO: Handle correctly - util created to resolve circular dependency

import { In, Not, IsNull } from 'typeorm';
import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ScenariosRepository } from '../repository/scenario.repository';
import { Scenarios } from '../entity/scenarios.entity';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ScenarioFilters } from '../type/scenario-filter.type';
import { GetScenarioDto } from '../dto/get-scenario.dto';
import { ScenarioTranslationsRepository } from '../repository/scenario-translations.repository';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioSessionMessagesRepository } from '../repository/scenario-session-messages.repository';
import { ScenarioSessionMessages } from '../entity/scenario-session-messages.entity';
import { ScenarioSessionDetailsRepository } from '../repository/scenario-session-details.repository';

@Injectable()
export class ScenarioSharedService {
  private static readonly logger = LoggerService.getInstance(
    ScenarioSharedService.name,
  );
  constructor(
    private readonly scenariosRepository: ScenariosRepository,
    private scenarioSessionRepository: ScenarioSessionRepository,
    private scenarioTranslationsRepository: ScenarioTranslationsRepository,
    private scenarioSessionMessagesRepository: ScenarioSessionMessagesRepository,
    private scenarioSessionDetailsRepository: ScenarioSessionDetailsRepository,
  ) {}

  async getScenarioByIds(
    scenarioIds: number[],
    filters?: ScenarioFilters,
  ): Promise<Scenarios[]> {
    return this.scenariosRepository.findBy({
      id: In(scenarioIds),
      ...(filters?.status && { status: In([filters.status]) }),
    });
  }

  async getScenarioWithTriggerWarningsByIds(
    scenarioIds: number[],
  ): Promise<GetScenarioDto[]> {
    return this.scenariosRepository.getScenarioWithTriggerWarningsByIds(
      scenarioIds,
    );
  }

  async getScenarioById(scenarioId: number): Promise<Scenarios | null> {
    return this.scenariosRepository.findOne({
      where: { id: scenarioId },
    });
  }

  async getScenarioSessionById(
    scenarioSessionId: string,
  ): Promise<ScenarioSessions | null> {
    return this.scenarioSessionRepository.findOne({
      where: { id: scenarioSessionId },
    });
  }

  async getScenarioSessionForUser(
    scenarioSessionId: string,
    userId: number,
  ): Promise<ScenarioSessions | null> {
    return this.scenarioSessionRepository.findOne({
      where: { id: scenarioSessionId, counselorId: userId },
    });
  }

  async getUniqueLanguagesFromScenarioTranslations(): Promise<number[]> {
    return this.scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations();
  }

  async getMessagesByScenarioSessionId(
    scenarioSessionId: string,
    pagination: Pagination,
  ) {
    const [messages, count] =
      await this.scenarioSessionMessagesRepository.getMessagesByScenarioSessionId(
        scenarioSessionId,
        pagination,
      );

    return { messages, count };
  }

  async getMessagesByIds(
    messageIds: number[],
  ): Promise<ScenarioSessionMessages[]> {
    return this.scenarioSessionMessagesRepository.find({
      where: { id: In(messageIds) },
    });
  }
  async getPreviousScenarioSessionByCaseSessionItemId(
    caseSessionItemId: string,
  ) {
    return this.scenarioSessionRepository.findOne({
      where: { caseSessionItemId, score: Not(IsNull()) },
      order: { score: 'DESC' },
    });
  }

  async getScenarioSessionDetailsByScenarioSessionId(
    scenarioSessionId: string,
  ) {
    return this.scenarioSessionDetailsRepository.findOne({
      where: { scenarioSessionId },
    });
  }

  async getSessionGlimpseByScenarioSessionId(
    scenarioSessionId: string,
  ): Promise<string | null> {
    const scenarioSessionDetails =
      await this.scenarioSessionDetailsRepository.findOne({
        where: { scenarioSessionId },
      });
    if (!scenarioSessionDetails) {
      throw new NotFoundException('Scenario session details not found');
    }
    return scenarioSessionDetails.summary?.feedback?.sessionGlimpse;
  }
}
