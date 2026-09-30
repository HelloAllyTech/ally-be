import { Module } from '@nestjs/common';

import { ChangelogController } from './controller/changelog.controller';
import { ChangelogSourceService } from './service/changelog-source.service';
import { ChangelogService } from './service/changelog.service';
import { CodeActivityService } from './service/code-activity.service';

/**
 * No TypeORM: the changelog is a file in another repo, not a table here.
 * RedisService (the source service's cache) is provided globally by
 * RedisModule, so there is nothing to import.
 */
@Module({
  controllers: [ChangelogController],
  providers: [ChangelogSourceService, ChangelogService, CodeActivityService],
  // ChangelogSourceService is exported for product updates, which read the
  // same file as their input.
  exports: [ChangelogService, ChangelogSourceService],
})
export class ChangelogModule {}
