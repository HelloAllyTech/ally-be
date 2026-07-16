import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { RoleplaySpecDocument } from '../type/roleplay-spec-document.type';

export class CreateRoleplaySpecDto {
  @ApiProperty({ description: 'Spec (and thin scenario) title' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ description: 'Primary competency this spec trains' })
  @IsOptional()
  @IsUUID()
  competencyId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'All competencies this spec trains (first-class multi-select)',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  competencyIds?: string[];

  @ApiPropertyOptional({
    description: 'Optional initial draft spec document (jsonb, schema "1.0")',
  })
  @IsOptional()
  @IsObject()
  spec?: Partial<RoleplaySpecDocument>;
}

export class UpdateRoleplaySpecDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  competencyId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'All competencies this spec trains (first-class multi-select)',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  competencyIds?: string[] | null;
}

export class UpdateRoleplaySpecDraftDto {
  @ApiProperty({ description: 'The full draft spec document' })
  @IsObject()
  spec!: Partial<RoleplaySpecDocument>;

  @ApiProperty({
    description:
      'Optimistic-concurrency token: the draft updatedAt the client last saw. Mismatch → 409.',
  })
  @IsDateString()
  expectedUpdatedAt!: string;
}

export class CreateRoleplaySpecVersionDto {
  @ApiPropertyOptional({ description: 'Optional snapshot label' })
  @IsOptional()
  @IsString()
  name?: string;
}

export class PublishRoleplaySpecVersionDto {
  @ApiPropertyOptional({
    description:
      'Skip the rehearsal gate (publish without a COMPLETED rehearsal for this version)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class ShareRoleplaySpecTenantsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  tenantIds!: string[];
}

export class ListRoleplaySpecsQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated statuses' })
  @IsOptional()
  @IsString()
  statuses?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
