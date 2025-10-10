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
import { ApiTags, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import {
  GetCallLogs,
  GetAdminCallLogs,
  GetCounselorNames,
  GetAllTags,
  GetChatMessages,
  GetChatDetails,
  EnhanceChatSummary,
  UpdateCallDetails,
  GetChatSummary,
  GetChatSummaryForMessage,
  GetChatNudge,
  ExportChatSummary,
  UpdateCallInfo,
  TagPositivityRatings,
  AddNoteToChat,
  AddSummaryFeedback,
  DeleteChat,
} from '../decorators/api-documentation.decorators';
import { CallInfoDto, DeleteChatResponseDto } from '../dto/chat.response.dto';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { CallStartDto } from '../dto/call-start.dto';
import { Response } from 'express';
import { CallLogSortBy, SortOrder } from '../dto/call-log.request.dto';
import { AddNoteDto, AddNotesResponse } from '../dto/notes.dto';
import { ChatSummaryService } from '../service/chat-summary.service';
import { SummaryFeedbackDto } from '../dto/summary-feedback.dto';
import { SummaryFeedbackResponse } from '../dto/call-log.response.dto';
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

  @GetCallLogs()
  @AuthRoles(UserRole.COUNSELOR, UserRole.SUPER_ADMIN, UserRole.ADMIN)
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

  @GetAdminCallLogs()
  @AuthRoles(UserRole.ADMIN)
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

  @GetCounselorNames()
  @AuthRoles(UserRole.ADMIN)
  @Get('counselors')
  async getCounselorNames(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('search') search?: string,
  ) {
    return this.service.getCounselorNames(limit, offset, search);
  }

  @GetAllTags()
  @AuthRoles(UserRole.ADMIN)
  @Get('tags')
  async getAllTags(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('search') search?: string,
  ) {
    return this.service.getAllTags(limit, offset, search);
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

  @GetChatMessages()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
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

  @GetChatDetails()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Get(':id')
  async getChat(@Param('id', ParseIntPipe) id: number) {
    return this.service.getChat(id);
  }

  @EnhanceChatSummary()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Post('enhance')
  async enhance(@Body() body: { content: string }) {
    return this.service.enhance(body.content);
  }

  @UpdateCallDetails()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Put(':id/call-details')
  async updateCallDetails(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { summary: any },
  ) {
    return this.service.updateCallDetails(id, body.summary);
  }

  @GetChatSummary()
  @AuthRoles(UserRole.COUNSELOR)
  @Get(':id/summary')
  async getChatSummary(@Param('id', ParseIntPipe) id: number) {
    return this.service.generateSummary(id);
  }

  @GetChatSummaryForMessage()
  @AuthRoles(UserRole.COUNSELOR)
  @Post('summaryForMessage')
  async getChatSummaryForMessage(
    @Body() body: { messageRequests: MessageRequest[] },
  ) {
    return this.service.generateSummaryForMessage(body.messageRequests);
  }

  @GetChatNudge()
  @AuthRoles(UserRole.COUNSELOR)
  @Post('nudge')
  async getChatNudge(
    @Body() body: { newMessage: string; chatHistory: MessageRequest[] },
  ) {
    return this.service.getNudge(body.newMessage, body.chatHistory);
  }

  @ExportChatSummary()
  @AuthRoles(UserRole.COUNSELOR, UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get(':chatId/export-summary')
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

  @UpdateCallInfo()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Patch(':chatId/call-info')
  async updateCallInfo(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() body: CallInfoDto,
  ) {
    return this.service.updateCallInfo(chatId, body);
  }

  @TagPositivityRatings()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Post('/summary/tag-positivity-ratings')
  async tagPositivityRatings(@Body() body: { tags: string[] }) {
    return this.service.tagPositivityRatings(body.tags);
  }

  @AddNoteToChat()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Post(':id/notes')
  async addNoteToChat(
    @Param('id') chatId: number,
    @Body() createNoteDto: AddNoteDto,
  ): Promise<AddNotesResponse> {
    return this.service.addNoteToSession(chatId, createNoteDto);
  }

  @AddSummaryFeedback()
  @AuthRoles(UserRole.COUNSELOR)
  @Post(':id/summary-feedback')
  async addFeedbackToChat(
    @Param('id') chatId: number,
    @Body() summaryFeedbackDto: SummaryFeedbackDto,
  ): Promise<SummaryFeedbackResponse> {
    return this.service.addFeedbackToChat(chatId, summaryFeedbackDto);
  }

  @DeleteChat()
  @AuthPermissions([PERMISSIONS.DELETE_CHAT])
  @Delete(':id')
  async deleteChat(@Param('id') id: string): Promise<DeleteChatResponseDto> {
    return this.service.deleteChat(parseInt(id));
  }
}
