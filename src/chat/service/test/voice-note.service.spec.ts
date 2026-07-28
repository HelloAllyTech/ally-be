import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';

import { VoiceNoteService } from '../voice-note.service';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { SettingsService } from 'src/settings/service/settings.service';

const mockTranscriptionsCreate = jest.fn();
const mockMessagesCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: mockTranscriptionsCreate } },
  })),
  toFile: jest.fn().mockResolvedValue('file-handle'),
}));

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

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
          useValue: { getPromptContent: jest.fn().mockResolvedValue('prompt') },
        },
        { provide: SettingsService, useValue: settingsService },
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
        'Scribe voice note is not enabled for this organization',
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
});
