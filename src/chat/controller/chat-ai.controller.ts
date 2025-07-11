import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ChatAiService } from '../service/chat-ai-service';
import { AiApiKeyGuard } from '../../auth/guards/ai-auth.guard';
import { AddSummaryDto, AddTranscriptDto } from '../dto/chat-ai.request.dto';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Chats AI')
@Controller('v1/chats/ai')
@UseGuards(AiApiKeyGuard)
export class ChatAiController {
  constructor(private readonly chatAiService: ChatAiService) {}

  @Post('/transcript')
  async addTranscript(@Body() params: AddTranscriptDto) {
    return this.chatAiService.addTranscript(params.chat_id, params.messages);
  }

  @Post('/summary')
  async addSummary(@Body() params: AddSummaryDto) {
    return this.chatAiService.addSummary(params.chat_id, params.summary);
  }
}
