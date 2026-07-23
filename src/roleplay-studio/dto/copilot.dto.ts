import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

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

/**
 * Auto-improve bridge: the server injects the referenced test report into the
 * turn (AUTO_IMPROVE_MESSAGE_TEMPLATE), consumes the turn to completion even
 * if the client disconnects, and re-runs the report's test case when the
 * copilot patched the spec.
 */
export class CopilotAutoImproveDto {
  @ApiProperty({
    description: 'COMPLETED test report driving this auto-improve turn',
  })
  @IsUUID()
  reportId!: string;
}

export class CreateCopilotSessionDto {
  @ApiProperty({ description: 'The roleplay spec this copilot session edits' })
  @IsUUID()
  specId!: string;
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

  @ApiPropertyOptional({
    type: CopilotAutoImproveDto,
    description:
      'Marks this turn as an auto-improve request for a test report; the ' +
      'report content is injected server-side',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CopilotAutoImproveDto)
  autoImprove?: CopilotAutoImproveDto;
}
