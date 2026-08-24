import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChangelogController } from './controller/changelog.controller';
import { ChangelogEntry } from './entity/changelog-entry.entity';
import { ChangelogEntryRepository } from './repository/changelog-entry.repository';
import { ChangelogService } from './service/changelog.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChangelogEntry])],
  controllers: [ChangelogController],
  providers: [ChangelogEntryRepository, ChangelogService],
  exports: [ChangelogService],
})
export class ChangelogModule {}
