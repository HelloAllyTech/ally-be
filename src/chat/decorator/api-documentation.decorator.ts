import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import {
  CallLogResponse,
  SummaryFeedbackResponse,
} from '../dto/call-log.response.dto';
import { GetMessagesResponse } from '../dto/message.response.dto';
import { ChatResponseDto } from '../dto/chat.response.dto';
import { CallLogSortBy, SortOrder } from '../dto/call-log.request.dto';
import { PaginatedResponse } from '../../common/type/common.type';
import { CounselorNameResponse } from '../dto/call-log.response.dto';

const withPagination = () =>
  applyDecorators(
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Number of records to return',
    }),
    ApiQuery({
      name: 'offset',
      required: false,
      type: Number,
      description: 'Number of records to skip',
    }),
  );

const withSorting = (sortByEnum?: any) =>
  applyDecorators(
    ApiQuery({
      name: 'sortBy',
      required: false,
      enum: sortByEnum,
      type: sortByEnum ? undefined : String,
      description: 'Field to sort by (default: createdAt)',
    }),
    ApiQuery({
      name: 'order',
      required: false,
      enum: SortOrder,
      description: 'Sort order (default: DESC)',
    }),
  );

const withSearch = () =>
  applyDecorators(
    ApiQuery({
      name: 'search',
      required: false,
      type: String,
      description: 'Search term (partial match)',
    }),
  );

export const GetCallLogs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get counsellor call logs' }),
    ApiResponse({
      status: 200,
      description: 'Returns the list of call logs',
      type: CallLogResponse,
      isArray: true,
    }),
    withPagination(),
    withSorting(CallLogSortBy),
  );

export const GetAdminCallLogs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get admin call logs with filtering' }),
    ApiResponse({
      status: 200,
      description: 'Returns the list of call logs with admin filters',
      type: CallLogResponse,
      isArray: true,
    }),
    withPagination(),
    withSorting(CallLogSortBy),
    ApiQuery({
      name: 'counselorName',
      required: false,
      type: String,
      description: 'Search by counselor name (partial match)',
    }),
    ApiQuery({
      name: 'clientId',
      required: false,
      type: String,
      description: 'Search by client ID',
    }),
    ApiQuery({
      name: 'counselorId',
      required: false,
      type: String,
      description: 'Filter by counselor IDs (comma-separated)',
    }),
    ApiQuery({
      name: 'startDate',
      required: false,
      type: String,
      description: 'Filter by start date (ISO string)',
    }),
    ApiQuery({
      name: 'endDate',
      required: false,
      type: String,
      description: 'Filter by end date (ISO string)',
    }),
    ApiQuery({
      name: 'minDuration',
      required: false,
      type: Number,
      description: 'Filter by minimum call duration in seconds',
    }),
    ApiQuery({
      name: 'maxDuration',
      required: false,
      type: Number,
      description: 'Filter by maximum call duration in seconds',
    }),
    ApiQuery({
      name: 'minQualityScore',
      required: false,
      type: Number,
      description: 'Filter by minimum quality score',
    }),
    ApiQuery({
      name: 'maxQualityScore',
      required: false,
      type: Number,
      description: 'Filter by maximum quality score',
    }),
    ApiQuery({
      name: 'tags',
      required: false,
      type: String,
      description: 'Filter by tags (comma-separated)',
    }),
  );

export const GetCounselorNames = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get all counselor names for admin' }),
    ApiResponse({
      status: 200,
      description: 'Returns the list of counselor names',
      type: PaginatedResponse<CounselorNameResponse>,
    }),
    withPagination(),
    withSearch(),
  );

export const GetAllTags = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get all tags for admin' }),
    ApiResponse({
      status: 200,
      description: 'Returns the list of all tags',
      type: PaginatedResponse<string>,
    }),
    withPagination(),
    withSearch(),
  );

export const GetChatMessages = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get messages' }),
    ApiResponse({
      status: 200,
      description: 'Returns the list of messages',
      type: GetMessagesResponse,
    }),
    ApiParam({
      name: 'id',
      required: true,
      type: Number,
      description: 'Chat ID',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Number of records to return',
    }),
    ApiQuery({
      name: 'offset',
      required: false,
      type: Number,
      description: 'Number of records to skip',
    }),
    ApiQuery({
      name: 'sortBy',
      required: false,
      type: String,
      description: 'Field to sort by (default: createdAt)',
    }),
    ApiQuery({
      name: 'sortOrder',
      required: false,
      enum: ['ASC', 'DESC'],
      description: 'Sort order (default: DESC)',
    }),
  );

export const GetChatDetails = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get chat details' }),
    ApiResponse({
      status: 200,
      description: 'Returns the chat details',
      type: ChatResponseDto,
    }),
  );

export const EnhanceChatSummary = () =>
  applyDecorators(
    ApiOperation({ summary: 'Enhance chat summary' }),
    ApiResponse({
      status: 200,
      description: 'Returns enhanced summary content',
      schema: {
        type: 'object',
        properties: {
          enhanced_content: { type: 'string' },
        },
      },
    }),
    ApiBody({
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
    }),
  );

export const UpdateCallDetails = () =>
  applyDecorators(
    ApiOperation({ summary: 'Update call details' }),
    ApiResponse({
      status: 200,
      description: 'Returns the updated call details',
      type: ChatResponseDto,
    }),
    ApiBody({
      description: 'Call details to update',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'object' },
        },
      },
    }),
  );

export const GetChatSummary = () =>
  ApiOperation({ summary: 'Get chat summary' });

export const GetChatSummaryForMessage = () =>
  ApiOperation({ summary: 'Get chat summary for message' });

export const GetChatNudge = () =>
  ApiOperation({ summary: 'Get chat AI nugde for message' });

export const ExportChatSummary = () =>
  applyDecorators(
    ApiOperation({ summary: 'Export chat summary in TXT format' }),
    ApiResponse({
      status: 200,
      description: 'Returns the chat summary as a text file',
      content: {
        'text/plain': {
          schema: {
            type: 'string',
          },
        },
      },
    }),
    ApiResponse({ status: 404, description: 'Chat not found' }),
  );

export const UpdateCallInfo = () =>
  applyDecorators(
    ApiOperation({ summary: 'Update call info' }),
    ApiResponse({
      status: 200,
      description: 'Returns the updated call info',
      type: ChatResponseDto,
    }),
  );

export const TagPositivityRatings = () =>
  applyDecorators(
    ApiOperation({ summary: 'Tag positivty ratings' }),
    ApiResponse({
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
    }),
  );

export const AddNoteToChat = () =>
  applyDecorators(
    ApiOperation({ summary: 'Add a note to a session' }),
    ApiResponse({
      status: 201,
      description: 'Note added successfully',
      type: String,
    }),
    ApiParam({
      name: 'id',
      required: true,
      type: Number,
      description: 'Chat ID',
    }),
  );

export const AddSummaryFeedback = () =>
  applyDecorators(
    ApiOperation({ summary: 'Add a feedback to summary generated' }),
    ApiResponse({
      status: 201,
      description: 'Feedback added successfully',
      type: SummaryFeedbackResponse,
    }),
    ApiParam({
      name: 'id',
      required: true,
      type: Number,
      description: 'Chat ID',
    }),
  );

export const DeleteChat = () =>
  applyDecorators(
    ApiOperation({ summary: 'Delete chat' }),
    ApiResponse({ status: 200, description: 'Chat deleted successfully' }),
  );
