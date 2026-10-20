import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import {
  GenerateCoverImageRequestDto,
  GenerateCoverImageResponseDto,
} from '../dto/generate-cover-image.dto';
import { CoverImageGenerationService } from '../service/cover-image-generation.service';
import { ImageGenerationJobService } from 'src/image-generation/service/image-generation-job.service';
import { ImageGenerationJobDto } from 'src/image-generation/dto/image-generation-job.dto';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';

@ApiTags('Scenario Cover Image Library')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/scenario-cover-image-library')
export class ScenarioCoverImageLibraryController {
  constructor(
    private readonly scenarioCoverImageLibraryService: ScenarioCoverImageLibraryService,
    private readonly coverImageGenerationService: CoverImageGenerationService,
    private readonly imageGenerationJobService: ImageGenerationJobService,
  ) {}

  @Post('generate-jobs')
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_COVER_IMAGE_LIBRARY])
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start generating a scenario cover image with AI',
    description:
      'Same generation as POST generate, as a background job: returns 202 ' +
      "with a job id at once, because generation can outlast the load balancer's " +
      '60 s idle timeout. Poll GET generate-jobs/:jobId.',
  })
  @ApiResponse({ status: 202, type: ImageGenerationJobDto })
  async startCoverImageGeneration(
    @Body() generateCoverImageDto: GenerateCoverImageRequestDto,
    @CurrentUser() user: TokenUser,
  ): Promise<ImageGenerationJobDto> {
    return this.imageGenerationJobService.start('scenario-cover', user.id, () =>
      this.coverImageGenerationService.generateCoverImage(
        generateCoverImageDto,
      ),
    );
  }

  @Get('generate-jobs/:jobId')
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_COVER_IMAGE_LIBRARY])
  @ApiOperation({
    summary: 'Poll a scenario cover image generation',
    description:
      "status is 'running', 'succeeded' (with imageUrl) or 'failed' (with an " +
      'error to show the author). Only the user who started it can read it; ' +
      'records expire after an hour.',
  })
  @ApiResponse({ status: 200, type: ImageGenerationJobDto })
  @ApiResponse({ status: 404, description: 'Unknown, expired or not yours' })
  async getCoverImageGeneration(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUser() user: TokenUser,
  ): Promise<ImageGenerationJobDto> {
    return this.imageGenerationJobService.get('scenario-cover', user.id, jobId);
  }

  @Post('generate')
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_COVER_IMAGE_LIBRARY])
  @ApiOperation({
    summary: 'Generate a scenario cover image with AI (deprecated)',
    deprecated: true,
    description:
      'Deprecated — use POST generate-jobs. Kept so an admin bundle deployed ' +
      'before it keeps working; a generation slower than the load ' +
      "balancer's 60 s idle timeout is cut off here. " +
      'Stateless: renders the managed `cover_image_generation` prompt with ' +
      'the scenario title/description, generates the image, stores it in S3 ' +
      'and the library, and returns the URL. The client saves it on the ' +
      'scenario via the normal update flow.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns the generated image URL and the provider used',
    type: GenerateCoverImageResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Provider rejected the request' })
  @ApiResponse({ status: 502, description: 'Provider unavailable' })
  async generateCoverImage(
    @Body() generateCoverImageDto: GenerateCoverImageRequestDto,
  ): Promise<GenerateCoverImageResponseDto> {
    return this.coverImageGenerationService.generateCoverImage(
      generateCoverImageDto,
    );
  }

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
