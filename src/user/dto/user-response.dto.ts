import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from 'src/user/constants/user-status.constants';

export class UserDto {
  @ApiProperty({ description: 'User ID' })
  id!: string;

  @ApiProperty({ description: 'Full name of the user' })
  name!: string;

  @ApiProperty({ description: 'User email' })
  email!: string;

  @ApiProperty({ description: 'Username' })
  username!: string;

  @ApiProperty({ description: 'Profile image URL', nullable: true })
  profileImageUrl?: string;

  @ApiProperty({
    description: 'External system ID / Telephony ID',
    nullable: true,
  })
  externalId?: string;

  @ApiProperty({ enum: UserStatus, description: 'Status of the user' })
  status!: UserStatus;

  @ApiProperty({ description: 'Primary role of the user', nullable: true })
  role?: string;

  @ApiProperty({
    type: [String],
    description: 'All roles assigned to the user',
  })
  roles!: string[];

  @ApiProperty({ description: 'User metadata' })
  metadata?: Record<string, any>;

  @ApiProperty({ description: 'Organization / Tenant name' })
  organization!: string;

  @ApiProperty({ description: 'Tenant ID' })
  tenantId!: string;

  @ApiProperty({ description: 'User creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'User last update timestamp' })
  updatedAt!: Date;

  @ApiProperty({ description: 'Max credits for the user', nullable: true })
  creditLimit?: number;

  @ApiProperty({ description: 'Used credits for the user', nullable: true })
  consumedCredits?: number;
}

// Response for get all users
export class UserListResponseDto {
  @ApiProperty({ type: [UserDto], description: 'Array of users' })
  data!: UserDto[];

  @ApiProperty({ description: 'Total number of users matching the filter' })
  count!: number;
}

// Response for create user
export class UserCreateResponseDto {
  @ApiProperty({ description: 'Success message' })
  message!: string;

  @ApiProperty({ type: UserDto, description: 'Created user details' })
  user!: UserDto;
}

// Response for update user and user status
export class UserUpdateResponseDto {
  @ApiProperty({ description: 'Whether the update succeeded or not' })
  success!: boolean;
}
