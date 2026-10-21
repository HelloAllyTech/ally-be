import { Reflector } from '@nestjs/core';

import { RoadmapOpportunityController } from '../roadmap-opportunity.controller';
import { PERMISSIONS_KEY } from 'src/auth/decorators/permissions.decorator';
import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

/**
 * The two filing doors, asserted as decorator metadata (the pattern of
 * bug-hunter.controller.gating.spec.ts: the service specs instantiate things
 * directly, so guards never run there, and the split lives only in decorators).
 *
 * `create` is the interview's door and sits on the VOTE tier with no toggle.
 * `quickAdd` skips the readiness gate, so it must sit behind the
 * `product_roadmap_quick_add` toggle as well — a quick-add handler that loses
 * its toggle would let every voter file unchecked, which is the bypass the
 * gate exists to close.
 */
describe('RoadmapOpportunityController — filing route gating', () => {
  const reflector = new Reflector();
  const prototype = RoadmapOpportunityController.prototype as unknown as Record<
    string,
    () => unknown
  >;

  const gateOf = (name: string) => {
    const handler = prototype[name];
    return {
      path: reflector.get<string>('path', handler),
      permissions: reflector.get<{ permissions: string[]; operator: string }>(
        PERMISSIONS_KEY,
        handler,
      ),
      toggle: reflector.get<{ featureKey: string }>(
        FEATURE_TOGGLE_KEY,
        handler,
      ),
    };
  };

  it('create (the interview) is VOTE-tier with no toggle', () => {
    const { path, permissions, toggle } = gateOf('create');
    expect(path).toBe('opportunities');
    expect(permissions?.permissions).toEqual([
      PERMISSIONS.VOTE_PRODUCT_ROADMAP,
    ]);
    expect(toggle).toBeUndefined();
  });

  it('quickAdd is VOTE-tier AND behind the quick-add toggle', () => {
    const { path, permissions, toggle } = gateOf('quickAdd');
    expect(path).toBe('opportunities/quick');
    expect(permissions?.permissions).toEqual([
      PERMISSIONS.VOTE_PRODUCT_ROADMAP,
    ]);
    expect(toggle?.featureKey).toBe(FeatureToggleKey.PRODUCT_ROADMAP_QUICK_ADD);
  });

  it('quickAdd does not share the manage toggle', () => {
    // Quick add is a filing shortcut, not board curation: the manage toggle
    // was reset to one account on 2026-10-01 precisely because it had been
    // carrying unrelated grants.
    expect(gateOf('quickAdd').toggle?.featureKey).not.toBe(
      FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
    );
  });
});
