import { ForbiddenException } from '@nestjs/common';
import { TenantScopeService } from '../tenant-scope.service';
import { PERMISSIONS } from '../../constants/permissions.constants';
import { ExecutionManager } from '../../../common/execution/execution-manager';

describe('TenantScopeService', () => {
  const ALLOWED = 'tenant-allowed';
  const DELETED = 'tenant-deleted';
  const OTHER = 'tenant-other';
  const OWN = 'tenant-own';

  let permissionsService: {
    isMultiTenantAdmin: jest.Mock;
    getUserPermissions: jest.Mock;
  };
  let adminTenantRepository: { find: jest.Mock };
  let tenantRepository: { find: jest.Mock; findOne: jest.Mock };
  let service: TenantScopeService;

  /** A platform admin holding PLATFORM_ADMIN with one admin_tenants row. */
  const asRestrictedPlatformAdmin = () => {
    permissionsService.isMultiTenantAdmin.mockResolvedValue(true);
    permissionsService.getUserPermissions.mockResolvedValue([
      PERMISSIONS.SYSTEM_ACCESS,
    ]);
  };

  beforeEach(() => {
    permissionsService = {
      isMultiTenantAdmin: jest.fn().mockResolvedValue(false),
      getUserPermissions: jest.fn().mockResolvedValue([]),
    };
    adminTenantRepository = {
      find: jest
        .fn()
        .mockResolvedValue([{ tenantId: ALLOWED }, { tenantId: DELETED }]),
    };
    // find() never returns soft-deleted rows, so DELETED is absent here.
    tenantRepository = {
      find: jest.fn().mockResolvedValue([{ id: ALLOWED }]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    service = new TenantScopeService(
      permissionsService as any,
      adminTenantRepository as any,
      tenantRepository as any,
    );
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('42');
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(OWN);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('resolveScope', () => {
    it('confines a restricted platform admin to their live allowlisted tenants', async () => {
      asRestrictedPlatformAdmin();

      await expect(service.resolveScope()).resolves.toEqual({
        tenantIds: [ALLOWED],
        restricted: true,
      });
      expect(adminTenantRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 42 }),
        }),
      );
    });

    it('reaches nothing — not everything — once every allowlisted tenant is deleted', async () => {
      asRestrictedPlatformAdmin();
      tenantRepository.find.mockResolvedValue([]);

      await expect(service.resolveScope()).resolves.toEqual({
        tenantIds: [],
        restricted: true,
      });
    });

    it('leaves an unrestricted SYSTEM_ACCESS holder platform-wide', async () => {
      permissionsService.getUserPermissions.mockResolvedValue([
        PERMISSIONS.SYSTEM_ACCESS,
      ]);

      await expect(service.resolveScope()).resolves.toEqual({
        tenantIds: null,
        restricted: false,
      });
    });

    it('pins anyone else to their own JWT tenant', async () => {
      await expect(service.resolveScope()).resolves.toEqual({
        tenantIds: [OWN],
        restricted: false,
      });
    });

    it('gives a caller with no JWT tenant nothing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.resolveTenantIds()).resolves.toEqual([]);
    });
  });

  describe('assertTenantInScope', () => {
    it('passes an unrestricted platform admin for any tenant', async () => {
      permissionsService.getUserPermissions.mockResolvedValue([
        PERMISSIONS.SYSTEM_ACCESS,
      ]);

      await expect(service.assertTenantInScope(OTHER)).resolves.toBeUndefined();
    });

    it('passes a restricted admin for an allowlisted tenant id', async () => {
      asRestrictedPlatformAdmin();

      await expect(
        service.assertTenantInScope(ALLOWED),
      ).resolves.toBeUndefined();
    });

    it('passes a restricted admin naming an allowlisted tenant by code', async () => {
      asRestrictedPlatformAdmin();
      tenantRepository.findOne.mockResolvedValue({ id: ALLOWED });

      await expect(
        service.assertTenantInScope('allowed-code'),
      ).resolves.toBeUndefined();
      expect(tenantRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: 'allowed-code' } }),
      );
    });

    it('refuses a restricted admin for a tenant off the allowlist', async () => {
      asRestrictedPlatformAdmin();
      tenantRepository.findOne.mockResolvedValue({ id: OTHER });

      await expect(service.assertTenantInScope(OTHER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a restricted admin for a tenant deleted since it was granted', async () => {
      asRestrictedPlatformAdmin();

      await expect(service.assertTenantInScope(DELETED)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('uses the caller-supplied refusal message', async () => {
      asRestrictedPlatformAdmin();

      await expect(
        service.assertTenantInScope(OTHER, { message: 'Not yours' }),
      ).rejects.toThrow('Not yours');
    });
  });
});
