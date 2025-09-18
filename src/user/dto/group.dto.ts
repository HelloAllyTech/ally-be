import { IsString, IsNotEmpty, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../common/constants/user.constants';

export class AssignUserRoleDto {
  @ApiProperty({
    description: 'User role',
    example: 'role',
  })
  @IsString()
  @IsNotEmpty()
  role!: UserRole;

  @ApiProperty({
    description: 'User ID',
    example: 123,
  })
  @IsNumber()
  @IsNotEmpty()
  userId!: number;
}

export class RemoveUserRoleDto {
  @ApiProperty({
    description: 'User role',
    example: 'role',
  })
  @IsString()
  @IsNotEmpty()
  role!: UserRole;

  @ApiProperty({
    description: 'User ID',
    example: 123,
  })
  @IsNumber()
  @IsNotEmpty()
  userId!: number;
}
