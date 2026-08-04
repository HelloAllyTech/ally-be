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
    // The catalog cache is time-based, so its tests need to move the clock
    // without waiting out a 15-minute TTL.
    jest.useFakeTimers();
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
    jest.useRealTimers();
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

    // Names here are language-prefixed like the real ones: a bare name is how
    // a Gemini voice is recognised, so 'a'/'b' would be read as Gemini voices
    // and re-added by the language-agnostic pass below.
    it('matches languageCodes exactly, since Google already tags regional variants', async () => {
      mockListVoices.mockResolvedValue([
        {
          voices: [
            {
              name: 'en-IN-Standard-A',
              languageCodes: ['en-IN'],
              ssmlGender: 'MALE',
            },
            {
              name: 'fr-FR-Standard-A',
              languageCodes: ['fr-FR'],
              ssmlGender: 'MALE',
            },
          ],
        },
      ]);

      const result = await service.getCatalog({
        provider: 'GOOGLE',
        languageCode: 'en-IN',
      });

      expect(result).toEqual([
        { value: 'en-IN-Standard-A', label: 'en-IN-Standard-A (male)' },
      ]);
    });

    it('falls back to the full list when nothing matches the language', async () => {
      mockListVoices.mockResolvedValue([
        {
          voices: [
            {
              name: 'fr-FR-Standard-A',
              languageCodes: ['fr-FR'],
              ssmlGender: 'MALE',
            },
          ],
        },
      ]);

      const result = await service.getCatalog({
        provider: 'GOOGLE',
        languageCode: 'zz-ZZ',
      });

      expect(result).toEqual([
        { value: 'fr-FR-Standard-A', label: 'fr-FR-Standard-A (male)' },
      ]);
    });

    /**
     * Gemini's 30 voices all report `languageCodes: ["en-US"]` and nothing
     * else, so an exact language match drops every one of them for a Tamil,
     * Marathi or en-IN voice — measured: en-US returns 30 of them, en-IN /
     * ta-IN / mr-IN return 0. Without this an admin creating an Indian-language
     * Google voice gets a strict dropdown with no Gemini name in it and no way
     * to type one, because the catalog turns the field into a select.
     */
    it('offers Gemini voices for a language they do not claim to support', async () => {
      mockListVoices.mockResolvedValue([
        {
          voices: [
            {
              name: 'ta-IN-Standard-A',
              languageCodes: ['ta-IN'],
              ssmlGender: 'FEMALE',
            },
            { name: 'Kore', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
            { name: 'Charon', languageCodes: ['en-US'], ssmlGender: 'MALE' },
          ],
        },
      ]);

      const result = await service.getCatalog({
        provider: 'GOOGLE',
        languageCode: 'ta-IN',
      });

      expect(result).toEqual([
        { value: 'ta-IN-Standard-A', label: 'ta-IN-Standard-A (female)' },
        { value: 'Kore', label: 'Kore (female · Gemini, any language)' },
        { value: 'Charon', label: 'Charon (male · Gemini, any language)' },
      ]);
    });

    it('does not mistake a lowercase-region voice for a Gemini one', async () => {
      // fil-ph-Neural2-A and -D are the only two real voices that lowercase
      // their region, and are the reason the prefix test is case-insensitive.
      mockListVoices.mockResolvedValue([
        {
          voices: [
            {
              name: 'fil-ph-Neural2-A',
              languageCodes: ['fil-PH'],
              ssmlGender: 'FEMALE',
            },
          ],
        },
      ]);

      const result = await service.getCatalog({
        provider: 'GOOGLE',
        languageCode: 'ta-IN',
      });

      // Reached only by the no-match fallback, and never labelled Gemini.
      expect(result).toEqual([
        { value: 'fil-ph-Neural2-A', label: 'fil-ph-Neural2-A (female)' },
      ]);
    });

    it('does not list a Gemini voice twice when the language is en-US', async () => {
      mockListVoices.mockResolvedValue([
        {
          voices: [
            { name: 'Kore', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
          ],
        },
      ]);

      const result = await service.getCatalog({
        provider: 'GOOGLE',
        languageCode: 'en-US',
      });

      expect(result).toEqual([{ value: 'Kore', label: 'Kore (female)' }]);
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

  describe('caching', () => {
    const models = (id: string) => [{ modelId: id, name: id }];

    it('serves a second call from cache instead of re-asking the provider', async () => {
      elevenLabsVoiceSyncService.listAvailableModels.mockResolvedValue(
        models('eleven_v3'),
      );

      await service.getCatalog({ provider: 'ELEVENLABS' });
      await service.getCatalog({ provider: 'ELEVENLABS' });

      // Measured uncached: ElevenLabs 0.6s, Deepgram 2.2s, Hume 3.9s per panel
      // open, for lists that move on a provider's release cadence.
      expect(
        elevenLabsVoiceSyncService.listAvailableModels,
      ).toHaveBeenCalledTimes(1);
    });

    it('caches per scope, so one language does not answer for another', async () => {
      const deepgram = (name: string) => ({
        ok: true,
        json: async () => ({
          tts: [
            {
              canonical_name: name,
              languages: ['en'],
              metadata: { accent: name },
            },
          ],
        }),
      });
      fetchMock
        .mockResolvedValueOnce(deepgram('aura-a-en'))
        .mockResolvedValueOnce(deepgram('aura-b-en'));

      const first = await service.getCatalog({
        provider: 'DEEPGRAM',
        languageCode: 'en-IN',
      });
      const second = await service.getCatalog({
        provider: 'DEEPGRAM',
        languageCode: 'en-GB',
      });

      expect(first).not.toEqual(second);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    /**
     * The case the cache was written for. An expired Google credential made
     * every catalog call 500; the studio's Voice name field silently degraded
     * from a picker to a free-text box, and it read as a broken dropdown rather
     * than a credential problem. A plain TTL would not have helped — the entry
     * was cold, so it still called out and still failed.
     */
    it('serves the last good catalog when a refresh fails', async () => {
      elevenLabsVoiceSyncService.listAvailableModels
        .mockResolvedValueOnce(models('eleven_v3'))
        .mockRejectedValue(new Error('invalid_grant: reauth related error'));

      const warm = await service.getCatalog({ provider: 'ELEVENLABS' });
      jest.advanceTimersByTime(16 * 60 * 1000);
      const afterFailure = await service.getCatalog({ provider: 'ELEVENLABS' });

      expect(afterFailure).toEqual(warm);
      expect(
        elevenLabsVoiceSyncService.listAvailableModels,
      ).toHaveBeenCalledTimes(2);
    });

    it('re-asks the provider once the entry goes stale', async () => {
      elevenLabsVoiceSyncService.listAvailableModels
        .mockResolvedValueOnce(models('eleven_v3'))
        .mockResolvedValueOnce(models('eleven_v4'));

      await service.getCatalog({ provider: 'ELEVENLABS' });
      jest.advanceTimersByTime(16 * 60 * 1000);
      const refreshed = await service.getCatalog({ provider: 'ELEVENLABS' });

      expect(refreshed).toEqual([{ value: 'eleven_v4', label: 'eleven_v4' }]);
    });

    it('still throws when the very first call fails, having nothing to fall back on', async () => {
      // Showing an empty picker would claim the provider offers no voices.
      elevenLabsVoiceSyncService.listAvailableModels.mockRejectedValue(
        new Error('boom'),
      );

      await expect(
        service.getCatalog({ provider: 'ELEVENLABS' }),
      ).rejects.toThrow('boom');
    });

    it('does not cache the unsupported-provider rejection', async () => {
      await expect(service.getCatalog({ provider: 'SARVAM' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getCatalog({ provider: 'SARVAM' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
