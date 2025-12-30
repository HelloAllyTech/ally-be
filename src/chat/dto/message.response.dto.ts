import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '../entity/message.entity';
import { Feedback } from '../entity/feedback.entity';

export class MessageResponse {
  @ApiProperty({ type: Number })
  messageId!: number;

  @ApiProperty({ type: Number })
  chatId!: number;

  @ApiProperty({ type: Number })
  senderId!: number;

  @ApiProperty({ type: String })
  messageType!: MessageType;

  @ApiProperty({ type: String })
  content!: string;

  @ApiProperty({ type: String })
  context!: string;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: Feedback, required: false })
  feedback?: Feedback;
}

export class GetMessagesResponse {
  @ApiProperty({ type: [MessageResponse] })
  data!: MessageResponse[];

  @ApiProperty({ type: Number })
  count!: number;
}
