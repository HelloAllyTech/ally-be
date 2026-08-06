import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { UserRole } from 'src/common/constants/user.constants';
import { IsAllowedRoles } from 'src/common/decorator/allowed-roles.decorator';

export class AppleFullNameDto {
  @ApiProperty({ required: false, nullable: true, example: 'Ada' })
  @IsOptional()
  @IsString()
  givenName?: string | null;

  @ApiProperty({ required: false, nullable: true, example: 'Lovelace' })
  @IsOptional()
  @IsString()
  familyName?: string | null;
}

export class AppleSignInDto {
  @ApiProperty({
    description: 'Apple identity token (JWT) returned by Sign in with Apple',
    example: 'eyJraWQiOiJBSURPUEsxIiwiYWxnIjoiUlMyNTYifQ...',
  })
  @IsString()
  identityToken!: string;

  @ApiProperty({
    description: 'Apple authorization code (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  authorizationCode?: string;

  @ApiProperty({
    description: "User's full name (only present on first sign-in)",
    required: false,
    type: () => AppleFullNameDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppleFullNameDto)
  fullName?: AppleFullNameDto;

  @ApiProperty({
    description: 'Allowed roles for sign-in',
    example: [UserRole.CLIENT, UserRole.COUNSELOR],
  })
  @IsAllowedRoles()
  allowedRoles!: UserRole[];
}
