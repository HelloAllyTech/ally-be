import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
export class UpdateScenarioDto {
  @ApiProperty({
    description: 'Title of the scenario',
    example: 'Scenario 1',
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    description: 'Scenario of the scenario',
    example: 'Scenario 1',
  })
  @IsString()
  @IsOptional()
  scenario?: string;

  @ApiProperty({
    description: 'Description of the scenario',
    example: 'Description 1',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Cover image URL of the scenario',
    example: 'https://example.com/cover-image.png',
  })
  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @ApiProperty({
    description: 'Status of the scenario',
    example: 'ACTIVE',
  })
  @IsString()
  @IsOptional()
  status?: string;

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
