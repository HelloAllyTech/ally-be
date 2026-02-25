import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioCoverImageLibraryRepository } from '../repository/scenario-cover-image-library.repository';
import { ScenarioCoverImageLibrary } from '../entity/scenario-cover-image-library.entity';
import {
  UploadImageUrlRequestDto,
  UploadImageUrlResponseDto,
} from '../dto/upload-image-url.dto';
import { AddScenarioCoverImageDto } from '../dto/add-scenario-cover-image.dto';
import {
  GetScenarioCoverImageLibraryQueryDto,
  ScenarioCoverImageLibrarySortBy,
  ScenarioCoverImageLibrarySortOrder,
} from '../dto/get-scenario-cover-image-library.dto';
import { ScenarioCoverImageUploadContentType } from '../enum/scenario-cover-image-upload-content-type.enum';
import { COVER_IMAGE_LIBRARY_S3_PREFIX } from '../constants/scenario-cover-image-library.constants';

@Injectable()
export class ScenarioCoverImageLibraryService {
  private readonly logger = LoggerService.getInstance(
    ScenarioCoverImageLibraryService.name,
  );

  constructor(
    private readonly scenarioCoverImageLibraryRepository: ScenarioCoverImageLibraryRepository,
    private readonly s3Service: S3Service,
    private readonly configService: AppConfigService,
  ) {}

  async createCoverImageUploadUrl(
    dto: UploadImageUrlRequestDto,
  ): Promise<UploadImageUrlResponseDto> {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new Error('S3 bucket name for assetsBucket is not defined');
    }

    if (
      !Object.values(ScenarioCoverImageUploadContentType).includes(
        dto.contentType,
      )
    ) {
      throw new BadRequestException('Invalid file type');
    }

    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('unauthorized access');
    }

    const { presignedUrl, imageUrl } =
      await this.s3Service.getPresignedUrlForImageUpload(
        bucket,
        COVER_IMAGE_LIBRARY_S3_PREFIX,
        dto.fileName,
        dto.fileSize,
        dto.contentType,
      );

    return { presignedUrl, imageUrl };
  }

  async addCoverImage(
    coverImage: AddScenarioCoverImageDto,
  ): Promise<ScenarioCoverImageLibrary> {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new Error('S3 bucket name for assetsBucket is not defined');
    }

    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('unauthorized access');
    }

    const existing = await this.scenarioCoverImageLibraryRepository.findOne({
      where: { imageUrl: coverImage.imageUrl },
    });
    if (existing) {
      return existing;
    }

    const libraryImage = this.scenarioCoverImageLibraryRepository.create({
      imageUrl: coverImage.imageUrl,
      createdBy: Number(userId),
    });
    return this.scenarioCoverImageLibraryRepository.save(libraryImage);
  }

  async getCoverImages(
    dto: GetScenarioCoverImageLibraryQueryDto,
  ): Promise<{ coverImages: ScenarioCoverImageLibrary[]; count: number }> {
    return this.scenarioCoverImageLibraryRepository.getCoverImages({
      limit: dto.limit ?? 20,
      offset: dto.offset ?? 0,
      sortBy: dto.sortBy ?? ScenarioCoverImageLibrarySortBy.CREATED_AT,
      sortOrder: dto.sortOrder ?? ScenarioCoverImageLibrarySortOrder.DESC,
    });
  }

  async getById(id: string): Promise<ScenarioCoverImageLibrary> {
    const image = await this.scenarioCoverImageLibraryRepository.findOne({
      where: { id },
    });
    if (!image) {
      throw new NotFoundException(`Library image with ID ${id} not found`);
    }
    return image;
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const image = await this.getById(id);
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new Error('S3 bucket name for assetsBucket is not defined');
    }
    await this.s3Service.deleteS3Image(bucket, image.imageUrl);
    await this.scenarioCoverImageLibraryRepository.delete(id);
    this.logger.info(`Library image deleted: ${id}`);
    return { success: true };
  }
}
