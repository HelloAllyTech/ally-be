import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Body,
  Patch,
  Query,
  Res,
  Put,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { TokenUser } from '../../auth/type/auth.types';
import { ChatService } from '../service/chat.service';
import { FeedbackService } from '../service/feedback.service';
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
import { CallInfoDto, ChatResponseDto } from '../dto/chat.response.dto';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { CallStartDto } from '../dto/call-start.dto';
import { Response } from 'express';

@ApiTags('Chats')
@Controller('v1/chats')
export class ChatController {
  constructor(
    private service: ChatService,
    private readonly feedbackService: FeedbackService,
  ) {}

  @AuthRoles(UserRole.CLIENT, UserRole.COUNSELOR)
  @Get('my-chat')
  async getMyChats(@CurrentUser() tokenUser: TokenUser) {
    return this.service.getMyChats(tokenUser.id);
  }

  @AuthRoles(UserRole.CLIENT)
  @Post('request')
  async requestChat(@CurrentUser() tokenUser: TokenUser) {
    return this.service.requestChat(tokenUser.id);
  }

  @AuthRoles(UserRole.COUNSELOR)
  @Get('counsellor-chat')
  async getCounselorChat(@CurrentUser() tokenUser: TokenUser) {
    return this.service.getCounselorChat(tokenUser.id);
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
  @AuthRoles(UserRole.COUNSELOR, UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('call-logs')
  async getCallLogs(
    @CurrentUser() tokenUser: TokenUser,
    @Query('limit') limit: number,
    @Query('offset') offset: number,
    @Query('sortBy') sortBy: string = 'createdAt',
    @Query('order') order: 'ASC' | 'DESC' = 'DESC',
  ) {
    return this.service.getCallLogs(tokenUser, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @AuthRoles(UserRole.COUNSELOR)
  @Post('call-start')
  async callStart(@Body() params: CallStartDto) {
    return this.service.startCall(params.participantPhoneNumbers);
  }

  @AuthRoles(UserRole.COUNSELOR)
  @Post(':id/accept')
  async accept(@CurrentUser() tokenUser: TokenUser, @Param('id') id: string) {
    return this.service.accept(tokenUser.id, parseInt(id));
  }

  @AuthRoles(UserRole.COUNSELOR, UserRole.CLIENT)
  @Post(':id/end')
  async endChat(@CurrentUser() tokenUser: TokenUser, @Param('id') id: string) {
    return this.service.endChat(tokenUser.id, parseInt(id));
  }

  @AuthRoles(UserRole.COUNSELOR)
  @Get(':id/messages')
  async getMessages(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
    @Query('limit') limit: number,
    @Query('offset') offset: number,
  ) {
    return this.service.getMessages(parseInt(id), tokenUser.id, limit, offset);
  }

  @AuthRoles(UserRole.COUNSELOR)
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

  @AuthRoles(UserRole.COUNSELOR)
  @Get('messages/:messageId/feedback')
  async getFeedback(@Param('messageId', ParseIntPipe) messageId: number) {
    return this.feedbackService.findByMessageId(messageId);
  }

  @AuthRoles(UserRole.COUNSELOR)
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
  @AuthRoles(UserRole.COUNSELOR)
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
  @AuthRoles(UserRole.COUNSELOR)
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
  @AuthRoles(UserRole.COUNSELOR)
  @Put(':id/call-details')
  async updateCallDetails(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { summary: any },
  ) {
    return this.service.updateCallDetails(id, body.summary);
  }

  @ApiOperation({ summary: 'Get chat summary' })
  @AuthRoles(UserRole.COUNSELOR)
  @Get(':id/summary')
  async getChatSummary(@Param('id', ParseIntPipe) id: number) {
    return this.service.generateSummary(id);
  }

  @ApiOperation({ summary: 'Get chat summary for message' })
  @AuthRoles(UserRole.COUNSELOR)
  @Post('summaryForMessage')
  async getChatSummaryForMessage(
    @Body() body: { messageRequests: MessageRequest[] },
  ) {
    return this.service.generateSummaryForMessage(body.messageRequests);
  }

  @ApiOperation({ summary: 'Get chat AI nugde for message' })
  @AuthRoles(UserRole.COUNSELOR)
  @Post('nudge')
  async getChatNudge(
    @Body() body: { newMessage: string; chatHistory: MessageRequest[] },
  ) {
    return this.service.getNudge(body.newMessage, body.chatHistory);
  }

  @Get(':chatId/export-summary')
  @ApiOperation({ summary: 'Export chat summary in TXT format' })
  @ApiResponse({
    status: 200,
    description: 'Returns the chat summary as a text file',
    content: {
      'text/plain': {
        schema: {
          type: 'string',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  @AuthRoles(UserRole.COUNSELOR, UserRole.SUPER_ADMIN)
  async exportSummary(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() tokenUser: TokenUser,
    @Res() res: Response,
  ): Promise<void> {
    const { summary, fileName } = await this.service.exportSummary(
      tokenUser,
      chatId,
    );
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${fileName}.txt`,
    );
    res.send(summary);
  }

  @Patch(':chatId/call-info')
  @ApiOperation({ summary: 'Update call info' })
  @ApiResponse({
    status: 200,
    description: 'Returns the updated call info',
    type: ChatResponseDto,
  })
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  async updateCallInfo(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() body: CallInfoDto,
  ) {
    return this.service.updateCallInfo(chatId, body);
  }
}
