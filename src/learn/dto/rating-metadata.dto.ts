import { ApiProperty } from '@nestjs/swagger';

export class RatingMetadataResponseDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  rating!: number;

  @ApiProperty()
  ratingText!: string;

  @ApiProperty({ type: [String] })
  tags!: string[];
}
