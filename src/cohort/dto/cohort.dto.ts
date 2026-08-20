import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import {
  CohortContentType,
  UNASSIGNED_COHORT_ID,
} from '../constants/cohort.constants';

export class CreateCohortDto {
  @ApiProperty({ example: 'Night shift' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ example: 'Counsellors on the 10pm–6am rota' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateCohortDto {
  @ApiPropertyOptional({ example: 'Night shift (IST)' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ example: 'Counsellors on the 10pm–6am rota' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CohortDto {
  @ApiProperty({
    description: `Cohort id, or the literal "${UNASSIGNED_COHORT_ID}" for the synthesised bucket of users who are in no cohort.`,
    example: '9f1c1a7e-1b3c-4a6b-8af0-4a9b6e593b09',
  })
  id!: string;

  @ApiProperty({ example: 'Night shift' })
  name!: string;

  @ApiPropertyOptional({ example: 'Counsellors on the 10pm–6am rota' })
  description?: string | null;

  @ApiProperty({
    description: 'Live members of this cohort.',
    example: 12,
  })
  memberCount!: number;

  @ApiProperty({
    description:
      'True only for the synthesised “Unassigned” bucket, which cannot be ' +
      'renamed or deleted but can be targeted by a restriction like any cohort.',
    example: false,
  })
  isUnassignedBucket!: boolean;
}

export class CohortListResponseDto {
  @ApiProperty({ type: CohortDto, isArray: true })
  data!: CohortDto[];

  @ApiProperty({
    description:
      'Tenant users counted across all cohorts plus the Unassigned bucket — ' +
      'the denominator an admin needs to see that the partition is complete.',
    example: 48,
  })
  totalUsers!: number;
}

export class CohortMemberDto {
  @ApiProperty({ example: 274 })
  userId!: number;

  @ApiProperty({ example: 'Asha Menon' })
  name!: string;

  @ApiProperty({ example: 'asha@example.org' })
  email!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiPropertyOptional({
    description: 'Null when the user is in no cohort.',
    example: '9f1c1a7e-1b3c-4a6b-8af0-4a9b6e593b09',
  })
  cohortId?: string | null;

  @ApiPropertyOptional({ example: 'Night shift' })
  cohortName?: string | null;
}

export class CohortMemberListResponseDto {
  @ApiProperty({ type: CohortMemberDto, isArray: true })
  data!: CohortMemberDto[];

  @ApiProperty({ example: 48 })
  count!: number;
}

export class GetCohortMembersQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or email.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: `Filter to one cohort, or "${UNASSIGNED_COHORT_ID}" for users in no cohort.`,
  })
  @IsOptional()
  @IsString()
  cohortId?: string;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class MoveCohortMembersDto {
  @ApiProperty({
    description: 'Users to move. All must belong to the target tenant.',
    type: [Number],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one user is required' })
  @IsInt({ each: true })
  userIds!: number[];

  @ApiProperty({
    description:
      `Destination cohort id, or "${UNASSIGNED_COHORT_ID}" to remove these ` +
      'users from whatever cohort they are in. Membership is exclusive, so a ' +
      'move always replaces any existing membership rather than adding one.',
  })
  @IsString()
  cohortId!: string;
}

export class SetCohortRestrictionsDto {
  @ApiProperty({ enum: CohortContentType })
  @IsEnum(CohortContentType)
  contentType!: CohortContentType;

  @ApiProperty({
    description:
      'Content id — an integer for scenarios, a uuid for courses and cases. ' +
      'Sent as a string either way and validated against the content type.',
    example: '42',
  })
  @IsString()
  contentId!: string;

  @ApiProperty({
    description:
      'The cohorts allowed to see this item. An EMPTY array clears every ' +
      `restriction, returning the item to tenant-wide visibility. Include ` +
      `"${UNASSIGNED_COHORT_ID}" to also admit users who are in no cohort.`,
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  cohortIds!: string[];
}

export class GetCohortRestrictionsQueryDto {
  @ApiProperty({ enum: CohortContentType })
  @IsEnum(CohortContentType)
  contentType!: CohortContentType;

  @ApiPropertyOptional({
    description:
      'Comma-separated content ids to fetch restrictions for. Omit to fetch ' +
      'every restricted item of this type in the tenant.',
    example: '42,43',
  })
  @IsOptional()
  @IsString()
  contentIds?: string;
}

export class ContentCohortRestrictionDto {
  @ApiProperty({ example: '42' })
  contentId!: string;

  @ApiProperty({
    description:
      'Cohorts this item is restricted to. Absent from the response entirely ' +
      'when the item has no restrictions (i.e. is visible tenant-wide).',
    type: [String],
  })
  cohortIds!: string[];
}
