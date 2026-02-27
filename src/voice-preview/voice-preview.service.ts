import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { TTSProviderFactory } from './providers/tts-provider.factory';
import { TTSProviderEnum } from './dto/preview-request.dto';
import {
  DEFAULT_SAMPLE_TEXT,
  LANGUAGE_SAMPLE_TEXT,
} from './constants/language-samples.constant';

export interface GeneratePreviewParams {
  provider: string;
  config: Record<string, any>;
  languageCode: string;
  text?: string;
}

@Injectable()
export class VoicePreviewService {
  private readonly logger = new Logger(VoicePreviewService.name);

  constructor(
    private readonly providerFactory: TTSProviderFactory,
    private readonly scenarioSharedService: ScenarioSharedService,
  ) {}

  async getVoiceWithLanguageCode(voiceId: string) {
    return this.scenarioSharedService.getVoiceWithLanguageCode(voiceId);
  }

  async generatePreview(
    params: GeneratePreviewParams,
  ): Promise<{ audioBuffer: Buffer; provider: string }> {
    const languageCode = params.languageCode || 'en-US';
    const text =
      params.text || LANGUAGE_SAMPLE_TEXT[languageCode] || DEFAULT_SAMPLE_TEXT;

    try {
      const provider = this.providerFactory.createProvider(
        params.provider as TTSProviderEnum,
        params.config,
        languageCode,
      );
      const audioBuffer = await provider.generatePreview(text);
      return { audioBuffer, provider: params.provider };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `TTS generation failed for provider ${params.provider}: ${message}`,
      );
      throw new InternalServerErrorException(
        `Voice preview generation failed: ${message}`,
      );
    }
  }
}
