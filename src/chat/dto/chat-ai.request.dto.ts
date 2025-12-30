import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsArray, IsString } from 'class-validator';
import { FlattenedSummaryNotePayload } from '../type/call.details.type';

class MessageRequestDto {
  @ApiProperty({ description: 'The role of the message' })
  @IsString()
  role!: string;

  @ApiProperty({ description: 'The content of the message' })
  @IsString()
  content!: string;

  @ApiProperty({ description: 'The start time of the message' })
  @IsNumber()
  start_time!: number;

  @ApiProperty({ description: 'The end time of the message' })
  @IsNumber()
  end_time!: number;
}

export class AddTranscriptDto {
  @ApiProperty({ description: 'The ID of the chat' })
  @IsNumber()
  chat_id!: number;

  @ApiProperty({
    description: 'The messages to add to the chat',
    type: [MessageRequestDto],
  })
  @IsArray()
  messages!: MessageRequestDto[];
}

export class AddSummaryDto {
  @ApiProperty({ description: 'The ID of the chat' })
  @IsNumber()
  chat_id!: number;

  @ApiProperty({ description: 'The summary to add to the chat' })
  summary!: FlattenedSummaryNotePayload;
}
