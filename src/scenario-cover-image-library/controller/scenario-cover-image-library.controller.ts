import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from '../../auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ScenarioCoverImageLibraryService } from '../service/scenario-cover-image-library.service';
import {
  UploadImageUrlRequestDto,
  UploadImageUrlResponseDto,
} from '../dto/upload-image-url.dto';
import {
  GetScenarioCoverImageLibraryQueryDto,
  GetScenarioCoverImageLibraryResponseDto,
} from '../dto/get-scenario-cover-image-library.dto';
import { ScenarioCoverImageLibraryResponseDto } from '../dto/scenario-cover-image-library-response.dto';

@ApiTags('Cover Image Library')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/scenario-cover-image-library')
export class ScenarioCoverImageLibraryController {
  constructor(
    private readonly coverImageLibraryService: ScenarioCoverImageLibraryService,
  ) {}

  @Post('upload-url')
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_COVER_IMAGE_LIBRARY])
  @ApiOperation({
    summary: 'Add image to library (get presigned S3 upload URL)',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns presigned URL and image record id',
    type: UploadImageUrlResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  async createCoverImageUploadUrl(
    @Body() dto: UploadImageUrlRequestDto,
  ): Promise<UploadImageUrlResponseDto> {
    return this.coverImageLibraryService.createCoverImageUploadUrl(dto);
  }

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_COVER_IMAGE_LIBRARY])
  @ApiOperation({ summary: 'List images with search and pagination' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of library images',
    type: GetScenarioCoverImageLibraryResponseDto,
  })
  async getCoverImages(
    @Query() query: GetScenarioCoverImageLibraryQueryDto,
  ): Promise<GetScenarioCoverImageLibraryResponseDto> {
    return this.coverImageLibraryService.getCoverImages(query);
  }

  @Get(':id')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_COVER_IMAGE_LIBRARY])
  @ApiOperation({ summary: 'Get one image by ID' })
  @ApiParam({ name: 'id', description: 'Library image UUID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the library image',
    type: ScenarioCoverImageLibraryResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getCoverImageById(
    @Param('id') id: string,
  ): Promise<ScenarioCoverImageLibraryResponseDto> {
    return this.coverImageLibraryService.getById(id);
  }

  @Delete(':id')
  @AuthPermissions([PERMISSIONS.DELETE_SCENARIO_COVER_IMAGE_LIBRARY])
  @ApiOperation({ summary: 'Delete image from S3 and library' })
  @ApiParam({ name: 'id', description: 'Library image UUID' })
  @ApiResponse({
    status: 200,
    description: 'Returns success status',
    schema: { type: 'object', properties: { success: { type: 'boolean' } } },
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteCoverImage(
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.coverImageLibraryService.delete(id);
  }
}
