import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsString } from 'class-validator';
import { UserRole } from 'src/common/constants/user.constants';

export class GrantPermissionToRolesDto {
  @ApiProperty({
    description: 'Name of the permission',
    example: 'edit:users:roles',
  })
  @IsString()
  permissionName!: string;

  @ApiProperty({
    description: 'List of roles (groups) to grant permission',
    example: ['ADMIN', 'COUNSELOR'],
  })
  @ArrayMinSize(1, { message: 'At least one role must be provided' })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  roles!: UserRole[];
}

export class DeletePermissionGroupsDto {
  @ApiProperty({
    description: 'Name of the permission',
    example: 'edit:users:roles',
  })
  @IsString()
  permissionName!: string;

  @ApiProperty({
    description: 'List of roles (groups) from which to remove the permission',
    example: ['ADMIN', 'COUNSELOR'],
  })
  @ArrayMinSize(1, { message: 'At least one role must be provided' })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  roles!: UserRole[];
}

export class CreatePermissionDto {
  @ApiProperty({
    description: 'Name of the permission',
    example: 'edit:users:roles',
  })
  @IsString()
  @Transform(({ value }) => (!value || value.trim() == '' ? null : value))
  permissionName!: string;
}

export class DeletePermissionDto {
  @ApiProperty({
    description: 'Name of the permission',
    example: 'edit:users:roles',
  })
  @IsString()
  permissionName!: string;
}
