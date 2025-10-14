import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { SessionEventService } from '../service/session-event.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SessionEvents } from '../entity/session-events.entity';
import { CreateSessionEventsDto } from '../dto/create-session-events.dto';
import { UpdateSessionEventDto } from '../dto/update-session-event.dto';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';

import { SortOrder } from 'src/chat/dto/call-log.request.dto';
import { SessionEventSortBy } from '../enum/session-event-sort-by.enum';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';
import { AuthRoles } from 'src/auth/decorators/auth-roles.decorator';
import { UserRole } from 'src/common/constants/user.constants';

@ApiTags('SessionEvents')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/session-events')
export class SessionEventController {
  constructor(private readonly sessionEventService: SessionEventService) {}

  @ApiOperation({ summary: 'Create session events' })
  @ApiBody({ type: CreateSessionEventsDto })
  @AuthPermissions([PERMISSIONS.EDIT_SESSION_EVENTS])
  @Post()
  createSessionEvents(
    @Body() createEventsDto: CreateSessionEventsDto,
  ): Promise<SessionEvents[]> {
    return this.sessionEventService.createSessionEvents(createEventsDto.events);
  }

  @ApiOperation({ summary: 'Update Session Event by id' })
  @ApiBody({ type: UpdateSessionEventDto })
  @AuthPermissions([PERMISSIONS.EDIT_SESSION_EVENTS])
  @Put('events/:id')
  updateSessionEvents(
    @Param('id') id: string,
    @Body() updateEventsDto: UpdateSessionEventDto,
  ): Promise<boolean> {
    return this.sessionEventService.updateSessionEvent(id, updateEventsDto);
  }

  @ApiOperation({ summary: 'Get all session events' })
  @ApiQuery({
    name: 'visibilityType',
    required: false,
    enum: SessionEventVisibilityType,
    description: 'Filter by session event visibility type',
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
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Get()
  getAllSessionEvents(
    @Query('visibilityType') visibilityType?: SessionEventVisibilityType,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy: SessionEventSortBy = SessionEventSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<{ data: SessionEvents[] }> {
    return this.sessionEventService.getAllSessionEvents(visibilityType, {
      limit,
      offset,
      sortBy,
      order,
    });
  }
}
