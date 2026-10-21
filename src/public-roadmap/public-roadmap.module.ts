import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PublicRoadmapController } from './controller/public-roadmap.controller';
import { PublicRoadmapItem } from './entity/public-roadmap-item.entity';
import { PublicRoadmapItemRepository } from './repository/public-roadmap-item.repository';
import { PublicRoadmapService } from './service/public-roadmap.service';

/**
 * The public product roadmap at app.helloally.ai/blog/roadmap — hand-written
 * cards, edited from the admin console's Settings → Roadmap tab. Separate from
 * `ProductRoadmapModule`, which is the internal, voted opportunity backlog.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PublicRoadmapItem])],
  controllers: [PublicRoadmapController],
  providers: [PublicRoadmapService, PublicRoadmapItemRepository],
})
export class PublicRoadmapModule {}
