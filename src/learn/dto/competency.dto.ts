import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCompetencyDto {
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
}

export class CompetencyResponseDto {
  @ApiProperty({ description: 'ID of the competency' })
  id!: string;

  @ApiProperty({ description: 'Name of the competency' })
  name!: string;
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
