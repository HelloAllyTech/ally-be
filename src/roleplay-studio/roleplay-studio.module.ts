import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleplaySpec } from './entity/roleplay-spec.entity';
import { RoleplaySpecVersion } from './entity/roleplay-spec-version.entity';
import { RoleplaySpecTenant } from './entity/roleplay-spec-tenant.entity';
import { CopilotSession } from './entity/copilot-session.entity';
import { CopilotMessage } from './entity/copilot-message.entity';
import { RehearsalRun } from './entity/rehearsal-run.entity';
import { RehearsalTranscript } from './entity/rehearsal-transcript.entity';
import { RoleplayDirectorEvent } from './entity/roleplay-director-event.entity';
import { RoleplayRubricScore } from './entity/roleplay-rubric-score.entity';
import { RoleplaySpecRepository } from './repository/roleplay-spec.repository';
import { RoleplaySpecVersionRepository } from './repository/roleplay-spec-version.repository';
import { RoleplaySpecTenantRepository } from './repository/roleplay-spec-tenant.repository';
import { CopilotSessionRepository } from './repository/copilot-session.repository';
import { CopilotMessageRepository } from './repository/copilot-message.repository';
import { RehearsalRunRepository } from './repository/rehearsal-run.repository';
import { RehearsalTranscriptRepository } from './repository/rehearsal-transcript.repository';
import { RoleplayDirectorEventRepository } from './repository/roleplay-director-event.repository';
import { RoleplayRubricScoreRepository } from './repository/roleplay-rubric-score.repository';
import { SpecValidatorService } from './service/spec-validator.service';
import { SpecCompilerService } from './service/spec-compiler.service';
import { RoleplaySpecService } from './service/roleplay-spec.service';
import { CopilotSessionService } from './service/copilot-session.service';
import { CopilotToolsService } from './service/copilot-tools.service';
import { CopilotOrchestratorService } from './service/copilot-orchestrator.service';
import { RoleplaySpecController } from './controller/roleplay-spec.controller';
import { CopilotController } from './controller/copilot.controller';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';

/**
 * Roleplay Studio v2 — spec authoring (copilot-driven), rehearsal, and the
 * ROLEPLAY_V2 session runtime. Deliberately self-contained: the v1 learn
 * module is never imported for its providers (entities are reached through
 * the shared DataSource), so v1 stays untouched.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoleplaySpec,
      RoleplaySpecVersion,
      RoleplaySpecTenant,
      CopilotSession,
      CopilotMessage,
      RehearsalRun,
      RehearsalTranscript,
      RoleplayDirectorEvent,
      RoleplayRubricScore,
    ]),
    PromptModule,
    LlmUsageModule,
  ],
  controllers: [RoleplaySpecController, CopilotController],
  providers: [
    RoleplaySpecRepository,
    RoleplaySpecVersionRepository,
    RoleplaySpecTenantRepository,
    CopilotSessionRepository,
    CopilotMessageRepository,
    RehearsalRunRepository,
    RehearsalTranscriptRepository,
    RoleplayDirectorEventRepository,
    RoleplayRubricScoreRepository,
    SpecValidatorService,
    SpecCompilerService,
    RoleplaySpecService,
    CopilotSessionService,
    CopilotToolsService,
    CopilotOrchestratorService,
  ],
  exports: [RoleplaySpecService, SpecValidatorService, SpecCompilerService],
})
export class RoleplayStudioModule {}
