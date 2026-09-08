import { BugHunterModelSettingsService } from '../bug-hunter-model-settings.service';
import {
  BUG_HUNTER_MODEL_SETTINGS_NAME,
  DEFAULT_BUG_HUNTER_MODEL_SETTINGS,
} from '../../type/bug-hunter-model-settings.type';

describe('BugHunterModelSettingsService', () => {
  let service: BugHunterModelSettingsService;
  let repo: {
    findOne: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      update: jest.fn(),
      save: jest.fn(),
      create: jest.fn((row) => row),
    };
    service = new BugHunterModelSettingsService(repo as never);
  });

  describe('get', () => {
    it('returns defaults when no row has ever been written', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.get()).resolves.toEqual(
        DEFAULT_BUG_HUNTER_MODEL_SETTINGS,
      );
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { name: BUG_HUNTER_MODEL_SETTINGS_NAME },
      });
    });

    it('fills a field missing from an older row with its default rather than leaving it undefined', async () => {
      repo.findOne.mockResolvedValue({
        value: { defaultModel: 'claude-sonnet-5' },
      } as never);

      await expect(service.get()).resolves.toEqual({
        defaultModel: 'claude-sonnet-5',
        escalationModel: DEFAULT_BUG_HUNTER_MODEL_SETTINGS.escalationModel,
      });
    });
  });

  describe('update', () => {
    it('creates the row on the first write, merged over defaults', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.update(
        { escalationModel: 'claude-opus-5' },
        7,
      );

      expect(result).toEqual({
        defaultModel: DEFAULT_BUG_HUNTER_MODEL_SETTINGS.defaultModel,
        escalationModel: 'claude-opus-5',
      });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: BUG_HUNTER_MODEL_SETTINGS_NAME,
          value: result,
          createdBy: 7,
          updatedBy: 7,
        }),
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('merges a partial patch over the existing row rather than blanking the untouched field', async () => {
      repo.findOne.mockResolvedValue({
        id: 'settings-1',
        value: {
          defaultModel: 'claude-sonnet-5',
          escalationModel: 'claude-opus-5',
        },
      } as never);

      const result = await service.update(
        { defaultModel: 'claude-haiku-4-5' },
        9,
      );

      expect(result).toEqual({
        defaultModel: 'claude-haiku-4-5',
        escalationModel: 'claude-opus-5',
      });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'settings-1' },
        { value: result, updatedBy: 9 },
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
