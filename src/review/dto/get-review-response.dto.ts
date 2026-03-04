import { ApiProperty } from '@nestjs/swagger';
import { CreatedByDto } from './created-user.dto';
import { ReviewStatus } from '../type/review.type';

export class ScenarioDto {
  @ApiProperty()
  title?: string;

  @ApiProperty()
  createdAt?: Date;

  @ApiProperty()
  name?: string;

  @ApiProperty()
  description?: string;

  @ApiProperty({ nullable: true, type: String })
  coverImageUrl?: string | null;

  @ApiProperty({ nullable: true, type: String })
  coverVideoUrl?: string | null;
}

export class ScenarioSessionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  duration!: number;

  @ApiProperty()
  createdAt?: Date;
}

export class GetReviewResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  scenario!: ScenarioDto;

  @ApiProperty()
  scenarioSession!: ScenarioSessionDto;

  @ApiProperty()
  commentsCount!: number;

  @ApiProperty()
  createdBy!: CreatedByDto;

  @ApiProperty()
  reactions!: Record<string, number>;

  @ApiProperty({ required: false, nullable: true, type: String })
  myReaction!: string | null;

  @ApiProperty()
  reviewStatus?: ReviewStatus;

  @ApiProperty()
  generalCommentsThreadId?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  note?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  noteEditedAt?: Date | null;
}
