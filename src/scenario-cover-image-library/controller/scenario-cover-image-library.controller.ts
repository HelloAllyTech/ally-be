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
  ApiBody,
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
  GetScenarioCoverImageLibraryQueryDto,
  GetScenarioCoverImageLibraryResponseDto,
} from '../dto/get-scenario-cover-image-library.dto';
import { ScenarioCoverImageLibraryResponseDto } from '../dto/scenario-cover-image-library-response.dto';
import {
  UploadImageUrlRequestDto,
  UploadImageUrlResponseDto,
} from '../dto/upload-image-url.dto';
import { AddScenarioCoverImageDto } from '../dto/add-scenario-cover-image.dto';
import { ParseArrayBodyPipe } from '../pipes/parse-array-body.pipe';

@ApiTags('Scenario Cover Image Library')
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
    summary: 'Create presigned URLs for image upload',
    description:
      'Accepts one or more images. Returns presigned S3 URLs and image URLs for each.',
  })
  @ApiBody({
    type: UploadImageUrlRequestDto,
    isArray: true,
    description: 'Array of image upload requests. Body must be a JSON array.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns presigned URLs and image URLs for each item',
    type: [UploadImageUrlResponseDto],
  })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  async createCoverImageUploadUrl(
    @Body(new ParseArrayBodyPipe(UploadImageUrlRequestDto))
    coverImages: UploadImageUrlRequestDto[],
  ): Promise<UploadImageUrlResponseDto[]> {
    return this.scenarioCoverImageLibraryService.createCoverImageUploadUrls(
      coverImages,
    );
  }

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_COVER_IMAGE_LIBRARY])
  @ApiOperation({
    summary: 'Insert images into library',
    description:
      'Accepts one or more image URLs (S3 URLs from presigned upload or any public image URL). Duplicate imageUrl values are skipped (existing record returned).',
  })
  @ApiBody({
    type: AddScenarioCoverImageDto,
    isArray: true,
    description:
      'Array of image URLs (S3 or public) to add to the library. Body must be a JSON array.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns the created library image records',
    type: [ScenarioCoverImageLibraryResponseDto],
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid URL format',
  })
  async addCoverImage(
    @Body(new ParseArrayBodyPipe(AddScenarioCoverImageDto))
    coverImages: AddScenarioCoverImageDto[],
  ): Promise<ScenarioCoverImageLibraryResponseDto[]> {
    return this.scenarioCoverImageLibraryService.addCoverImages(coverImages);
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
