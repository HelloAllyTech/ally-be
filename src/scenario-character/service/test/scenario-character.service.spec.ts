import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { In } from 'typeorm';
import { ScenarioCharacterService } from '../scenario-character.service';
import { ScenarioCharacterRepository } from '../../repository/scenario-character.repository';
import { CharacterLibraryAccessService } from '../character-library-access.service';
import { ScenarioCharacter } from '../../entity/scenario-character.entity';
import {
  ScenarioCharacterSortBy,
  ScenarioCharacterSortOrder,
} from '../../enum/scenario-character.enum';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { LoggerService } from '../../../logger/logger.service';

jest.mock('../../../common/execution/execution-manager');
jest.mock('../../../logger/logger.service');

describe('ScenarioCharacterService', () => {
  let service: ScenarioCharacterService;

  const now = new Date();
  const mockCharacter = {
    id: 'char-uuid-1',
    name: 'Susan Tom',
    age: 26,
    gender: 'Female',
    profession: 'Software Engineer',
    currentLocation: 'Kerala, Kochi',
    genderIdentity: 'Female/Woman',
    sexualOrientation: 'Heterosexual',
    coverImageUrl: 'https://example.com/cover.png',
    coverVideoUrl: 'https://example.com/cover.mp4',
    characterProfileText: 'Some backstory text',
    createdAt: now,
    updatedAt: now,
    createdBy: 100,
    updatedBy: 100,
  } as ScenarioCharacter;

  const mockRepo = {
    getScenarioCharactersQuery: jest.fn(),
    getCreatorAttribution: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  // Default every test to a platform caller (SYSTEM_ACCESS): sees the whole
  // library, creates Ally-owned characters. Tenant-scoped cases override it.
  const mockAccessService = { resolveScope: jest.fn() };
  const asPlatform = () =>
    mockAccessService.resolveScope.mockResolvedValue({
      isPlatform: true,
      tenantId: null,
    });
  const asTenant = (tenantId: string) =>
    mockAccessService.resolveScope.mockResolvedValue({
      isPlatform: false,
      tenantId,
    });

  beforeEach(async () => {
    jest.resetAllMocks();
    (LoggerService.getInstance as jest.Mock).mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioCharacterService,
        { provide: ScenarioCharacterRepository, useValue: mockRepo },
        {
          provide: CharacterLibraryAccessService,
          useValue: mockAccessService,
        },
      ],
    }).compile();

    service = module.get<ScenarioCharacterService>(ScenarioCharacterService);
    asPlatform();
    mockRepo.getCreatorAttribution.mockResolvedValue({
      usersById: new Map(),
      tenantNamesById: new Map(),
    });
  });

  describe('getScenarioCharacters', () => {
    it('delegates to repository with options and returns characters and count', async () => {
      const options = { limit: 10, offset: 0 };
      const result = { characters: [mockCharacter], count: 1 };
      mockRepo.getScenarioCharactersQuery.mockResolvedValue(result);

      const res = await service.getScenarioCharacters(options);

      expect(mockRepo.getScenarioCharactersQuery).toHaveBeenCalledWith({
        ...options,
        limit: 10,
        offset: 0,
        sortBy: ScenarioCharacterSortBy.CREATED_AT,
        sortOrder: ScenarioCharacterSortOrder.DESC,
        tenantId: null,
      });
      expect(res.count).toBe(1);
      expect(res.characters[0]).toEqual(
        expect.objectContaining({ id: mockCharacter.id }),
      );
    });

    it('scopes the query to the caller tenant and skips owner attribution', async () => {
      asTenant('tenant-a');
      mockRepo.getScenarioCharactersQuery.mockResolvedValue({
        characters: [mockCharacter],
        count: 1,
      });

      const res = await service.getScenarioCharacters({ limit: 10, offset: 0 });

      expect(mockRepo.getScenarioCharactersQuery).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-a' }),
      );
      // "who created this" is platform-only — a tenant sees one org's rows.
      expect(mockRepo.getCreatorAttribution).not.toHaveBeenCalled();
      expect(res.characters).toEqual([mockCharacter]);
    });

    it('decorates a platform caller results with creator and org names', async () => {
      mockRepo.getScenarioCharactersQuery.mockResolvedValue({
        characters: [{ ...mockCharacter, tenantId: 'tenant-a' }],
        count: 1,
      });
      mockRepo.getCreatorAttribution.mockResolvedValue({
        usersById: new Map([[100, 'Riya Nair']]),
        tenantNamesById: new Map([['tenant-a', 'Acme Helpline']]),
      });

      const res = await service.getScenarioCharacters({});

      expect(mockRepo.getCreatorAttribution).toHaveBeenCalledWith(
        [100],
        ['tenant-a'],
      );
      expect(res.characters[0]).toEqual(
        expect.objectContaining({
          createdByName: 'Riya Nair',
          tenantName: 'Acme Helpline',
        }),
      );
    });
  });

  describe('createScenarioCharacter', () => {
    const createDto = {
      name: 'Susan Tom',
      age: 26,
      gender: 'Female',
      profession: 'Software Engineer',
      currentLocation: 'Kerala, Kochi',
      genderIdentity: 'Female/Woman',
      sexualOrientation: 'Heterosexual',
    };

    it('throws UnauthorizedException when getUserId returns undefined', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(undefined);

      await expect(service.createScenarioCharacter(createDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('creates and saves character with createdBy and updatedBy from getUserId', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(42);
      const created = {
        ...mockCharacter,
        ...createDto,
        createdBy: 42,
        updatedBy: 42,
      };
      mockRepo.create.mockReturnValue(created as ScenarioCharacter);
      mockRepo.save.mockResolvedValue(created as ScenarioCharacter);

      const res = await service.createScenarioCharacter(createDto);

      expect(mockRepo.create).toHaveBeenCalledWith({
        ...createDto,
        tenantId: null,
        createdBy: 42,
        updatedBy: 42,
      });
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(res).toEqual(created);
    });

    it("stamps a tenant caller's own tenant on the new character", async () => {
      asTenant('tenant-a');
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(7);
      mockRepo.create.mockReturnValue(mockCharacter as ScenarioCharacter);
      mockRepo.save.mockResolvedValue(mockCharacter as ScenarioCharacter);

      await service.createScenarioCharacter(createDto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-a' }),
      );
    });

    it('returns saved character', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(1);
      mockRepo.create.mockReturnValue(mockCharacter as ScenarioCharacter);
      mockRepo.save.mockResolvedValue(mockCharacter as ScenarioCharacter);

      const res = await service.createScenarioCharacter(createDto);

      expect(res).toEqual(mockCharacter);
    });
  });

  describe('getScenarioCharacterById', () => {
    it('returns character when found', async () => {
      mockRepo.findOne.mockResolvedValue(mockCharacter as ScenarioCharacter);

      const res = await service.getScenarioCharacterById('char-uuid-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'char-uuid-1' },
      });
      expect(res).toEqual(mockCharacter);
    });

    it('throws NotFoundException when character not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getScenarioCharacterById('non-existent'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getScenarioCharacterById('non-existent'),
      ).rejects.toThrow('Scenario character with ID non-existent not found');
    });

    it("403s a tenant caller naming another org's character", async () => {
      asTenant('tenant-a');
      mockRepo.findOne.mockResolvedValue({
        ...mockCharacter,
        tenantId: 'tenant-b',
      } as ScenarioCharacter);

      await expect(
        service.getScenarioCharacterById('char-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('403s a tenant caller naming an Ally-owned global character', async () => {
      asTenant('tenant-a');
      mockRepo.findOne.mockResolvedValue({
        ...mockCharacter,
        tenantId: null,
      } as ScenarioCharacter);

      await expect(
        service.getScenarioCharacterById('char-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateScenarioCharacter', () => {
    it('updates and returns character by id', async () => {
      const updateDto = { age: 27 } as any;
      const updated = { ...mockCharacter, age: 27 };
      mockRepo.update.mockResolvedValue({ affected: 1 } as any);
      mockRepo.findOne.mockResolvedValue(updated as ScenarioCharacter);

      const res = await service.updateScenarioCharacter(
        'char-uuid-1',
        updateDto,
      );

      expect(mockRepo.update).toHaveBeenCalledWith(
        'char-uuid-1',
        expect.objectContaining({ ...updateDto }),
      );
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'char-uuid-1' },
      });
      expect(res).toEqual(updated);
    });

    it('throws NotFoundException when character does not exist', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 } as any);
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateScenarioCharacter('missing-id', {
          name: 'New Name',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteScenarioCharacter', () => {
    it('deletes character and returns success when found', async () => {
      mockRepo.findOne.mockResolvedValue(mockCharacter as ScenarioCharacter);
      mockRepo.delete.mockResolvedValue({ affected: 1 } as any);

      const res = await service.deleteScenarioCharacter('char-uuid-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'char-uuid-1' },
      });
      expect(mockRepo.delete).toHaveBeenCalledWith('char-uuid-1');
      expect(res).toEqual({ success: true });
    });

    it('throws NotFoundException when character not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteScenarioCharacter('non-existent'),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('deleteScenarioCharacters', () => {
    it('returns false when no characters are deleted', async () => {
      const ids = ['non-existent-1', 'non-existent-2'];
      mockRepo.delete.mockResolvedValue({ affected: 0 });

      const res = await service.deleteScenarioCharacters(ids);

      expect(mockRepo.delete).toHaveBeenCalledWith({
        id: In(ids),
      });
      expect(res).toBe(false);
    });

    it('deletes multiple characters and returns true', async () => {
      const ids = ['char-uuid-1', 'char-uuid-2'];
      mockRepo.delete.mockResolvedValue({ affected: 2 });

      const res = await service.deleteScenarioCharacters(ids);
      expect(res).toBe(true);
    });

    it('narrows the bulk delete to the caller tenant', async () => {
      asTenant('tenant-a');
      mockRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteScenarioCharacters(['char-uuid-1']);

      expect(mockRepo.delete).toHaveBeenCalledWith({
        id: In(['char-uuid-1']),
        tenantId: 'tenant-a',
      });
    });
  });
});
