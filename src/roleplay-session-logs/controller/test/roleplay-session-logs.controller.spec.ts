import { Reflector } from '@nestjs/core';
import { RoleplaySessionLogsController } from '../roleplay-session-logs.controller';
import { RoleplaySessionLogsService } from '../../service/roleplay-session-logs.service';
import { FEATURE_TOGGLE_KEY } from '../../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../../authorization/constants/admin-feature-toggle.constants';
import { SUPER_ADMIN_ROLES } from '../../../common/constants/user.constants';

describe('RoleplaySessionLogsController', () => {
  let controller: RoleplaySessionLogsController;
  let service: jest.Mocked<RoleplaySessionLogsService>;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getById: jest.fn(),
    } as unknown as jest.Mocked<RoleplaySessionLogsService>;

    controller = new RoleplaySessionLogsController(service);
  });

  it('guards both endpoints with the roleplay session logs feature toggle, with a super-admin legacy fallback', () => {
    const reflector = new Reflector();
    const listOptions = reflector.get(FEATURE_TOGGLE_KEY, controller.list);
    const detailOptions = reflector.get(FEATURE_TOGGLE_KEY, controller.getById);

    expect(listOptions).toEqual({
      featureKey: FeatureToggleKey.ROLEPLAY_SESSION_LOGS,
      legacyRoles: SUPER_ADMIN_ROLES,
    });
    expect(detailOptions).toEqual({
      featureKey: FeatureToggleKey.ROLEPLAY_SESSION_LOGS,
      legacyRoles: SUPER_ADMIN_ROLES,
    });
  });

  it('delegates list to the service', async () => {
    const response = { data: [], total: 0 };
    service.list.mockResolvedValue(response);

    const query = { limit: 10 };
    await expect(controller.list(query)).resolves.toBe(response);
    expect(service.list).toHaveBeenCalledWith(query);
  });

  it('delegates detail lookup to the service', async () => {
    const detail = { id: 'abc' } as any;
    service.getById.mockResolvedValue(detail);

    await expect(controller.getById('abc')).resolves.toBe(detail);
    expect(service.getById).toHaveBeenCalledWith('abc');
  });
});
