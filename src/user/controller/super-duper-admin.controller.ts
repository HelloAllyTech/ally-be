import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
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
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { SuperDuperAdminService } from '../service/super-duper-admin.service';
import {
  PromoteSuperAdminDto,
  PromoteSuperDuperAdminDto,
  SuperDuperAdminListResponseDto,
} from '../dto/super-duper-admin.dto';
import { SuccessResponse } from 'src/common/type/common.type';

/**
 * Central management surface for the SUPER_DUPER_ADMIN tier. Both permissions
 * used here are granted exclusively to SUPER_DUPER_ADMIN (migration
 * 1847000000000), so a plain SUPER_ADMIN cannot reach any of these endpoints.
 */
@Controller('v1/super-duper-admins')
@ApiTags('Super Duper Admins')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class SuperDuperAdminController {
  constructor(
    private readonly superDuperAdminService: SuperDuperAdminService,
  ) {}

  @ApiOperation({ summary: 'List all super duper admins' })
  @ApiResponse({ status: 200, type: SuperDuperAdminListResponseDto })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name or email',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SUPER_DUPER_ADMINS])
  @Get()
  listSuperDuperAdmins(
    @Query('search') search?: string,
  ): Promise<SuperDuperAdminListResponseDto> {
    return this.superDuperAdminService.listSuperDuperAdmins(search);
  }

  @ApiOperation({
    summary:
      'List users eligible for promotion (super admins not already in the elevated tier)',
  })
  @ApiResponse({ status: 200, type: SuperDuperAdminListResponseDto })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name or email',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SUPER_DUPER_ADMINS])
  @Get('eligible')
  listEligibleUsers(
    @Query('search') search?: string,
  ): Promise<SuperDuperAdminListResponseDto> {
    return this.superDuperAdminService.listEligibleUsers(search);
  }

  @ApiOperation({
    summary: 'Promote a super admin to super duper admin (swaps the role)',
  })
  @ApiResponse({ status: 201, description: 'User promoted' })
  @AuthPermissions([PERMISSIONS.EDIT_SUPER_DUPER_ADMINS])
  @Post()
  promote(
    @Body() dto: PromoteSuperDuperAdminDto,
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<SuccessResponse> {
    return this.superDuperAdminService.promote(dto, tokenUser.id);
  }

  @ApiOperation({ summary: 'List all super admins' })
  @ApiResponse({ status: 200, type: SuperDuperAdminListResponseDto })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name or email',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SUPER_DUPER_ADMINS])
  @Get('super-admins')
  listSuperAdmins(
    @Query('search') search?: string,
  ): Promise<SuperDuperAdminListResponseDto> {
    return this.superDuperAdminService.listSuperAdmins(search);
  }

  @ApiOperation({
    summary:
      'List users eligible to become super admins (active users outside the super-admin tier; capped — narrow with search)',
  })
  @ApiResponse({ status: 200, type: SuperDuperAdminListResponseDto })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name or email',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SUPER_DUPER_ADMINS])
  @Get('super-admins/eligible')
  listSuperAdminCandidates(
    @Query('search') search?: string,
  ): Promise<SuperDuperAdminListResponseDto> {
    return this.superDuperAdminService.listSuperAdminCandidates(search);
  }

  @ApiOperation({
    summary: 'Make an existing user a super admin (additive; other roles kept)',
  })
  @ApiResponse({ status: 201, description: 'User promoted to super admin' })
  @AuthPermissions([PERMISSIONS.EDIT_SUPER_DUPER_ADMINS])
  @Post('super-admins')
  promoteToSuperAdmin(
    @Body() dto: PromoteSuperAdminDto,
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<SuccessResponse> {
    return this.superDuperAdminService.promoteToSuperAdmin(dto, tokenUser.id);
  }

  @ApiOperation({
    summary:
      'Remove the super admin role from a user (other roles kept). Self-removal is rejected; super duper admins must be demoted first.',
  })
  @ApiResponse({ status: 200, description: 'Super admin role removed' })
  @AuthPermissions([PERMISSIONS.EDIT_SUPER_DUPER_ADMINS])
  @Delete('super-admins/:userId')
  removeSuperAdmin(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<SuccessResponse> {
    return this.superDuperAdminService.removeSuperAdmin(userId, tokenUser.id);
  }

  @ApiOperation({
    summary:
      'Demote a super duper admin back to super admin. Self-demotion and demoting the last remaining super duper admin are rejected.',
  })
  @ApiResponse({ status: 200, description: 'User demoted' })
  @AuthPermissions([PERMISSIONS.EDIT_SUPER_DUPER_ADMINS])
  @Delete(':userId')
  demote(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<SuccessResponse> {
    return this.superDuperAdminService.demote(userId, tokenUser.id);
  }
}
