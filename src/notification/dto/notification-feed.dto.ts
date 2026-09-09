import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListNotificationsQueryDto {
  @ApiProperty({ required: false, default: 25 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 25;

  @ApiProperty({ required: false, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number = 0;

  @ApiProperty({ required: false, default: false })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  unreadOnly?: boolean = false;
}

export class NotificationItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ nullable: true, type: Object })
  data!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  readAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class NotificationFeedResponseDto {
  @ApiProperty({ type: [NotificationItemDto] })
  data!: NotificationItemDto[];

  @ApiProperty()
  count!: number;
}

export class UnreadNotificationCountDto {
  @ApiProperty()
  count!: number;
}

export class NotificationActionResultDto {
  @ApiProperty()
  success!: boolean;
}
