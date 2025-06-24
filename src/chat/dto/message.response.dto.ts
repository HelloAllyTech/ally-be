import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '../../common/entities/message.entity';
import { Feedback } from '../../common/entities/feedback.entity';

export class GetMessagesResponse {
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
