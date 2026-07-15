import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { LoggerService } from 'src/logger/logger.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { renderTemplate } from 'src/learn/util/autofill-shared.util';
import { ImageGenerationProviderFactory } from 'src/image-generation/provider/image-generation-provider.factory';
import { DEFAULT_IMAGE_SIZE } from 'src/image-generation/interface/image-generation-provider.interface';
import { ScenarioCoverImageLibraryService } from './scenario-cover-image-library.service';
import { COVER_IMAGE_LIBRARY_S3_PREFIX } from '../constants/scenario-cover-image-library.constants';
import {
  GenerateCoverImageRequestDto,
  GenerateCoverImageResponseDto,
} from '../dto/generate-cover-image.dto';

/**
 * Managed prompt template (src/prompts/cover_image_generation.txt, editable
 * via Prompt Management once useDashboardOverride is enabled). Available
 * placeholders: {{title}}, {{description}}, {{styleHints}} plus the scenario
 * persona fields {{name}}, {{age}}, {{gender}}, {{profession}},
 * {{currentLocation}}. Unused placeholders render as empty strings.
 */
export const COVER_IMAGE_GENERATION_PROMPT_CODE = 'cover_image_generation';

@Injectable()
export class CoverImageGenerationService {
  private readonly logger = LoggerService.getInstance(
    CoverImageGenerationService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly s3Service: S3Service,
    private readonly providerFactory: ImageGenerationProviderFactory,
    private readonly promptSharedService: PromptSharedService,
    private readonly scenarioCoverImageLibraryService: ScenarioCoverImageLibraryService,
    private readonly llmUsage: LlmUsageService,
  ) {}

  /**
   * Map a provider SDK failure to a client-facing HTTP error: 400 for
   * requests the provider rejected (content policy / invalid input), 502 for
   * upstream unavailability (quota, timeout, 5xx). Never leaks stack traces.
   */
  private toHttpError(error: unknown, providerType: string): HttpException {
    const err = error as {
      status?: number;
      code?: string;
      message?: string;
    };
    const status = err?.status;
    const message = err?.message ?? 'Unknown error';

    if (status === 400 || err?.code === 'content_policy_violation') {
      return new BadRequestException(
        `${providerType} rejected the image request: ${message}`,
      );
    }
    if (status === 429) {
      return new BadGatewayException(
        `${providerType} image quota or rate limit reached — try again shortly.`,
      );
    }
    return new BadGatewayException(
      `Image generation with ${providerType} failed: ${message}`,
    );
  }

  private async buildPrompt(
    dto: GenerateCoverImageRequestDto,
  ): Promise<string> {
    const template = await this.promptSharedService.getPromptByCode(
      COVER_IMAGE_GENERATION_PROMPT_CODE,
    );
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found for code: ${COVER_IMAGE_GENERATION_PROMPT_CODE}`,
      );
    }
    return renderTemplate(template, {
      title: dto.title,
      description: dto.description ?? '',
      styleHints: dto.styleHints ?? '',
      name: dto.name ?? '',
      age: dto.age != null ? String(dto.age) : '',
      gender: dto.gender ?? '',
      profession: dto.profession ?? '',
      currentLocation: dto.currentLocation ?? '',
    });
  }

  async generateCoverImage(
    dto: GenerateCoverImageRequestDto,
  ): Promise<GenerateCoverImageResponseDto> {
    const bucket = this.configService.s3.assetsBucket;
    const region = this.configService.aws.region;
    if (!bucket || !region) {
      throw new InternalServerErrorException(
        'S3 assets bucket or AWS region is not configured',
      );
    }
    const { provider, providerType } = this.providerFactory.getProvider(
      dto.provider,
    );
    const prompt = await this.buildPrompt(dto);

    this.logger.info(
      `[COVER_IMAGE] start provider=${providerType} model=${provider.getModel()} title=${dto.title}`,
    );
    const startedAt = Date.now();

    let imageBuffer: Buffer;
    try {
      imageBuffer = await provider.generateImage(prompt, DEFAULT_IMAGE_SIZE);
    } catch (error) {
      this.logger.error(
        `[COVER_IMAGE] failed provider=${providerType} elapsedMs=${Date.now() - startedAt}: ${
          (error as Error)?.message ?? error
        }`,
      );
      throw this.toHttpError(error, providerType);
    }

    void this.llmUsage.record({
      provider: providerType,
      model: provider.getModel(),
      task: LlmTask.GENERATE_COVER_IMAGE,
      unit: 'images',
      metadata: { title: dto.title, size: DEFAULT_IMAGE_SIZE },
    });

    // Upload only after a successful generation so failures leave no orphans.
    const key = `${COVER_IMAGE_LIBRARY_S3_PREFIX}/${Date.now()}-generated-${this.s3Service.sanitizeFileName(dto.title)}.png`;
    await this.s3Service.uploadStream({
      Bucket: bucket,
      Key: key,
      Body: imageBuffer,
      ContentType: 'image/png',
    });
    const imageUrl = this.s3Service.getS3Url(bucket, region, key);

    // Best-effort: the generated image should be reusable from the shared
    // library, but a library-insert failure must not fail the generation.
    try {
      await this.scenarioCoverImageLibraryService.addCoverImage({ imageUrl });
    } catch (error) {
      this.logger.error(
        `[COVER_IMAGE] failed to add generated image to library (imageUrl=${imageUrl}): ${
          (error as Error)?.message ?? error
        }`,
      );
    }

    this.logger.info(
      `[COVER_IMAGE] done provider=${providerType} key=${key} elapsedMs=${Date.now() - startedAt}`,
    );
    return { imageUrl, provider: providerType };
  }
}
