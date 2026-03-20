import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { In } from 'typeorm';
import { ScenarioCharacterService } from '../scenario-character.service';
import { ScenarioCharacterRepository } from '../../repository/scenario-character.repository';
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
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

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
      ],
    }).compile();

    service = module.get<ScenarioCharacterService>(ScenarioCharacterService);
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
      });
      expect(res).toEqual(result);
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
        createdBy: 42,
        updatedBy: 42,
      });
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(res).toEqual(created);
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
  });
});
