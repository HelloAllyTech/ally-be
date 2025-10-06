import { Test, TestingModule } from '@nestjs/testing';
import { AuthorizationController } from '../authorization.controller';
import { PermissionsService } from '../../service/permissions.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ExecutionContext } from '@nestjs/common';

describe('AuthorizationController', () => {
  let controller: AuthorizationController;
  let permissionsService: jest.Mocked<PermissionsService>;

  const mockPermissions = [
    'user.read',
    'user.write',
    'chat.read',
    'chat.write',
  ];

  const mockRequest = {
    user: {
      id: '123',
      email: 'test@example.com',
      role: 'admin',
    },
  };

  beforeEach(async () => {
    const mockPermissionsService = {
      getUserPermissions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthorizationController],
      providers: [
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          request.user = mockRequest.user;
          return true;
        },
      })
      .compile();

    controller = module.get<AuthorizationController>(AuthorizationController);
    permissionsService = module.get(PermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPermissions', () => {
    it('should return user permissions successfully', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      const result = await controller.getPermissions(mockRequest);

      expect(result).toEqual(mockPermissions);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledTimes(1);
    });

    it('should parse string user id to integer', async () => {
      const request = {
        user: {
          id: '456',
        },
      };

      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await controller.getPermissions(request);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(456);
    });

    it('should return empty array when user has no permissions', async () => {
      permissionsService.getUserPermissions.mockResolvedValue([]);

      const result = await controller.getPermissions(mockRequest);

      expect(result).toEqual([]);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
    });

    it('should handle large user id numbers', async () => {
      const request = {
        user: {
          id: '999999999',
        },
      };

      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await controller.getPermissions(request);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(
        999999999,
      );
    });

    it('should propagate errors from permissions service', async () => {
      const error = new Error('Database connection failed');
      permissionsService.getUserPermissions.mockRejectedValue(error);

      await expect(controller.getPermissions(mockRequest)).rejects.toThrow(
        'Database connection failed',
      );
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
    });

    it('should handle permission service returning null', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(null as any);

      const result = await controller.getPermissions(mockRequest);

      expect(result).toBeNull();
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
    });

    it('should handle permission service returning undefined', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(undefined as any);

      const result = await controller.getPermissions(mockRequest);

      expect(result).toBeUndefined();
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
    });

    it('should handle different permission arrays', async () => {
      const customPermissions = ['admin.full', 'system.manage'];
      permissionsService.getUserPermissions.mockResolvedValue(
        customPermissions,
      );

      const result = await controller.getPermissions(mockRequest);

      expect(result).toEqual(customPermissions);
      expect(result).toHaveLength(2);
    });

    it('should handle numeric string conversion edge cases', async () => {
      const request = {
        user: {
          id: '0',
        },
      };

      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await controller.getPermissions(request);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(0);
    });

    it('should call service only once per request', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await controller.getPermissions(mockRequest);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledTimes(1);
    });
  });

  describe('Controller metadata', () => {
    it('should have correct route path', () => {
      const metadata = Reflect.getMetadata('path', AuthorizationController);
      expect(metadata).toBe('v1/authorization');
    });

    it('should have JwtAuthGuard applied to getPermissions', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        controller.getPermissions,
      );
      expect(guards).toBeDefined();
    });

    it('should be decorated with ApiTags', () => {
      const tags = Reflect.getMetadata(
        'swagger/apiUseTags',
        AuthorizationController,
      );
      expect(tags).toEqual(['Authorization']);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle rapid successive calls', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      const promises = [
        controller.getPermissions(mockRequest),
        controller.getPermissions(mockRequest),
        controller.getPermissions(mockRequest),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toEqual(mockPermissions);
      });
      expect(permissionsService.getUserPermissions).toHaveBeenCalledTimes(3);
    });

    it('should handle different user ids in parallel', async () => {
      const request1 = { user: { id: '100' } };
      const request2 = { user: { id: '200' } };
      const request3 = { user: { id: '300' } };

      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await Promise.all([
        controller.getPermissions(request1),
        controller.getPermissions(request2),
        controller.getPermissions(request3),
      ]);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(100);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(200);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(300);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledTimes(3);
    });

    it('should maintain correct behavior with service timeout', async () => {
      jest.setTimeout(10000);

      permissionsService.getUserPermissions.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(mockPermissions), 100),
          ),
      );

      const result = await controller.getPermissions(mockRequest);

      expect(result).toEqual(mockPermissions);
    });
  });
});
