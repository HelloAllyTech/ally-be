import { UnauthorizedException } from '@nestjs/common';
import { CharacterLibraryAccessService } from '../character-library-access.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';

describe('CharacterLibraryAccessService', () => {
  let permissionValidator: { validatePermissions: jest.Mock };
  let tenantScopeService: { resolveScope: jest.Mock };
  let service: CharacterLibraryAccessService;

  beforeEach(() => {
    permissionValidator = { validatePermissions: jest.fn() };
    tenantScopeService = {
      resolveScope: jest
        .fn()
        .mockResolvedValue({ tenantIds: null, restricted: false }),
    };
    service = new CharacterLibraryAccessService(
      permissionValidator as any,
      tenantScopeService as any,
    );
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('42');
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('own-org');
  });

  afterEach(() => jest.restoreAllMocks());

  it('gives an unrestricted platform admin the whole library', async () => {
    permissionValidator.validatePermissions.mockResolvedValue(true);

    await expect(service.resolveScope()).resolves.toEqual({
      isPlatform: true,
      tenantId: null,
      restrictedToTenantIds: null,
    });
  });

  it('narrows an organization-restricted platform admin to their orgs', async () => {
    permissionValidator.validatePermissions.mockResolvedValue(true);
    tenantScopeService.resolveScope.mockResolvedValue({
      tenantIds: ['org-a'],
      restricted: true,
    });

    await expect(service.resolveScope()).resolves.toEqual({
      isPlatform: true,
      tenantId: null,
      restrictedToTenantIds: ['org-a'],
    });
    expect(tenantScopeService.resolveScope).toHaveBeenCalledWith(42);
  });

  it('pins a tenant caller to their own org', async () => {
    permissionValidator.validatePermissions.mockResolvedValue(false);

    await expect(service.resolveScope()).resolves.toEqual({
      isPlatform: false,
      tenantId: 'own-org',
      restrictedToTenantIds: null,
    });
  });

  it('refuses a caller with no identity', async () => {
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

    await expect(service.resolveScope()).rejects.toThrow(UnauthorizedException);
  });
});
