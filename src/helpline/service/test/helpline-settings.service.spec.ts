import { HttpException } from '@nestjs/common';
import { HelplineSettingsService } from '../helpline-settings.service';

const TENANT = { id: 't-1', code: 'acme', name: 'Acme', logoUrl: null };

function build(stored: unknown = null) {
  const existing = stored ? { id: 'p-1', value: stored } : null;
  const preferences = {
    findOne: jest.fn().mockResolvedValue(existing),
    update: jest.fn().mockResolvedValue({}),
    save: jest.fn().mockResolvedValue({}),
    create: (x: unknown) => x,
  };
  const tenantFeature = {
    isEnabledForTenant: jest.fn().mockResolvedValue(true),
  };
  const redis = { del: jest.fn().mockResolvedValue(undefined) };
  const presence = { invalidateStatus: jest.fn().mockResolvedValue(undefined) };
  const service = new HelplineSettingsService(
    preferences as never,
    tenantFeature as never,
    redis as never,
    presence as never,
  );
  return { service, preferences, tenantFeature, redis, presence };
}

describe('HelplineSettingsService', () => {
  it('a write invalidates the public status cache, so the talker page flips at once', async () => {
    const { service, presence } = build();
    await service.updateAdminSettings(TENANT, { enabled: true });
    expect(presence.invalidateStatus).toHaveBeenCalledWith('t-1');
  });

  it('writes the enabled switch keyed by tenant CODE and busts PreferenceService’s cache key', async () => {
    const { service, preferences, redis } = build();
    await service.updateAdminSettings(TENANT, { enabled: true });
    expect(preferences.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TEXT_HELPLINE_ENABLED',
        relatedId: 'acme',
        relatedEntity: 'ORGANIZATION',
        value: { enabled: true },
      }),
    );
    expect(redis.del).toHaveBeenCalledWith(
      'preference:TEXT_HELPLINE_ENABLED:acme:ORGANIZATION',
    );
  });

  it('stores a patch over what is stored, and reads it back merged over the defaults', async () => {
    const { service, preferences } = build({ maxWaitMinutes: 45 });
    await service.updateAdminSettings(TENANT, {
      settings: { idleEndMinutes: 20 },
    });
    expect(preferences.update).toHaveBeenCalledWith('p-1', {
      value: { maxWaitMinutes: 45, idleEndMinutes: 20 },
    });
    const merged = await service.getSettings(TENANT);
    expect(merged.maxWaitMinutes).toBe(45);
    expect(merged.languages).toEqual(['en', 'hi']);
  });

  it('a bad field writes nothing at all — not even the enabled switch', async () => {
    const { service, preferences, presence } = build();
    await expect(
      service.updateAdminSettings(TENANT, {
        enabled: true,
        settings: {
          supervisorAlertChannels: {
            slackWebhookUrl: 'https://evil.example.com',
          },
        },
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(preferences.save).not.toHaveBeenCalled();
    expect(preferences.update).not.toHaveBeenCalled();
    expect(presence.invalidateStatus).not.toHaveBeenCalled();
  });

  it('reads the switch through TenantFeatureService (fail closed, by code)', async () => {
    const { service, tenantFeature } = build();
    await service.isEnabled(TENANT);
    expect(tenantFeature.isEnabledForTenant).toHaveBeenCalledWith(
      'TEXT_HELPLINE_ENABLED',
      'acme',
    );
  });
});
