import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * A cluster a competency belongs to. Names are the natural key on the
 * competency side of the API: the editor creates a cluster by typing its name,
 * so the server find-or-creates by name (case-insensitively) rather than
 * making the client do a create-then-link round-trip.
 */
export class CompetencyClusterRefDto {
  @ApiProperty({ description: 'ID of the cluster' })
  id!: string;

  @ApiProperty({ description: 'Name of the cluster' })
  name!: string;
}

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

  @ApiPropertyOptional({
    type: [String],
    description:
      'Clusters this competency belongs to, by name. Unknown names create the ' +
      'cluster. Ignored for custom competencies, which are private to their ' +
      'owner and never grouped.',
    example: ['Core Communication'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  clusterNames?: string[];
}

export class UpdateCompetencyDto {
  @ApiProperty({
    description: 'Name of the competency',
    example: 'Communication Skills',
  })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Replaces the clusters this competency belongs to, by name. Unknown ' +
      'names create the cluster; an empty array removes it from all of them. ' +
      'Omit to leave clustering alone.',
    example: ['Core Communication'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  clusterNames?: string[];
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

  @ApiPropertyOptional({
    type: [CompetencyClusterRefDto],
    description: 'Clusters this competency belongs to (may be several)',
  })
  clusters?: CompetencyClusterRefDto[];
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

  @ApiPropertyOptional({
    type: [CompetencyClusterRefDto],
    description: 'Clusters this competency belongs to (may be several)',
  })
  clusters?: CompetencyClusterRefDto[];
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
