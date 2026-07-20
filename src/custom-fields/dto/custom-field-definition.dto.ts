import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CustomFieldEditPermission,
  CustomFieldFillMode,
  CustomFieldType,
} from '../entity/custom-field-definition.entity';

export class SingleSelectOptionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label!: string;

  @ApiProperty()
  @IsInt()
  order!: number;
}

export class CreateCustomFieldDefinitionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: CustomFieldType })
  @IsEnum(CustomFieldType)
  fieldType!: CustomFieldType;

  @ApiPropertyOptional({ type: [SingleSelectOptionDto] })
  @ValidateIf(
    (o) =>
      o.fieldType === CustomFieldType.SINGLE_SELECT ||
      o.fieldType === CustomFieldType.MULTI_SELECT,
  )
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SingleSelectOptionDto)
  options?: SingleSelectOptionDto[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sectionKey!: string;

  @ApiProperty({ enum: CustomFieldEditPermission })
  @IsEnum(CustomFieldEditPermission)
  editPermission!: CustomFieldEditPermission;

  @ApiPropertyOptional({ enum: CustomFieldFillMode })
  @IsOptional()
  @IsEnum(CustomFieldFillMode)
  fillMode?: CustomFieldFillMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  aiInstruction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showInTable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class ReorderCustomFieldDefinitionsDto {
  @ApiProperty({
    type: [String],
    description: 'All active definition IDs in the desired display order',
  })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

export class UpdateCustomFieldDefinitionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ type: [SingleSelectOptionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SingleSelectOptionDto)
  options?: SingleSelectOptionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sectionKey?: string;

  @ApiPropertyOptional({ enum: CustomFieldEditPermission })
  @IsOptional()
  @IsEnum(CustomFieldEditPermission)
  editPermission?: CustomFieldEditPermission;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showInTable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: CustomFieldFillMode })
  @IsOptional()
  @IsEnum(CustomFieldFillMode)
  fillMode?: CustomFieldFillMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  aiInstruction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
