import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiModule } from 'src/ai/ai.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';

import { AgentMemory } from './entity/agent-memory.entity';
import { AgentMemoryRepository } from './repository/agent-memory.repository';
import { AgentMemoryService } from './service/agent-memory.service';
import { AgentMemoryCuratorService } from './service/agent-memory-curator.service';
import { AgentMemorySchedulerRegistrationService } from './service/agent-memory-scheduler-registration.service';

/**
 * The notebook an Ally agent keeps of what it has learned — see
 * docs/bug-hunter-memory-adr.md and `AgentMemory`.
 *
 * Its own module rather than a corner of BugHunterModule because the table is
 * agent-scoped: Bug Hunter is the first writer, Builder's lessons are the next
 * to move in (OPP-0714), and neither should import the other to reach it. It
 * has no controller of its own; each agent exposes the endpoints it needs on
 * its own surface with its own auth (Bug Hunter's pipeline key and admin JWT).
 */
@Module({
  imports: [TypeOrmModule.forFeature([AgentMemory]), AiModule, LlmAgentModule],
  providers: [
    AgentMemoryRepository,
    AgentMemoryService,
    AgentMemoryCuratorService,
    AgentMemorySchedulerRegistrationService,
  ],
  exports: [AgentMemoryService, AgentMemoryCuratorService],
})
export class AgentMemoryModule {}
