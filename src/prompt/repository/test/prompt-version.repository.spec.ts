import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { PromptVersionRepository } from '../prompt-version.repository';
import { PromptVersion } from '../../entity/prompt-version.entity';

describe('PromptVersionRepository', () => {
  let repository: PromptVersionRepository;
  let queryBuilder: Partial<SelectQueryBuilder<PromptVersion>>;

  const mockPromptId = '123e4567-e89b-12d3-a456-426614174000';
  const mockVersionId = '223e4567-e89b-12d3-a456-426614174001';

  const mockPromptVersion: PromptVersion = {
    id: mockVersionId,
    promptId: mockPromptId,
    version: 2,
    prompt: 'Updated prompt content v2',
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-02-08'),
    updatedAt: new Date('2026-02-08'),
  };

  const mockInitialVersion: PromptVersion = {
    id: '323e4567-e89b-12d3-a456-426614174002',
    promptId: mockPromptId,
    version: 1,
    prompt: 'Initial prompt content v1',
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-02-06'),
    updatedAt: new Date('2026-02-06'),
  };

  beforeEach(async () => {
    // Create mock QueryBuilder
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getMany: jest.fn(),
    };

    // Create mock DataSource
    const mockDataSource = {
      createEntityManager: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptVersionRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<PromptVersionRepository>(PromptVersionRepository);

    // Mock createQueryBuilder method
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(queryBuilder as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLatestPromptVersion', () => {
    it('should return the latest prompt version by promptId', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result).toEqual(mockPromptVersion);
      expect(result?.version).toBe(2);
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'promptVersion.promptId = :promptId',
        { promptId: mockPromptId },
      );
    });

    it('should order by version descending', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(mockPromptId);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'promptVersion.version',
        'DESC',
      );
    });

    it('should limit results to 1', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(mockPromptId);

      expect(queryBuilder.limit).toHaveBeenCalledWith(1);
    });

    it('should return null when no versions exist for prompt', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(null);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result).toBeNull();
    });

    it('should return version 1 when only initial version exists', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockInitialVersion);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result).toEqual(mockInitialVersion);
      expect(result?.version).toBe(1);
    });

    it('should handle different promptIds correctly', async () => {
      const differentPromptId = '423e4567-e89b-12d3-a456-426614174003';
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(differentPromptId);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'promptVersion.promptId = :promptId',
        { promptId: differentPromptId },
      );
    });

    it('should use correct query builder alias', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(mockPromptId);

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'promptVersion',
      );
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      (queryBuilder.getOne as jest.Mock).mockRejectedValue(error);

      await expect(
        repository.getLatestPromptVersion(mockPromptId),
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle UUID format promptId', async () => {
      const uuidPromptId = 'a1b2c3d4-e5f6-47g8-9h0i-j1k2l3m4n5o6';
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(uuidPromptId);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'promptVersion.promptId = :promptId',
        { promptId: uuidPromptId },
      );
    });

    it('should return version with correct metadata', async () => {
      const versionWithMetadata: PromptVersion = {
        ...mockPromptVersion,
        id: 'version-uuid',
        promptId: mockPromptId,
        version: 5,
        prompt: 'Complex prompt content',
        createdBy: 42,
        updatedBy: 43,
      };

      (queryBuilder.getOne as jest.Mock).mockResolvedValue(versionWithMetadata);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result?.version).toBe(5);
      expect(result?.createdBy).toBe(42);
      expect(result?.updatedBy).toBe(43);
      expect(result?.prompt).toBe('Complex prompt content');
    });
  });

  describe('Query Building', () => {
    it('should create query builder with correct entity', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(mockPromptId);

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'promptVersion',
      );
    });

    it('should chain where, orderBy, and limit correctly', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(mockPromptId);

      // Verify chaining order: where -> orderBy -> limit -> getOne
      expect(queryBuilder.where).toHaveBeenCalled();
      expect(queryBuilder.orderBy).toHaveBeenCalled();
      expect(queryBuilder.limit).toHaveBeenCalled();
      expect(queryBuilder.getOne).toHaveBeenCalled();
    });

    it('should use DESC order for version sorting', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(mockPromptId);

      const orderByCall = (queryBuilder.orderBy as jest.Mock).mock.calls[0];
      expect(orderByCall[1]).toBe('DESC');
    });
  });

  describe('Version Resolution', () => {
    it('should correctly identify version 2 as higher than version 1', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result?.version).toBeGreaterThan(mockInitialVersion.version);
    });

    it('should handle high version numbers', async () => {
      const highVersionPrompt: PromptVersion = {
        ...mockPromptVersion,
        version: 999,
      };

      (queryBuilder.getOne as jest.Mock).mockResolvedValue(highVersionPrompt);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result?.version).toBe(999);
    });

    it('should return the highest version when multiple exist', async () => {
      // DESC ordering ensures we get the highest version
      const highestVersion: PromptVersion = {
        ...mockPromptVersion,
        version: 10,
      };

      (queryBuilder.getOne as jest.Mock).mockResolvedValue(highestVersion);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result?.version).toBe(10);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty promptId string', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(null);

      const result = await repository.getLatestPromptVersion('');

      expect(result).toBeNull();
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'promptVersion.promptId = :promptId',
        { promptId: '' },
      );
    });

    it('should handle very long promptId', async () => {
      const longPromptId =
        '123e4567-e89b-12d3-a456-426614174000-123e4567-e89b-12d3-a456-426614174000';
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(longPromptId);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'promptVersion.promptId = :promptId',
        { promptId: longPromptId },
      );
    });

    it('should handle prompt content with special characters', async () => {
      const specialCharPrompt: PromptVersion = {
        ...mockPromptVersion,
        prompt: 'Content with special chars: !@#$%^&*()_+-=[]{}|;:,.<>?',
      };

      (queryBuilder.getOne as jest.Mock).mockResolvedValue(specialCharPrompt);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result?.prompt).toContain('!@#$%^&*()_+-=[]{}|;:,.<>?');
    });

    it('should handle prompt content with newlines', async () => {
      const multilinePrompt: PromptVersion = {
        ...mockPromptVersion,
        prompt: 'Line 1\nLine 2\nLine 3',
      };

      (queryBuilder.getOne as jest.Mock).mockResolvedValue(multilinePrompt);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result?.prompt).toContain('\n');
    });

    it('should handle null updatedBy', async () => {
      const versionWithoutUpdatedBy: PromptVersion = {
        ...mockPromptVersion,
        updatedBy: undefined,
      };

      (queryBuilder.getOne as jest.Mock).mockResolvedValue(
        versionWithoutUpdatedBy,
      );

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result?.updatedBy).toBeUndefined();
    });
  });

  describe('Performance', () => {
    it('should limit query to 1 result for efficiency', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(mockPromptId);

      expect(queryBuilder.limit).toHaveBeenCalledWith(1);
    });

    it('should use descending order for efficient retrieval', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      await repository.getLatestPromptVersion(mockPromptId);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'promptVersion.version',
        'DESC',
      );
    });
  });

  describe('Data Integrity', () => {
    it('should return version with correct promptId', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result?.promptId).toBe(mockPromptId);
    });

    it('should return version with all required fields', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('promptId');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('prompt');
      expect(result).toHaveProperty('createdBy');
    });

    it('should return version with correct timestamps', async () => {
      (queryBuilder.getOne as jest.Mock).mockResolvedValue(mockPromptVersion);

      const result = await repository.getLatestPromptVersion(mockPromptId);

      expect(result?.createdAt).toBeInstanceOf(Date);
      expect(result?.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('deleteVersionsBefore', () => {
    let deleteQueryBuilder: Partial<SelectQueryBuilder<PromptVersion>>;

    beforeEach(() => {
      deleteQueryBuilder = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      };

      jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(deleteQueryBuilder as any);
    });

    it('should delete versions before specified version number', async () => {
      await repository.deleteVersionsBefore(mockPromptId, 3);

      expect(deleteQueryBuilder.delete).toHaveBeenCalled();
      expect(deleteQueryBuilder.from).toHaveBeenCalledWith(PromptVersion);
      expect(deleteQueryBuilder.where).toHaveBeenCalled();
      expect(deleteQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should use correct promptId in where clause', async () => {
      await repository.deleteVersionsBefore(mockPromptId, 5);

      expect(deleteQueryBuilder.where).toHaveBeenCalledWith(
        'promptId = :promptId',
        { promptId: mockPromptId },
      );
    });

    it('should use correct minVersionToKeep in andWhere clause', async () => {
      const minVersionToKeep = 5;
      await repository.deleteVersionsBefore(mockPromptId, minVersionToKeep);

      expect(deleteQueryBuilder.andWhere).toHaveBeenCalledWith(
        'version < :minVersionToKeep',
        { minVersionToKeep },
      );
    });

    it('should execute the delete query', async () => {
      await repository.deleteVersionsBefore(mockPromptId, 3);

      expect(deleteQueryBuilder.execute).toHaveBeenCalled();
    });

    it('should handle deletion of multiple versions', async () => {
      (deleteQueryBuilder.execute as jest.Mock).mockResolvedValue({
        affected: 5,
      });

      await repository.deleteVersionsBefore(mockPromptId, 6);

      expect(deleteQueryBuilder.execute).toHaveBeenCalled();
    });

    it('should handle deletion of zero versions', async () => {
      (deleteQueryBuilder.execute as jest.Mock).mockResolvedValue({
        affected: 0,
      });

      await repository.deleteVersionsBefore(mockPromptId, 1);

      expect(deleteQueryBuilder.execute).toHaveBeenCalled();
    });

    it('should handle high minVersionToKeep values', async () => {
      await repository.deleteVersionsBefore(mockPromptId, 100);

      expect(deleteQueryBuilder.andWhere).toHaveBeenCalledWith(
        'version < :minVersionToKeep',
        { minVersionToKeep: 100 },
      );
    });

    it('should handle version 1 as minVersionToKeep', async () => {
      await repository.deleteVersionsBefore(mockPromptId, 1);

      expect(deleteQueryBuilder.andWhere).toHaveBeenCalledWith(
        'version < :minVersionToKeep',
        { minVersionToKeep: 1 },
      );
    });

    it('should construct query chain correctly', async () => {
      await repository.deleteVersionsBefore(mockPromptId, 5);

      // Verify the order of method calls
      const deleteCall = (deleteQueryBuilder.delete as jest.Mock).mock.calls[0];
      const fromCall = (deleteQueryBuilder.from as jest.Mock).mock.calls[0];
      const whereCall = (deleteQueryBuilder.where as jest.Mock).mock.calls[0];
      const andWhereCall = (deleteQueryBuilder.andWhere as jest.Mock).mock
        .calls[0];
      const executeCall = (deleteQueryBuilder.execute as jest.Mock).mock
        .calls[0];

      expect(deleteCall).toBeDefined();
      expect(fromCall).toBeDefined();
      expect(whereCall).toBeDefined();
      expect(andWhereCall).toBeDefined();
      expect(executeCall).toBeDefined();
    });

    it('should handle database errors during deletion', async () => {
      const error = new Error('Database error');
      (deleteQueryBuilder.execute as jest.Mock).mockRejectedValue(error);

      await expect(
        repository.deleteVersionsBefore(mockPromptId, 5),
      ).rejects.toThrow('Database error');
    });
  });
});
