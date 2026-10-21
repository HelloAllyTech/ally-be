import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
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
import {
  MarkTrackTranslationReviewedDto,
  SetTrackLanguagesDto,
  SetTrackTranslationMediaDto,
  TranslateTrackDto,
  UpdateTrackTranslationFieldsDto,
} from '../dto/track-translation.dto';
import { TrackTranslationService } from '../service/track-translation.service';
import { TrackCoverImageService } from '../service/track-cover-image.service';
import { GenerateTrackCoverImageRequestDto } from '../dto/generate-track-cover-image.dto';
import { ImageGenerationJobService } from 'src/image-generation/service/image-generation-job.service';
import { ImageGenerationJobDto } from 'src/image-generation/dto/image-generation-job.dto';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { TrackSortBy, TrackSortOrder } from '../type/track.type';
import { BranchingResetDto } from '../dto/branching-reset.dto';
import { TrackBranchingService } from '../service/track-branching.service';

@ApiTags('Learn Tracks (Admin)')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn/admin')
export class TrackAdminController {
  constructor(
    private readonly trackService: TrackService,
    private readonly trackTenantService: TrackTenantService,
    private readonly trackMediaService: TrackMediaService,
    private readonly trackTranslationService: TrackTranslationService,
    private readonly trackCoverImageService: TrackCoverImageService,
    private readonly imageGenerationJobService: ImageGenerationJobService,
    private readonly trackBranchingService: TrackBranchingService,
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

  @ApiOperation({
    summary: 'Start generating a course cover image with AI',
    description:
      'Returns 202 with a job id at once — generation can outlast the load ' +
      "balancer's 60 s idle timeout. Poll GET tracks/cover-image/generate/:jobId. " +
      'The trainer-edited prompt is sent to the image provider verbatim; the ' +
      'PNG is stored under track-media/image/. Nothing is saved on the track — ' +
      'the editor applies an accepted image to the form and the normal track ' +
      'save persists it.',
  })
  @ApiResponse({ status: 202, type: ImageGenerationJobDto })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks/cover-image/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async startCoverImageGeneration(
    @Body() dto: GenerateTrackCoverImageRequestDto,
    @CurrentUser() user: TokenUser,
  ): Promise<ImageGenerationJobDto> {
    return this.imageGenerationJobService.start('course-cover', user.id, () =>
      this.trackCoverImageService.generate(dto),
    );
  }

  @ApiOperation({
    summary: 'Poll a course cover image generation',
    description:
      "status is 'running', 'succeeded' (with imageUrl) or 'failed' (with an " +
      'error to show the trainer). Only the user who started it can read it; ' +
      'records expire after an hour.',
  })
  @ApiResponse({ status: 200, type: ImageGenerationJobDto })
  @ApiResponse({ status: 404, description: 'Unknown, expired or not yours' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Get('tracks/cover-image/generate/:jobId')
  async getCoverImageGeneration(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUser() user: TokenUser,
  ): Promise<ImageGenerationJobDto> {
    return this.imageGenerationJobService.get('course-cover', user.id, jobId);
  }

  // Declared before the `tracks/:id` routes so "media" isn't captured as :id.
  @ApiOperation({ summary: 'Delete uploaded track media' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Delete('tracks/media')
  async deleteMedia(
    @Body() dto: DeleteTrackMediaDto,
  ): Promise<SuccessResponse> {
    await this.trackService.assertCallerMayDeleteMedia(dto.url);
    return this.trackMediaService.deleteMedia(dto);
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
    await this.trackService.assertCallerMayMakeGlobal(createTrackDto.isGlobal);
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
    await this.trackService.assertCallerMayEdit(id);
    await this.trackService.assertCallerMayMakeGlobal(updateTrackDto.isGlobal);
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
    await this.trackService.assertCallerMayEdit(id);
    return this.trackService.upsertStructure(id, dto);
  }

  /* ---------------------------------------------------------------- *
   * Translations
   *
   * All of these sit on EDIT_ADMIN_TRACK: whoever owns a course's content owns
   * its translations, including publishing them.
   * ---------------------------------------------------------------- */

  @ApiOperation({
    summary:
      "The course's languages with per-language review state, plus every language available to add",
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_TRACK])
  @Get('tracks/:id/translations')
  async listTrackTranslations(@Param('id', ParseUUIDPipe) id: string) {
    return this.trackTranslationService.listForTrack(id);
  }

  @ApiOperation({
    summary:
      'Set the languages this course should be available in. Newly added languages start translating immediately.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Put('tracks/:id/translations')
  async setTrackLanguages(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTrackLanguagesDto,
  ) {
    await this.trackService.assertCallerMayEdit(id);
    return this.trackTranslationService.setLanguages(id, dto.languageIds);
  }

  @ApiOperation({
    summary:
      'Run translation. Returns immediately — progress arrives on the /tracks/translations socket.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks/:id/translations/translate')
  async translateTrack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TranslateTrackDto,
  ) {
    await this.trackService.assertCallerMayEdit(id);
    return this.trackTranslationService.translate(id, dto.languageIds);
  }

  @ApiOperation({
    summary:
      'The course in one language: every translatable string beside its English source',
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_TRACK])
  @Get('tracks/:id/translations/:languageId')
  async getTrackTranslation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('languageId', ParseIntPipe) languageId: number,
  ) {
    return this.trackTranslationService.getEditorView(id, languageId);
  }

  @ApiOperation({
    summary:
      'Save trainer edits. An edit counts as reviewed and is never overwritten by a later translation run.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Put('tracks/:id/translations/:languageId/fields')
  async updateTrackTranslationFields(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('languageId', ParseIntPipe) languageId: number,
    @Body() dto: UpdateTrackTranslationFieldsDto,
  ) {
    await this.trackService.assertCallerMayEdit(id);
    return this.trackTranslationService.updateFields(id, languageId, dto.edits);
  }

  @ApiOperation({
    summary:
      'Confirm machine output as-is. With no fields named, confirms everything awaiting review.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks/:id/translations/:languageId/review')
  async reviewTrackTranslation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('languageId', ParseIntPipe) languageId: number,
    @Body() dto: MarkTrackTranslationReviewedDto,
  ) {
    await this.trackService.assertCallerMayEdit(id);
    return this.trackTranslationService.markReviewed(
      id,
      languageId,
      dto.fields,
    );
  }

  @ApiOperation({
    summary:
      "Set or clear a localised media URL for a video component, or for one question's media",
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Put('tracks/:id/translations/:languageId/media')
  async setTrackTranslationMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('languageId', ParseIntPipe) languageId: number,
    @Body() dto: SetTrackTranslationMediaDto,
  ): Promise<SuccessResponse> {
    await this.trackService.assertCallerMayEdit(id);
    await this.trackTranslationService.setMediaUrl(
      id,
      languageId,
      dto.trackItemId,
      dto.url ?? null,
      dto.questionId ?? null,
    );
    return { success: true };
  }

  @ApiOperation({
    summary:
      'Make this language available to learners. Rejected while any scoring field is unconfirmed.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks/:id/translations/:languageId/publish')
  async publishTrackTranslation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('languageId', ParseIntPipe) languageId: number,
  ) {
    await this.trackService.assertCallerMayEdit(id);
    return this.trackTranslationService.publish(id, languageId);
  }

  @ApiOperation({
    summary:
      'Take this language off the shelf. Learners mid-course fall back to English.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks/:id/translations/:languageId/unpublish')
  async unpublishTrackTranslation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('languageId', ParseIntPipe) languageId: number,
  ): Promise<SuccessResponse> {
    await this.trackService.assertCallerMayEdit(id);
    await this.trackTranslationService.unpublish(id, languageId);
    return { success: true };
  }

  @ApiOperation({ summary: 'Delete track' })
  @AuthPermissions([PERMISSIONS.DELETE_ADMIN_TRACK])
  @Delete('tracks/:id')
  async deleteTrack(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SuccessResponse> {
    await this.trackService.assertCallerMayEdit(id);
    return this.trackService.deleteTrack(id);
  }

  @ApiOperation({ summary: 'Duplicate track (deep copy → draft)' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Post('tracks/:id/duplicate')
  async duplicateTrack(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TrackSummaryResponseDto> {
    await this.trackService.assertCallerMayEdit(id);
    return this.trackService.duplicateTrack(id);
  }

  @ApiOperation({
    summary: "A learner's open scenario quiz attempts",
    description:
      "The scenario quizzes a learner in the caller's own organisation has " +
      'started but not passed, with attempts used and when a paused round ' +
      'reopens. What the "reopen attempts" action acts on.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_USER])
  @Get('learners/:userId/scenario-attempts')
  async listLearnerScenarioAttempts(
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.trackBranchingService.listLearnerAttempts(userId);
  }

  @ApiOperation({
    summary: "Reopen a learner's attempts on a scenario quiz now",
    description:
      'A learner who uses every attempt without passing waits for a fresh ' +
      'round to open by itself. This opens it immediately. Only learners in ' +
      "the caller's own organisation can be reset.",
  })
  @AuthPermissions([PERMISSIONS.EDIT_USER])
  @Post('tracks/items/:trackItemId/branching-reset')
  async resetBranchingAttempts(
    @Param('trackItemId', ParseUUIDPipe) trackItemId: string,
    @Body() dto: BranchingResetDto,
  ) {
    return this.trackBranchingService.resetAttempts(trackItemId, dto.userId);
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
