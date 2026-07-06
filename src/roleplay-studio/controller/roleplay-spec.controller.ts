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
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { RoleplaySpecService } from '../service/roleplay-spec.service';
import {
  CreateRoleplaySpecDto,
  CreateRoleplaySpecVersionDto,
  ListRoleplaySpecsQueryDto,
  PublishRoleplaySpecVersionDto,
  ShareRoleplaySpecTenantsDto,
  UpdateRoleplaySpecDraftDto,
  UpdateRoleplaySpecDto,
} from '../dto/roleplay-spec.dto';

@ApiTags('Roleplay Studio Specs')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roleplay-studio/specs', version: '1' })
export class RoleplaySpecController {
  constructor(private readonly roleplaySpecService: RoleplaySpecService) {}

  // ---------------------------------------------------------------- specs

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_SPEC])
  @ApiOperation({
    summary:
      'Create a roleplay spec (also creates its thin DRAFT scenarios shell)',
  })
  createSpec(
    @Body() dto: CreateRoleplaySpecDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySpecService.createSpec(dto, user.id);
  }

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_SPECS])
  @ApiOperation({ summary: 'List roleplay specs' })
  listSpecs(
    @Query() query: ListRoleplaySpecsQueryDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySpecService.listSpecs(query, user.id);
  }

  @Get(':specId')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_SPECS])
  @ApiOperation({ summary: 'Get a roleplay spec (incl. its draft document)' })
  getSpec(@Param('specId', ParseUUIDPipe) specId: string) {
    return this.roleplaySpecService.getSpec(specId);
  }

  @Put(':specId')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_SPEC])
  @ApiOperation({ summary: 'Update spec facts (title, competency)' })
  updateSpec(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Body() dto: UpdateRoleplaySpecDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySpecService.updateSpec(specId, dto, user.id);
  }

  @Delete(':specId')
  @AuthPermissions([PERMISSIONS.DELETE_ROLEPLAY_SPEC])
  @ApiOperation({
    summary: 'Soft-delete a spec (and retire its shell scenario)',
  })
  deleteSpec(
    @Param('specId', ParseUUIDPipe) specId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySpecService.deleteSpec(specId, user.id);
  }

  // ---------------------------------------------------------------- draft

  @Put(':specId/draft')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_SPEC])
  @ApiOperation({
    summary:
      'Save the draft document (optimistic concurrency via expectedUpdatedAt; mismatch → 409)',
  })
  updateDraft(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Body() dto: UpdateRoleplaySpecDraftDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySpecService.updateDraft(specId, dto, user.id);
  }

  @Get(':specId/validation')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_SPECS])
  @ApiOperation({ summary: 'Validate the current draft (or ?versionId=…)' })
  validateSpec(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.roleplaySpecService.validateVersion(specId, versionId);
  }

  // -------------------------------------------------------------- versions

  @Get(':specId/versions')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_SPECS])
  @ApiOperation({ summary: 'List spec versions (newest first)' })
  listVersions(@Param('specId', ParseUUIDPipe) specId: string) {
    return this.roleplaySpecService.listVersions(specId);
  }

  @Post(':specId/versions')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_SPEC])
  @ApiOperation({ summary: 'Checkpoint the current draft as a new version' })
  createVersion(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Body() dto: CreateRoleplaySpecVersionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySpecService.createVersion(specId, dto, user.id);
  }

  @Get(':specId/versions/:versionId')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_SPECS])
  @ApiOperation({ summary: 'Get one spec version' })
  getVersion(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.roleplaySpecService.getVersion(specId, versionId);
  }

  @Post(':specId/versions/:versionId/publish')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_SPEC])
  @ApiOperation({
    summary:
      'Publish a version (422 on validation errors; 409 without a completed rehearsal unless force)',
  })
  publishVersion(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: PublishRoleplaySpecVersionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySpecService.publishVersion(
      specId,
      versionId,
      user.id,
      dto?.force ?? false,
    );
  }

  // --------------------------------------------------------------- tenants

  @Get(':specId/tenants')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_SPECS])
  @ApiOperation({ summary: 'List tenants the spec is shared with' })
  listTenants(@Param('specId', ParseUUIDPipe) specId: string) {
    return this.roleplaySpecService.listTenants(specId);
  }

  @Post(':specId/tenants')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_SPEC_TENANT])
  @ApiOperation({ summary: 'Share the spec with tenants' })
  shareTenants(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Body() dto: ShareRoleplaySpecTenantsDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySpecService.shareWithTenants(
      specId,
      dto.tenantIds,
      user.id,
    );
  }

  @Delete(':specId/tenants/:tenantId')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_SPEC_TENANT])
  @ApiOperation({ summary: 'Unshare the spec from a tenant' })
  unshareTenant(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySpecService.unshareTenant(specId, tenantId, user.id);
  }
}
