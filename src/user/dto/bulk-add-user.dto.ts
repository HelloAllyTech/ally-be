import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from 'src/common/constants/user.constants';

export const BULK_ADD_USERS_MAX = 500;

export class BulkAddUsersDto {
  @ApiProperty({
    description: 'Email addresses of the users to create',
    example: ['john@example.com', 'jane@example.com'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_ADD_USERS_MAX)
  @IsEmail({}, { each: true, message: 'One or more emails are invalid' })
  emails!: string[];

  @ApiProperty({
    description: 'Roles applied to every created user',
    example: [UserRole.CLIENT],
    type: [String],
    enum: UserRole,
    isArray: true,
  })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  @ArrayNotEmpty()
  roles!: UserRole[];

  @ApiProperty({
    description: 'Tenant ID (UUID) applied to every created user',
    example: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
  })
  @IsNotEmpty()
  @IsString()
  tenantId!: string;

  @ApiProperty({
    description: 'Simulation credit limit applied to every created user',
    example: 100,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  simulationCreditLimit?: number;
}
