import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CopilotRunStatus } from '../enum/copilot-run.enum';
import {
  CopilotRunConfig,
  CopilotRoundHistoryEntry,
} from '../type/copilot-run.type';

export class CreateCopilotRunDto {
  @ApiProperty({
    description: 'Free-text description of the roleplay actor to build',
    example:
      'A 28-year-old new mother struggling with postpartum anxiety who is reluctant to admit she needs help.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  brief!: string;

  @ApiProperty({
    description:
      'promptCode of the selected main-agent prompt variant ("skill"). ' +
      'Determines which Basic Settings fields are generated.',
    required: false,
  })
  @IsOptional()
  @IsString()
  skillPromptCode?: string;

  @ApiProperty({
    description:
      'Model id to run field generation on (e.g. gpt-4o, claude-sonnet-4-6). ' +
      'Provider is derived from the model id server-side.',
    required: false,
  })
  @IsOptional()
  @IsString()
  model?: string;
}

export class CreateCopilotRunResponseDto {
  @ApiProperty({ description: 'ID of the Copilot run', format: 'uuid' })
  runId!: string;

  @ApiProperty({ enum: CopilotRunStatus, example: CopilotRunStatus.STARTED })
  status!: CopilotRunStatus;
}

export class CopilotRunDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: CopilotRunStatus })
  status!: CopilotRunStatus;

  @ApiProperty()
  brief!: string;

  @ApiProperty({ type: Object })
  config!: CopilotRunConfig;

  @ApiProperty({ required: false })
  draftScenarioId?: number;

  @ApiProperty({ example: 2 })
  round!: number;

  @ApiProperty({ required: false, example: 74 })
  bestScore?: number;

  @ApiProperty({
    required: false,
    description:
      'Generated field values that produced the best score. Applied to the ' +
      'Basic Settings form when the run finishes.',
    type: Object,
  })
  bestFieldValues?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    description: 'Per-round history (score, metrics, markdown, field values).',
    type: Object,
    isArray: true,
  })
  roundHistory?: CopilotRoundHistoryEntry[];

  @ApiProperty({ required: false })
  errorMessage?: string;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;

  @ApiProperty({ type: Date, required: false })
  endedAt?: Date;
}
