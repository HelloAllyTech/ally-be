import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiModule } from 'src/ai/ai.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { User } from 'src/user/entity/user.entity';
import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';

import { RoadmapAllocation } from './entity/roadmap-allocation.entity';
import { RoadmapInterviewNote } from './entity/roadmap-interview-note.entity';
import { RoadmapOpportunity } from './entity/roadmap-opportunity.entity';
import { RoadmapOpportunityComment } from './entity/roadmap-opportunity-comment.entity';
import { RoadmapOpportunityOwner } from './entity/roadmap-opportunity-owner.entity';
import { RoadmapProductGoal } from './entity/roadmap-product-goal.entity';
import { RoadmapStrategyGoal } from './entity/roadmap-strategy-goal.entity';
import { RoadmapOpportunityGoalImpact } from './entity/roadmap-opportunity-goal-impact.entity';
import { RoadmapRankWeights } from './entity/roadmap-rank-weights.entity';
import { RoadmapSavedView } from './entity/roadmap-saved-view.entity';
import { RoadmapUserMap } from './entity/roadmap-user-map.entity';
import { RoadmapUserTabOrder } from './entity/roadmap-user-tab-order.entity';

import { RoadmapAllocationRepository } from './repository/roadmap-allocation.repository';
import {
  RoadmapInterviewNoteRepository,
  RoadmapOpportunityCommentRepository,
  RoadmapUserTabOrderRepository,
} from './repository/roadmap-content.repository';
import { RoadmapOpportunityRepository } from './repository/roadmap-opportunity.repository';
import { RoadmapSavedViewRepository } from './repository/roadmap-saved-view.repository';
import {
  RoadmapOpportunityOwnerRepository,
  RoadmapProductGoalRepository,
} from './repository/roadmap-taxonomy.repository';
import {
  RoadmapGoalImpactRepository,
  RoadmapRankWeightsRepository,
  RoadmapStrategyGoalRepository,
} from './repository/roadmap-strategy.repository';

import { RoadmapAccessService } from './service/roadmap-access.service';
import { RoadmapAiService } from './service/roadmap-ai.service';
import { RoadmapAllocationService } from './service/roadmap-allocation.service';
import { RoadmapCommentService } from './service/roadmap-comment.service';
import { RoadmapInterviewNoteService } from './service/roadmap-content.service';
import { RoadmapNotificationService } from './service/roadmap-notification.service';
import { RoadmapImportService } from './service/roadmap-import.service';
import { RoadmapOpportunityService } from './service/roadmap-opportunity.service';
import { RoadmapSavedViewService } from './service/roadmap-saved-view.service';
import { RoadmapSplitMergeService } from './service/roadmap-split-merge.service';
import { RoadmapBuilderService } from './service/roadmap-builder.service';
import { BuilderModule } from 'src/builder/builder.module';
import { RoadmapBoardService } from './service/roadmap-board.service';
import { RoadmapTaxonomyService } from './service/roadmap-taxonomy.service';
import { RoadmapStrategyGoalService } from './service/roadmap-strategy-goal.service';
import { RoadmapGoalImpactService } from './service/roadmap-goal-impact.service';
import { RoadmapVectorService } from './service/roadmap-vector.service';

import { RoadmapAdminController } from './controller/roadmap-admin.controller';
import { RoadmapCollaborationController } from './controller/roadmap-collaboration.controller';
import { RoadmapOpportunityController } from './controller/roadmap-opportunity.controller';
import { RoadmapGateway } from './gateway/roadmap.gateway';
import { AwsModule } from 'src/aws/aws.module';

/**
 * Product Roadmap — the internal vote-based prioritisation board, rebuilt from the standalone
 * `sandeep-roadmap-app` (Next.js + Supabase). Global, not tenant-scoped.
 *
 * Access is three permissions rather than a role gate, because viewing and voting are meant to
 * be wider than management:
 *   view:admin:product-roadmap  → SUPER_ADMIN, SUPER_DUPER_ADMIN
 *   vote:admin:product-roadmap  → SUPER_ADMIN, SUPER_DUPER_ADMIN
 *   edit:admin:product-roadmap  → SUPER_DUPER_ADMIN only
 *
 * Schema: migrations 1871000000000 (tables) / …001 (monthly-cap trigger) / …002 (taxonomy
 * seed) / …003 (permission grants).
 *
 * Semantic duplicate detection lives in ally-ai's Weaviate (`RoadmapOpportunity` collection);
 * Postgres here is the system of record and the vector index is derived.
 *
 * ⚠️ DO NOT RUN `npm run migration:generate` FOR THIS MODULE. Several constraints exist only
 * in the migration SQL and are not expressible (or not worth expressing) in decorators: the
 * two FK-by-name relationships with ON UPDATE CASCADE, every CHECK constraint, the
 * `("createdAt" DESC)` index, and the partial index on embeddingStatus. `synchronize` is false
 * so none of that matters at runtime, but a generated migration would happily DROP all of it.
 * This is not specific to the roadmap — `typeorm schema:log` reports the same class of drift
 * for prompt_translations, lab_*, blogs, comfort_audio_tracks, scenarios and tracks. Migrations
 * in this repo are hand-written; keep them that way.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoadmapProductGoal,
      RoadmapStrategyGoal,
      RoadmapOpportunityGoalImpact,
      RoadmapRankWeights,
      RoadmapOpportunityOwner,
      RoadmapOpportunity,
      RoadmapAllocation,
      RoadmapOpportunityComment,
      RoadmapInterviewNote,
      RoadmapSavedView,
      RoadmapUserTabOrder,
      RoadmapUserMap,
      // Read-only: resolving createdBy ints to an email/name for responses. createdBy has no
      // FK, so this is a join done in the mapper rather than by the ORM.
      User,
      // Written (not just read) by RoadmapOpportunityService.create() when type=bug — see
      // there. Just the entity, not BugHunterModule, to avoid the circular-import trap.
      BugFinding,
    ]),
    // AiService — the Weaviate client for duplicate detection.
    AiModule,
    // PromptSharedService — resolves src/prompts/roadmap/*.txt (with any dashboard override)
    // for the five LLM flows.
    PromptModule,
    // LlmUsageService — token/cost accounting, which is mandatory for every LLM call here.
    LlmUsageModule,
    /**
     * BuilderSessionService — "Open in Builder Agent" on an opportunity.
     *
     * The whole module rather than the entity (the treatment BugFinding gets above) because
     * creating a session is real logic: slug allocation, the default budget ceiling and the
     * tenant caps all live in that service, and a roadmap-side INSERT would silently skip them.
     * Safe to import: nothing in Builder's graph reaches back here — only AnalyticsSuggestions
     * imports ProductRoadmapModule.
     */
    BuilderModule,
    /**
     * S3Service — presigned PUTs for opportunity reference images, and the URL parsing that
     * checks a stored image really is one of our own uploads.
     */
    AwsModule,
  ],
  controllers: [
    RoadmapOpportunityController,
    RoadmapCollaborationController,
    RoadmapAdminController,
  ],
  providers: [
    // repositories
    RoadmapProductGoalRepository,
    RoadmapStrategyGoalRepository,
    RoadmapGoalImpactRepository,
    RoadmapRankWeightsRepository,
    RoadmapOpportunityOwnerRepository,
    RoadmapOpportunityRepository,
    RoadmapAllocationRepository,
    RoadmapOpportunityCommentRepository,
    RoadmapInterviewNoteRepository,
    RoadmapSavedViewRepository,
    RoadmapUserTabOrderRepository,
    // services
    RoadmapNotificationService,
    RoadmapAccessService,
    RoadmapVectorService,
    RoadmapImportService,
    RoadmapOpportunityService,
    RoadmapAllocationService,
    RoadmapSplitMergeService,
    RoadmapBuilderService,
    RoadmapBoardService,
    RoadmapCommentService,
    RoadmapSavedViewService,
    RoadmapTaxonomyService,
    RoadmapStrategyGoalService,
    RoadmapGoalImpactService,
    RoadmapInterviewNoteService,
    RoadmapAiService,
    // realtime
    RoadmapGateway,
  ],
  /**
   * RoadmapOpportunityService is exported so AnalyticsSuggestionsModule can file
   * an accepted suggestion through THE SAME create() path a person filing by
   * hand uses. Writing the row through the exported repository instead would
   * skip the vector index and the realtime notify, which is how an opportunity
   * ends up invisible to duplicate detection and absent from an open board.
   * RoadmapProductGoalRepository goes with it: the goal name on a suggestion has
   * to be re-validated against the live taxonomy before it is stored.
   */
  exports: [
    RoadmapOpportunityRepository,
    RoadmapAllocationRepository,
    RoadmapOpportunityService,
    RoadmapProductGoalRepository,
  ],
})
export class ProductRoadmapModule {}
