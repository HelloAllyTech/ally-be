import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ScenarioSessionResponseDto } from '../dto/scenario-session-response.dto';
import { ScenarioSessionSortBy } from '../enum/scenario-session-sort-by.enum';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';

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
      description: 'Field to sort by',
    }),
    ApiQuery({
      name: 'order',
      required: false,
      enum: SortOrder,
      description: 'Sort order',
    }),
  );

export const GetUserScenarioSessions = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get all scenario sessions for user' }),
    ApiResponse({
      status: 200,
      description: 'Returns the list of scenario sessions',
      type: ScenarioSessionResponseDto,
      isArray: true,
    }),
    ApiQuery({
      name: 'statuses',
      required: false,
      type: String,
      description: 'Filter by scenario session statuses (comma-separated)',
    }),
    withPagination(),
    withSorting(ScenarioSessionSortBy),
  );

export const GetAdminScenarioSessions = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get all scenario sessions for admin' }),
    ApiResponse({
      status: 200,
      description: 'Returns the list of scenario sessions for admin',
      type: ScenarioSessionResponseDto,
      isArray: true,
    }),
    withPagination(),
    withSorting(ScenarioSessionSortBy),
  );

export const GetScenarioSessionMessages = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get messages for a scenario session' }),
    ApiResponse({
      status: 200,
      description: 'Returns the list of messages for the scenario session',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Number of messages to return',
    }),
    ApiQuery({
      name: 'offset',
      required: false,
      type: Number,
      description: 'Number of messages to skip',
    }),
    ApiQuery({
      name: 'sortBy',
      required: false,
      type: String,
      description: 'Field to sort by (default: createdAt)',
    }),
    ApiQuery({
      name: 'order',
      required: false,
      enum: SortOrder,
      description: 'Sort order (default: DESC)',
    }),
  );

export const GetAllScenarios = () =>
  ApiOperation({ summary: 'Get all scenarios' });

export const GetScenarioById = () =>
  ApiOperation({ summary: 'Get a scenario by id' });

export const CreateScenarios = () =>
  ApiOperation({ summary: 'Create multiple scenarios' });

export const UpdateScenario = () =>
  ApiOperation({ summary: 'Update a scenario by id' });

export const GetScenarioSessionById = () =>
  ApiOperation({ summary: 'Get a scenario session by id' });

export const MapEventsToScenario = () =>
  ApiOperation({ summary: 'Map events to scenario' });

export const DeleteScenarioEvents = () =>
  ApiOperation({ summary: 'Delete scenario events' });

export const StartScenarioSession = () =>
  ApiOperation({ summary: 'Start a scenario session' });

export const EndScenarioSession = () =>
  ApiOperation({ summary: 'End a scenario session' });

export const AddScenarioSessionFeedback = () =>
  ApiOperation({ summary: 'Add a feedback to a scenario session' });
