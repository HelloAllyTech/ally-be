import { Injectable } from '@nestjs/common';
import { LanguagesRepository } from 'src/language/repository/languages.repository';
import { LLM_CONFIG_SCHEMA } from '../constants/provider-config-schemas.constants';
import { LlmConfigs } from '../entity/llm-configs.entity';
import { LlmConfigsRepository } from '../repository/llm-configs.repository';
import { ProviderConfigService } from './provider-config.service';

@Injectable()
export class LlmConfigService extends ProviderConfigService<LlmConfigs> {
  protected readonly schema = LLM_CONFIG_SCHEMA;
  protected readonly label = 'LLM config';

  constructor(
    protected readonly repository: LlmConfigsRepository,
    private readonly languagesRepository: LanguagesRepository,
  ) {
    super();
  }

  protected async findDependentLanguageLabels(id: string): Promise<string[]> {
    const rows = await this.languagesRepository.find({
      where: { llmConfigId: id },
      select: ['label'],
    });
    return rows.map((language) => language.label);
  }
}
