import { IsNotEmpty, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../constants/user-status.constants';

export class PromoteSuperDuperAdminDto {
  @ApiProperty({
    description: 'ID of the user to promote to SUPER_DUPER_ADMIN',
    example: 123,
  })
  @IsNumber()
  @IsNotEmpty()
  userId!: number;
}

export class PromoteSuperAdminDto {
  @ApiProperty({
    description: 'ID of the user to make a SUPER_ADMIN',
    example: 123,
  })
  @IsNumber()
  @IsNotEmpty()
  userId!: number;
}

export class SuperDuperAdminDto {
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

export class SuperDuperAdminListResponseDto {
  @ApiProperty({ type: SuperDuperAdminDto, isArray: true })
  data!: SuperDuperAdminDto[];

  @ApiProperty({ description: 'Total count' })
  count!: number;
}
