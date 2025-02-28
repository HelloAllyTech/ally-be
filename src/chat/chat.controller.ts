import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Body,
  Patch,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/user.decorator';
import { TokenUser } from '../auth/type/auth.types';
import { ChatService } from './chat.service';
import { FeedbackService } from './services/feedback.service';
import { ParseIntPipe } from '@nestjs/common';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Controller('v1/chats')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private service: ChatService,
    private readonly feedbackService: FeedbackService,
  ) {}

  @Get('my-chat')
  async getMyChats(@CurrentUser() tokenUser: TokenUser) {
    return this.service.getMyChats(tokenUser.id);
  }

  @Post('request')
  async requestChat(@CurrentUser() tokenUser: TokenUser) {
    return this.service.requestChat(tokenUser.id);
  }

  @Get('counsellor-chat')
  async getCounsellorChat(@CurrentUser() tokenUser: TokenUser) {
    return this.service.getCounsellorChat(tokenUser.id);
  }

  @Get('call-logs')
  async getCallLogs(
    @CurrentUser() tokenUser: TokenUser,
    @Query('limit') limit: number,
    @Query('offset') offset: number,
    @Query('sortBy') sortBy: string,
    @Query('order') order: 'ASC' | 'DESC',
  ) {
    return this.service.getCallLogs(tokenUser.id, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @Post(':id/accept')
  async accept(@CurrentUser() tokenUser: TokenUser, @Param('id') id: string) {
    return this.service.accept(tokenUser.id, parseInt(id));
  }

  @Post(':id/end')
  async endChat(@CurrentUser() tokenUser: TokenUser, @Param('id') id: string) {
    return this.service.endChat(tokenUser.id, parseInt(id));
  }

  @Get(':id/messages')
  async getMessages(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
    @Query('limit') limit: number,
    @Query('offset') offset: number,
  ) {
    return this.service.getMessages(parseInt(id), tokenUser.id, limit, offset);
  }

  @Post('messages/:messageId/feedback')
  async createFeedback(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() createFeedbackDto: CreateFeedbackDto,
    @CurrentUser() tokenUser: TokenUser,
  ) {
    const feedback = {
      ...createFeedbackDto,
      messageId,
      userId: tokenUser.id,
    };
    return this.feedbackService.create(feedback);
  }

  @Get('messages/:messageId/feedback')
  async getFeedback(@Param('messageId', ParseIntPipe) messageId: number) {
    return this.feedbackService.findByMessageId(messageId);
  }

  @Patch('messages/feedback/:id')
  async updateFeedback(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateFeedbackDto: CreateFeedbackDto,
  ) {
    return this.feedbackService.update(id, updateFeedbackDto);
  }

  @Get(':id')
  async getChat(@Param('id', ParseIntPipe) id: number) {
    return this.service.getChat(id);
  }
}
