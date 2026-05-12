import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';

import { TooltipTranslations } from '../entity/tooltip-translations.entity';

@Injectable()
export class TooltipTranslationsRepository extends Repository<TooltipTranslations> {
  private readonly logger = LoggerService.getInstance(
    TooltipTranslationsRepository.name,
  );

  constructor(private dataSource: DataSource) {
    super(TooltipTranslations, dataSource.createEntityManager());
  }

  async getTranslationsByTooltipId(tooltipId: string) {
    return this.find({ where: { tooltipId } });
  }

  async getTranslationsForTooltips(tooltipIds: string[], languageId: number) {
    if (tooltipIds.length === 0) return [];
    return this.createQueryBuilder('translation')
      .select(['translation.tooltipId', 'translation.tipText'])
      .where('translation.tooltipId IN (:...tooltipIds)', { tooltipIds })
      .andWhere('translation.languageId = :languageId', { languageId })
      .getMany();
  }
}
