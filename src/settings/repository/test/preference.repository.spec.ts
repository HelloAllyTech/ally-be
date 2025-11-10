import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { PreferenceRepository } from '../preference.repository';
import { Preference } from '../../entity/preference.entity';
import { PreferenceName } from '../../../common/constants/user.constants';

describe('PreferenceRepository', () => {
  let repository: PreferenceRepository;
  let entityManager: jest.Mocked<EntityManager>;

  const mockPreference: Preference = {
    id: 'pref-id-123',
    name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
    relatedId: 'tenant-123',
    relatedEntity: 'Tenant',
    value: { fields: ['field1', 'field2'] },
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
  } as Preference;

  beforeEach(async () => {
    const mockRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as any;

    const mockEntityManager = {
      getRepository: jest.fn().mockReturnValue(mockRepository),
    } as any;

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
      getRepository: jest.fn().mockReturnValue(mockRepository),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferenceRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<PreferenceRepository>(PreferenceRepository);
    entityManager = mockEntityManager;

    // Spy on inherited Repository methods
    jest.spyOn(repository, 'save');
    jest.spyOn(repository, 'findOne');
    jest.spyOn(repository, 'update');
    jest.spyOn(repository, 'delete');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPreference', () => {
    it('should create and save a new preference', async () => {
      const preferenceData = {
        name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
        relatedId: 'tenant-123',
        relatedEntity: 'Tenant',
        value: { fields: ['field1', 'field2'] },
      };

      jest.spyOn(repository, 'save').mockResolvedValue(mockPreference);

      const result = await repository.createPreference(preferenceData);

      expect(repository.save).toHaveBeenCalledWith(preferenceData);
      expect(result).toEqual(mockPreference);
    });

    it('should use entity manager if provided', async () => {
      const preferenceData = {
        name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
        relatedId: 'tenant-123',
        relatedEntity: 'Tenant',
        value: { fields: ['field1', 'field2'] },
      };

      const emRepository = {
        save: jest.fn().mockResolvedValue(mockPreference),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.createPreference(
        preferenceData,
        entityManager,
      );

      expect(entityManager.getRepository).toHaveBeenCalledWith(Preference);
      expect(emRepository.save).toHaveBeenCalledWith(preferenceData);
      expect(result).toEqual(mockPreference);
    });
  });

  describe('findPreference', () => {
    it('should find preference by name, relatedId, and relatedEntity', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockPreference);

      const result = await repository.findPreference(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        'tenant-123',
        'Tenant',
      );

      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
          relatedId: 'tenant-123',
          relatedEntity: 'Tenant',
        },
      });
      expect(result).toEqual(mockPreference);
    });

    it('should return null when preference not found', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      const result = await repository.findPreference(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        'non-existent',
        'Tenant',
      );

      expect(result).toBeNull();
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        findOne: jest.fn().mockResolvedValue(mockPreference),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.findPreference(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        'tenant-123',
        'Tenant',
        entityManager,
      );

      expect(entityManager.getRepository).toHaveBeenCalledWith(Preference);
      expect(emRepository.findOne).toHaveBeenCalledWith({
        where: {
          name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
          relatedId: 'tenant-123',
          relatedEntity: 'Tenant',
        },
      });
      expect(result).toEqual(mockPreference);
    });
  });

  describe('findPreferenceById', () => {
    it('should find preference by id', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockPreference);

      const result = await repository.findPreferenceById('pref-id-123');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'pref-id-123' },
      });
      expect(result).toEqual(mockPreference);
    });

    it('should return null when preference not found', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      const result = await repository.findPreferenceById('non-existent');

      expect(result).toBeNull();
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        findOne: jest.fn().mockResolvedValue(mockPreference),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.findPreferenceById(
        'pref-id-123',
        entityManager,
      );

      expect(entityManager.getRepository).toHaveBeenCalledWith(Preference);
      expect(emRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'pref-id-123' },
      });
      expect(result).toEqual(mockPreference);
    });
  });

  describe('updatePreference', () => {
    it('should update preference', async () => {
      const newValue = { fields: ['field3'] };
      jest.spyOn(repository, 'update').mockResolvedValue({} as any);

      await repository.updatePreference('pref-id-123', newValue);

      expect(repository.update).toHaveBeenCalledWith('pref-id-123', {
        value: newValue,
      });
    });

    it('should use entity manager if provided', async () => {
      const newValue = { fields: ['field3'] };
      const emRepository = {
        update: jest.fn().mockResolvedValue({}),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      await repository.updatePreference('pref-id-123', newValue, entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(Preference);
      expect(emRepository.update).toHaveBeenCalledWith('pref-id-123', {
        value: newValue,
      });
    });
  });

  describe('deletePreference', () => {
    it('should delete preference', async () => {
      jest.spyOn(repository, 'delete').mockResolvedValue({} as any);

      await repository.deletePreference('pref-id-123');

      expect(repository.delete).toHaveBeenCalledWith('pref-id-123');
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        delete: jest.fn().mockResolvedValue({}),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      await repository.deletePreference('pref-id-123', entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(Preference);
      expect(emRepository.delete).toHaveBeenCalledWith('pref-id-123');
    });
  });
});
