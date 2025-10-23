import {
  IsEnum,
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsArray,
  ArrayNotEmpty,
  IsPositive,
  IsInt,
  Matches,
} from 'class-validator';
import { UserRole, UserStatus } from '../../common/constants/user.constants';
import { PASSWORD_VALIDATION } from '../../common/constants/validation.constants';
import { ApiProperty } from '@nestjs/swagger';

export class AddUserDto {
  @ApiProperty({
    description: 'User email',
    example: 'john_doe@example.com',
  })
  @IsEmail()
  email!: string;

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

  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({
    description: 'Tenant ID(UUID)',
    example: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
  })
  @IsString()
  tenantId!: string;

  @ApiProperty({
    description: 'External ID',
    example: 'external-123',
  })
  @IsOptional()
  @IsString()
  externalId?: string;
  @ApiProperty({
    description: 'User status',
    example: 'ACTIVE',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
    required: false,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiProperty({
    description: 'Simulation credit limit',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  simulationCreditLimit?: number;
}
