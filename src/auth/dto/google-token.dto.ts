import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
} from 'class-validator';
import { UserRole } from 'src/common/constants/user.constants';

export class GoogleSignInDto {
  @ApiProperty({
    description: 'Google ID Token',
    example:
      'eyJhhenAiOiIxMDI0MjM0NTY3ODkwLXNhbXBsZS1hcHAuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJhdWQiOiIxMDI0MjM0NTY3ODkwLXNhbXBsZS1hcHAuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJzdWIiOiIxMDI0MjM0NTY3ODkwMTIzNDU2Nzg5MCIs',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiProperty({
    description: 'Allowed roles for OTP generation',
    example: [UserRole.CLIENT, UserRole.COUNSELOR],
  })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  @ArrayNotEmpty()
  allowedRoles!: UserRole[];
}
