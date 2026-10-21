import { FeatureToggleService } from '../feature-toggle.service';
import { FeatureToggleKey } from '../../constants/admin-feature-toggle.constants';

describe('FeatureToggleService — toggles for organization-restricted admins', () => {
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

  it('drops platform-only toggles for an organization-restricted admin, keeping org-scoped Analytics', async () => {
    tenantScopeService.isRestricted.mockResolvedValue(true);

    await expect(service.getEnabledKeys(USER_ID)).resolves.toEqual([
      FeatureToggleKey.ANALYTICS,
      FeatureToggleKey.CONTENT_MANAGEMENT,
    ]);
    await expect(
      service.hasToggle(USER_ID, FeatureToggleKey.ANALYTICS_AGENT),
    ).resolves.toBe(false);
  });

  it('applies a restriction to already-cached toggles at once', async () => {
    cache.get.mockResolvedValue(
      JSON.stringify([FeatureToggleKey.ANALYTICS_AGENT]),
    );
    tenantScopeService.isRestricted.mockResolvedValue(true);

    await expect(service.getEnabledKeys(USER_ID)).resolves.toEqual([]);
  });

  it('limits a restricted admin to the org-scoped routes of Analytics only', async () => {
    tenantScopeService.isRestricted.mockResolvedValue(true);

    await expect(
      service.isLimitedToOrgScopedRoutes(USER_ID, FeatureToggleKey.ANALYTICS),
    ).resolves.toBe(true);
    await expect(
      service.isLimitedToOrgScopedRoutes(
        USER_ID,
        FeatureToggleKey.CONTENT_MANAGEMENT,
      ),
    ).resolves.toBe(false);

    tenantScopeService.isRestricted.mockResolvedValue(false);
    await expect(
      service.isLimitedToOrgScopedRoutes(USER_ID, FeatureToggleKey.ANALYTICS),
    ).resolves.toBe(false);
  });

  it('skips the restriction lookup when no platform-only toggle is held', async () => {
    toggleRepository.findByUserId.mockResolvedValue([
      { featureKey: FeatureToggleKey.CONTENT_MANAGEMENT, enabled: true },
    ]);

    await service.getEnabledKeys(USER_ID);

    expect(tenantScopeService.isRestricted).not.toHaveBeenCalled();
  });

  it.each([
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

  it.each([FeatureToggleKey.CONTENT_MANAGEMENT, FeatureToggleKey.ANALYTICS])(
    'never withholds %s, which can be scoped to an organization',
    async (key) => {
      tenantScopeService.isRestricted.mockResolvedValue(true);

      await expect(service.isWithheld(USER_ID, key)).resolves.toBe(false);
    },
  );

  it('marks platform-only toggles for the editor', async () => {
    const toggles = await service.getTogglesForUser(USER_ID);

    expect(
      toggles.find((t) => t.key === FeatureToggleKey.ANALYTICS_AGENT)
        ?.platformOnly,
    ).toBe(true);
    expect(
      toggles.find((t) => t.key === FeatureToggleKey.ANALYTICS),
    ).toMatchObject({ platformOnly: false, orgScopedRoutesOnly: true });
    expect(
      toggles.find((t) => t.key === FeatureToggleKey.CONTENT_MANAGEMENT)
        ?.platformOnly,
    ).toBe(false);
  });
});
