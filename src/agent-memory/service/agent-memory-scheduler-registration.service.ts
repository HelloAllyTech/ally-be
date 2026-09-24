import { Injectable, OnModuleInit } from '@nestjs/common';

import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';

import {
  AGENT_MEMORY_CURATE_INTERVAL,
  AGENT_MEMORY_CURATE_TASK,
  AGENT_MEMORY_REINDEX_INTERVAL,
  AGENT_MEMORY_REINDEX_TASK,
} from '../constants/agent-memory.constants';
import { AgentMemoryCuratorService } from './agent-memory-curator.service';
import { AgentMemoryService } from './agent-memory.service';

@Injectable()
export class AgentMemorySchedulerRegistrationService implements OnModuleInit {
  constructor(
    private readonly curator: AgentMemoryCuratorService,
    private readonly memoryService: AgentMemoryService,
  ) {}

  onModuleInit(): void {
    // Fold the candidates each agent wrote into its curated set. Hourly: a
    // sweep writes at 2am and its entries should be searchable by the next
    // one, and nothing about a notebook needs to be tidier than that. No-ops
    // on one COUNT per agent when nothing is new.
    scheduledTaskRegistry.register(
      AGENT_MEMORY_CURATE_INTERVAL,
      AGENT_MEMORY_CURATE_TASK,
      () => this.curator.consolidateAll().then(() => undefined),
    );

    // Heal the derived index. A write lands in Postgres first and is pushed
    // to Weaviate best-effort; if ally-ai was down at that moment the entry
    // exists but cannot be found. This is what makes that a delay rather than
    // a permanent hole. One indexed query when nothing is pending.
    scheduledTaskRegistry.register(
      AGENT_MEMORY_REINDEX_INTERVAL,
      AGENT_MEMORY_REINDEX_TASK,
      () => this.memoryService.reindexPending().then(() => undefined),
    );
  }
}
