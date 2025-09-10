import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateSessionEventDto } from './create-session-event.dto';

export class CreateSessionEventsDto {
  @ApiProperty({
    description: 'Array of events to create',
    type: [CreateSessionEventDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSessionEventDto)
  events!: CreateSessionEventDto[];
}
