import { ApiProperty } from '@nestjs/swagger';

export class ScenarioDto {
  @ApiProperty()
  title?: string;

  @ApiProperty()
  createdAt?: Date;

  @ApiProperty()
  duration!: number;

  @ApiProperty()
  description?: string;

  @ApiProperty({ nullable: true })
  coverImageUrl?: string | null;

  @ApiProperty({ nullable: true })
  coverVideoUrl?: string | null;
}

export class CreatedByDto {
  @ApiProperty()
  id?: number;

  @ApiProperty()
  name?: string;

  @ApiProperty({ nullable: true })
  profileImage!: string | null;
}

export class GetReviewResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  scenario!: ScenarioDto;

  @ApiProperty()
  commentsCount!: number;

  @ApiProperty()
  createdBy!: CreatedByDto;
}
