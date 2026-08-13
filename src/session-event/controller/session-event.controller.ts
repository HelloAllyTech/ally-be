import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SessionEvents } from '../entity/session-events.entity';
import { CreateSessionEventsDto } from '../dto/create-session-events.dto';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { SessionEventService } from '../service/session-event.service';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';
import { SessionEventSortBy } from '../enum/session-event-sort-by.enum';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';
import { DeleteSessionEventsDto } from '../dto/delete-session-events.dto';
import {
  SessionEventResponseDto,
  UpdateSessionEventDto,
} from '../dto/session-event.dto';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { SuccessResponse } from 'src/common/type/common.type';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { SUPER_ADMIN_ROLES } from 'src/common/constants/user.constants';

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
  async createSessionEvents(
    @Body() createEventsDto: CreateSessionEventsDto,
    @CurrentUser() currentUser: TokenUser,
  ): Promise<SessionEvents[]> {
    return this.sessionEventService.createSessionEvents(
      createEventsDto.events,
      currentUser.id,
    );
  }

  @ApiOperation({ summary: 'Update Session Event by id' })
  @ApiBody({ type: UpdateSessionEventDto })
  @AuthPermissions([PERMISSIONS.EDIT_SESSION_EVENTS])
  @Put('events/:id')
  async updateSessionEvents(
    @Param('id') id: string,
    @Body() updateEventsDto: UpdateSessionEventDto,
    @CurrentUser() currentUser: TokenUser,
  ): Promise<boolean> {
    return this.sessionEventService.updateSessionEvent(
      id,
      updateEventsDto,
      currentUser.id,
    );
  }

  @ApiOperation({ summary: 'Get all session events' })
  @ApiQuery({
    name: 'visibilityType',
    required: false,
    enum: SessionEventVisibilityType,
    description: 'Filter by session event visibility type',
  })
  @ApiQuery({
    name: 'searchName',
    required: false,
    type: String,
    description: 'Search by session event name',
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
  @AuthPermissions([PERMISSIONS.VIEW_SESSION_EVENTS])
  @Get()
  async getAllSessionEvents(
    @CurrentUser() currentUser: TokenUser,
    @Query('visibilityType') visibilityType?: SessionEventVisibilityType,
    @Query('searchName') searchName?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy: SessionEventSortBy = SessionEventSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<{ data: SessionEventResponseDto[] }> {
    return this.sessionEventService.getAllSessionEvents(
      visibilityType,
      searchName,
      {
        limit,
        offset,
        sortBy,
        order,
      },
      currentUser.id,
    );
  }

  @ApiOperation({ summary: 'Get session event by id' })
  @ApiParam({ name: 'id', description: 'Session event id' })
  @AuthPermissions([PERMISSIONS.VIEW_SESSION_EVENTS])
  @Get('events/:id')
  async getSessionEventById(
    @Param('id') id: string,
    @CurrentUser() currentUser: TokenUser,
  ): Promise<SessionEventResponseDto> {
    return this.sessionEventService.getSessionEventById(id, currentUser.id);
  }

  @ApiOperation({ summary: 'Delete session events' })
  @ApiBody({ type: DeleteSessionEventsDto })
  @AuthPermissions([PERMISSIONS.DELETE_SESSION_EVENTS])
  @Delete('events')
  async deleteSessionEvents(
    @Body() deleteEventsDto: DeleteSessionEventsDto,
  ): Promise<boolean> {
    return this.sessionEventService.deleteSessionEvents(
      deleteEventsDto.eventIds,
    );
  }

  @ApiOperation({ summary: 'Process passive session events' })
  // Role-gated (not EDIT_SESSION_EVENTS) so multi-tenant admins, who hold that
  // permission for library CRUD, cannot trigger this operational endpoint.
  @RequireFeatureToggle(FeatureToggleKey.OPERATIONAL_ADMIN_ACTIONS, {
    legacyRoles: SUPER_ADMIN_ROLES,
  })
  @Post('translate-passive')
  async translatePassiveSessionEvents(): Promise<SuccessResponse> {
    return await this.sessionEventService.translatePassiveSessionEvents();
  }

  @ApiOperation({ summary: 'Get all unique tags from session events' })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search filter for tags (case-insensitive)',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SESSION_EVENTS])
  @Get('tags')
  async getUniqueTags(
    @Query('search') search?: string,
  ): Promise<{ data: string[] }> {
    const tags = await this.sessionEventService.getUniqueTags(search);
    return { data: tags };
  }
}
