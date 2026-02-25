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
import { AddScenarioCoverImageDto } from '../dto/add-scenario-cover-image.dto';
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
    private readonly scenarioCoverImageLibraryService: ScenarioCoverImageLibraryService,
  ) {}

  @Post('upload-url')
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_COVER_IMAGE_LIBRARY])
  @ApiOperation({
    summary: 'Create and return presigned URL for image upload',
    description: 'Returns a presigned S3 URL to upload the image.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns presigned URL and image URL',
    type: UploadImageUrlResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  async createCoverImageUploadUrl(
    @Body() dto: UploadImageUrlRequestDto,
  ): Promise<UploadImageUrlResponseDto> {
    return this.scenarioCoverImageLibraryService.createCoverImageUploadUrl(dto);
  }

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_COVER_IMAGE_LIBRARY])
  @ApiOperation({
    summary: 'Insert image into library',
    description:
      'Call after uploading the image to the presigned URL. Inserts the library entry.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the created library image record',
    type: ScenarioCoverImageLibraryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid URL or image not found in S3',
  })
  async addCoverImage(
    @Body() coverImage: AddScenarioCoverImageDto,
  ): Promise<ScenarioCoverImageLibraryResponseDto> {
    return this.scenarioCoverImageLibraryService.addCoverImage(coverImage);
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
    return this.scenarioCoverImageLibraryService.getCoverImages(query);
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
    return this.scenarioCoverImageLibraryService.getById(id);
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
    return this.scenarioCoverImageLibraryService.delete(id);
  }
}
