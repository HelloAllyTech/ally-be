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
 * Structured answer for select/dropdown questions. The FE also sends a
 * human-readable `message`; the orchestrator renders these fields (ids +
 * custom values) into the persisted content so the agent can act on them
 * deterministically, and keeps the raw payload in metadata for resume
 * fidelity. Same contract as the Roleplay Studio copilot's CopilotAnswerDto.
 */
export class CharacterInterviewAnswerDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Selected option ids',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptionIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Custom free-text values the admin added to the answer',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customValues?: string[];

  @ApiPropertyOptional({ description: 'Admin chose "None of these"' })
  @IsOptional()
  @IsBoolean()
  none?: boolean;
}

export class CreateCharacterInterviewMessageDto {
  @ApiProperty({ description: "The admin's message for this turn" })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({
    description:
      'When answering an ask_question question, the question id being answered',
  })
  @IsOptional()
  @IsUUID()
  questionId?: string;

  @ApiPropertyOptional({
    type: CharacterInterviewAnswerDto,
    description: 'Structured answer payload for select/dropdown questions',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CharacterInterviewAnswerDto)
  answer?: CharacterInterviewAnswerDto;
}
