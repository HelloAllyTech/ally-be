import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Languages } from './entity/languages.entity';
import { LanguagesRepository } from './repository/languages.repository';
import { SharedLanguageService } from './service/shared-language.service';
import { LanguageController } from './controller/language.controller';
import { LanguageService } from './service/language.service';
import { UserModule } from 'src/user/user.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([Languages]),
    forwardRef(() => UserModule),
  ],
  controllers: [LanguageController],
  providers: [LanguagesRepository, SharedLanguageService, LanguageService],
  exports: [SharedLanguageService],
})
export class LanguageModule {}
