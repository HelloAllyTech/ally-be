import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ArrayNotEmpty,
} from 'class-validator';
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
export class ChangeUserRolesDto {
  @ApiProperty({
    description: 'User ID whose roles need to be changed',
    example: 5,
  })
  @IsNotEmpty()
  @IsNumber()
  userId!: number;

  @ApiProperty({
    description: 'Array of group IDs (roles) to assign',
    example: [1, 2],
    type: [Number],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  groupIds!: number[];
}
