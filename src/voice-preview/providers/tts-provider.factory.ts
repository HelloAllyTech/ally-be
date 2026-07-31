import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { TTSProviderEnum } from '../dto/preview-request.dto';
import { normalizeProviderKey } from 'src/learn/enum/tts-provider.enum';
import { ITTSProvider } from './tts-provider.interface';
import { DeepgramTTSProvider } from './deepgram-tts.provider';
import { ElevenLabsTTSProvider } from './elevenlabs-tts.provider';
import { SarvamTTSProvider } from './sarvam-tts.provider';
import { GoogleTTSProvider } from './google-tts.provider';
import { HumeTTSProvider } from './hume-tts.provider';

@Injectable()
export class TTSProviderFactory {
  private readonly logger = new Logger(TTSProviderFactory.name);

  constructor(private readonly configService: AppConfigService) {}

  createProvider(
    provider: TTSProviderEnum,
    config: Record<string, any>,
    languageCode: string,
  ): ITTSProvider {
    const keys = this.configService.voicePreview;

    const keyMap: Record<TTSProviderEnum, string | undefined> = {
      [TTSProviderEnum.DEEPGRAM]: keys.deepgramApiKey,
      [TTSProviderEnum.ELEVENLABS]: keys.elevenlabsApiKey,
      [TTSProviderEnum.SARVAM]: keys.sarvamApiKey,
      [TTSProviderEnum.GOOGLE]:
        this.configService.googleCloudTranslationConfig.credentials,
      [TTSProviderEnum.HUME]: keys.humeApiKey,
    };

    // The stored provider may still be upper-case on rows written before the
    // casing migration, and this map is keyed by the (lower-case) enum, so
    // normalize before the lookup rather than 404-ing a perfectly good voice.
    const normalized = normalizeProviderKey(provider) as TTSProviderEnum;
    const apiKey = keyMap[normalized];
    if (!apiKey) {
      this.logger.warn(
        `Provider ${provider} is not configured — missing API key`,
      );
      throw new BadRequestException(
        `Provider ${provider} is not configured. Please contact your administrator.`,
      );
    }

    switch (normalized) {
      case TTSProviderEnum.DEEPGRAM:
        return new DeepgramTTSProvider(apiKey, config);
      case TTSProviderEnum.ELEVENLABS:
        return new ElevenLabsTTSProvider(apiKey, config);
      case TTSProviderEnum.SARVAM:
        return new SarvamTTSProvider(apiKey, config, languageCode);
      case TTSProviderEnum.GOOGLE:
        return new GoogleTTSProvider(config, languageCode);
      case TTSProviderEnum.HUME:
        return new HumeTTSProvider(apiKey, config);
      default: {
        const _exhaustive: never = normalized;
        throw new BadRequestException(
          `Unsupported TTS provider: ${_exhaustive}`,
        );
      }
    }
  }
}
