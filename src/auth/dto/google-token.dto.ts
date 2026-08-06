import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { UserRole } from 'src/common/constants/user.constants';
import { IsAllowedRoles } from 'src/common/decorator/allowed-roles.decorator';

export class GoogleSignInDto {
  @ApiProperty({
    description: 'Google ID Token',
    example: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.sig',
  })
  @IsOptional()
  @IsString()
  idToken?: string;

  @ApiProperty({
    description: 'Google Access Token',
    example: 'ya29.a0AfH6SMBxxxx',
  })
  @IsOptional()
  @IsString()
  accessToken?: string;

  @ApiProperty({
    description: 'Allowed roles for OTP generation',
    example: [UserRole.CLIENT, UserRole.COUNSELOR],
  })
  @IsAllowedRoles()
  allowedRoles!: UserRole[];
}
