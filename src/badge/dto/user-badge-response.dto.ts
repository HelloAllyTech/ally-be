import { ApiProperty } from '@nestjs/swagger';
import { BadgeViewedStatus } from '../constants/badge.constants';

export class UserBadgeWithDetailsDto {
  @ApiProperty({ description: 'User badge assignment ID' })
  id!: string;

  @ApiProperty({ description: 'Badge ID' })
  badgeId!: string;

  @ApiProperty({ description: 'User ID' })
  userId!: number;

  @ApiProperty({
    enum: BadgeViewedStatus,
    description: 'Whether the user has viewed this badge',
  })
  viewedStatus!: BadgeViewedStatus;

  @ApiProperty({ description: 'Date when the badge was awarded' })
  createdAt!: Date;

  @ApiProperty({ description: 'Unique badge code' })
  code!: string;

  @ApiProperty({ description: 'Badge name' })
  name!: string;

  @ApiProperty({ description: 'Badge description' })
  description?: string;

  @ApiProperty({ description: 'Badge image URL' })
  imageUrl?: string;
}

export class UserBadgeResponseDto {
  @ApiProperty({
    type: UserBadgeWithDetailsDto,
    description: 'List of user badges',
  })
  data!: UserBadgeWithDetailsDto[];
}

export class UserBadgeCountResponseDto {
  @ApiProperty({
    type: Number,
    description: 'Total count of badges awarded to the user',
    example: 5,
  })
  count!: number;
}
