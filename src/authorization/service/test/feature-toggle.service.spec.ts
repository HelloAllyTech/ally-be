import { FeatureToggleService } from '../feature-toggle.service';
import { FeatureToggleKey } from '../../constants/admin-feature-toggle.constants';

describe('FeatureToggleService — platform-only toggles', () => {
  let toggleRepository: { findByUserId: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock };
  let tenantScopeService: { isRestricted: jest.Mock };
  let service: FeatureToggleService;

  const USER_ID = 7;

  beforeEach(() => {
    toggleRepository = {
      findByUserId: jest.fn().mockResolvedValue([
        { featureKey: FeatureToggleKey.ANALYTICS, enabled: true },
        { featureKey: FeatureToggleKey.ANALYTICS_AGENT, enabled: true },
        { featureKey: FeatureToggleKey.CONTENT_MANAGEMENT, enabled: true },
        { featureKey: FeatureToggleKey.LOGS, enabled: false },
      ]),
    };
    cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    tenantScopeService = { isRestricted: jest.fn().mockResolvedValue(false) };
    service = new FeatureToggleService(
      toggleRepository as any,
      cache as any,
      tenantScopeService as any,
    );
  });

  it('returns every enabled toggle to an unrestricted platform admin', async () => {
    await expect(service.getEnabledKeys(USER_ID)).resolves.toEqual([
      FeatureToggleKey.ANALYTICS,
      FeatureToggleKey.ANALYTICS_AGENT,
      FeatureToggleKey.CONTENT_MANAGEMENT,
    ]);
  });

  it('drops platform-only toggles for an organization-restricted admin', async () => {
    tenantScopeService.isRestricted.mockResolvedValue(true);

    await expect(service.getEnabledKeys(USER_ID)).resolves.toEqual([
      FeatureToggleKey.CONTENT_MANAGEMENT,
    ]);
    await expect(
      service.hasToggle(USER_ID, FeatureToggleKey.ANALYTICS),
    ).resolves.toBe(false);
  });

  it('applies a restriction to already-cached toggles at once', async () => {
    cache.get.mockResolvedValue(JSON.stringify([FeatureToggleKey.ANALYTICS]));
    tenantScopeService.isRestricted.mockResolvedValue(true);

    await expect(service.getEnabledKeys(USER_ID)).resolves.toEqual([]);
  });

  it('skips the restriction lookup when no platform-only toggle is held', async () => {
    toggleRepository.findByUserId.mockResolvedValue([
      { featureKey: FeatureToggleKey.CONTENT_MANAGEMENT, enabled: true },
    ]);

    await service.getEnabledKeys(USER_ID);

    expect(tenantScopeService.isRestricted).not.toHaveBeenCalled();
  });

  it.each([
    FeatureToggleKey.ANALYTICS,
    FeatureToggleKey.ANALYTICS_AGENT,
    FeatureToggleKey.ANALYTICS_SUGGESTIONS,
    FeatureToggleKey.ROLEPLAY_SESSION_LOGS,
    FeatureToggleKey.WHATSAPP_BOT,
    FeatureToggleKey.LOGS,
    FeatureToggleKey.ADMIN_USER_MANAGEMENT,
    FeatureToggleKey.MULTI_TENANT_ALLOWLIST_MANAGEMENT,
    FeatureToggleKey.UX_SIGNALS,
    FeatureToggleKey.KNOWLEDGE_BASE,
  ])('withholds %s from a restricted admin', async (key) => {
    tenantScopeService.isRestricted.mockResolvedValue(true);

    await expect(service.isWithheld(USER_ID, key)).resolves.toBe(true);
  });

  it('never withholds an org-scoped toggle', async () => {
    tenantScopeService.isRestricted.mockResolvedValue(true);

    await expect(
      service.isWithheld(USER_ID, FeatureToggleKey.CONTENT_MANAGEMENT),
    ).resolves.toBe(false);
  });

  it('marks platform-only toggles for the editor', async () => {
    const toggles = await service.getTogglesForUser(USER_ID);

    expect(
      toggles.find((t) => t.key === FeatureToggleKey.ANALYTICS)?.platformOnly,
    ).toBe(true);
    expect(
      toggles.find((t) => t.key === FeatureToggleKey.CONTENT_MANAGEMENT)
        ?.platformOnly,
    ).toBe(false);
  });
});
