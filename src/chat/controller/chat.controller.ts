import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Patch,
  Query,
  Res,
  Put,
  Delete,
} from '@nestjs/common';
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
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import {
  CallLogResponse,
  SummaryFeedbackResponse,
} from '../dto/call-log.response.dto';
import {
  CallInfoDto,
  ChatResponseDto,
  DeleteChatResponseDto,
} from '../dto/chat.response.dto';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { CallStartDto } from '../dto/call-start.dto';
import { Response } from 'express';
import { GetMessagesResponse } from '../dto/message.response.dto';
import { CallLogSortBy, SortOrder } from '../dto/call-log.request.dto';
import { PaginatedResponse } from '../../common/type/common.type';
import { CounselorNameResponse } from '../dto/call-log.response.dto';
import { AddNoteDto, AddNotesResponse } from '../dto/notes.dto';
import { ChatSummaryService } from '../service/chat-summary.service';
import { SummaryFeedbackDto } from '../dto/summary-feedback.dto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

@ApiTags('Chats')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chats')
export class ChatController {
  constructor(
    private service: ChatService,
    private readonly feedbackService: FeedbackService,
    private readonly chatSummaryService: ChatSummaryService,
  ) {}

  @AuthPermissions([PERMISSIONS.VIEW_CHAT])
  @Get('my-chat')
  async getMyChats(@CurrentUser() tokenUser: TokenUser) {
    return this.service.getMyChats(tokenUser.id);
  }

  @AuthRoles(UserRole.CLIENT)
  @Post('request')
  async requestChat(@CurrentUser() tokenUser: TokenUser) {
    return this.service.requestChat(tokenUser.id);
  }

  @AuthPermissions([PERMISSIONS.VIEW_CHAT_COUNSELOR])
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
    enum: CallLogSortBy,
    description: 'Field to sort by (default: createdAt)',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order (default: DESC)',
  })
  @AuthPermissions([PERMISSIONS.VIEW_CALL_LOGS])
  @Get('call-logs')
  async getCallLogs(
    @CurrentUser() tokenUser: TokenUser,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy: CallLogSortBy = CallLogSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ) {
    return this.service.getCallLogs(tokenUser, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Get admin call logs with filtering' })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of call logs with admin filters',
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
    enum: CallLogSortBy,
    description: 'Field to sort by (default: startedAt)',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order (default: DESC)',
  })
  @ApiQuery({
    name: 'counselorName',
    required: false,
    type: String,
    description: 'Search by counselor name (partial match)',
  })
  @ApiQuery({
    name: 'clientId',
    required: false,
    type: String,
    description: 'Search by client ID',
  })
  @ApiQuery({
    name: 'counselorId',
    required: false,
    type: String,
    description: 'Filter by counselor IDs (comma-separated)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Filter by start date (ISO string)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'Filter by end date (ISO string)',
  })
  @ApiQuery({
    name: 'minDuration',
    required: false,
    type: Number,
    description: 'Filter by minimum call duration in seconds',
  })
  @ApiQuery({
    name: 'maxDuration',
    required: false,
    type: Number,
    description: 'Filter by maximum call duration in seconds',
  })
  @ApiQuery({
    name: 'minQualityScore',
    required: false,
    type: Number,
    description: 'Filter by minimum quality score',
  })
  @ApiQuery({
    name: 'maxQualityScore',
    required: false,
    type: Number,
    description: 'Filter by maximum quality score',
  })
  @ApiQuery({
    name: 'tags',
    required: false,
    type: String,
    description: 'Filter by tags (comma-separated)',
  })
  @AuthPermissions([PERMISSIONS.VIEW_CALL_LOGS_SUMMARY])
  @Get('call-logs-summary')
  async getAdminCallLogs(
    @Query('limit') limit: number,
    @Query('offset') offset: number,
    @Query('sortBy') sortBy?: CallLogSortBy,
    @Query('order') order: SortOrder = SortOrder.DESC,
    @Query('counselorName') counselorName?: string,
    @Query('counselorIds') counselorIds?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('minDuration') minDuration?: string,
    @Query('maxDuration') maxDuration?: string,
    @Query('minQualityScore') minQualityScore?: string,
    @Query('maxQualityScore') maxQualityScore?: string,
    @Query('tags') tags?: string,
  ) {
    const parsedMinDuration = minDuration ? parseFloat(minDuration) : undefined;
    const parsedMaxDuration = maxDuration ? parseFloat(maxDuration) : undefined;
    const parsedMinQualityScore = minQualityScore
      ? parseFloat(minQualityScore)
      : undefined;
    const parsedMaxQualityScore = maxQualityScore
      ? parseFloat(maxQualityScore)
      : undefined;

    return this.service.getAdminCallLogs({
      limit,
      offset,
      sortBy,
      order,
      counselorName,
      counselorIds,
      startDate,
      endDate,
      minDuration: parsedMinDuration,
      maxDuration: parsedMaxDuration,
      minQualityScore: parsedMinQualityScore,
      maxQualityScore: parsedMaxQualityScore,
      tags,
    });
  }

  @ApiOperation({ summary: 'Get all counselor names for admin' })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of counselor names',
    type: PaginatedResponse<CounselorNameResponse>,
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
    name: 'search',
    required: false,
    type: String,
    description: 'Search counselor names (partial match)',
  })
  @AuthPermissions([PERMISSIONS.VIEW_COUNSELOR])
  @Get('counselors')
  async getCounselorNames(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('search') search?: string,
  ) {
    return this.service.getCounselorNames(limit, offset, search);
  }

  @ApiOperation({ summary: 'Get all tags for admin' })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of all tags',
    type: PaginatedResponse<string>,
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
    name: 'search',
    required: false,
    type: String,
    description: 'Search tag names (partial match)',
  })
  @AuthPermissions([PERMISSIONS.VIEW_TAGS])
  @Get('tags')
  async getAllTags(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('search') search?: string,
  ) {
    return this.service.getAllTags(limit, offset, search);
  }

  @AuthPermissions([PERMISSIONS.EDIT_CALL_START])
  @Post('call-start')
  async callStart(@Body() params: CallStartDto) {
    return this.service.startCall(params.participantPhoneNumbers);
  }

  @AuthPermissions([PERMISSIONS.EDIT_CALL_ACCEPT])
  @Post(':id/accept')
  async accept(@CurrentUser() tokenUser: TokenUser, @Param('id') id: string) {
    return this.service.accept(tokenUser.id, parseInt(id));
  }

  @AuthPermissions([PERMISSIONS.EDIT_CALL_END])
  @Post(':id/end')
  async endChat(@Param('id') id: string) {
    return this.service.endChat(parseInt(id));
  }

  @AuthRoles(UserRole.CLIENT)
  @Post(':id/cancel')
  async cancelCallByClient(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
  ) {
    return this.service.cancelCallByClient(tokenUser.id, parseInt(id));
  }

  @AuthPermissions([PERMISSIONS.VIEW_MESSAGE])
  @ApiOperation({ summary: 'Get messages' })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of messages',
    type: GetMessagesResponse,
  })
  @ApiParam({
    name: 'id',
    required: true,
    type: Number,
    description: 'Chat ID',
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
    name: 'sortOrder',
    required: false,
    enum: ['ASC', 'DESC'],
    description: 'Sort order (default: DESC)',
  })
  @Get(':id/messages')
  async getMessages(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    return this.service.getMessages(parseInt(id), tokenUser.id, {
      limit,
      offset,
      sortBy,
      sortOrder,
    });
  }

  @AuthPermissions([PERMISSIONS.EDIT_MESSAGE_FEEDBACK])
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

  @AuthPermissions([PERMISSIONS.VIEW_MESSAGE_FEEDBACK])
  @Get('messages/:messageId/feedback')
  async getFeedback(@Param('messageId', ParseIntPipe) messageId: number) {
    return this.feedbackService.findByMessageId(messageId);
  }

  @AuthPermissions([PERMISSIONS.EDIT_MESSAGE_FEEDBACK])
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
  @AuthPermissions([PERMISSIONS.VIEW_CHAT_DETAILS])
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
  @AuthPermissions([PERMISSIONS.EDIT_ENHANCEMENT])
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
        summary: { type: 'object' },
      },
    },
  })
  @AuthPermissions([PERMISSIONS.EDIT_CALL_DETAILS])
  @Put(':id/call-details')
  async updateCallDetails(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { summary: any },
  ) {
    return this.service.updateCallDetails(id, body.summary);
  }

  @ApiOperation({ summary: 'Get chat summary' })
  @AuthPermissions([PERMISSIONS.VIEW_SUMMARY])
  @Get(':id/summary')
  async getChatSummary(@Param('id', ParseIntPipe) id: number) {
    return this.service.generateSummary(id);
  }

  @ApiOperation({ summary: 'Get chat summary for message' })
  @AuthPermissions([PERMISSIONS.EDIT_SUMMARY])
  @Post('summaryForMessage')
  async getChatSummaryForMessage(
    @Body() body: { messageRequests: MessageRequest[] },
  ) {
    return this.service.generateSummaryForMessage(body.messageRequests);
  }

  @ApiOperation({ summary: 'Get chat AI nugde for message' })
  @AuthPermissions([PERMISSIONS.VIEW_CHAT_NUDGE])
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
  @AuthPermissions([PERMISSIONS.EXPORT_SUMMARY])
  async exportSummary(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() tokenUser: TokenUser,
    @Res() res: Response,
  ): Promise<void> {
    const { summary, fileName } = await this.chatSummaryService.exportSummary(
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
  @AuthPermissions([PERMISSIONS.EDIT_CALL_INFO])
  async updateCallInfo(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() body: CallInfoDto,
  ) {
    return this.service.updateCallInfo(chatId, body);
  }

  @Post('/summary/tag-positivity-ratings')
  @ApiOperation({ summary: 'Tag positivty ratings' })
  @ApiResponse({
    status: 200,
    description: 'Returns the tagged positivity ratings',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tag: { type: 'string' },
          positivity_rating: { type: 'number' },
        },
      },
    },
  })
  @AuthPermissions([PERMISSIONS.EDIT_TAG_POSITIVITY_RATINGS])
  async tagPositivityRatings(@Body() body: { tags: string[] }) {
    return this.service.tagPositivityRatings(body.tags);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note to a session' })
  @ApiResponse({
    status: 201,
    description: 'Note added successfully',
    type: String,
  })
  @ApiParam({
    name: 'id',
    required: true,
    type: Number,
    description: 'Chat ID',
  })
  @AuthPermissions([PERMISSIONS.EDIT_CHAT_NOTE])
  async addNoteToChat(
    @Param('id') chatId: number,
    @Body() createNoteDto: AddNoteDto,
  ): Promise<AddNotesResponse> {
    return this.service.addNoteToSession(chatId, createNoteDto);
  }

  @Post(':id/summary-feedback')
  @ApiOperation({ summary: 'Add a feedback to summary generated' })
  @ApiResponse({
    status: 201,
    description: 'Feedback added successfully',
    type: SummaryFeedbackResponse,
  })
  @ApiParam({
    name: 'id',
    required: true,
    type: Number,
    description: 'Chat ID',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SUMMARY_FEEDBACK])
  async addFeedbackToChat(
    @Param('id') chatId: number,
    @Body() summaryFeedbackDto: SummaryFeedbackDto,
  ): Promise<SummaryFeedbackResponse> {
    return this.service.addFeedbackToChat(chatId, summaryFeedbackDto);
  }

  @Delete(':id')
  @AuthPermissions([PERMISSIONS.DELETE_CHAT])
  @ApiOperation({ summary: 'Delete chat' })
  @ApiResponse({ status: 200, description: 'Chat deleted successfully' })
  async deleteChat(@Param('id') id: string): Promise<DeleteChatResponseDto> {
    return this.service.deleteChat(parseInt(id));
  }
}
