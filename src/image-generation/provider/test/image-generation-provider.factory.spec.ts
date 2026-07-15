import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigService } from 'src/config/config.service';
import { ImageGenerationProviderFactory } from '../image-generation-provider.factory';
import { OpenAiImageProvider } from '../openai-image.provider';
import { GeminiImageProvider } from '../gemini-image.provider';

describe('ImageGenerationProviderFactory', () => {
  let factory: ImageGenerationProviderFactory;

  const mockConfig = {
    openai: { apiKey: 'openai-key', imageModel: 'gpt-image-1' },
    gemini: { apiKey: 'gemini-key', imageModel: 'gemini-2.5-flash-image' },
    characterImage: { defaultProvider: 'openai' },
  };

  const build = async (config: any) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageGenerationProviderFactory,
        OpenAiImageProvider,
        GeminiImageProvider,
        { provide: AppConfigService, useValue: config },
      ],
    }).compile();
    return module.get(ImageGenerationProviderFactory);
  };

  it('returns the requested provider', async () => {
    factory = await build(mockConfig);

    expect(factory.getProvider('openai').providerType).toBe('openai');
    expect(factory.getProvider('gemini').providerType).toBe('gemini');
  });

  it('falls back to the configured default when no provider is requested', async () => {
    factory = await build(mockConfig);

    const { provider, providerType } = factory.getProvider();
    expect(providerType).toBe('openai');
    expect(provider.getModel()).toBe('gpt-image-1');
  });

  it('rejects unknown providers with a 400', async () => {
    factory = await build(mockConfig);

    expect(() => factory.getProvider('dall-e-shop')).toThrow(
      BadRequestException,
    );
    expect(() => factory.getProvider('dall-e-shop')).toThrow(/not registered/);
  });

  it('rejects a provider whose API key is missing with a clear 400', async () => {
    factory = await build({
      ...mockConfig,
      gemini: { apiKey: undefined, imageModel: 'gemini-2.5-flash-image' },
    });

    expect(() => factory.getProvider('gemini')).toThrow(BadRequestException);
    expect(() => factory.getProvider('gemini')).toThrow(
      /GEMINI_API_KEY is not configured/,
    );
    // The other provider still works.
    expect(factory.getProvider('openai').providerType).toBe('openai');
  });

  it('rejects when the default provider key is missing and none requested', async () => {
    factory = await build({
      ...mockConfig,
      openai: { apiKey: undefined, imageModel: 'gpt-image-1' },
    });

    expect(() => factory.getProvider()).toThrow(BadRequestException);
    expect(() => factory.getProvider()).toThrow(
      /OPENAI_API_KEY is not configured/,
    );
  });
});
