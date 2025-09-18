import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber } from 'class-validator';

export class CreateSessionEventDto {
  @ApiProperty({
    description: 'ID for the event',
    example: 'event-1',
  })
  @IsString()
  id!: string;

  @ApiProperty({
    description: 'The name of the event',
    example: 'Event 1',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'The description of the event',
    example: 'Event 1 description',
  })
  @IsString()
  description!: string;

  @ApiProperty({
    description: 'The session quality score of the event',
    example: 1,
  })
  @IsNumber()
  score!: number;

  @ApiProperty({
    description: 'The emoji of the event',
    example: '👍',
  })
  @IsString()
  emoji!: string;

  @ApiProperty({
    description: 'The real time feedback message of the event',
    example: 'Event 1 real time feedback message',
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: 'The branch instruction of the event',
    example: 'Event 1 branch instruction',
  })
  @IsString()
  @IsOptional()
  branchInstruction?: string;
}
