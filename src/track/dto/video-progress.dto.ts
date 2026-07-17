import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class VideoProgressDto {
  @ApiProperty({ description: 'Unique-watched percentage (0-100)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  watchedPct!: number;
}
