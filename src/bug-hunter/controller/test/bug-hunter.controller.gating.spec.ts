import { Reflector } from '@nestjs/core';

import { BugHunterController } from '../bug-hunter.controller';
import { PERMISSIONS_KEY } from 'src/auth/decorators/permissions.decorator';
import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

/**
 * The authorisation split on this controller, asserted as metadata.
 *
 * Three read handlers are gated on VIEW_PRODUCT_ROADMAP so the roadmap's
 * read-only Bugs tab can serve every roadmap viewer; everything else stays on
 * the `bug_hunter` toggle because it writes into repos and other teams'
 * backlogs. That split is currently expressed only in decorators, which no
 * other test in this module exercises — the sibling spec instantiates the
 * controller directly precisely so guards do NOT run.
 *
 * So this suite reads the decorator metadata instead. It is deliberately
 * exhaustive rather than spot-checking the three: an exhaustive assertion is
 * what makes ADDING a handler a decision — a new one with no gate, or with the
 * wrong one, fails here rather than shipping. Widening the read tier was a
 * one-line change; widening a write tier by accident should not be.
 */
describe('BugHunterController — route gating', () => {
  const reflector = new Reflector();

  const prototype = BugHunterController.prototype as unknown as Record<
    string,
    () => unknown
  >;

  /**
   * Every ROUTE handler on the controller.
   *
   * Filtered on Nest's own `path` metadata rather than on "is a function": the
   * prototype also carries `toDto` and `toFindingDetailDto`, which are mapping
   * helpers with no decorators and therefore no gate to assert. Using the route
   * metadata means the list stays honest as helpers come and go, and a handler
   * that loses its @Get/@Post drops out visibly rather than silently passing.
   */
  const handlers = Object.getOwnPropertyNames(BugHunterController.prototype)
    .filter((name) => name !== 'constructor')
    .filter((name) => typeof prototype[name] === 'function')
    .filter((name) => reflector.get('path', prototype[name]) !== undefined);

  const gateOf = (name: string) => {
    const handler = prototype[name];
    return {
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

  /**
   * The exceptions, by handler name. Anything not listed here must be on the
   * toggle — see the loop below.
   */
  const ROADMAP_READ_HANDLERS = [
    'listFindings',
    'getFinding',
    'getFindingByReportedBug',
  ];

  it.each(ROADMAP_READ_HANDLERS)(
    '%s is open to every roadmap viewer, with no toggle of its own',
    (name) => {
      const { permissions, toggle } = gateOf(name);

      expect(permissions?.permissions).toEqual([
        PERMISSIONS.VIEW_PRODUCT_ROADMAP,
      ]);
      // The absence matters as much as the presence: leaving
      // @RequireFeatureToggle on alongside @AuthPermissions would AND the two
      // and quietly restore the gate this change removed.
      expect(toggle).toBeUndefined();
    },
  );

  it('leaves every other handler on the bug_hunter toggle', () => {
    const others = handlers.filter(
      (name) => !ROADMAP_READ_HANDLERS.includes(name),
    );

    // Guards against the list above silently becoming the whole controller,
    // and against the `path` filter matching nothing at all.
    expect(ROADMAP_READ_HANDLERS.every((name) => handlers.includes(name))).toBe(
      true,
    );
    expect(others.length).toBeGreaterThan(0);

    const misgated = others.filter(
      (name) => gateOf(name).toggle?.featureKey !== FeatureToggleKey.BUG_HUNTER,
    );

    expect(misgated).toEqual([]);
  });

  it('grants no roadmap permission to anything that writes', () => {
    const writesWithRoadmapPermission = handlers
      .filter((name) => !ROADMAP_READ_HANDLERS.includes(name))
      .filter((name) =>
        gateOf(name).permissions?.permissions?.includes(
          PERMISSIONS.VIEW_PRODUCT_ROADMAP,
        ),
      );

    expect(writesWithRoadmapPermission).toEqual([]);
  });
});
