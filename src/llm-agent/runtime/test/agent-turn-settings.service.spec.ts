import {
  AgentTurnSettingsService,
  VALIDATED_AGENT_TURNS_SETTING,
} from '../agent-turn-settings.service';

describe('AgentTurnSettingsService', () => {
  let row: { id: string; value: Record<string, any> } | null;
  let repository: Record<string, jest.Mock>;
  let service: AgentTurnSettingsService;

  beforeEach(() => {
    row = null;
    repository = {
      findOne: jest.fn(async () => row),
      update: jest.fn(async (_where, patch) => {
        row = { ...(row as any), ...patch };
      }),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        row = { id: 'r1', value: value.value };
        return row;
      }),
    };
    service = new AgentTurnSettingsService(repository as any);
  });

  it('is on for both agents before anything is saved', async () => {
    await expect(service.get()).resolves.toEqual({
      courseCopilot: true,
      characterInterview: true,
    });
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { name: VALIDATED_AGENT_TURNS_SETTING },
    });
  });

  it('turns one agent off without touching the other', async () => {
    await service.update({ courseCopilot: false }, 5);
    expect(repository.save).toHaveBeenCalled();
    await expect(service.enabled('courseCopilot')).resolves.toBe(false);
    await expect(service.enabled('characterInterview')).resolves.toBe(true);

    await service.update({ characterInterview: false }, 5);
    expect(repository.update).toHaveBeenCalled();
    await expect(service.get()).resolves.toEqual({
      courseCopilot: false,
      characterInterview: false,
    });
  });

  it('ignores fields that are not switches', async () => {
    await service.update(
      { courseCopilot: 'no' as any, other: false } as any,
      5,
    );
    await expect(service.get()).resolves.toEqual({
      courseCopilot: true,
      characterInterview: true,
    });
  });

  it('keeps validated turns on when the settings cannot be read', async () => {
    repository.findOne.mockRejectedValue(new Error('db down'));
    await expect(service.enabled('characterInterview')).resolves.toBe(true);
  });
});
