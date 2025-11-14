import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class DeleteSessionEventsDto {
  @ApiProperty({
    description: 'List of event IDs',
    type: [String],
    example: ['event1', 'event2', 'event3'],
  })
  @IsArray()
  @IsString({ each: true })
  eventIds!: string[];
}
