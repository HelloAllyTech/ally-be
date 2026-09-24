import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DISCUSSION_MAX_LENGTH } from '../type/course-discussion.constant';

export class DiscussionPostContentDto {
  @ApiProperty({ description: 'Plain text', maxLength: DISCUSSION_MAX_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Write something before posting.' })
  @MaxLength(DISCUSSION_MAX_LENGTH, {
    message: `Posts can be at most ${DISCUSSION_MAX_LENGTH} characters.`,
  })
  content!: string;
}

export class DiscussionLockDto {
  @ApiProperty()
  @IsBoolean()
  locked!: boolean;
}

export class DiscussionTenantQueryDto {
  @ApiPropertyOptional({
    description:
      "Organisation whose thread to read or lock. Honoured for moderators (edit:admin:track) only; everyone else always gets their own organisation's.",
  })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class DiscussionAuthorDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) profileImageUrl!: string | null;
}

export class DiscussionPostDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) parentPostId!: string | null;
  @ApiProperty() depth!: number;
  @ApiPropertyOptional({ type: DiscussionAuthorDto, nullable: true })
  author!: DiscussionAuthorDto | null;
  @ApiPropertyOptional({ nullable: true }) content!: string | null;
  @ApiProperty() isDeletedByAuthor!: boolean;
  @ApiProperty() isEdited!: boolean;
  @ApiProperty() editedByModerator!: boolean;
  @ApiProperty() isLocked!: boolean;
  @ApiProperty() isOwn!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) editedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) editableUntil!: string | null;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty() canDelete!: boolean;
  @ApiProperty() canReply!: boolean;
  @ApiProperty() canLock!: boolean;
  @ApiProperty({ type: () => [DiscussionPostDto] })
  replies!: DiscussionPostDto[];
}

export class DiscussionViewerDto {
  @ApiProperty() userId!: number;
  @ApiProperty() canModerate!: boolean;
  @ApiProperty() canPost!: boolean;
  @ApiProperty() maxDepth!: number;
  @ApiProperty() maxLength!: number;
  @ApiProperty() editWindowMinutes!: number;
}

export class DiscussionViewDto {
  @ApiProperty() trackId!: string;
  @ApiProperty() trackItemId!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() isLocked!: boolean;
  @ApiProperty() postCount!: number;
  @ApiProperty({ type: DiscussionViewerDto }) viewer!: DiscussionViewerDto;
  @ApiProperty({ type: [DiscussionPostDto] }) posts!: DiscussionPostDto[];
}

export class DiscussionTenantSummaryDto {
  @ApiProperty() tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty() postCount!: number;
  @ApiProperty() isLocked!: boolean;
  @ApiPropertyOptional({ nullable: true }) lastPostAt!: string | null;
}
