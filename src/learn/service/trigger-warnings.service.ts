import { In, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { CreateTriggerWarningDto } from '../dto/trigger-warning.dto';
import { ScenarioTriggerWarnings } from '../entity/scenario-trigger-warnings.entity';
import { Pagination } from 'src/common/type/common.type';
import { TriggerWarningsRepository } from '../repository/trigger-warnings.repository';

import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { TriggerWarningTranslatableFields } from '../type/scenario-translation-metadata.type';

@Injectable()
export class TriggerWarningsService {
  constructor(
    private triggerWarningsRepository: TriggerWarningsRepository,
    @InjectRepository(ScenarioTriggerWarnings)
    private triggerWarningsScenarioRepository: Repository<ScenarioTriggerWarnings>,
    private readonly openaiTranslationsService: OpenAITranslationsService,
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly scenarioSharedService: ScenarioSharedService,
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

  async getTriggerWarningsByScenarioId(scenarioId: number) {
    return await this.triggerWarningsScenarioRepository.find({
      where: { scenarioId },
    });
  }

  async createTriggerWarning(createTriggerWarningDto: CreateTriggerWarningDto) {
    const triggerWarning = this.triggerWarningsRepository.create(
      createTriggerWarningDto,
    );
    const savedTriggerWarning =
      await this.triggerWarningsRepository.save(triggerWarning);

    this.createTriggerWarningTranslations(savedTriggerWarning.id, {
      name: savedTriggerWarning.name,
    });
    return savedTriggerWarning;
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

  private async createTriggerWarningTranslations(
    triggerWarningId: string,
    triggerWarningData: TriggerWarningTranslatableFields,
  ) {
    const validLanguageIds: number[] =
      await this.scenarioSharedService.getUniqueLanguagesFromScenarioTranslations();

    if (!validLanguageIds || validLanguageIds.length === 0) {
      return;
    }

    const languageCodes =
      await this.sharedLanguageService.getValidLanguageCodes(validLanguageIds);

    if (!languageCodes || languageCodes.length === 0) {
      return;
    }

    const translated =
      await this.openaiTranslationsService.translateObjectToLanguages(
        triggerWarningData,
        languageCodes,
        'openai_translation_speech_reexpression_user',
      );

    if (translated) {
      await this.triggerWarningsRepository.update(triggerWarningId, {
        translations: translated,
      } as any);
    }
  }
}
