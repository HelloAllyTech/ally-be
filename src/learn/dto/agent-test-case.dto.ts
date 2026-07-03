import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAgentTestCaseDto {
  @ApiProperty({
    description: 'Title of the agent test case',
    example: 'Build rapport with the user',
  })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @ApiProperty({
    description: 'Category the test case belongs to',
    example: 'Relationship',
  })
  @IsNotEmpty()
  @IsString()
  category!: string;

  @ApiProperty({
    description: 'Free-text description of the test case',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Condition under which this test case applies',
    required: false,
  })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiProperty({
    description: 'The test / assertion the agent is evaluated against',
    required: false,
  })
  @IsOptional()
  @IsString()
  test?: string;
}

export class UpdateAgentTestCaseDto {
  @ApiProperty({
    description: 'Title of the agent test case',
    required: false,
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    description: 'Category the test case belongs to',
    required: false,
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    description: 'Free-text description of the test case',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Condition under which this test case applies',
    required: false,
  })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiProperty({
    description: 'The test / assertion the agent is evaluated against',
    required: false,
  })
  @IsOptional()
  @IsString()
  test?: string;
}

export class AgentTestCaseResponseDto {
  @ApiProperty({ description: 'ID of the agent test case' })
  id!: string;

  @ApiProperty({ description: 'Title of the agent test case' })
  title!: string;

  @ApiProperty({ description: 'Category the test case belongs to' })
  category!: string;

  @ApiProperty({
    description: 'Free-text description of the test case',
    required: false,
  })
  description?: string;

  @ApiProperty({
    description: 'Condition under which this test case applies',
    required: false,
  })
  condition?: string;

  @ApiProperty({
    description: 'The test / assertion the agent is evaluated against',
    required: false,
  })
  test?: string;
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
