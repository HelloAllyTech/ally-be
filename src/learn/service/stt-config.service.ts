import { Injectable } from '@nestjs/common';
import { LanguagesRepository } from 'src/language/repository/languages.repository';
import { STT_CONFIG_SCHEMA } from '../constants/provider-config-schemas.constants';
import { SttConfigs } from '../entity/stt-configs.entity';
import { SttConfigsRepository } from '../repository/stt-configs.repository';
import { ProviderConfigService } from './provider-config.service';

@Injectable()
export class SttConfigService extends ProviderConfigService<SttConfigs> {
  protected readonly schema = STT_CONFIG_SCHEMA;
  protected readonly label = 'STT config';

  constructor(
    protected readonly repository: SttConfigsRepository,
    private readonly languagesRepository: LanguagesRepository,
  ) {
    super();
  }

  protected async findDependentLanguageLabels(id: string): Promise<string[]> {
    const rows = await this.languagesRepository.find({
      where: { sttConfigId: id },
      select: ['label'],
    });
    return rows.map((language) => language.label);
  }
}
