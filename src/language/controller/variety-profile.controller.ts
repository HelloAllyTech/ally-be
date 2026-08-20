import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { InferVarietyProfileDto } from '../dto/variety-profile.dto';
import { VarietyProfileService } from '../service/variety-profile.service';

@ApiTags('Language')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'language',
  version: '1',
})
export class VarietyProfileController {
  constructor(private readonly profileService: VarietyProfileService) {}

  @ApiOperation({
    summary: 'List variety profiles for a language (with tenant attachments)',
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_LANGUAGES])
  @Get(':id/variety-profiles')
  async listProfiles(@Param('id') id: number) {
    return this.profileService.listProfiles(Number(id));
  }

  @ApiOperation({
    summary:
      "Infer a tenant's variety profile from its judged learner turns " +
      '(matches an existing profile or creates one, then attaches the tenant)',
  })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Post(':id/variety-profiles/infer')
  async inferProfile(
    @Param('id') id: number,
    @Body() dto: InferVarietyProfileDto,
  ) {
    return this.profileService.inferProfile(
      Number(id),
      dto.tenantId,
      dto.windowDays,
    );
  }
}
