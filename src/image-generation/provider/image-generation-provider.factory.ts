import { BadRequestException, Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import {
  ImageGenerationProvider,
  ImageGenerationProviderType,
} from '../interface/image-generation-provider.interface';
import { OpenAiImageProvider } from './openai-image.provider';
import { GeminiImageProvider } from './gemini-image.provider';

@Injectable()
export class ImageGenerationProviderFactory {
  private readonly providers: Map<string, ImageGenerationProvider>;

  constructor(
    private readonly configService: AppConfigService,
    private readonly openAiProvider: OpenAiImageProvider,
    private readonly geminiProvider: GeminiImageProvider,
  ) {
    this.providers = new Map<string, ImageGenerationProvider>([
      [ImageGenerationProviderType.OPENAI, this.openAiProvider],
      [ImageGenerationProviderType.GEMINI, this.geminiProvider],
    ]);
  }

  getProvider(providerType?: string): {
    provider: ImageGenerationProvider;
    providerType: string;
  } {
    const type =
      providerType ?? this.configService.characterImage.defaultProvider;
    const provider = this.providers.get(type);

    if (!provider) {
      throw new BadRequestException(
        `Image generation provider "${type}" is not registered`,
      );
    }

    try {
      provider.assertConfigured();
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }

    return { provider, providerType: type };
  }
}
