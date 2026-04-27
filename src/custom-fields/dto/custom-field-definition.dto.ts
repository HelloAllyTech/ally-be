import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CustomFieldEditPermission,
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
  @ValidateIf((o) => o.fieldType === CustomFieldType.SINGLE_SELECT)
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showInTable?: boolean;
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
  isActive?: boolean;
}
