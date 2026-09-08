import { CompetencyController } from '../competency.controller';
import { CompetencyClusterController } from '../competency-cluster.controller';
import { PERMISSIONS_KEY } from 'src/auth/decorators/permissions.decorator';
import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';

/**
 * Managing clusters is the same job as managing competencies: whoever can
 * create and edit competencies can group them. That was a product decision,
 * not an accident of how the controller was written — so it is asserted here
 * rather than left to whoever next touches a decorator.
 *
 * Reads the guard metadata off each handler instead of booting Nest, so it
 * fails on the decorator itself the moment the two drift apart.
 */
describe('competency cluster permissions', () => {
  const gatesOf = (controller: new (...args: never[]) => object) => {
    const prototype = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = prototype[name] as object;
        return {
          handler: `${controller.name}.${name}`,
          permissions: Reflect.getMetadata(PERMISSIONS_KEY, handler),
          featureToggle: Reflect.getMetadata(FEATURE_TOGGLE_KEY, handler),
        };
      });
  };

  const competencyGates = gatesOf(CompetencyController);
  const clusterGates = gatesOf(CompetencyClusterController);

  it('gates every cluster endpoint exactly like the competency endpoints', () => {
    // Both controllers are fully decorated — an undecorated handler would be
    // publicly reachable, so an empty gate is a failure, not a pass.
    expect(clusterGates.length).toBeGreaterThan(0);
    expect(competencyGates.length).toBeGreaterThan(0);

    const [reference] = competencyGates;
    expect(reference.permissions).toBeDefined();
    expect(reference.featureToggle).toBeDefined();

    for (const gate of [...competencyGates, ...clusterGates]) {
      expect({
        handler: gate.handler,
        permissions: gate.permissions,
        featureToggle: gate.featureToggle,
      }).toEqual({
        handler: gate.handler,
        permissions: reference.permissions,
        featureToggle: reference.featureToggle,
      });
    }
  });
});
