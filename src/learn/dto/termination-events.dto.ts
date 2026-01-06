import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class TerminationEventsDto {
  @ApiProperty({
    description: 'ID of the termination event',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  id!: string;

  @ApiProperty({
    description: 'Message of the termination event',
    example: 'Termination message',
  })
  @IsString()
  message?: string;
}
