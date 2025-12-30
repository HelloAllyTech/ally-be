import { ApiProperty } from '@nestjs/swagger';
import { CallDetails } from './call-log.response.dto';
import { ChatStatus } from '../entity/chat.entity';
import { IsNotEmpty, IsString } from 'class-validator';

export class ChatDto {
  @ApiProperty({ example: 1, description: 'Unique identifier for the chat' })
  id!: number;

  @ApiProperty({
    example: 5001,
    description: 'Client identifier participating in the chat',
  })
  clientId?: number;

  @ApiProperty({
    example: 3001,
    description: 'Counselor identifier assigned to the chat',
    nullable: true,
  })
  counselorId?: number;

  @ApiProperty({
    example: ChatStatus.ACTIVE,
    description: 'Current status of the chat',
    enum: ChatStatus,
  })
  status!: ChatStatus;

  @ApiProperty({
    example: '2025-03-14T12:00:00Z',
    description: 'Timestamp when the chat started',
    nullable: true,
  })
  startedAt?: Date;

  @ApiProperty({
    example: '2025-03-14T12:30:00Z',
    description: 'Timestamp when the chat ended',
    nullable: true,
  })
  endedAt?: Date;
}

export class ChatResponseDto extends ChatDto {
  @ApiProperty({ type: CallDetails, description: 'Chat details' })
  details?: CallDetails;
}

export class CallInfoDto {
  @ApiProperty({
    example: 'CALL-123-2025-03-14',
    description: 'Summary name',
  })
  @IsString()
  @IsNotEmpty()
  summaryName!: string;
}

export class DeleteChatResponseDto {
  @ApiProperty({ example: true, description: 'Success status' })
  success!: boolean;
}
