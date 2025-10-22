import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from 'src/common/constants/user.constants';

export class AddUserResponseDto {
  @ApiProperty({ description: 'User ID' })
  id!: number;

  @ApiProperty({ description: 'Full name of the user' })
  name!: string;

  @ApiProperty({ description: 'User email' })
  email!: string;

  @ApiProperty({ description: 'Username' })
  username!: string;

  @ApiProperty({
    description: 'Phone number of the user',
    nullable: true,
  })
  phone?: string;

  @ApiProperty({
    description: 'External system ID / Telephony ID',
    nullable: true,
  })
  externalId?: string;

  @ApiProperty({ enum: UserStatus, description: 'Status of the user' })
  status!: UserStatus;

  @ApiProperty({ description: 'User metadata', nullable: true })
  metadata?: Record<string, any>;

  @ApiProperty({ description: 'Tenant ID' })
  tenantId!: string;

  @ApiProperty({ description: 'User creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'User last update timestamp' })
  updatedAt!: Date;
}
