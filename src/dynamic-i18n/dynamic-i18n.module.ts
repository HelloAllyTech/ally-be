import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from 'src/audit/audit.module';
import { User } from 'src/user/entity/user.entity';
import { DynamicI18nController } from './controller/dynamic-i18n.controller';
import { DynamicI18nService } from './service/dynamic-i18n.service';

@Module({
  imports: [AuditModule, TypeOrmModule.forFeature([User])],
  controllers: [DynamicI18nController],
  providers: [DynamicI18nService],
  exports: [DynamicI18nService],
})
export class DynamicI18nModule {}
