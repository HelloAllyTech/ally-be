import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CreateCopilotSessionDto {
  @ApiProperty({ description: 'The roleplay spec this copilot session edits' })
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
}

export class SuggestedTestCaseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  test?: string;
}

/**
 * Accepting suggest_test_cases output: creates agent_test_cases rows and
 * appends their ids to the draft spec's agentTestCaseIds.
 */
export class AcceptSuggestedTestCasesDto {
  @ApiProperty({ type: [SuggestedTestCaseDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SuggestedTestCaseDto)
  testCases!: SuggestedTestCaseDto[];
}
