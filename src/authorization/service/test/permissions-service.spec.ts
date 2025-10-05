import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from 'src/redis/service/redis.service';
import { GroupService } from 'src/authorization/service/group.service';
import { PermissionsService } from '../permissions.service';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let cache: jest.Mocked<RedisService>;
  let groupService: jest.Mocked<GroupService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: RedisService, useValue: { get: jest.fn(), set: jest.fn() } },
        {
          provide: GroupService,
          useValue: { getUserRolesByUserId: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
    cache = module.get(RedisService);
    groupService = module.get(GroupService);
  });

  describe('getUserRoles', () => {
    it('should return cached roles if available', async () => {
      cache.get.mockResolvedValueOnce(JSON.stringify(['ADMIN', 'USER']));

      const roles = await service.getUserRoles(1);

      expect(roles).toEqual(['ADMIN', 'USER']);
      expect(groupService.getUserRolesByUserId).not.toHaveBeenCalled();
    });

    it('should fetch roles from groupService and cache them if not cached', async () => {
      cache.get.mockResolvedValueOnce(null);
      const mockRoles = [{ name: 'ADMIN' }, { name: 'USER' }];
      groupService.getUserRolesByUserId.mockResolvedValueOnce(mockRoles as any);

      const roles = await service.getUserRoles(1);

      expect(roles).toEqual(['ADMIN', 'USER']);
      expect(cache.set).toHaveBeenCalledWith(
        'user:roles:1',
        JSON.stringify(['ADMIN', 'USER']),
      );
      expect(groupService.getUserRolesByUserId).toHaveBeenCalledWith(1);
    });
  });
});
