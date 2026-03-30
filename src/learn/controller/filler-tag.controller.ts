import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FillerTagService } from '../service/filler-tag.service';
import {
  CreateFillerTagDto,
  CreateFillerTagResponseDto,
  GetFillerTagsResponseDto,
} from '../dto/filler-tag.dto';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { SortOrder } from 'src/common/type/common.type';

@ApiTags('Filler tags')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/filler-tags',
  version: '1',
})
export class FillerTagController {
  constructor(private readonly fillerTagService: FillerTagService) {}

  @ApiOperation({ summary: 'List reusable filler words/phrases' })
  @ApiResponse({ status: 200, type: GetFillerTagsResponseDto })
  @ApiQuery({ name: 'name', required: false, type: String })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'order', required: false, enum: SortOrder })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Get()
  async getFillerTags(
    @Query('name') name?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<GetFillerTagsResponseDto> {
    return this.fillerTagService.getFillerTags(name, {
      offset,
      limit,
      order,
    });
  }

  @ApiOperation({ summary: 'Create a filler tag for reuse across scenarios' })
  @ApiResponse({ status: 201, type: CreateFillerTagResponseDto })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post()
  async createFillerTag(
    @CurrentUser() tokenUser: TokenUser,
    @Body() dto: CreateFillerTagDto,
  ): Promise<CreateFillerTagResponseDto> {
    return this.fillerTagService.createFillerTag(dto, tokenUser.id);
  }
}
