import { Module } from '@nestjs/common';
import { OpenAiImageProvider } from './provider/openai-image.provider';
import { GeminiImageProvider } from './provider/gemini-image.provider';
import { ImageGenerationProviderFactory } from './provider/image-generation-provider.factory';

@Module({
  providers: [
    OpenAiImageProvider,
    GeminiImageProvider,
    ImageGenerationProviderFactory,
  ],
  exports: [ImageGenerationProviderFactory],
})
export class ImageGenerationModule {}
