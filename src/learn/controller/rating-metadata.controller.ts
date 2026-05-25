import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import { RatingMetadataResponseDto } from '../dto/rating-metadata.dto';
import { RatingMetadataService } from '../service/rating-metadata.service';

@ApiTags('Learn')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/rating-metadata',
  version: '1',
})
export class RatingMetadataController {
  constructor(private readonly ratingMetadataService: RatingMetadataService) {}

  @ApiOperation({
    summary: 'Get all rating metadata (rating text + suggested tags)',
  })
  @ApiOkResponse({ type: [RatingMetadataResponseDto] })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION_DETAILS])
  @Get()
  async getAll(): Promise<RatingMetadataResponseDto[]> {
    return this.ratingMetadataService.getAll();
  }
}
