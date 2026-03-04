import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreatedByDto } from './created-user.dto';

export class ScenarioDto {
  @ApiProperty()
  title!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  description!: string;

  @ApiProperty({ required: false, nullable: true, type: String })
  coverImageUrl?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  coverVideoUrl?: string | null;
}

export class ScenarioSessionDto {
  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  duration!: number;
}

export class ReviewItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: () => ScenarioDto })
  @Type(() => ScenarioDto)
  scenario!: ScenarioDto;

  @ApiProperty({ type: () => ScenarioSessionDto })
  @Type(() => ScenarioSessionDto)
  scenarioSession!: ScenarioSessionDto;

  @ApiProperty()
  commentsCount!: number;

  @ApiProperty({
    description: 'Map of reactionCode -> count',
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { '1f44d': 10, '1f389': 2 },
  })
  reactions!: Record<string, number>;

  @ApiProperty({ type: () => CreatedByDto })
  @Type(() => CreatedByDto)
  createdBy!: CreatedByDto;

  @ApiProperty({ required: false, nullable: true, type: String })
  note?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  noteEditedAt?: Date | null;
}

export class ReviewsListResponseDto {
  @ApiProperty({ type: () => ReviewItemDto, isArray: true })
  @Type(() => ReviewItemDto)
  data!: ReviewItemDto[];

  @ApiProperty()
  count!: number;
}
