import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { ReferenceDocumentRepository } from '../reference-document.repository';
import {
  DocumentUploadStatus,
  ReferenceDocument,
} from '../../entity/reference-document.entity';

describe('ReferenceDocumentRepository', () => {
  let repository: ReferenceDocumentRepository;
  let entityManager: jest.Mocked<EntityManager>;

  const mockDocument: ReferenceDocument = {
    id: 'doc-id-123',
    heading: 'Test Document',
    content: 'Test Content',
    category: 'Test Category',
    tags: ['tag1', 'tag2'],
    createdBy: 1,
    isPublic: true,
    organizationId: undefined,
    isArchived: false,
    archivedAt: undefined,
    uploadStatus: DocumentUploadStatus.SUCCESS,
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
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
        ReferenceDocumentRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<ReferenceDocumentRepository>(
      ReferenceDocumentRepository,
    );
    entityManager = mockEntityManager;

    // Spy on inherited Repository methods
    jest.spyOn(repository, 'create');
    jest.spyOn(repository, 'save');
    jest.spyOn(repository, 'find');
    jest.spyOn(repository, 'findOneBy');
    jest.spyOn(repository, 'update');
    jest.spyOn(repository, 'delete');
    jest.spyOn(repository, 'createQueryBuilder');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createDocument', () => {
    it('should create and save a new document', async () => {
      const data = {
        heading: 'Test Document',
        content: 'Test Content',
        category: 'Test Category',
        createdBy: 1,
        uploadStatus: DocumentUploadStatus.PENDING,
      };

      jest.spyOn(repository, 'create').mockReturnValue(mockDocument);
      jest.spyOn(repository, 'save').mockResolvedValue(mockDocument);

      const result = await repository.createDocument(data);

      expect(repository.create).toHaveBeenCalledWith(data);
      expect(repository.save).toHaveBeenCalledWith(mockDocument);
      expect(result).toEqual(mockDocument);
    });

    it('should use entity manager if provided', async () => {
      const data = { heading: 'Test', content: 'Content', createdBy: 1 };
      const emRepository = {
        create: jest.fn().mockReturnValue(mockDocument),
        save: jest.fn().mockResolvedValue(mockDocument),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.createDocument(data, entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(emRepository.create).toHaveBeenCalledWith(data);
      expect(emRepository.save).toHaveBeenCalledWith(mockDocument);
      expect(result).toEqual(mockDocument);
    });
  });

  describe('findPublicSuccessfulDocuments', () => {
    it('should find all public successful documents', async () => {
      const documents = [{ id: 'doc-1' }, { id: 'doc-2' }];
      jest.spyOn(repository, 'find').mockResolvedValue(documents as any);

      const result = await repository.findPublicSuccessfulDocuments();

      expect(repository.find).toHaveBeenCalledWith({
        select: ['id'],
        where: {
          isPublic: true,
          isArchived: false,
          uploadStatus: DocumentUploadStatus.SUCCESS,
        },
      });
      expect(result).toEqual(documents);
    });

    it('should return empty array when no documents found', async () => {
      jest.spyOn(repository, 'find').mockResolvedValue([]);

      const result = await repository.findPublicSuccessfulDocuments();

      expect(result).toEqual([]);
    });

    it('should use entity manager if provided', async () => {
      const documents = [{ id: 'doc-1' }];
      const emRepository = {
        find: jest.fn().mockResolvedValue(documents),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result =
        await repository.findPublicSuccessfulDocuments(entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(emRepository.find).toHaveBeenCalled();
      expect(result).toEqual(documents);
    });
  });

  describe('findTenantSuccessfulDocuments', () => {
    it('should find tenant successful documents', async () => {
      const organizationId = 'org-123';
      const documents = [{ id: 'doc-1' }, { id: 'doc-2' }];
      jest.spyOn(repository, 'find').mockResolvedValue(documents as any);

      const result =
        await repository.findTenantSuccessfulDocuments(organizationId);

      expect(repository.find).toHaveBeenCalledWith({
        select: ['id'],
        where: [
          {
            isPublic: true,
            uploadStatus: DocumentUploadStatus.SUCCESS,
            isArchived: false,
          },
          {
            organizationId,
            uploadStatus: DocumentUploadStatus.SUCCESS,
            isArchived: false,
          },
        ],
      });
      expect(result).toEqual(documents);
    });

    it('should use entity manager if provided', async () => {
      const organizationId = 'org-123';
      const documents = [{ id: 'doc-1' }];
      const emRepository = {
        find: jest.fn().mockResolvedValue(documents),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.findTenantSuccessfulDocuments(
        organizationId,
        entityManager,
      );

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(result).toEqual(documents);
    });
  });

  describe('findById', () => {
    it('should find document by id', async () => {
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(mockDocument);

      const result = await repository.findById('doc-id-123');

      expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'doc-id-123' });
      expect(result).toEqual(mockDocument);
    });

    it('should return null when document not found', async () => {
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        findOneBy: jest.fn().mockResolvedValue(mockDocument),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.findById('doc-id-123', entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(emRepository.findOneBy).toHaveBeenCalledWith({ id: 'doc-id-123' });
      expect(result).toEqual(mockDocument);
    });
  });

  describe('findPublicById', () => {
    it('should find public document by id', async () => {
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(mockDocument);

      const result = await repository.findPublicById('doc-id-123');

      expect(repository.findOneBy).toHaveBeenCalledWith({
        id: 'doc-id-123',
        isPublic: true,
        uploadStatus: DocumentUploadStatus.SUCCESS,
      });
      expect(result).toEqual(mockDocument);
    });

    it('should return null for non-public document', async () => {
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

      const result = await repository.findPublicById('private-doc');

      expect(result).toBeNull();
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        findOneBy: jest.fn().mockResolvedValue(mockDocument),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.findPublicById(
        'doc-id-123',
        entityManager,
      );

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(result).toEqual(mockDocument);
    });
  });

  describe('findPrivateById', () => {
    it('should find private document by id and organization', async () => {
      const privateDoc = {
        ...mockDocument,
        isPublic: false,
        organizationId: 'org-123',
      };
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(privateDoc);

      const result = await repository.findPrivateById('doc-id-123', 'org-123');

      expect(repository.findOneBy).toHaveBeenCalledWith({
        id: 'doc-id-123',
        organizationId: 'org-123',
        uploadStatus: DocumentUploadStatus.SUCCESS,
      });
      expect(result).toEqual(privateDoc);
    });

    it('should return null for wrong organization', async () => {
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

      const result = await repository.findPrivateById(
        'doc-id-123',
        'wrong-org',
      );

      expect(result).toBeNull();
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        findOneBy: jest.fn().mockResolvedValue(mockDocument),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.findPrivateById(
        'doc-id-123',
        'org-123',
        entityManager,
      );

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(result).toEqual(mockDocument);
    });
  });

  describe('updateDocument', () => {
    it('should update document', async () => {
      const updateData = { heading: 'Updated Heading' };
      jest.spyOn(repository, 'update').mockResolvedValue({} as any);

      await repository.updateDocument('doc-id-123', updateData);

      expect(repository.update).toHaveBeenCalledWith('doc-id-123', updateData);
    });

    it('should use entity manager if provided', async () => {
      const updateData = { heading: 'Updated' };
      const emRepository = {
        update: jest.fn().mockResolvedValue({}),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      await repository.updateDocument('doc-id-123', updateData, entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(emRepository.update).toHaveBeenCalledWith(
        'doc-id-123',
        updateData,
      );
    });
  });

  describe('deleteDocument', () => {
    it('should delete document', async () => {
      jest.spyOn(repository, 'delete').mockResolvedValue({} as any);

      await repository.deleteDocument('doc-id-123');

      expect(repository.delete).toHaveBeenCalledWith('doc-id-123');
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        delete: jest.fn().mockResolvedValue({}),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      await repository.deleteDocument('doc-id-123', entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(emRepository.delete).toHaveBeenCalledWith('doc-id-123');
    });
  });

  describe('archiveDocument', () => {
    it('should archive document', async () => {
      jest.spyOn(repository, 'update').mockResolvedValue({} as any);

      await repository.archiveDocument('doc-id-123');

      expect(repository.update).toHaveBeenCalledWith('doc-id-123', {
        isArchived: true,
        archivedAt: expect.any(Date),
      });
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        update: jest.fn().mockResolvedValue({}),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      await repository.archiveDocument('doc-id-123', entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(emRepository.update).toHaveBeenCalledWith('doc-id-123', {
        isArchived: true,
        archivedAt: expect.any(Date),
      });
    });
  });

  describe('unarchiveDocument', () => {
    it('should unarchive document', async () => {
      jest.spyOn(repository, 'update').mockResolvedValue({} as any);

      await repository.unarchiveDocument('doc-id-123');

      expect(repository.update).toHaveBeenCalledWith('doc-id-123', {
        isArchived: false,
        archivedAt: undefined,
      });
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        update: jest.fn().mockResolvedValue({}),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      await repository.unarchiveDocument('doc-id-123', entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(emRepository.update).toHaveBeenCalledWith('doc-id-123', {
        isArchived: false,
        archivedAt: undefined,
      });
    });
  });

  describe('getDistinctCategories', () => {
    it('should get distinct categories with counts', async () => {
      const mockCategories = [
        { category: 'Category A', count: '10' },
        { category: 'Category B', count: '5' },
      ];

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockCategories),
      };

      jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await repository.getDistinctCategories();

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('document');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'document.category',
        'category',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'COUNT(document.category)',
        'count',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'document.category IS NOT NULL',
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith(
        'document.category',
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('count', 'DESC');
      expect(result).toEqual(['Category A', 'Category B']);
    });

    it('should return empty array when no categories', async () => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await repository.getDistinctCategories();

      expect(result).toEqual([]);
    });

    it('should use entity manager if provided', async () => {
      const mockCategories = [{ category: 'Category A', count: '10' }];
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockCategories),
      };

      const emRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.getDistinctCategories(entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ReferenceDocument,
      );
      expect(emRepository.createQueryBuilder).toHaveBeenCalledWith('document');
      expect(result).toEqual(['Category A']);
    });
  });
});
