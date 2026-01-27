import { ApiProperty } from '@nestjs/swagger';
import { CreatedByDto } from './created-user.dto';

export class ScenarioDto {
  @ApiProperty()
  title?: string;

  @ApiProperty()
  createdAt?: Date;

  @ApiProperty()
  description?: string;

  @ApiProperty({ nullable: true })
  coverImageUrl?: string | null;

  @ApiProperty({ nullable: true })
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

  @ApiProperty()
  myReaction!: string | null;
}
