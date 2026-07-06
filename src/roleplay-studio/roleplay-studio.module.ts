import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from 'src/ai/ai.module';
import { LiveKitModule } from 'src/livekit/livekit.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { ProcessorRegistry } from 'src/ai/processors/processor-registry';
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
import { RoleplaySessionService } from './service/roleplay-session.service';
import { DirectorTelemetryService } from './service/director-telemetry.service';
import { DirectorStateTransitionProcessor } from './processor/director-state-transition.processor';
import { DirectorRubricScoreProcessor } from './processor/director-rubric-score.processor';
import { DirectorDisclosureUnlockProcessor } from './processor/director-disclosure-unlock.processor';
import { DirectorStageDirectionProcessor } from './processor/director-stage-direction.processor';
import { RoleplaySessionSummaryProcessor } from './processor/roleplay-session-summary.processor';
import { RoleplaySpecController } from './controller/roleplay-spec.controller';
import { CopilotController } from './controller/copilot.controller';
import { RoleplaySessionController } from './controller/roleplay-session.controller';
import { RoleplayStudioWebhookController } from './controller/roleplay-studio-webhook.controller';

/**
 * Roleplay Studio v2 — spec authoring (copilot-driven), rehearsal, and the
 * ROLEPLAY_V2 session runtime. Deliberately self-contained: the v1 learn
 * module is never imported for its providers (entities are reached through
 * the shared DataSource), so v1 stays untouched.
 *
 * The director SQS processors are registered dynamically from onModuleInit
 * via ProcessorRegistry.registerCustomProcessor — zero edits under
 * src/ai/processors/.
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
    AiModule,
    LiveKitModule,
    PromptModule,
    LlmUsageModule,
  ],
  controllers: [
    RoleplaySpecController,
    CopilotController,
    RoleplaySessionController,
    RoleplayStudioWebhookController,
  ],
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
    RoleplaySessionService,
    DirectorTelemetryService,
    DirectorStateTransitionProcessor,
    DirectorRubricScoreProcessor,
    DirectorDisclosureUnlockProcessor,
    DirectorStageDirectionProcessor,
    RoleplaySessionSummaryProcessor,
  ],
  exports: [
    RoleplaySpecService,
    SpecValidatorService,
    SpecCompilerService,
    RoleplaySessionService,
  ],
})
export class RoleplayStudioModule implements OnModuleInit {
  constructor(
    private readonly processorRegistry: ProcessorRegistry,
    private readonly stateTransitionProcessor: DirectorStateTransitionProcessor,
    private readonly rubricScoreProcessor: DirectorRubricScoreProcessor,
    private readonly disclosureUnlockProcessor: DirectorDisclosureUnlockProcessor,
    private readonly stageDirectionProcessor: DirectorStageDirectionProcessor,
    private readonly sessionSummaryProcessor: RoleplaySessionSummaryProcessor,
  ) {}

  onModuleInit(): void {
    this.processorRegistry.registerCustomProcessor(
      this.stateTransitionProcessor,
    );
    this.processorRegistry.registerCustomProcessor(this.rubricScoreProcessor);
    this.processorRegistry.registerCustomProcessor(
      this.disclosureUnlockProcessor,
    );
    this.processorRegistry.registerCustomProcessor(
      this.stageDirectionProcessor,
    );
    this.processorRegistry.registerCustomProcessor(
      this.sessionSummaryProcessor,
    );
  }
}
