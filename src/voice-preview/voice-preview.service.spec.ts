import { Test, TestingModule } from '@nestjs/testing';
import { VoicePreviewService } from './voice-preview.service';
import { TTSProviderFactory } from './providers/tts-provider.factory';
import { ScenarioSharedService } from '../learn/service/scenario-shared.service';
import { ITTSProvider } from './providers/tts-provider.interface';
import { TTSProviderEnum } from './dto/preview-request.dto';

// Mock implementation of ITTSProvider
const mockTTSProvider: ITTSProvider = {
  generatePreview: jest.fn().mockResolvedValue(Buffer.from('test-audio')),
};

describe('VoicePreviewService', () => {
  let service: VoicePreviewService;

  beforeEach(async () => {
    // Reset the mock before each test
    (mockTTSProvider.generatePreview as jest.Mock).mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoicePreviewService,
        {
          provide: TTSProviderFactory,
          useValue: {
            createProvider: jest.fn().mockReturnValue(mockTTSProvider),
          },
        },
        {
          provide: ScenarioSharedService,
          useValue: {
            getVoiceWithLanguageCode: jest.fn().mockResolvedValue({
              id: 'voice-id',
              languageCode: 'en-US',
            }),
          },
        },
      ],
    }).compile();

    service = module.get<VoicePreviewService>(VoicePreviewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generatePreview', () => {
    it('should pass the language of the text to the provider', async () => {
      const params = {
        provider: TTSProviderEnum.CARTESIA,
        config: { voiceId: 'voice-123' },
        languageCode: 'es-US',
        text: 'Hola, mundo',
      };

      await service.generatePreview(params);

      expect(mockTTSProvider.generatePreview).toHaveBeenCalledWith(
        'Hola, mundo',
        'es-US',
      );
    });
  });
});
