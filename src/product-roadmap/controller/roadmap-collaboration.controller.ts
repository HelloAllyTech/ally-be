import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { SUPER_DUPER_ADMIN_ROLES } from 'src/common/constants/user.constants';

import {
  CreateCommentDto,
  CreateSavedViewDto,
  PinSavedViewDto,
  SetTabOrderDto,
  UpdateCommentDto,
  UpdateSavedViewDto,
} from '../dto/roadmap-content.dto';
import { RoadmapCommentService } from '../service/roadmap-comment.service';
import { RoadmapSavedViewService } from '../service/roadmap-saved-view.service';
import { RoadmapAccessService } from '../service/roadmap-access.service';

/** Comments and saved views — the per-user collaboration surface. */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap', version: '1' })
export class RoadmapCollaborationController {
  constructor(
    private readonly commentService: RoadmapCommentService,
    private readonly savedViewService: RoadmapSavedViewService,
    private readonly access: RoadmapAccessService,
  ) {}

  // ── comments ──────────────────────────────────────────────────────────────

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('opportunities/:id/comments')
  @ApiOperation({ summary: 'Comments on an opportunity, oldest first' })
  listComments(@Param('id', ParseUUIDPipe) id: string) {
    return this.commentService.list(id);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('opportunities/:id/comments')
  @ApiOperation({ summary: 'Add a comment' })
  createComment(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentService.create(user.id, id, dto);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Patch('comments/:commentId')
  @ApiOperation({
    summary: 'Edit your own comment',
    description:
      'AUTHOR ONLY — a roadmap manager may delete someone else’s comment but may not rewrite ' +
      'it. That asymmetry is intentional and ported from the source’s RLS.',
  })
  updateComment(
    @CurrentUser() user: TokenUser,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.commentService.update(user.id, commentId, dto);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a comment (author or roadmap manager)' })
  async removeComment(
    @CurrentUser() user: TokenUser,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<void> {
    return this.commentService.remove(
      user.id,
      commentId,
      await this.access.canManage(user.id),
    );
  }

  // ── saved views ───────────────────────────────────────────────────────────

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('views')
  @ApiOperation({
    summary: 'Your saved views plus every pinned view',
    description:
      'The own-or-pinned row filter is applied in SQL. It replaces the source’s RLS policy and ' +
      'is the only rule here with no decorator equivalent.',
  })
  listViews(@CurrentUser() user: TokenUser) {
    return this.savedViewService.list(user.id);
  }

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('views/tab-order')
  @ApiOperation({ summary: 'Your saved-view tab order' })
  getTabOrder(@CurrentUser() user: TokenUser) {
    return this.savedViewService.getTabOrder(user.id);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Put('views/tab-order')
  @ApiOperation({
    summary: 'Reorder your saved-view tabs',
    description:
      'Tolerant of stale and missing ids by design — the client skips unknown ids and appends ' +
      'new views, so a slightly-stale array degrades to a wrong order rather than a hidden tab.',
  })
  setTabOrder(@CurrentUser() user: TokenUser, @Body() dto: SetTabOrderDto) {
    return this.savedViewService.setTabOrder(user.id, dto.viewIds);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('views')
  @ApiOperation({ summary: 'Save the current filters as a named view' })
  createView(@CurrentUser() user: TokenUser, @Body() dto: CreateSavedViewDto) {
    return this.savedViewService.create(user.id, dto);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Patch('views/:id')
  @ApiOperation({
    summary: 'Rename or re-snapshot a view (owner or manager)',
    description:
      'Rejects `pinned`; use PUT /views/:id/pin, which requires manage permission.',
  })
  async updateView(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedViewDto,
  ) {
    return this.savedViewService.update(
      user.id,
      id,
      dto,
      await this.access.canManage(user.id),
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Put('views/:id/pin')
  @ApiOperation({
    summary: 'Pin or unpin a view for everyone',
    description:
      'This decorator IS the enforcement, replacing the source’s enforce_pin_admin() trigger.',
  })
  pinView(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PinSavedViewDto,
  ) {
    return this.savedViewService.setPinned(user.id, id, dto.pinned);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Delete('views/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a view (owner or manager)' })
  async removeView(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.savedViewService.remove(
      user.id,
      id,
      await this.access.canManage(user.id),
    );
  }
}
