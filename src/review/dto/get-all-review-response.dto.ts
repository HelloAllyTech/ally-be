import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ScenarioDto {
  @ApiProperty()
  title!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  duration!: number;

  @ApiProperty()
  description!: string;

  @ApiProperty({ required: false, nullable: true })
  coverImageUrl?: string | null;

  @ApiProperty({ required: false, nullable: true })
  coverVideoUrl?: string | null;
}

export class CreatedByDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ required: false, nullable: true })
  profileImage?: string | null;
}

export class ReviewItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: () => ScenarioDto })
  @Type(() => ScenarioDto)
  scenario!: ScenarioDto;

  @ApiProperty()
  commentsCount!: number;

  @ApiProperty({
    description: 'Map of reactionCode -> count',
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { like: 10, love: 2 },
  })
  reactions!: Record<string, number>;

  @ApiProperty({ type: () => CreatedByDto })
  @Type(() => CreatedByDto)
  createdBy!: CreatedByDto;
}

export class ReviewsListResponseDto {
  @ApiProperty({ type: () => ReviewItemDto, isArray: true })
  @Type(() => ReviewItemDto)
  data!: ReviewItemDto[];

  @ApiProperty()
  count!: number;
}
