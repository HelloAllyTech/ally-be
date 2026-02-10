import {
  IsArray,
  IsString,
  IsOptional,
  IsEnum,
  ArrayNotEmpty,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PermissionOperator } from '../type/authorization-event.type';

export class ValidatePermissionsDto {
  @ApiProperty({
    description: 'Permissions to verify',
    example: ['view:admin:scenarios'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayNotEmpty()
  permissions!: string[];

  @ApiProperty({
    description: 'Operator to use for verification',
    example: 'AND',
  })
  @IsOptional()
  @IsEnum(PermissionOperator)
  operator?: PermissionOperator;
}
