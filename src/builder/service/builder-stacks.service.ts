import { Injectable } from '@nestjs/common';
import { StacksClientService } from 'src/llm-agent/service/stacks-client.service';

/**
 * Builder's handle on the shared Stacks client.
 *
 * The client moved to `src/llm-agent/service/stacks-client.service.ts` when
 * Course Copilot needed the same retrieval; this subclass keeps Builder's
 * module wiring and imports unchanged. The wire-format notes (JSON-RPC over
 * one POST, both Accept types, SSE-framed replies) live on the shared class.
 */
@Injectable()
export class BuilderStacksService extends StacksClientService {}
