import { IsUUID, IsOptional, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetSummaryFieldsDto {
  @ApiProperty({
    description: 'Tenant ID',
  })
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class UpdateSummaryFieldsDto {
  @ApiProperty({
    description: 'Hidden fields',
  })
  @IsArray()
  @IsString({ each: true })
  hiddenFields!: string[];

  @ApiProperty({
    description: 'Tenant ID',
  })
  @IsUUID()
  tenantId!: string;
}
