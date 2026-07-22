import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CopilotSessionMode } from '../enum/copilot-session-mode.enum';

/**
 * Structured answer for select/dropdown/behaviour-review questions. The FE
 * also sends a human-readable `message`; the orchestrator renders these
 * fields (ids + custom values) into the persisted content so the copilot can
 * act on them deterministically, and keeps the raw payload in metadata for
 * resume fidelity.
 */
export class CopilotAnswerDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Selected option ids (competency/language/test-case ids…)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptionIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Custom free-text values the trainer added to the answer',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customValues?: string[];

  @ApiPropertyOptional({ description: 'Trainer chose "None of these"' })
  @IsOptional()
  @IsBoolean()
  none?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Behaviour review — confirmed helpful behaviour names',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  helpful?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Behaviour review — confirmed unhelpful behaviour names',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unhelpful?: string[];
}

export class CreateCopilotSessionDto {
  @ApiProperty({ description: 'The roleplay spec this copilot session edits' })
  @IsUUID()
  specId!: string;

  @ApiPropertyOptional({
    enum: CopilotSessionMode,
    description:
      'Starting mode (defaults to BUILDING). Use ITERATING to open a session ' +
      'straight into feedback-driven refinement of an already-built spec.',
  })
  @IsOptional()
  @IsEnum(CopilotSessionMode)
  mode?: CopilotSessionMode;
}

export class SetCopilotSessionModeDto {
  @ApiProperty({
    enum: CopilotSessionMode,
    description:
      'The mode to switch the copilot session to: BUILDING (authoring interview) ' +
      'or ITERATING (refine from live-test feedback).',
  })
  @IsEnum(CopilotSessionMode)
  mode!: CopilotSessionMode;
}

export class ListCopilotSessionsQueryDto {
  @ApiProperty({ description: 'Spec whose sessions to list' })
  @IsUUID()
  specId!: string;
}

export class CreateCopilotMessageDto {
  @ApiProperty({ description: "The trainer's message for this turn" })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({
    description:
      'When answering an ask_trainer question, the question id being answered',
  })
  @IsOptional()
  @IsUUID()
  questionId?: string;

  @ApiPropertyOptional({
    type: CopilotAnswerDto,
    description:
      'Structured answer payload for select/dropdown/behaviour-review questions',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CopilotAnswerDto)
  answer?: CopilotAnswerDto;
}
