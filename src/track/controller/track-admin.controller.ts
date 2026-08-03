import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { TenantScopedPermissions } from 'src/auth/decorators/own-tenant-scope.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AssignmentStatus, SuccessResponse } from 'src/common/type/common.type';
import { TrackService } from '../service/track.service';
import { TrackTenantService } from '../service/track-tenant.service';
import { TrackMediaService } from '../service/track-media.service';
import {
  CreateTrackDto,
  TrackSummaryResponseDto,
} from '../dto/create-track.dto';
import { UpdateTrackDto } from '../dto/update-track.dto';
import { UpsertTrackStructureDto } from '../dto/upsert-track-structure.dto';
import {
  CreateTrackTenantDto,
  DeleteTrackTenantDto,
} from '../dto/track-tenant.dto';
import {
  DeleteTrackMediaDto,
  TrackMediaUploadRequestDto,
  TrackMediaUploadResponseDto,
} from '../dto/track-media-upload.dto';
import { TrackSortBy, TrackSortOrder } from '../type/track.type';

@ApiTags('Learn Tracks (Admin)')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn/admin')
export class TrackAdminController {
  constructor(
    private readonly trackService: TrackService,
    private readonly trackTenantService: TrackTenantService,
    private readonly trackMediaService: TrackMediaService,
  ) {}

  @ApiOperation({ summary: 'List tracks' })
  @ApiQuery({
    name: 'assignmentStatus',
    required: false,
    enum: AssignmentStatus,
    description:
      'Filter by tenant assignment status (requires tenantId; ignored without it)',
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_TRACKS])
  @Get('tracks')
  async getTracks(
    @Query('status') status?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('tenantId', new ParseUUIDPipe({ optional: true })) tenantId?: string,
    @Query(
      'assignmentStatus',
      new ParseEnumPipe(AssignmentStatus, { optional: true }),
    )
    assignmentStatus?: AssignmentStatus,
    @Query('sortBy') sortBy: TrackSortBy = TrackSortBy.UPDATED_AT,
    @Query('order') order: TrackSortOrder = TrackSortOrder.DESC,
  ) {
    return this.trackService.getTracks({
      status: status?.split(',').map((s) => s.trim()),
      offset,
      limit,
      search,
      tenantId,
      assignmentStatus,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Presigned upload URL for track media' })
  @ApiResponse({ status: 201, type: TrackMediaUploadResponseDto })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks/media/upload-url')
  async getMediaUploadUrl(
    @Body() dto: TrackMediaUploadRequestDto,
  ): Promise<TrackMediaUploadResponseDto> {
    return this.trackMediaService.getPresignedUploadUrl(dto);
  }

  // Declared before the `tracks/:id` routes so "media" isn't captured as :id.
  @ApiOperation({ summary: 'Delete uploaded track media' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Delete('tracks/media')
  async deleteMedia(
    @Body() dto: DeleteTrackMediaDto,
  ): Promise<SuccessResponse> {
    return this.trackMediaService.deleteMedia(dto);
  }

  @ApiOperation({ summary: 'Backfill translations for all tracks' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks/make-translations')
  async makeTranslationsForTracks(): Promise<boolean> {
    return this.trackService.makeTranslationsForTracks();
  }

  @ApiOperation({
    summary: 'Get track by id with full section/component tree',
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_TRACK])
  @Get('tracks/:id')
  async getTrackById(@Param('id', ParseUUIDPipe) id: string) {
    return this.trackService.getTrackById(id);
  }

  @ApiOperation({ summary: 'Create track (draft)' })
  @ApiResponse({ status: 201, type: TrackSummaryResponseDto })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks')
  async createTrack(
    @Body() createTrackDto: CreateTrackDto,
  ): Promise<TrackSummaryResponseDto> {
    return this.trackService.createTrack(createTrackDto);
  }

  @ApiOperation({ summary: 'Update track metadata / status' })
  @ApiResponse({ status: 200, type: TrackSummaryResponseDto })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Put('tracks/:id')
  async updateTrack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTrackDto: UpdateTrackDto,
  ): Promise<TrackSummaryResponseDto> {
    return this.trackService.updateTrack(id, updateTrackDto);
  }

  @ApiOperation({
    summary:
      'Upsert the whole section/component tree. Structural edits are rejected with 409 once learners are enrolled.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Put('tracks/:id/structure')
  async upsertTrackStructure(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertTrackStructureDto,
  ): Promise<SuccessResponse> {
    return this.trackService.upsertStructure(id, dto);
  }

  @ApiOperation({ summary: 'Delete track' })
  @AuthPermissions([PERMISSIONS.DELETE_ADMIN_TRACK])
  @Delete('tracks/:id')
  async deleteTrack(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SuccessResponse> {
    return this.trackService.deleteTrack(id);
  }

  @ApiOperation({ summary: 'Duplicate track (deep copy → draft)' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks/:id/duplicate')
  async duplicateTrack(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TrackSummaryResponseDto> {
    return this.trackService.duplicateTrack(id);
  }

  @ApiOperation({ summary: 'Assign tracks to a tenant' })
  @TenantScopedPermissions([PERMISSIONS.EDIT_TRACK_TENANT])
  @Post('tracks/tenant/:tenantId')
  async assignTracksToTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateTrackTenantDto,
  ): Promise<SuccessResponse> {
    return this.trackTenantService.assignTracksToTenant(tenantId, dto);
  }

  @ApiOperation({ summary: 'Remove tracks from a tenant' })
  @TenantScopedPermissions([PERMISSIONS.DELETE_TRACK_TENANT])
  @Delete('tracks/tenant/:tenantId')
  async removeTracksFromTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: DeleteTrackTenantDto,
  ): Promise<SuccessResponse> {
    return this.trackTenantService.removeTracksFromTenant(tenantId, dto);
  }
}
