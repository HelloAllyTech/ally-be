import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsArray,
  IsEnum,
  ArrayNotEmpty,
  IsNotEmpty,
  IsPositive,
  IsNumber,
  MinLength,
  Matches,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { UserRole } from 'src/common/constants/user.constants';
import { PASSWORD_VALIDATION } from 'src/common/constants/validation.constants';

export class AddUserDto {
  @ApiProperty({
    description: 'User email',
    example: 'john_doe@example.com',
  })
  @IsEmail({}, { message: 'Invalid email' })
  email!: string;

  @ApiProperty({
    description: 'User name',
    example: 'John Doe',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'User roles (array of roles)',
    example: [UserRole.CLIENT, UserRole.COUNSELOR],
    type: [String],
    enum: UserRole,
    isArray: true,
  })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  @ArrayNotEmpty()
  roles!: UserRole[];

  @ApiProperty({
    description: 'Phone number',
    example: '+1234567890',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: 'Tenant ID(UUID)',
    example: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
  })
  @IsNotEmpty()
  @IsString()
  tenantId!: string;

  @ApiProperty({
    description: 'External ID',
    example: 'external-123',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (!value || value.trim() === '' ? null : value))
  externalId?: string;

  @ApiProperty({
    description: 'Simulation credit limit',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  simulationCreditLimit?: number;

  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({
    description: 'User password (optional)',
    example: 'password123',
    minLength: 6,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_VALIDATION.MIN_LENGTH)
  @Matches(PASSWORD_VALIDATION.REGEX)
  password?: string;
}
