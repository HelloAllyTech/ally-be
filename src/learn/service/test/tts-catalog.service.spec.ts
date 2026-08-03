import { BadRequestException } from '@nestjs/common';
import { TtsCatalogService } from '../tts-catalog.service';

const mockListVoices = jest.fn();
jest.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: jest.fn().mockImplementation(() => ({
    listVoices: mockListVoices,
  })),
}));

describe('TtsCatalogService', () => {
  let service: TtsCatalogService;
  let configService: {
    voicePreview: {
      deepgramApiKey: string | undefined;
      humeApiKey: string | undefined;
    };
  };
  let elevenLabsVoiceSyncService: { listAvailableModels: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    configService = {
      voicePreview: { deepgramApiKey: 'dg-key', humeApiKey: 'hume-key' },
    };
    elevenLabsVoiceSyncService = { listAvailableModels: jest.fn() };
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    mockListVoices.mockReset();
    service = new TtsCatalogService(
      configService as any,
      elevenLabsVoiceSyncService as any,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a provider with no catalog implementation', async () => {
    await expect(service.getCatalog({ provider: 'SARVAM' })).rejects.toThrow(
      BadRequestException,
    );
  });

  describe('ElevenLabs', () => {
    it('delegates to the sync service and maps modelId/name to value/label', async () => {
      elevenLabsVoiceSyncService.listAvailableModels.mockResolvedValue([
        { modelId: 'eleven_v3', name: 'Eleven v3' },
      ]);

      const result = await service.getCatalog({ provider: 'ELEVENLABS' });

      expect(result).toEqual([{ value: 'eleven_v3', label: 'Eleven v3' }]);
    });
  });

  describe('Deepgram', () => {
    const deepgramResponse = (tts: any[]) => ({
      ok: true,
      json: async () => ({ tts }),
    });

    it('lists TTS models, preferring display_name and falling back to name', async () => {
      fetchMock.mockResolvedValue(
        deepgramResponse([
          {
            name: 'asteria',
            canonical_name: 'aura-asteria-en',
            languages: ['en', 'en-US'],
            metadata: { display_name: 'Asteria' },
          },
          {
            name: 'amalthea',
            canonical_name: 'aura-2-amalthea-en',
            languages: ['en', 'en-PH'],
            metadata: {},
          },
        ]),
      );

      const result = await service.getCatalog({ provider: 'DEEPGRAM' });

      expect(result).toEqual([
        { value: 'aura-asteria-en', label: 'Asteria (aura-asteria-en)' },
        { value: 'aura-2-amalthea-en', label: 'amalthea (aura-2-amalthea-en)' },
      ]);
    });

    it('matches a language by prefix, since Deepgram has no Indian regional variants', async () => {
      fetchMock.mockResolvedValue(
        deepgramResponse([
          {
            name: 'a',
            canonical_name: 'aura-a-en',
            languages: ['en', 'en-US'],
          },
          {
            name: 'b',
            canonical_name: 'aura-b-fr',
            languages: ['fr', 'fr-FR'],
          },
        ]),
      );

      const result = await service.getCatalog({
        provider: 'DEEPGRAM',
        languageCode: 'en-IN', // Deepgram never tags "en-IN" itself
      });

      expect(result).toEqual([{ value: 'aura-a-en', label: 'a (aura-a-en)' }]);
    });

    it('falls back to the full list when the language has no match at all', async () => {
      fetchMock.mockResolvedValue(
        deepgramResponse([
          { name: 'a', canonical_name: 'aura-a-en', languages: ['en'] },
        ]),
      );

      const result = await service.getCatalog({
        provider: 'DEEPGRAM',
        languageCode: 'hi-IN', // Deepgram has no Hindi voices at all
      });

      expect(result).toEqual([{ value: 'aura-a-en', label: 'a (aura-a-en)' }]);
    });

    it('rejects when Deepgram is not configured on this environment', async () => {
      configService.voicePreview.deepgramApiKey = undefined;
      await expect(
        service.getCatalog({ provider: 'DEEPGRAM' }),
      ).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces a non-200 from Deepgram', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      await expect(
        service.getCatalog({ provider: 'DEEPGRAM' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Google', () => {
    it('lists voices with gender in the label', async () => {
      mockListVoices.mockResolvedValue([
        {
          voices: [
            {
              name: 'en-IN-Chirp3-HD-Achernar',
              languageCodes: ['en-IN'],
              ssmlGender: 'FEMALE',
            },
          ],
        },
      ]);

      const result = await service.getCatalog({ provider: 'GOOGLE' });

      expect(result).toEqual([
        {
          value: 'en-IN-Chirp3-HD-Achernar',
          label: 'en-IN-Chirp3-HD-Achernar (female)',
        },
      ]);
    });

    it('matches languageCodes exactly, since Google already tags regional variants', async () => {
      mockListVoices.mockResolvedValue([
        {
          voices: [
            { name: 'a', languageCodes: ['en-IN'], ssmlGender: 'MALE' },
            { name: 'b', languageCodes: ['fr-FR'], ssmlGender: 'MALE' },
          ],
        },
      ]);

      const result = await service.getCatalog({
        provider: 'GOOGLE',
        languageCode: 'en-IN',
      });

      expect(result).toEqual([{ value: 'a', label: 'a (male)' }]);
    });

    it('falls back to the full list when nothing matches the language', async () => {
      mockListVoices.mockResolvedValue([
        {
          voices: [{ name: 'a', languageCodes: ['fr-FR'], ssmlGender: 'MALE' }],
        },
      ]);

      const result = await service.getCatalog({
        provider: 'GOOGLE',
        languageCode: 'zz-ZZ',
      });

      expect(result).toEqual([{ value: 'a', label: 'a (male)' }]);
    });

    it('constructs the client lazily, once, not per call', async () => {
      mockListVoices.mockResolvedValue([{ voices: [] }]);

      await service.getCatalog({ provider: 'GOOGLE' });
      await service.getCatalog({ provider: 'GOOGLE' });

      const textToSpeech = require('@google-cloud/text-to-speech');
      expect(textToSpeech.TextToSpeechClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('Hume', () => {
    const humePage = (voices: any[], totalPages = 1) => ({
      ok: true,
      json: async () => ({ voices_page: voices, total_pages: totalPages }),
    });

    it('defaults to the HUME_AI library when voice_provider is unset', async () => {
      fetchMock.mockResolvedValue(
        humePage([{ name: 'Priya', tags: { GENDER: ['Female'] } }]),
      );

      const result = await service.getCatalog({ provider: 'HUME' });

      expect(result).toEqual([{ value: 'Priya', label: 'Priya (Female)' }]);
      expect(fetchMock.mock.calls[0][0]).toContain('provider=HUME_AI');
    });

    it('honours an explicit voice_provider', async () => {
      fetchMock.mockResolvedValue(humePage([]));

      await service.getCatalog({
        provider: 'HUME',
        voiceProvider: 'CUSTOM_VOICE',
      });

      expect(fetchMock.mock.calls[0][0]).toContain('provider=CUSTOM_VOICE');
    });

    it('pages through the whole library', async () => {
      fetchMock
        .mockResolvedValueOnce(humePage([{ name: 'A' }], 2))
        .mockResolvedValueOnce(humePage([{ name: 'B' }], 2));

      const result = await service.getCatalog({ provider: 'HUME' });

      expect(result.map((r) => r.value)).toEqual(['A', 'B']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects when Hume is not configured on this environment', async () => {
      configService.voicePreview.humeApiKey = undefined;
      await expect(service.getCatalog({ provider: 'HUME' })).rejects.toThrow(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces a non-200 from Hume', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403 });
      await expect(service.getCatalog({ provider: 'HUME' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
