import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserStatus } from '../constants/user-status.constants';

export class UpdateUserStatusDto {
  @ApiProperty({
    description: 'New status for the user',
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  @IsEnum(UserStatus, {
    message: 'Status must be a valid UserStatus value',
  })
  @IsNotEmpty()
  status!: UserStatus;
}
