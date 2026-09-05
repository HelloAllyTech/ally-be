import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { ScenarioCharacter } from './entity/scenario-character.entity';
import { CharacterInterviewSession } from './entity/character-interview-session.entity';
import { CharacterInterviewMessage } from './entity/character-interview-message.entity';
import { ScenarioCharacterController } from './controller/scenario-character.controller';
import { CharacterInterviewController } from './controller/character-interview.controller';
import { ScenarioCharacterService } from './service/scenario-character.service';
import { CharacterLibraryAccessService } from './service/character-library-access.service';
import { CharacterInterviewSessionService } from './service/character-interview-session.service';
import { CharacterInterviewToolsService } from './service/character-interview-tools.service';
import { CharacterInterviewOrchestratorService } from './service/character-interview-orchestrator.service';
import { ScenarioCharacterRepository } from './repository/scenario-character.repository';
import { CharacterInterviewSessionRepository } from './repository/character-interview-session.repository';
import { CharacterInterviewMessageRepository } from './repository/character-interview-message.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScenarioCharacter,
      ScenarioCharacterRepository,
      CharacterInterviewSession,
      CharacterInterviewMessage,
    ]),
    PromptModule,
    LlmUsageModule,
    LlmAgentModule,
  ],
  controllers: [ScenarioCharacterController, CharacterInterviewController],
  providers: [
    ScenarioCharacterService,
    CharacterLibraryAccessService,
    ScenarioCharacterRepository,
    CharacterInterviewSessionService,
    CharacterInterviewToolsService,
    CharacterInterviewOrchestratorService,
    CharacterInterviewSessionRepository,
    CharacterInterviewMessageRepository,
  ],
  exports: [ScenarioCharacterService],
})
export class ScenarioCharacterModule {}
