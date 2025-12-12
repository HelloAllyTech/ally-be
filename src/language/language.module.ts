import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Languages } from './entity/languages.entity';
import { LanguagesRepository } from './repository/languages.repository';

import { SharedLanguageService } from './service/shared-language.service';

@Module({
  imports: [TypeOrmModule.forFeature([Languages])],
  controllers: [],
  providers: [LanguagesRepository, SharedLanguageService],
  exports: [SharedLanguageService],
})
export class LanguageModule {}
