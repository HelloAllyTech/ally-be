import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateChatMessageDto {
  @ApiProperty({
    description: 'The user message to send to the AI chatbot',
    example: 'What could I have said better at the 45-second mark?',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;
}
