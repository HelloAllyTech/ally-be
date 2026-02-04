import { IsArray, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSummarySectionsDto {
  @ApiProperty({
    description:
      'Hidden section ids (sections hidden for this tenant; super admin only)',
  })
  @IsArray()
  @IsString({ each: true })
  hiddenSections!: string[];

  @ApiProperty({ description: 'Tenant ID' })
  @IsUUID()
  tenantId!: string;
}

export class SummarySectionFieldResponseDto {
  @ApiProperty({ description: 'Field id' })
  id!: string;

  @ApiProperty({ description: 'Field label' })
  label!: string;

  @ApiProperty({ description: 'Whether the field is visible for this tenant' })
  visible!: boolean;
}

export class SummarySectionResponseDto {
  @ApiProperty({ description: 'Section id' })
  id!: string;

  @ApiProperty({ description: 'Section label' })
  label!: string;

  @ApiProperty({
    description:
      'Whether this section is enabled (true) or hidden (false) by default',
  })
  defaultVisibility!: boolean;

  @ApiProperty({
    description: 'Whether the section is enabled for this tenant',
  })
  enabled!: boolean;

  @ApiProperty({
    description: 'Fields in this section with their visibility',
    type: [SummarySectionFieldResponseDto],
  })
  fields!: SummarySectionFieldResponseDto[];
}

export class GetSummarySectionsResponseDto {
  @ApiProperty({
    description:
      'Sections with defaultVisibility, enabled state and per-section fields with visible state',
    type: [SummarySectionResponseDto],
  })
  sections!: SummarySectionResponseDto[];
}
