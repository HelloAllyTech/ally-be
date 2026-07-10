import { BadRequestException, Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { SuccessResponse } from 'src/common/type/common.type';
import {
  TRACK_IMAGE_FILE_SIZE_LIMIT,
  TRACK_MEDIA_ALLOWED_CONTENT_TYPES,
  TRACK_VIDEO_FILE_DURATION_LIMIT,
  TRACK_VIDEO_FILE_SIZE_LIMIT,
  TrackMediaKind,
} from '../constants/track.constant';
import {
  DeleteTrackMediaDto,
  TrackMediaUploadRequestDto,
  TrackMediaUploadResponseDto,
} from '../dto/track-media-upload.dto';

@Injectable()
export class TrackMediaService {
  constructor(
    private readonly configService: AppConfigService,
    private readonly s3Service: S3Service,
  ) {}

  async getPresignedUploadUrl(
    dto: TrackMediaUploadRequestDto,
  ): Promise<TrackMediaUploadResponseDto> {
    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }

    const allowedTypes = TRACK_MEDIA_ALLOWED_CONTENT_TYPES[dto.kind];
    if (!allowedTypes.includes(dto.contentType)) {
      throw new BadRequestException('Invalid file type');
    }

    const sizeLimit =
      dto.kind === TrackMediaKind.VIDEO
        ? TRACK_VIDEO_FILE_SIZE_LIMIT
        : TRACK_IMAGE_FILE_SIZE_LIMIT;
    if (dto.fileSize > sizeLimit) {
      throw new BadRequestException(
        `File size must be less than ${Math.round(sizeLimit / 1024 / 1024)} MB`,
      );
    }
    if (
      dto.kind === TrackMediaKind.VIDEO &&
      dto.duration !== undefined &&
      dto.duration > TRACK_VIDEO_FILE_DURATION_LIMIT
    ) {
      throw new BadRequestException(
        `Video duration must be less than ${TRACK_VIDEO_FILE_DURATION_LIMIT / 60} minutes`,
      );
    }

    const sanitizedFileName = this.s3Service.sanitizeFileName(dto.fileName);
    const storageKey = `track-media/${dto.kind}/${Date.now()}-${sanitizedFileName}`;
    const presignedUrl = await this.s3Service.generatePresignedUrl({
      bucket,
      key: storageKey,
      operation: 'put',
      expiresIn: 600,
      contentType: dto.contentType,
    });

    const region = this.configService.aws.region;
    const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${storageKey}`;
    return { presignedUrl, publicUrl };
  }

  async deleteMedia(dto: DeleteTrackMediaDto): Promise<SuccessResponse> {
    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }
    const urlPattern = /^https:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com\/(.+)$/;
    const match = dto.url.match(urlPattern);
    const storageKey = match ? match[1] : null;
    if (!storageKey || !storageKey.startsWith('track-media/')) {
      throw new BadRequestException('Invalid track media URL');
    }
    await this.s3Service.deleteObject({ bucket, key: storageKey });
    return { success: true };
  }
}
