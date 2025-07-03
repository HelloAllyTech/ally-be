import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

export class GenerateOtpDto {
  @ApiProperty({
    description: 'Phone number for OTP generation',
    example: '+1234567890',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    description: 'Email for OTP generation',
    example: 'john_doe@example.com',
  })
  @IsString()
  @IsOptional()
  email?: string;
}

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Phone number for OTP verification',
    example: '+1234567890',
  })
  @IsString()
  @IsOptional()
  phone?: string;

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
  @IsOptional()
  email?: string;
}
