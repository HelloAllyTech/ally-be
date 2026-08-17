import { ForbiddenException } from '@nestjs/common';
import { CharacterInterviewSessionService } from '../character-interview-session.service';
import { CharacterInterviewSessionStatus } from '../../enum/character-interview.enum';
import {
  CHARACTER_INTERVIEW_MAX_ACTIVE_SESSIONS_PER_TENANT,
  CHARACTER_INTERVIEW_MAX_SESSIONS_PER_TENANT_PER_MONTH,
} from '../../constants/character-interview.constants';

describe('CharacterInterviewSessionService', () => {
  let service: CharacterInterviewSessionService;
  let sessionRepository: {
    save: jest.Mock;
    create: jest.Mock;
    count: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let accessService: { resolveScope: jest.Mock };

  const asPlatform = () =>
    accessService.resolveScope.mockResolvedValue({
      isPlatform: true,
      tenantId: null,
    });
  const asTenant = (tenantId = 'tenant-a') =>
    accessService.resolveScope.mockResolvedValue({
      isPlatform: false,
      tenantId,
    });

  beforeEach(() => {
    sessionRepository = {
      save: jest.fn(async (s) => s),
      create: jest.fn((s) => s),
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    accessService = { resolveScope: jest.fn() };
    asPlatform();

    service = new CharacterInterviewSessionService(
      sessionRepository as any,
      {} as any,
      accessService as any,
    );
  });

  describe('createSession', () => {
    it('stamps the tenant on a tenant caller session', async () => {
      asTenant();

      await service.createSession(7);

      expect(sessionRepository.create).toHaveBeenCalledWith({
        tenantId: 'tenant-a',
        createdBy: 7,
        updatedBy: 7,
      });
    });

    it('leaves the tenant null for a platform caller and skips the caps', async () => {
      await service.createSession(1);

      expect(sessionRepository.create).toHaveBeenCalledWith({
        tenantId: null,
        createdBy: 1,
        updatedBy: 1,
      });
      expect(sessionRepository.count).not.toHaveBeenCalled();
    });

    it('refuses once the org is at the concurrent-session cap', async () => {
      asTenant();
      sessionRepository.count.mockResolvedValue(
        CHARACTER_INTERVIEW_MAX_ACTIVE_SESSIONS_PER_TENANT,
      );

      await expect(service.createSession(7)).rejects.toThrow(
        ForbiddenException,
      );
      // The message has to say what to do about it, not just that it failed.
      await expect(service.createSession(7)).rejects.toThrow(
        /Finish or discard one/,
      );
      expect(sessionRepository.save).not.toHaveBeenCalled();
    });

    it('counts only ACTIVE sessions toward the concurrent cap', async () => {
      asTenant();

      await service.createSession(7);

      expect(sessionRepository.count).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-a',
          status: CharacterInterviewSessionStatus.ACTIVE,
        },
      });
    });

    it('refuses once the org is at the monthly cap', async () => {
      asTenant();
      sessionRepository.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(
          CHARACTER_INTERVIEW_MAX_SESSIONS_PER_TENANT_PER_MONTH,
        );

      await expect(service.createSession(7)).rejects.toThrow(
        /reached its limit of/,
      );
      expect(sessionRepository.save).not.toHaveBeenCalled();
    });

    it('allows a tenant caller under both caps', async () => {
      asTenant();
      sessionRepository.count.mockResolvedValue(1);

      await expect(service.createSession(7)).resolves.toBeDefined();
      expect(sessionRepository.save).toHaveBeenCalled();
    });
  });
});
