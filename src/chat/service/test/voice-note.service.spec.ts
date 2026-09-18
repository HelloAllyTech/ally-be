import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';
import { VoiceNoteExtractionFailedException } from 'src/exception/custom.exception';

import { VoiceNoteService } from '../voice-note.service';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { SettingsService } from 'src/settings/service/settings.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';

const mockTranscriptionsCreate = jest.fn();
const mockMessagesCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: mockTranscriptionsCreate } },
  })),
  toFile: jest.fn().mockResolvedValue('file-handle'),
}));

/**
 * Extraction seam. `mockMessagesCreate` keeps the provider-shaped
 * request/response these tests were written against; the injected
 * LlmCompletionService translates at the edge. Which model runs, and the usage
 * row it produces, belong to that service and are covered by its own spec —
 * what matters here is the tenant gate, the failure path, and the field
 * coercion.
 */
const llmCompletion = {
  complete: jest.fn(async (request: any) => {
    const response = await mockMessagesCreate({
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });
    const block = response?.content?.[0];
    return {
      text: (block?.type === 'text' ? block.text : '').trim(),
      provider: 'openai',
      model: 'gpt-test',
      source: 'tier',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }),
};

describe('VoiceNoteService', () => {
  let service: VoiceNoteService;
  let settingsService: { getScribeVoiceNoteEnabled: jest.Mock };

  const audio = {
    buffer: Buffer.from('fake-audio'),
    mimetype: 'audio/webm',
    size: 10,
  } as Express.Multer.File;

  beforeEach(async () => {
    settingsService = { getScribeVoiceNoteEnabled: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceNoteService,
        {
          provide: AppConfigService,
          useValue: {
            openai: { apiKey: 'test-key', transcriptionModel: 'whisper-1' },
            anthropic: { apiKey: 'test-key', autofillModel: 'claude-test' },
          },
        },
        {
          provide: PromptSharedService,
          useValue: {
            getPromptContent: jest.fn().mockResolvedValue('prompt'),
            // The service reads its templates through getPromptByCode; without
            // it on the mock, every extraction test dies on a TypeError inside
            // buildSystemPrompt rather than on the behaviour under test.
            getPromptByCode: jest
              .fn()
              .mockResolvedValue('prompt {{transcript}}'),
          },
        },
        { provide: SettingsService, useValue: settingsService },
        { provide: LlmCompletionService, useValue: llmCompletion },
      ],
    }).compile();

    service = module.get<VoiceNoteService>(VoiceNoteService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateFromAudio tenant gate', () => {
    it('throws when scribe voice note is disabled for the tenant', async () => {
      settingsService.getScribeVoiceNoteEnabled.mockResolvedValue(false);

      await expect(service.generateFromAudio(audio, undefined)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not reach the billable providers when disabled', async () => {
      settingsService.getScribeVoiceNoteEnabled.mockResolvedValue(false);

      await expect(service.generateFromAudio(audio, undefined)).rejects.toThrow(
        /not switched on for your organisation/i,
      );

      // The whole point of the guard: no Whisper call, no Anthropic call.
      expect(mockTranscriptionsCreate).not.toHaveBeenCalled();
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('transcribes when scribe voice note is enabled', async () => {
      settingsService.getScribeVoiceNoteEnabled.mockResolvedValue(true);
      mockTranscriptionsCreate.mockResolvedValue({ text: '  hello there  ' });

      const result = await service.generateFromAudio(audio, undefined);

      expect(mockTranscriptionsCreate).toHaveBeenCalled();
      expect(result.transcript).toBe('hello there');
      // No fields requested, so extraction is skipped entirely.
      expect(result.values).toEqual([]);
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('checks the toggle before validating the audio payload', async () => {
      settingsService.getScribeVoiceNoteEnabled.mockResolvedValue(false);

      // An empty upload would normally be a 400; the tenant gate wins.
      await expect(
        service.generateFromAudio(undefined, undefined),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('extraction failure', () => {
    const fields = JSON.stringify([
      { id: 'sessionSummary', label: 'Summary', type: 'multiline' },
    ]);

    beforeEach(() => {
      settingsService.getScribeVoiceNoteEnabled.mockResolvedValue(true);
      mockTranscriptionsCreate.mockResolvedValue({
        text: 'caller described trouble sleeping',
      });
    });

    it('returns the transcript alongside the failure instead of losing it', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('anthropic exploded'));

      // The counsellor spoke this note once. A bare 500 would make them speak
      // it again, which is the bug this covers.
      await expect(
        service.generateFromAudio(audio, fields),
      ).rejects.toMatchObject({
        response: {
          errorCode: ErrorCode.VOICE_NOTE_EXTRACTION_FAILED,
          transcript: 'caller described trouble sleeping',
        },
      });
    });

    it('throws the typed exception the filter carries the transcript through', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('anthropic exploded'));

      // CustomExceptionFilter builds the body from an allowlist and branches on
      // this class, so the type is load-bearing, not decoration.
      await expect(
        service.generateFromAudio(audio, fields),
      ).rejects.toBeInstanceOf(VoiceNoteExtractionFailedException);
    });

    it('still succeeds normally when extraction works', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'text', text: '{"sessionSummary":"Trouble sleeping."}' },
        ],
      });

      const result = await service.generateFromAudio(audio, fields);

      expect(result.transcript).toBe('caller described trouble sleeping');
      expect(result.values).toEqual([
        { id: 'sessionSummary', value: 'Trouble sleeping.' },
      ]);
    });

    it('carries FEATURE_NOT_ENABLED on the disabled-tenant 403', async () => {
      settingsService.getScribeVoiceNoteEnabled.mockResolvedValue(false);

      // The client branches on this to say "ask an admin" rather than showing
      // the retry copy for a request that can never succeed.
      await expect(
        service.generateFromAudio(audio, fields),
      ).rejects.toMatchObject({
        response: { errorCode: ErrorCode.FEATURE_NOT_ENABLED },
      });
    });
  });
});
