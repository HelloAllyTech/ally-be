import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCompetencyDto {
  @ApiPropertyOptional({
    description:
      'Name of the competency. Optional when isCustom is true — the server ' +
      'generates a name of the form "{userId}_custom_{N}".',
    example: 'Communication Skills',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description:
      'Create a user-owned custom competency (scoped to the creator and hidden ' +
      'from the global competency list). The name is server-generated.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isCustom?: boolean;
}

export class UpdateCompetencyDto {
  @ApiProperty({
    description: 'Name of the competency',
    example: 'Communication Skills',
  })
  @IsNotEmpty()
  @IsString()
  name!: string;
}

export class CreateCompetencyResponseDto {
  @ApiProperty({ description: 'ID of the created competency' })
  id!: string;

  @ApiProperty({ description: 'Name of the competency' })
  name!: string;

  @ApiProperty({
    description: 'Whether this is a user-owned custom competency',
  })
  isCustom!: boolean;
}

export class CompetencyResponseDto {
  @ApiProperty({ description: 'ID of the competency' })
  id!: string;

  @ApiProperty({ description: 'Name of the competency' })
  name!: string;

  @ApiProperty({
    description: 'Whether this is a user-owned custom competency',
  })
  isCustom!: boolean;
}

export class GetCompetenciesResponseDto {
  @ApiProperty({
    type: [CompetencyResponseDto],
    description: 'List of competencies',
  })
  data!: CompetencyResponseDto[];

  @ApiProperty({ description: 'Total count of competencies' })
  count!: number;
}
