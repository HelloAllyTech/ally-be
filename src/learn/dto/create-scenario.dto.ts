import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ScenarioStatus } from '../enum/scenario.status.enum';

export class CreateScenarioDto {
  @ApiProperty({
    description: 'Title of the scenario',
    example: 'Scenario 1',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Scenario of the scenario',
    example: 'Scenario 1',
  })
  @IsString()
  @IsNotEmpty()
  scenario!: string;

  @ApiProperty({
    description: 'Description of the scenario',
    example: 'Description 1',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({
    description: 'Cover image URL of the scenario',
    example: 'https://example.com/cover-image.png',
  })
  @IsString()
  @IsNotEmpty()
  coverImageUrl!: string;

  @ApiProperty({
    description: 'Status of the scenario',
    example: 'ACTIVE',
  })
  @IsEnum(ScenarioStatus)
  @IsNotEmpty()
  status!: ScenarioStatus;

  @ApiProperty({
    description: 'Prompt of the scenario',
    example: 'Prompt 1',
  })
  @IsString()
  @IsOptional()
  prompt?: string;

  @ApiProperty({
    description: 'Metadata of the scenario',
    example: { lifeHistory: 'value', gender: 'male', age: 42 },
  })
  @IsOptional()
  metadata?: Record<string, any>;
}
