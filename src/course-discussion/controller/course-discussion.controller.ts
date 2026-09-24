import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CourseDiscussionService } from '../service/course-discussion.service';
import {
  DiscussionLockDto,
  DiscussionPostContentDto,
  DiscussionPostDto,
  DiscussionTenantQueryDto,
  DiscussionTenantSummaryDto,
  DiscussionViewDto,
} from '../dto/course-discussion.dto';

/**
 * Inline discussions on course items. Every route admits a learner who can open
 * the item or a course editor (edit:admin:track); which powers each has is
 * decided in the service — see docs/course-discussions.md.
 */
@ApiTags('Course Discussions')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn')
export class CourseDiscussionController {
  constructor(private readonly discussionService: CourseDiscussionService) {}

  @ApiOperation({ summary: "A course item's discussion, threaded" })
  @ApiResponse({ status: 200, type: DiscussionViewDto })
  @AuthPermissions([PERMISSIONS.VIEW_TRACK, PERMISSIONS.EDIT_ADMIN_TRACK], 'OR')
  @Get('track-items/:itemId/discussion')
  async getDiscussion(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() query: DiscussionTenantQueryDto,
  ): Promise<DiscussionViewDto> {
    return this.discussionService.getDiscussion(itemId, query.tenantId);
  }

  @ApiOperation({
    summary: 'Moderators: organisations with a thread on this item',
  })
  @ApiResponse({ status: 200, type: [DiscussionTenantSummaryDto] })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Get('track-items/:itemId/discussion/tenants')
  async listTenants(
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<DiscussionTenantSummaryDto[]> {
    return this.discussionService.listTenantsWithPosts(itemId);
  }

  @ApiOperation({ summary: 'Start a new top-level post' })
  @ApiResponse({ status: 201, type: DiscussionPostDto })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK, PERMISSIONS.EDIT_ADMIN_TRACK], 'OR')
  @Post('track-items/:itemId/discussion/posts')
  async createPost(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: DiscussionPostContentDto,
  ): Promise<DiscussionPostDto> {
    return this.discussionService.createPost(itemId, dto.content);
  }

  @ApiOperation({
    summary:
      'Moderators: lock or unlock the whole discussion (no new posts or replies)',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Put('track-items/:itemId/discussion/lock')
  async setDiscussionLock(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() query: DiscussionTenantQueryDto,
    @Body() dto: DiscussionLockDto,
  ): Promise<{ success: true }> {
    return this.discussionService.setDiscussionLock(
      itemId,
      dto.locked,
      query.tenantId,
    );
  }

  @ApiOperation({ summary: 'Reply to a post (max three levels deep)' })
  @ApiResponse({ status: 201, type: DiscussionPostDto })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK, PERMISSIONS.EDIT_ADMIN_TRACK], 'OR')
  @Post('discussion/posts/:postId/replies')
  async reply(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: DiscussionPostContentDto,
  ): Promise<DiscussionPostDto> {
    return this.discussionService.reply(postId, dto.content);
  }

  @ApiOperation({
    summary:
      'Edit a post — your own within 15 minutes, or any post as a moderator',
  })
  @ApiResponse({ status: 200, type: DiscussionPostDto })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK, PERMISSIONS.EDIT_ADMIN_TRACK], 'OR')
  @Put('discussion/posts/:postId')
  async editPost(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: DiscussionPostContentDto,
  ): Promise<DiscussionPostDto> {
    return this.discussionService.editPost(postId, dto.content);
  }

  @ApiOperation({
    summary:
      'Delete a post — yours (leaves a placeholder if it has replies), or any post and its replies as a moderator',
  })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK, PERMISSIONS.EDIT_ADMIN_TRACK], 'OR')
  @Delete('discussion/posts/:postId')
  async deletePost(
    @Param('postId', ParseUUIDPipe) postId: string,
  ): Promise<{ success: true }> {
    return this.discussionService.deletePost(postId);
  }

  @ApiOperation({
    summary: 'Moderators: lock or unlock replies under a top-level post',
  })
  @ApiResponse({ status: 200, type: DiscussionPostDto })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  @Put('discussion/posts/:postId/lock')
  async setThreadLock(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: DiscussionLockDto,
  ): Promise<DiscussionPostDto> {
    return this.discussionService.setThreadLock(postId, dto.locked);
  }
}
