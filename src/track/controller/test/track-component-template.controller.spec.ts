import { Reflector } from '@nestjs/core';
import { TrackComponentTemplateController } from '../track-component-template.controller';
import { TrackComponentTemplateService } from '../../service/track-component-template.service';
import { FEATURE_TOGGLE_KEY } from '../../../auth/decorators/feature-toggle.decorator';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { FeatureToggleKey } from '../../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { TrackItemType } from '../../type/track.type';

describe('TrackComponentTemplateController', () => {
  let controller: TrackComponentTemplateController;
  let service: jest.Mocked<TrackComponentTemplateService>;
  const reflector = new Reflector();

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      bulkDelete: jest.fn(),
    } as unknown as jest.Mocked<TrackComponentTemplateService>;

    controller = new TrackComponentTemplateController(service);
  });

  /**
   * Every route sits behind @RequireFeatureToggle(COMPONENT_LIBRARY, { permissions }).
   * The actual pass/fail behaviour of a missing toggle or a missing permission
   * is guard-level and already covered generically by
   * feature-toggle.guard.spec.ts / permissions.guard.spec.ts — what a
   * controller spec should pin down is that each route is wired to the right
   * key and the right permission, since a wiring mistake here (wrong key,
   * wrong permission, or a route left ungated) would 403 the wrong people or
   * nobody at all without any guard test ever catching it.
   */
  describe('feature toggle + permission wiring', () => {
    it('gates list (GET) with COMPONENT_LIBRARY + VIEW_ADMIN_TRACK', () => {
      expect(reflector.get(FEATURE_TOGGLE_KEY, controller.list)).toEqual({
        featureKey: FeatureToggleKey.COMPONENT_LIBRARY,
        tenantPreference: undefined,
      });
      expect(reflector.get(PERMISSIONS_KEY, controller.list)).toEqual({
        permissions: [PERMISSIONS.VIEW_ADMIN_TRACK],
        operator: 'AND',
      });
    });

    it('gates getById (GET :id) with COMPONENT_LIBRARY + VIEW_ADMIN_TRACK', () => {
      expect(reflector.get(FEATURE_TOGGLE_KEY, controller.getById)).toEqual({
        featureKey: FeatureToggleKey.COMPONENT_LIBRARY,
        tenantPreference: undefined,
      });
      expect(reflector.get(PERMISSIONS_KEY, controller.getById)).toEqual({
        permissions: [PERMISSIONS.VIEW_ADMIN_TRACK],
        operator: 'AND',
      });
    });

    it('gates create (POST) with COMPONENT_LIBRARY + EDIT_ADMIN_TRACK', () => {
      expect(reflector.get(FEATURE_TOGGLE_KEY, controller.create)).toEqual({
        featureKey: FeatureToggleKey.COMPONENT_LIBRARY,
        tenantPreference: undefined,
      });
      expect(reflector.get(PERMISSIONS_KEY, controller.create)).toEqual({
        permissions: [PERMISSIONS.EDIT_ADMIN_TRACK],
        operator: 'AND',
      });
    });

    it('gates update (PUT :id) with COMPONENT_LIBRARY + EDIT_ADMIN_TRACK', () => {
      expect(reflector.get(FEATURE_TOGGLE_KEY, controller.update)).toEqual({
        featureKey: FeatureToggleKey.COMPONENT_LIBRARY,
        tenantPreference: undefined,
      });
      expect(reflector.get(PERMISSIONS_KEY, controller.update)).toEqual({
        permissions: [PERMISSIONS.EDIT_ADMIN_TRACK],
        operator: 'AND',
      });
    });

    it('gates bulkDelete (DELETE) with COMPONENT_LIBRARY + DELETE_ADMIN_TRACK', () => {
      expect(reflector.get(FEATURE_TOGGLE_KEY, controller.bulkDelete)).toEqual({
        featureKey: FeatureToggleKey.COMPONENT_LIBRARY,
        tenantPreference: undefined,
      });
      expect(reflector.get(PERMISSIONS_KEY, controller.bulkDelete)).toEqual({
        permissions: [PERMISSIONS.DELETE_ADMIN_TRACK],
        operator: 'AND',
      });
    });

    it('gates delete (DELETE :id) with COMPONENT_LIBRARY + DELETE_ADMIN_TRACK', () => {
      expect(reflector.get(FEATURE_TOGGLE_KEY, controller.delete)).toEqual({
        featureKey: FeatureToggleKey.COMPONENT_LIBRARY,
        tenantPreference: undefined,
      });
      expect(reflector.get(PERMISSIONS_KEY, controller.delete)).toEqual({
        permissions: [PERMISSIONS.DELETE_ADMIN_TRACK],
        operator: 'AND',
      });
    });

    // No @RequireFeatureToggle call in this file passes tenantPreference — this
    // surface has no org-level toggle, only the per-user one. If a future edit
    // adds one by accident, every assertion above (tenantPreference: undefined)
    // already catches it.
  });

  describe('delegation to the service', () => {
    it('list forwards query params', async () => {
      const response = { items: [], total: 0 };
      service.list.mockResolvedValue(response);

      const result = await controller.list(TrackItemType.QUIZ, 'search', 10, 5);

      expect(service.list).toHaveBeenCalledWith({
        type: TrackItemType.QUIZ,
        search: 'search',
        limit: 10,
        offset: 5,
      });
      expect(result).toBe(response);
    });

    it('getById forwards the id', async () => {
      const template = { id: 'abc' } as any;
      service.getById.mockResolvedValue(template);

      await expect(controller.getById('abc')).resolves.toBe(template);
      expect(service.getById).toHaveBeenCalledWith('abc');
    });

    it('create forwards the body', async () => {
      const dto = {
        type: TrackItemType.ARTICLE,
        title: 'T',
        content: { html: '<p>hi</p>' },
      };
      const created = { id: 'new-id', ...dto } as any;
      service.create.mockResolvedValue(created);

      await expect(controller.create(dto as any)).resolves.toBe(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('update forwards id and body', async () => {
      const dto = { title: 'Updated' };
      const updated = { id: 'abc', title: 'Updated' } as any;
      service.update.mockResolvedValue(updated);

      await expect(controller.update('abc', dto as any)).resolves.toBe(updated);
      expect(service.update).toHaveBeenCalledWith('abc', dto);
    });

    it('bulkDelete forwards ids', async () => {
      service.bulkDelete.mockResolvedValue({ success: true });

      await expect(controller.bulkDelete({ ids: ['a', 'b'] })).resolves.toEqual(
        { success: true },
      );
      expect(service.bulkDelete).toHaveBeenCalledWith(['a', 'b']);
    });

    it('delete forwards the id', async () => {
      service.delete.mockResolvedValue({ success: true });

      await expect(controller.delete('abc')).resolves.toEqual({
        success: true,
      });
      expect(service.delete).toHaveBeenCalledWith('abc');
    });
  });
});
