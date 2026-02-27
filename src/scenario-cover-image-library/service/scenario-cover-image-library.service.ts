import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
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
import { ScenarioCoverImageLibraryResponseDto } from '../dto/scenario-cover-image-library-response.dto';

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

  private getBucket(): string {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new InternalServerErrorException(
        'S3 bucket name for assetsBucket is not defined',
      );
    }
    return bucket;
  }

  private toResponseDto(
    entity: ScenarioCoverImageLibrary,
  ): ScenarioCoverImageLibraryResponseDto {
    return {
      id: entity.id,
      imageUrl: entity.imageUrl,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  async createCoverImageUploadUrl(
    coverImage: UploadImageUrlRequestDto,
  ): Promise<UploadImageUrlResponseDto> {
    const bucket = this.getBucket();
    if (
      !Object.values(ScenarioCoverImageUploadContentType).includes(
        coverImage.contentType,
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
        coverImage.fileName,
        coverImage.fileSize,
        coverImage.contentType,
      );

    return { presignedUrl, imageUrl };
  }

  async createCoverImageUploadUrls(
    coverImages: UploadImageUrlRequestDto[],
  ): Promise<UploadImageUrlResponseDto[]> {
    const coverImagesResponse = await Promise.all(
      coverImages.map((coverImage) =>
        this.createCoverImageUploadUrl(coverImage),
      ),
    );
    return coverImagesResponse;
  }

  async addCoverImage(
    coverImage: AddScenarioCoverImageDto,
  ): Promise<ScenarioCoverImageLibrary> {
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

  async addCoverImages(
    coverImages: AddScenarioCoverImageDto[],
  ): Promise<ScenarioCoverImageLibraryResponseDto[]> {
    const entities = await Promise.all(
      coverImages.map((coverImage) => this.addCoverImage(coverImage)),
    );
    return entities.map((entity) => this.toResponseDto(entity));
  }

  async getCoverImages(dto: GetScenarioCoverImageLibraryQueryDto): Promise<{
    coverImages: ScenarioCoverImageLibraryResponseDto[];
    count: number;
  }> {
    const { coverImages, count } =
      await this.scenarioCoverImageLibraryRepository.getCoverImages({
        limit: dto.limit ?? 20,
        offset: dto.offset ?? 0,
        sortBy: dto.sortBy ?? ScenarioCoverImageLibrarySortBy.CREATED_AT,
        sortOrder: dto.sortOrder ?? ScenarioCoverImageLibrarySortOrder.DESC,
      });
    return {
      coverImages: coverImages.map((entity) => this.toResponseDto(entity)),
      count,
    };
  }

  async getById(id: string): Promise<ScenarioCoverImageLibraryResponseDto> {
    const image = await this.scenarioCoverImageLibraryRepository.findOne({
      where: { id },
    });
    if (!image) {
      throw new NotFoundException(`Library image with ID ${id} not found`);
    }
    return this.toResponseDto(image);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const image = await this.getById(id);
    const bucket = this.getBucket();
    if (bucket) {
      const s3Result = await this.s3Service.deleteS3Image(
        bucket,
        image.imageUrl,
      );
      if (s3Result.success) {
        this.logger.info(`S3 image deleted for library image: ${id}`);
      }
    }
    await this.scenarioCoverImageLibraryRepository.delete(id);
    this.logger.info(`Library image deleted: ${id}`);
    return { success: true };
  }
}
