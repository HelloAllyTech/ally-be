import { IsNotEmpty, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../constants/user-status.constants';

export class AssignPlatformAdminDto {
  @ApiProperty({
    description: 'ID of the user to make a PLATFORM_ADMIN',
    example: 123,
  })
  @IsNumber()
  @IsNotEmpty()
  userId!: number;
}

export class PlatformAdminDto {
  @ApiProperty({ description: 'User ID', example: 123 })
  id!: number;

  @ApiProperty({ description: 'Full name' })
  name!: string;

  @ApiProperty({ description: 'Email address' })
  email!: string;

  @ApiProperty({ description: 'Account status', enum: UserStatus })
  status!: UserStatus;

  @ApiProperty({ description: 'Account creation timestamp' })
  createdAt!: Date;
}

export class PlatformAdminListResponseDto {
  @ApiProperty({ type: PlatformAdminDto, isArray: true })
  data!: PlatformAdminDto[];

  @ApiProperty({ description: 'Total count' })
  count!: number;
}
