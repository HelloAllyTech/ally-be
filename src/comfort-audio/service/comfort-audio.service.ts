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
import { ComfortAudioTrackRepository } from '../repository/comfort-audio-track.repository';
import { ComfortAudioTrack } from '../entity/comfort-audio-track.entity';
import {
  UploadComfortAudioUrlRequestDto,
  UploadComfortAudioUrlResponseDto,
} from '../dto/upload-comfort-audio-url.dto';
import { AddComfortAudioTrackDto } from '../dto/add-comfort-audio-track.dto';
import { UpdateComfortAudioTrackDto } from '../dto/update-comfort-audio-track.dto';
import {
  GetComfortAudioTracksQueryDto,
  ComfortAudioTrackSortBy,
  ComfortAudioTrackSortOrder,
} from '../dto/get-comfort-audio-tracks.dto';
import { ComfortAudioUploadContentType } from '../enum/comfort-audio-upload-content-type.enum';
import {
  COMFORT_AUDIO_LIBRARY_S3_PREFIX,
  COMFORT_AUDIO_MAX_FILE_SIZE_BYTES,
} from '../constants/comfort-audio.constants';
import { ComfortAudioTrackResponseDto } from '../dto/comfort-audio-track-response.dto';

@Injectable()
export class ComfortAudioService {
  private readonly logger = LoggerService.getInstance(ComfortAudioService.name);

  constructor(
    private readonly comfortAudioTrackRepository: ComfortAudioTrackRepository,
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
    entity: ComfortAudioTrack,
  ): ComfortAudioTrackResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      audioUrl: entity.audioUrl,
      contentType: entity.contentType ?? null,
      sizeBytes:
        entity.sizeBytes === null || entity.sizeBytes === undefined
          ? null
          : Number(entity.sizeBytes),
      isArchived: entity.archivedAt != null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  async createUploadUrl(
    dto: UploadComfortAudioUrlRequestDto,
  ): Promise<UploadComfortAudioUrlResponseDto> {
    const bucket = this.getBucket();
    if (
      !Object.values(ComfortAudioUploadContentType).includes(dto.contentType)
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
        COMFORT_AUDIO_LIBRARY_S3_PREFIX,
        dto.fileName,
        dto.fileSize,
        dto.contentType,
        COMFORT_AUDIO_MAX_FILE_SIZE_BYTES,
      );

    return { presignedUrl, audioUrl: imageUrl };
  }

  async addTrack(
    dto: AddComfortAudioTrackDto,
  ): Promise<ComfortAudioTrackResponseDto> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('unauthorized access');
    }

    const track = this.comfortAudioTrackRepository.create({
      name: dto.name,
      audioUrl: dto.audioUrl,
      contentType: dto.contentType ?? null,
      sizeBytes: dto.sizeBytes ?? null,
      createdBy: Number(userId),
    });
    const saved = await this.comfortAudioTrackRepository.save(track);
    this.logger.info(`Comfort audio track added: ${saved.id}`);
    return this.toResponseDto(saved);
  }

  async getTracks(dto: GetComfortAudioTracksQueryDto): Promise<{
    tracks: ComfortAudioTrackResponseDto[];
    count: number;
  }> {
    const { tracks, count } = await this.comfortAudioTrackRepository.getTracks({
      limit: dto.limit ?? 50,
      offset: dto.offset ?? 0,
      sortBy: dto.sortBy ?? ComfortAudioTrackSortBy.CREATED_AT,
      sortOrder: dto.sortOrder ?? ComfortAudioTrackSortOrder.DESC,
      includeArchived: dto.includeArchived ?? false,
    });
    return {
      tracks: tracks.map((entity) => this.toResponseDto(entity)),
      count,
    };
  }

  async getById(id: string): Promise<ComfortAudioTrackResponseDto> {
    const track = await this.comfortAudioTrackRepository.findOne({
      where: { id },
    });
    if (!track) {
      throw new NotFoundException(
        `Comfort audio track with ID ${id} not found`,
      );
    }
    return this.toResponseDto(track);
  }

  /**
   * Rename and/or archive/unarchive an existing track. Archiving flips
   * `archivedAt` (null = active) — it never touches S3 or scenario metadata, so
   * scenarios already pointing at the track's URL keep playing it; the track
   * just stops appearing in the roleplay picker going forward.
   */
  async updateTrack(
    id: string,
    dto: UpdateComfortAudioTrackDto,
  ): Promise<ComfortAudioTrackResponseDto> {
    const track = await this.comfortAudioTrackRepository.findOne({
      where: { id },
    });
    if (!track) {
      throw new NotFoundException(
        `Comfort audio track with ID ${id} not found`,
      );
    }

    if (dto.name !== undefined) {
      track.name = dto.name;
    }
    if (dto.isArchived !== undefined) {
      track.archivedAt = dto.isArchived ? new Date() : null;
    }

    const saved = await this.comfortAudioTrackRepository.save(track);
    this.logger.info(
      `Comfort audio track updated: ${saved.id} (archived=${saved.archivedAt != null})`,
    );
    return this.toResponseDto(saved);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const track = await this.getById(id);
    const bucket = this.getBucket();
    if (bucket) {
      const s3Result = await this.s3Service.deleteS3Image(
        bucket,
        track.audioUrl,
      );
      if (s3Result.success) {
        this.logger.info(`S3 object deleted for comfort audio track: ${id}`);
      }
    }
    await this.comfortAudioTrackRepository.delete(id);
    this.logger.info(`Comfort audio track deleted: ${id}`);
    return { success: true };
  }
}
