import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsArray,
  IsEnum,
  ArrayNotEmpty,
  IsNotEmpty,
  IsUUID,
} from 'class-validator';
import { UserRole } from 'src/common/constants/user.constants';

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
  @IsUUID()
  @IsNotEmpty()
  @IsString()
  tenantId!: string;

  @ApiProperty({
    description: 'External ID',
    example: 'external-123',
  })
  @IsOptional()
  @IsString()
  externalId?: string;
}
