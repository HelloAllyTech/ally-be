import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { ImageGenerationProviderFactory } from 'src/image-generation/provider/image-generation-provider.factory';
import {
  ImageGenerationProvider,
  INTERACTIVE_IMAGE_QUALITY,
} from 'src/image-generation/interface/image-generation-provider.interface';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { TRACK_COVER_IMAGE_SIZE } from '../constants/track.constant';
import { GenerateTrackCoverImageRequestDto } from '../dto/generate-track-cover-image.dto';

/** Same prefix the editor's cover uploads land under, so both are one kind. */
const TRACK_COVER_MEDIA_PREFIX = 'track-media/image';

const UNAVAILABLE_MESSAGE =
  "Image generation isn't set up on this environment. Upload a cover image instead.";

/**
 * Track settings → "Generate cover image": one image from a trainer-written
 * prompt, stored where an uploaded cover would be. Runs inside an
 * ImageGenerationJobService job — the controller returns before it finishes.
 *
 * Deliberately not the scenario cover-image service: that one renders a
 * persona-portrait template and files every image into the roleplay cover
 * library. Nothing is saved on the course here — the editor shows the image,
 * and only an accepted one is written into the form, which the course's own
 * Save persists. A rejected image is simply never referenced.
 */
@Injectable()
export class TrackCoverImageService {
  private readonly logger = LoggerService.getInstance(
    TrackCoverImageService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly s3Service: S3Service,
    private readonly imageFactory: ImageGenerationProviderFactory,
    private readonly llmUsage: LlmUsageService,
  ) {}

  async generate(
    dto: GenerateTrackCoverImageRequestDto,
  ): Promise<{ imageUrl: string }> {
    const bucket = this.configService.s3.learnMediaPublicBucket;
    const region = this.configService.aws.region;
    if (!bucket || !region) {
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
    }

    let provider: ImageGenerationProvider;
    let providerType: string;
    try {
      ({ provider, providerType } = this.imageFactory.getProvider());
    } catch (error) {
      this.logger.error(
        `[TRACK_COVER] provider unavailable: ${(error as Error)?.message ?? error}`,
      );
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
    }

    const startedAt = Date.now();
    let image: Buffer;
    try {
      image = await provider.generateImage(dto.prompt, TRACK_COVER_IMAGE_SIZE, {
        quality: INTERACTIVE_IMAGE_QUALITY,
      });
    } catch (error) {
      this.logger.error(
        `[TRACK_COVER] failed provider=${providerType} elapsedMs=${Date.now() - startedAt}: ${
          (error as Error)?.message ?? error
        }`,
      );
      throw this.toHttpError(error);
    }

    void this.llmUsage.record({
      provider: providerType,
      model: provider.getModel(),
      task: LlmTask.GENERATE_COURSE_COVER_IMAGE,
      unit: 'images',
      metadata: {
        trackTitle: dto.trackTitle ?? null,
        promptLength: dto.prompt.length,
        size: TRACK_COVER_IMAGE_SIZE,
        quality: INTERACTIVE_IMAGE_QUALITY,
      },
    });

    // Upload only after a successful generation so failures leave no orphans.
    const slug = this.s3Service.sanitizeFileName(
      `generated-cover-${dto.trackTitle || 'course'}`
        .toLowerCase()
        .replace(/\s+/g, '-'),
      80,
    );
    const key = `${TRACK_COVER_MEDIA_PREFIX}/${Date.now()}-${slug}.png`;
    await this.s3Service.uploadStream({
      Bucket: bucket,
      Key: key,
      Body: image,
      ContentType: 'image/png',
    });

    this.logger.info(
      `[TRACK_COVER] done provider=${providerType} key=${key} elapsedMs=${Date.now() - startedAt}`,
    );
    return { imageUrl: this.s3Service.getS3Url(bucket, region, key) };
  }

  /**
   * Provider failure → a message a trainer can act on: 400 when the provider
   * refused this prompt (reword it), 502 when it is busy or down (try again).
   * Provider wording and stack traces stay in the log.
   */
  private toHttpError(error: unknown): HttpException {
    const err = error as { status?: number; code?: string };
    if (err?.status === 400 || err?.code === 'content_policy_violation') {
      return new BadRequestException(
        "The image service couldn't use this prompt. Try rewording it — for example, remove anything graphic or any real person's name.",
      );
    }
    if (err?.status === 429) {
      return new BadGatewayException(
        'Image generation is busy right now. Try again in a minute.',
      );
    }
    return new BadGatewayException(
      "Couldn't generate an image this time. Try again in a moment.",
    );
  }
}
