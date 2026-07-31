import { Reflector } from '@nestjs/core';
import { RoleplaySessionLogsController } from '../roleplay-session-logs.controller';
import { RoleplaySessionLogsService } from '../../service/roleplay-session-logs.service';
import { ROLES_KEY } from '../../../auth/decorators/roles.decorator';
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

  it('guards both endpoints with the super-admin roles', () => {
    const reflector = new Reflector();
    const listRoles = reflector.get(ROLES_KEY, controller.list);
    const detailRoles = reflector.get(ROLES_KEY, controller.getById);

    expect(listRoles).toEqual(SUPER_ADMIN_ROLES);
    expect(detailRoles).toEqual(SUPER_ADMIN_ROLES);
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
