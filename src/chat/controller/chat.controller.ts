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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { TokenUser } from '../../auth/type/auth.types';
import { ChatService } from '../services/chat.service';
import { FeedbackService } from '../services/feedback.service';
import { ParseIntPipe } from '@nestjs/common';
import { CreateFeedbackDto } from '../dto/create-feedback.dto';
import {
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import { CallLogResponse } from '../dto/call-log.response.dto';
import { ChatResponseDto } from '../dto/chat.response.dto';

@ApiTags('Chats')
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

  @ApiOperation({ summary: 'Get counsellor call logs' })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of call logs',
    type: CallLogResponse,
    isArray: true,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of records to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of records to skip',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    description: 'Field to sort by (default: createdAt)',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['ASC', 'DESC'],
    description: 'Sort order (default: DESC)',
  })
  @Get('call-logs')
  async getCallLogs(
    @CurrentUser() tokenUser: TokenUser,
    @Query('limit') limit: number,
    @Query('offset') offset: number,
    @Query('sortBy') sortBy: string = 'createdAt',
    @Query('order') order: 'ASC' | 'DESC' = 'DESC',
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

  @ApiOperation({ summary: 'Get chat details' })
  @ApiResponse({
    status: 200,
    description: 'Returns the chat details',
    type: ChatResponseDto,
  })
  @Get(':id')
  async getChat(@Param('id', ParseIntPipe) id: number) {
    return this.service.getChat(id);
  }

  @ApiOperation({ summary: 'Enhance chat summary' })
  @ApiResponse({
    status: 200,
    description: 'Returns enhanced summary content',
    schema: {
      type: 'object',
      properties: {
        enhanced_content: { type: 'string' },
      },
    },
  })
  @ApiBody({
    description: 'Summary content to enhance',
    schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Original summary content',
          example: 'This is a chat summary that needs enhancement',
        },
      },
      required: ['content'],
    },
  })
  @Post('enhance')
  async enhance(@Body() body: { content: string }) {
    return this.service.enhance(body.content);
  }

  @ApiOperation({ summary: 'Update call details' })
  @ApiResponse({
    status: 200,
    description: 'Returns the updated call details',
    type: ChatResponseDto,
  })
  @ApiBody({
    description: 'Call details to update',
    schema: {
      type: 'object',
      properties: {
        callDetails: { type: 'object' },
      },
    },
  })
  @Post(':id/update-call-details')
  async updateCallDetails(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { callDetails: any },
  ) {
    return this.service.updateCallDetails(id, body.callDetails);
  }
}
