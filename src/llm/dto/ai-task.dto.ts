import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  AiTaskKind,
  AiTaskProvider,
} from '../constants/ai-task-registry.constants';
import { LlmRuntime } from '../constants/llm-model-registry.constants';

/** Whether `effectiveModel` was read from this deployment or copied from a doc. */
export enum AiTaskModelSource {
  /** Resolved from this process's own config — what will actually run here. */
  DEPLOYMENT = 'deployment',
  /**
   * The value recorded in the registry for a call another service executes.
   * Accurate as of the last registry update, not read from that service's env.
   */
  DOCUMENTED = 'documented',
}

export class AiTaskResponseDto {
  @ApiProperty({
    description: 'Stable row id. Never reused for a different call.',
  })
  id!: string;

  @ApiPropertyOptional({
    enum: LlmTask,
    nullable: true,
    description:
      'Label written to llm_usage.task, or null for calls that record no usage.',
  })
  task!: LlmTask | null;

  @ApiProperty({
    enum: LlmRuntime,
    description: 'Service that executes the call.',
  })
  runtime!: LlmRuntime;

  @ApiProperty({
    description: 'What the user or the system did to trigger it.',
  })
  trigger!: string;

  @ApiProperty({
    nullable: true,
    description: 'Cadence, constraints, or why it exists.',
  })
  detail!: string | null;

  @ApiProperty({
    description:
      'True when it runs inside a live voice turn, where latency is visible.',
  })
  hotPath!: boolean;

  @ApiProperty({ enum: AiTaskKind, description: 'Shape of the API call.' })
  kind!: AiTaskKind;

  @ApiProperty({
    description: 'Vendor, or "resolved" when unknown until request time.',
  })
  provider!: AiTaskProvider;

  @ApiProperty({ description: 'Model id when nothing overrides it.' })
  defaultModel!: string;

  @ApiProperty({
    description:
      'Model this deployment will actually use, where ally-be can read it; otherwise ' +
      'the same as defaultModel.',
  })
  effectiveModel!: string;

  @ApiProperty({ enum: AiTaskModelSource })
  modelSource!: AiTaskModelSource;

  @ApiProperty({
    description: 'Env var, constant or config field holding the default.',
  })
  configuredBy!: string;

  @ApiProperty({
    nullable: true,
    description:
      'Prompt row whose own provider/model beats configuredBy when set. Non-null means ' +
      'provider and defaultModel on this row describe the fallback, not a fixed fact.',
  })
  promptOverride!: string | null;
}
