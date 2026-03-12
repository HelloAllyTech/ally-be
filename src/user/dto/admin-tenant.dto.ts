import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsArray,
  ArrayNotEmpty,
  IsInt,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AssignAdminTenantsDto {
  @ApiProperty({
    description: 'User ID of the MULTI_TENANT_ADMIN to assign tenants to',
    example: 42,
  })
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  userId!: number;

  @ApiProperty({
    description: 'Array of tenant UUIDs to assign',
    example: ['c56a4180-65aa-42ec-a945-5fd21dec0538'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  tenantIds!: string[];
}

export class RemoveAdminTenantsDto {
  @ApiProperty({
    description: 'User ID of the MULTI_TENANT_ADMIN to remove tenants from',
    example: 42,
  })
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  userId!: number;

  @ApiProperty({
    description: 'Array of tenant UUIDs to remove',
    example: ['c56a4180-65aa-42ec-a945-5fd21dec0538'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  tenantIds!: string[];
}
