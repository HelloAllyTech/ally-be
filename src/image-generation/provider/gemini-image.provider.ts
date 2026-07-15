import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { AppConfigService } from 'src/config/config.service';
import { ImageGenerationProvider } from '../interface/image-generation-provider.interface';

@Injectable()
export class GeminiImageProvider implements ImageGenerationProvider {
  private client?: GoogleGenAI;

  constructor(private readonly configService: AppConfigService) {}

  getModel(): string {
    return this.configService.gemini.imageModel;
  }

  assertConfigured(): void {
    if (!this.configService.gemini.apiKey) {
      throw new Error(
        'GEMINI_API_KEY is not configured — cannot generate an image with Gemini.',
      );
    }
  }

  /** Lazily build the client so the app boots even without a key configured;
   * a Gemini-selected generation then fails clearly instead of at module load. */
  private getClient(): GoogleGenAI {
    if (!this.client) {
      this.assertConfigured();
      this.client = new GoogleGenAI({
        apiKey: this.configService.gemini.apiKey,
      });
    }
    return this.client;
  }

  /** Gemini image models take an aspect ratio, not pixel dimensions. */
  private toAspectRatio(size: string): string {
    const [width, height] = size.split('x').map(Number);
    if (!width || !height) {
      return '16:9';
    }
    const ratio = width / height;
    if (Math.abs(ratio - 16 / 9) < 0.2) return '16:9';
    if (Math.abs(ratio - 3 / 2) < 0.2) return '3:2';
    if (Math.abs(ratio - 9 / 16) < 0.2) return '9:16';
    return ratio > 1 ? '16:9' : ratio < 1 ? '3:4' : '1:1';
  }

  async generateImage(prompt: string, size: string): Promise<Buffer> {
    const response = await this.getClient().models.generateContent({
      model: this.getModel(),
      contents: prompt,
      config: {
        imageConfig: { aspectRatio: this.toAspectRatio(size) },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }
    throw new Error('Gemini returned no image data');
  }
}
