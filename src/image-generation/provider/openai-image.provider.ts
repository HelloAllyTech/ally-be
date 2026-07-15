import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from 'src/config/config.service';
import { ImageGenerationProvider } from '../interface/image-generation-provider.interface';

@Injectable()
export class OpenAiImageProvider implements ImageGenerationProvider {
  private client?: OpenAI;

  constructor(private readonly configService: AppConfigService) {}

  getModel(): string {
    return this.configService.openai.imageModel;
  }

  assertConfigured(): void {
    if (!this.configService.openai.apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not configured — cannot generate an image with OpenAI.',
      );
    }
  }

  /** Lazily build the client so the app boots even without a key configured. */
  private getClient(): OpenAI {
    if (!this.client) {
      this.assertConfigured();
      this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
    }
    return this.client;
  }

  async generateImage(prompt: string, size: string): Promise<Buffer> {
    const response = await this.getClient().images.generate({
      model: this.getModel(),
      prompt,
      n: 1,
      size: size as OpenAI.Images.ImageGenerateParams['size'],
    });

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error('OpenAI returned no image data');
    }
    return Buffer.from(base64, 'base64');
  }
}
