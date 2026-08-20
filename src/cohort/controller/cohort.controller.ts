import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { TenantScopedPermissions } from 'src/auth/decorators/own-tenant-scope.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { SuccessResponse } from 'src/common/type/common.type';
import { CohortService } from '../service/cohort.service';
import { CohortMemberService } from '../service/cohort-member.service';
import { CohortRestrictionService } from '../service/cohort-restriction.service';
import { TenantCohort } from '../entity/tenant-cohort.entity';
import {
  CohortListResponseDto,
  CohortMemberListResponseDto,
  ContentCohortRestrictionDto,
  CreateCohortDto,
  GetCohortMembersQueryDto,
  GetCohortRestrictionsQueryDto,
  MoveCohortMembersDto,
  SetCohortRestrictionsDto,
  UpdateCohortDto,
} from '../dto/cohort.dto';

/**
 * Cohort management for a tenant admin.
 *
 * Every route is `@TenantScopedPermissions`, so for a caller without system
 * access OwnTenantScopeGuard requires the request's target tenant to equal the
 * one baked into their JWT. That is what lets a tenant ADMIN hold
 * `view:cohorts` / `edit:cohorts` outright without those permissions becoming a
 * cross-tenant capability.
 *
 * **`tenantId` is a path segment on every route, including the GETs.** That is
 * not stylistic: OwnTenantScopeGuard resolves the target tenant from
 * `request.params` and `request.body` only — it never looks at the query string.
 * A `?tenantId=` GET would therefore reach the guard with nothing to check and
 * be rejected outright for a tenant admin (or, worse in a future refactor, be
 * quietly unscoped). Keep it in the path. The shape matches the existing
 * `POST /tracks/tenant/:tenantId` assignment endpoints.
 *
 * The guard pins that one field and nothing else, so the services still validate
 * every other id in the payload against it — cohort ids, user ids and content ids
 * are all separate untrusted input.
 *
 * Note the member list lives here rather than in UserController: it exists so a
 * tenant admin can organise their people *without* being granted `view:users`
 * and the platform-wide user-management payload that comes with it.
 */
@ApiTags('Cohorts')
@ApiSecurity('access-token')
@Controller('v1/cohorts')
export class CohortController {
  constructor(
    private readonly cohortService: CohortService,
    private readonly cohortMemberService: CohortMemberService,
    private readonly cohortRestrictionService: CohortRestrictionService,
  ) {}

  @ApiOperation({
    summary:
      'List the tenant’s cohorts plus the synthesised “Unassigned” bucket',
  })
  @ApiResponse({ status: 200, type: CohortListResponseDto })
  @TenantScopedPermissions([PERMISSIONS.VIEW_COHORTS])
  @Get('tenant/:tenantId')
  async listCohorts(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<CohortListResponseDto> {
    return this.cohortService.listCohorts(tenantId);
  }

  @ApiOperation({ summary: 'Create a cohort' })
  @ApiResponse({ status: 201, type: TenantCohort })
  @TenantScopedPermissions([PERMISSIONS.EDIT_COHORTS])
  @Post('tenant/:tenantId')
  async createCohort(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateCohortDto,
  ): Promise<TenantCohort> {
    return this.cohortService.createCohort(tenantId, dto);
  }

  @ApiOperation({ summary: 'Rename a cohort or change its description' })
  @TenantScopedPermissions([PERMISSIONS.EDIT_COHORTS])
  @Patch('tenant/:tenantId/:cohortId')
  async updateCohort(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('cohortId', ParseUUIDPipe) cohortId: string,
    @Body() dto: UpdateCohortDto,
  ): Promise<TenantCohort> {
    return this.cohortService.updateCohort(cohortId, tenantId, dto);
  }

  @ApiOperation({
    summary:
      'Delete a cohort. Members return to “Unassigned” and any content ' +
      'restricted only to this cohort returns to tenant-wide visibility.',
  })
  @TenantScopedPermissions([PERMISSIONS.EDIT_COHORTS])
  @Delete('tenant/:tenantId/:cohortId')
  async deleteCohort(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('cohortId', ParseUUIDPipe) cohortId: string,
  ): Promise<SuccessResponse> {
    return this.cohortService.deleteCohort(cohortId, tenantId);
  }

  @ApiOperation({
    summary: 'List the tenant’s users with their current cohort',
  })
  @ApiResponse({ status: 200, type: CohortMemberListResponseDto })
  @TenantScopedPermissions([PERMISSIONS.VIEW_COHORTS])
  @Get('tenant/:tenantId/members')
  async listMembers(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: GetCohortMembersQueryDto,
  ): Promise<CohortMemberListResponseDto> {
    return this.cohortMemberService.listMembers(tenantId, query);
  }

  @ApiOperation({
    summary:
      'Move users into a cohort, or out of every cohort with the ' +
      '“unassigned” sentinel. Membership is exclusive, so this replaces ' +
      'rather than adds.',
  })
  @TenantScopedPermissions([PERMISSIONS.EDIT_COHORTS])
  @Put('tenant/:tenantId/members')
  async moveMembers(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: MoveCohortMembersDto,
  ): Promise<SuccessResponse> {
    return this.cohortMemberService.moveMembers(tenantId, dto);
  }

  @ApiOperation({
    summary:
      'Cohort restrictions for the tenant’s content of one type. Items with ' +
      'no restriction are absent from the response — they are visible ' +
      'tenant-wide.',
  })
  @ApiResponse({
    status: 200,
    type: ContentCohortRestrictionDto,
    isArray: true,
  })
  @TenantScopedPermissions([PERMISSIONS.VIEW_COHORTS])
  @Get('tenant/:tenantId/restrictions')
  async getRestrictions(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: GetCohortRestrictionsQueryDto,
  ): Promise<ContentCohortRestrictionDto[]> {
    return this.cohortRestrictionService.getRestrictions(tenantId, query);
  }

  @ApiOperation({
    summary:
      'Replace one item’s cohort restrictions. An empty cohortIds array ' +
      'clears them, returning the item to tenant-wide visibility.',
  })
  @TenantScopedPermissions([PERMISSIONS.EDIT_COHORTS])
  @Put('tenant/:tenantId/restrictions')
  async setRestrictions(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: SetCohortRestrictionsDto,
  ): Promise<SuccessResponse> {
    return this.cohortRestrictionService.setRestrictions(tenantId, dto);
  }
}
