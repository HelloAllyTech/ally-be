import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateCompetencyClusterDto {
  @ApiProperty({
    description: 'Name of the cluster',
    example: 'Core Communication',
  })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Competencies to place in the cluster',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  competencyIds?: string[];
}

export class UpdateCompetencyClusterDto {
  @ApiPropertyOptional({ description: 'New name for the cluster' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Replaces the cluster’s full membership. Omit to leave membership alone.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  competencyIds?: string[];
}

export class CompetencyClusterResponseDto {
  @ApiProperty({ description: 'ID of the cluster' })
  id!: string;

  @ApiProperty({ description: 'Name of the cluster' })
  name!: string;

  @ApiProperty({
    type: [String],
    description:
      'Competencies in this cluster. Selecting the cluster in the simulation ' +
      'builder expands to exactly these.',
  })
  competencyIds!: string[];
}

export class GetCompetencyClustersResponseDto {
  @ApiProperty({
    type: [CompetencyClusterResponseDto],
    description: 'List of clusters',
  })
  data!: CompetencyClusterResponseDto[];

  @ApiProperty({ description: 'Total count of clusters' })
  count!: number;
}
