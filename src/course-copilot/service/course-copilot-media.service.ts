import { Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { ImageGenerationProviderFactory } from 'src/image-generation/provider/image-generation-provider.factory';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { COURSE_COPILOT_MEDIA_PREFIX } from '../constants/course-copilot.constants';

/** A job that cannot run in this environment — skipped with the reason, not failed. */
export class CourseCopilotJobSkip extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'CourseCopilotJobSkip';
  }
}

/**
 * Generated images for courses: render, upload, record.
 *
 * Calls the image provider directly rather than through the simulation
 * cover-image service, for two reasons: that service files every image it
 * makes into the roleplay cover library (a course cover does not belong
 * there), and its usage row carries no session id, so the copilot's budget
 * could not see it. Images land in the learn-media bucket under the same
 * `track-media/image/` prefix the course editor's uploads use, so the editor
 * and both learner apps treat them exactly like an uploaded image.
 */
@Injectable()
export class CourseCopilotMediaService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotMediaService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly s3Service: S3Service,
    private readonly imageFactory: ImageGenerationProviderFactory,
    private readonly llmUsage: LlmUsageService,
  ) {}

  /** Null when images cannot be made here; the reason is the job's skip note. */
  unavailableReason(): string | null {
    if (!this.configService.s3.learnMediaPublicBucket) {
      return 'Image storage is not configured on this environment — add a cover in the editor.';
    }
    try {
      this.imageFactory.getProvider();
      return null;
    } catch {
      return 'Image generation is not configured on this environment — pick a cover from the library or upload one in the editor.';
    }
  }

  async generate(
    prompt: string,
    options: {
      purpose: 'cover' | 'article';
      name: string;
      usageMetadata: Record<string, any>;
    },
  ): Promise<string> {
    const reason = this.unavailableReason();
    if (reason) throw new CourseCopilotJobSkip(reason);

    const { provider, providerType } = this.imageFactory.getProvider();
    // 3:2 landscape, the size the simulation covers use; renders well as a
    // course card and inline in an article.
    const size = '1536x1024';
    const image = await provider.generateImage(prompt, size);

    const bucket = this.configService.s3.learnMediaPublicBucket!;
    const region = this.configService.aws.region ?? '';
    const slug = this.s3Service.sanitizeFileName(
      `copilot-${options.purpose}-${options.name}`
        .toLowerCase()
        .replace(/\s+/g, '-'),
      80,
    );
    const key = `${COURSE_COPILOT_MEDIA_PREFIX}/${Date.now()}-${slug}.png`;
    await this.s3Service.uploadStream({
      Bucket: bucket,
      Key: key,
      Body: image,
      ContentType: 'image/png',
    });

    void this.llmUsage.record({
      provider: providerType,
      model: provider.getModel(),
      task: LlmTask.COURSE_COPILOT_IMAGE,
      unit: 'images',
      metadata: { ...options.usageMetadata, purpose: options.purpose, size },
    });
    this.logger.info(`Course Copilot image stored at ${key}`);
    return this.s3Service.getS3Url(bucket, region, key);
  }
}
