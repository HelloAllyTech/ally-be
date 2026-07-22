import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { AgentTestCaseType } from '../enum/agent-test-case.enum';

export class AgentTestCaseRubricDto {
  @ApiProperty({
    description: 'What this rubric row evaluates',
    example: 'Acknowledges the user’s emotion before problem-solving',
  })
  @IsString()
  criteria!: string;

  @ApiProperty({
    description: 'How the judge should score this criteria',
    example: 'Award full marks only if the emotion is named explicitly.',
  })
  @IsString()
  scoringInstructions!: string;
}

export class CreateAgentTestCaseDto {
  @ApiProperty({
    description: 'Title of the agent test case',
    example: 'Build rapport with the user',
  })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @ApiProperty({
    description: 'Test case type. Defaults to "condition" when omitted.',
    enum: AgentTestCaseType,
    default: AgentTestCaseType.CONDITION,
    required: false,
  })
  @IsOptional()
  @IsEnum(AgentTestCaseType)
  type?: AgentTestCaseType;

  @ApiProperty({
    description: 'Free-text tags used to group/search test cases',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({
    description: 'Free-text description of the test case',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Condition test cases: the condition to simulate',
    required: false,
  })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiProperty({
    description: 'Condition test cases: test pass description',
    required: false,
  })
  @IsOptional()
  @IsString()
  test?: string;

  @ApiProperty({
    description: 'Full-session test cases: rubric rows',
    type: [AgentTestCaseRubricDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentTestCaseRubricDto)
  rubrics?: AgentTestCaseRubricDto[];
}

export class UpdateAgentTestCaseDto {
  @ApiProperty({ description: 'Title of the agent test case', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    description: 'Test case type',
    enum: AgentTestCaseType,
    required: false,
  })
  @IsOptional()
  @IsEnum(AgentTestCaseType)
  type?: AgentTestCaseType;

  @ApiProperty({
    description: 'Free-text tags used to group/search test cases',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({
    description: 'Free-text description of the test case',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Condition test cases: the condition to simulate',
    required: false,
  })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiProperty({
    description: 'Condition test cases: test pass description',
    required: false,
  })
  @IsOptional()
  @IsString()
  test?: string;

  @ApiProperty({
    description: 'Full-session test cases: rubric rows',
    type: [AgentTestCaseRubricDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentTestCaseRubricDto)
  rubrics?: AgentTestCaseRubricDto[];
}

export class AgentTestCaseResponseDto {
  @ApiProperty({ description: 'ID of the agent test case' })
  id!: string;

  @ApiProperty({ description: 'Title of the agent test case' })
  title!: string;

  @ApiProperty({ enum: AgentTestCaseType, description: 'Test case type' })
  type!: AgentTestCaseType;

  @ApiProperty({ type: [String], description: 'Tags' })
  tags!: string[];

  @ApiProperty({
    description: 'Free-text description of the test case',
    required: false,
  })
  description?: string;

  @ApiProperty({
    description: 'Condition test cases: the condition to simulate',
    required: false,
  })
  condition?: string;

  @ApiProperty({
    description: 'Condition test cases: test pass description',
    required: false,
  })
  test?: string;

  @ApiProperty({
    description: 'Full-session test cases: rubric rows',
    type: [AgentTestCaseRubricDto],
    required: false,
  })
  rubrics?: AgentTestCaseRubricDto[];
}

export class GetAgentTestCasesResponseDto {
  @ApiProperty({
    type: [AgentTestCaseResponseDto],
    description: 'List of agent test cases',
  })
  data!: AgentTestCaseResponseDto[];

  @ApiProperty({ description: 'Total count of agent test cases' })
  count!: number;
}
