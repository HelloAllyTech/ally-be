import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CommonModule } from 'src/common/common.module';
import { LanguageModule } from 'src/language/language.module';
import { LearnModule } from 'src/learn/learn.module';

import { TooltipController } from './controller/tooltip.controller';
import { Tooltip } from './entity/tooltip.entity';
import { TooltipTranslations } from './entity/tooltip-translations.entity';
import { TooltipRepository } from './repository/tooltip.repository';
import { TooltipTranslationsRepository } from './repository/tooltip-translations.repository';
import { TooltipService } from './service/tooltip.service';
import { TooltipTranslationService } from './service/tooltip-translation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tooltip, TooltipTranslations]),
    LanguageModule,
    CommonModule,
    forwardRef(() => LearnModule),
  ],
  controllers: [TooltipController],
  providers: [
    TooltipService,
    TooltipRepository,
    TooltipTranslationsRepository,
    TooltipTranslationService,
  ],
  exports: [TooltipService, TooltipTranslationService],
})
export class TooltipModule {}
