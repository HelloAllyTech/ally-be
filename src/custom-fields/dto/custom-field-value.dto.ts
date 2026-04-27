import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CustomFieldEditPermission,
  CustomFieldFillMode,
  CustomFieldType,
  SingleSelectOption,
} from '../entity/custom-field-definition.entity';

export class FieldValueEntryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fieldDefinitionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  value?: string;
}

export class UpsertCustomFieldValuesDto {
  @ApiProperty({ type: [FieldValueEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldValueEntryDto)
  values!: FieldValueEntryDto[];
}

export class CustomFieldValueResponseDto {
  @ApiProperty()
  fieldDefinitionId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: CustomFieldType })
  fieldType!: CustomFieldType;

  @ApiPropertyOptional({ type: 'array' })
  options?: SingleSelectOption[];

  @ApiProperty()
  sectionKey!: string;

  @ApiProperty()
  sectionLabel!: string;

  @ApiProperty({ enum: CustomFieldEditPermission })
  editPermission!: CustomFieldEditPermission;

  @ApiProperty({ enum: CustomFieldFillMode })
  fillMode!: CustomFieldFillMode;

  @ApiProperty()
  displayOrder!: number;

  @ApiPropertyOptional({ nullable: true })
  value!: string | null;
}
