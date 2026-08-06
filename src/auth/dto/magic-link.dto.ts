import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from 'src/common/constants/user.constants';
import { IsAllowedRoles } from 'src/common/decorator/allowed-roles.decorator';

export class MagicLinkLoginRequestDto {
  @ApiProperty({
    description: 'Email for login',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class MagicLinkOtpVerifyDto {
  @ApiProperty({
    description: 'Email used for login request',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description: 'One-Time Password',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  otp!: string;
}

export class MagicLinkVerifyDto {
  @ApiProperty({
    description: 'Magic Link Token',
    example: 'uuid-v4-token',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({
    description: 'Allowed roles for magic link verification',
    example: [UserRole.CLIENT, UserRole.COUNSELOR],
  })
  @IsAllowedRoles()
  allowedRoles!: UserRole[];
}
