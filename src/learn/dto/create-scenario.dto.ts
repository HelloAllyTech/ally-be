import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

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
  @IsString()
  @IsNotEmpty()
  status!: string;

  @ApiProperty({
    description: 'Prompt of the scenario',
    example: 'Prompt 1',
  })
  @IsString()
  @IsOptional()
  prompt?: string;

  @ApiProperty({
    description: 'Metadata of the scenario',
    example: 'Metadata 1',
  })
  @IsString()
  @IsOptional()
  metadata?: Record<string, any>;
}
