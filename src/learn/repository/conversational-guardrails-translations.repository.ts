import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ConversationalGuardrailsTranslations } from '../entity/conversational-guardrails-translations.entity';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class ConversationalGuardrailsTranslationsRepository extends Repository<ConversationalGuardrailsTranslations> {
  private readonly logger = LoggerService.getInstance(
    ConversationalGuardrailsTranslationsRepository.name,
  );

  constructor(private dataSource: DataSource) {
    super(ConversationalGuardrailsTranslations, dataSource.createEntityManager());
  }

  async getTranslationsByGuardrailId(guardrailId: string) {
    return this.createQueryBuilder('translation')
      .where('translation.guardrailId = :guardrailId', { guardrailId })
      .getMany();
  }

  async getTranslationsByLanguageId(languageId: number) {
    return this.createQueryBuilder('translation')
      .where('translation.languageId = :languageId', { languageId })
      .getMany();
  }

  async getTranslation(guardrailId: string, languageId: number) {
    return this.createQueryBuilder('translation')
      .where('translation.guardrailId = :guardrailId', { guardrailId })
      .andWhere('translation.languageId = :languageId', { languageId })
      .getOne();
  }

  async getTranslationsForGuardrails(guardrailIds: string[], languageId: number) {
    if (guardrailIds.length === 0) {
      return [];
    }
    return this.createQueryBuilder('translation')
      .where('translation.guardrailId IN (:...guardrailIds)', { guardrailIds })
      .andWhere('translation.languageId = :languageId', { languageId })
      .getMany();
  }
}
