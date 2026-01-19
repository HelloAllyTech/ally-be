import { ApiProperty } from '@nestjs/swagger';
import {
  BadgeCategory,
  BadgeLockStatus,
  BadgeViewedStatus,
} from '../constants/badge.constants';

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

export class BadgeAchievementParamsDto {
  @ApiProperty({
    description: 'Achievement count threshold',
    example: 5,
    required: false,
  })
  count?: number;
}

export class UserAvailableBadgeDto {
  @ApiProperty({ description: 'Badge ID' })
  id!: string;

  @ApiProperty({ description: 'Unique badge code' })
  code!: string;

  @ApiProperty({ description: 'Badge name' })
  name!: string;

  @ApiProperty({ description: 'Badge description', required: false })
  description?: string;

  @ApiProperty({ description: 'Badge image URL', required: false })
  imageUrl?: string;

  @ApiProperty({ enum: BadgeCategory, description: 'Badge category' })
  category!: BadgeCategory;

  @ApiProperty({
    type: BadgeAchievementParamsDto,
    description: 'Achievement parameters',
    required: false,
  })
  achievementParams?: BadgeAchievementParamsDto;

  @ApiProperty({
    enum: BadgeViewedStatus,
    description: 'Whether the user has viewed this badge',
    nullable: true,
  })
  viewedStatus!: BadgeViewedStatus | null;

  @ApiProperty({
    enum: BadgeLockStatus,
    description: 'Whether the badge is locked or unlocked for the user',
  })
  lockStatus!: BadgeLockStatus;
}

export class GroupedUserAvailableBadgesDto {
  @ApiProperty({ enum: BadgeCategory, description: 'Badge category name' })
  category!: BadgeCategory;

  @ApiProperty({
    type: [UserAvailableBadgeDto],
    description: 'List of badges in this category',
  })
  badges!: UserAvailableBadgeDto[];
}

export class MarkBadgeViewedResponseDto {
  @ApiProperty({ description: 'Badge ID that was marked as viewed' })
  badgeId!: string;

  @ApiProperty({
    enum: BadgeViewedStatus,
    description: 'The updated viewed status',
  })
  viewedStatus!: BadgeViewedStatus;
}
