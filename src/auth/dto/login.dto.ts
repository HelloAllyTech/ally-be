import {
  IsString,
  IsNotEmpty,
  IsEnum,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsEmail,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole, AppType } from 'src/common/constants/user.constants';

export class LoginDto {
  @ApiProperty({
    description: 'Username for authentication',
    example: 'john_doe',
  })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({
    description: 'User password',
    example: 'password123',
    minLength: 6,
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class DevLoginDto {
  @ApiProperty({
    description:
      'Email of the seeded user to log in as. Local/dev only — bypasses OTP.',
    example: 'admin@example.com',
  })
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email!: string;
}

export class GenerateOtpV2Dto {
  @ApiProperty({
    description: 'Email for OTP generation',
    example: 'john_doe@example.com',
  })
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description: 'Allowed roles for OTP generation',
    example: [UserRole.CLIENT, UserRole.COUNSELOR],
  })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  @ArrayNotEmpty()
  allowedRoles!: UserRole[];

  @ApiProperty({
    description: 'App type for OTP generation (optional)',
    example: AppType.APP,
    enum: AppType,
    required: false,
  })
  @IsOptional()
  @ValidateIf((o) => o.appType !== undefined)
  @IsEnum(AppType)
  appType?: AppType;
}

export class VerifyOtpV2Dto {
  @ApiProperty({
    description: 'OTP for verification',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  otp!: string;

  @ApiProperty({
    description: 'Email for OTP verification',
    example: 'john_doe@example.com',
  })
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description: 'Allowed roles for OTP verification',
    example: [UserRole.CLIENT, UserRole.COUNSELOR],
  })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  @ArrayNotEmpty()
  allowedRoles!: UserRole[];
}

export class GenerateOtpV2ResponseDto {
  @ApiProperty({
    description: 'Success flag',
    example: true,
  })
  @IsBoolean()
  success!: boolean;

  @ApiProperty({
    description: 'OTP expiration time in seconds',
    example: 300,
  })
  @IsNumber()
  @IsNotEmpty()
  expiresIn!: number;
}

export class AuthenticationResponseDto {
  @ApiProperty({
    description: 'Access token',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  @ApiProperty({
    description: 'Refresh token',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;

  @ApiProperty({
    description: 'Token type',
    example: 'bearer',
  })
  @IsString()
  @IsNotEmpty()
  tokenType!: string;

  @ApiProperty({
    description: 'User',
    example: {
      id: 1,
      username: 'john_doe',
    },
  })
  user!: {
    id: number;
    username: string;
  };
}
