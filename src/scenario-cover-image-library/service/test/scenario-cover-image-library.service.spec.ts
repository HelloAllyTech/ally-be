import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioCoverImageLibraryService } from '../scenario-cover-image-library.service';
import { ScenarioCoverImageLibraryRepository } from '../../repository/scenario-cover-image-library.repository';
import { ScenarioCoverImageLibrary } from '../../entity/scenario-cover-image-library.entity';
import { S3Service } from '../../../aws/service/s3.service';
import { AppConfigService } from '../../../config/config.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { LoggerService } from '../../../logger/logger.service';
import { ScenarioCoverImageUploadContentType } from '../../enum/scenario-cover-image-upload-content-type.enum';

jest.mock('../../../common/execution/execution-manager');
jest.mock('../../../logger/logger.service');

describe('ScenarioCoverImageLibraryService', () => {
  let service: ScenarioCoverImageLibraryService;

  const now = new Date();
  const mockCoverImage = {
    id: 'img-uuid-1',
    imageUrl:
      'https://bucket.s3.region.amazonaws.com/scenario-cover-image-library/1.jpg',
    createdBy: 100,
    createdAt: now,
    updatedAt: now,
  } as ScenarioCoverImageLibrary;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    getCoverImages: jest.fn(),
  };

  const mockS3Service = {
    getPresignedUrlForImageUpload: jest.fn(),
    getHeadObject: jest.fn(),
    deleteS3Image: jest.fn(),
  };

  const mockConfigService: { s3: { assetsBucket: string | undefined } } = {
    s3: { assetsBucket: 'test-assets-bucket' },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    (LoggerService.getInstance as jest.Mock).mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    });
    mockConfigService.s3.assetsBucket = 'test-assets-bucket';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioCoverImageLibraryService,
        { provide: ScenarioCoverImageLibraryRepository, useValue: mockRepo },
        { provide: S3Service, useValue: mockS3Service },
        { provide: AppConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ScenarioCoverImageLibraryService>(
      ScenarioCoverImageLibraryService,
    );
  });

  describe('createCoverImageUploadUrl', () => {
    const uploadDto = {
      fileName: 'cover.jpg',
      fileSize: 1024000,
      contentType: ScenarioCoverImageUploadContentType.JPEG,
    };

    it('returns presignedUrl and imageUrl only', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(42);
      mockS3Service.getPresignedUrlForImageUpload.mockResolvedValue({
        presignedUrl: 'https://presigned.url',
        imageUrl:
          'https://bucket.s3.region.amazonaws.com/scenario-cover-image-library/cover.jpg',
      });

      const res = await service.createCoverImageUploadUrl(uploadDto);

      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.save).not.toHaveBeenCalled();
      expect(res).toEqual({
        presignedUrl: 'https://presigned.url',
        imageUrl:
          'https://bucket.s3.region.amazonaws.com/scenario-cover-image-library/cover.jpg',
      });
      expect(res).not.toHaveProperty('id');
    });
  });

  describe('addCoverImage', () => {
    const validImageUrl =
      'https://test-assets-bucket.s3.us-east-1.amazonaws.com/scenario-cover-image-library/1730000000000-cover.jpg';

    it('creates and saves library entry when not already present', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(42);
      mockRepo.findOne.mockResolvedValue(null);
      const saved = {
        ...mockCoverImage,
        id: 'new-id',
        imageUrl: validImageUrl,
      };
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      const res = await service.addCoverImage({ imageUrl: validImageUrl });

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { imageUrl: validImageUrl },
      });
      expect(mockRepo.create).toHaveBeenCalledWith({
        imageUrl: validImageUrl,
        createdBy: 42,
      });
      expect(mockRepo.save).toHaveBeenCalled();
      expect(res).toEqual(saved);
    });

    it('returns existing record when imageUrl already registered (idempotency)', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(42);
      const existing = { ...mockCoverImage, imageUrl: validImageUrl };
      mockRepo.findOne.mockResolvedValue(existing);

      const res = await service.addCoverImage({ imageUrl: validImageUrl });

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { imageUrl: validImageUrl },
      });
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.save).not.toHaveBeenCalled();
      expect(res).toEqual(existing);
    });

    it('accepts public image URLs', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(42);
      const publicUrl = 'https://cdn.example.com/assets/cover.jpg';
      mockRepo.findOne.mockResolvedValue(null);
      const saved = { ...mockCoverImage, id: 'new-id', imageUrl: publicUrl };
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      const res = await service.addCoverImage({ imageUrl: publicUrl });

      expect(mockRepo.create).toHaveBeenCalledWith({
        imageUrl: publicUrl,
        createdBy: 42,
      });
      expect(res).toEqual(saved);
    });
  });

  describe('getCoverImages', () => {
    it('returns coverImages and count from repository', async () => {
      mockRepo.getCoverImages.mockResolvedValue({
        coverImages: [mockCoverImage],
        count: 1,
      });

      const res = await service.getCoverImages({ limit: 10, offset: 5 });

      expect(res).toEqual({
        coverImages: [
          {
            id: mockCoverImage.id,
            imageUrl: mockCoverImage.imageUrl,
            createdAt: mockCoverImage.createdAt,
            updatedAt: mockCoverImage.updatedAt,
          },
        ],
        count: 1,
      });
      expect(mockRepo.getCoverImages).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 5 }),
      );
    });
  });

  describe('getById', () => {
    it('returns cover image when found', async () => {
      mockRepo.findOne.mockResolvedValue(mockCoverImage);

      const res = await service.getById('img-uuid-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'img-uuid-1' },
      });
      expect(res).toEqual({
        id: mockCoverImage.id,
        imageUrl: mockCoverImage.imageUrl,
        createdAt: mockCoverImage.createdAt,
        updatedAt: mockCoverImage.updatedAt,
      });
      expect(res).not.toHaveProperty('createdBy');
    });
  });

  describe('delete', () => {
    it('deletes S3 image and repository record then returns success', async () => {
      mockRepo.findOne.mockResolvedValue(mockCoverImage);
      mockS3Service.deleteS3Image.mockResolvedValue({ success: true });
      mockRepo.delete.mockResolvedValue({ affected: 1 });

      const res = await service.delete('img-uuid-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'img-uuid-1' },
      });
      expect(mockS3Service.deleteS3Image).toHaveBeenCalledWith(
        'test-assets-bucket',
        mockCoverImage.imageUrl,
      );
      expect(mockRepo.delete).toHaveBeenCalledWith('img-uuid-1');
      expect(res).toEqual({ success: true });
    });

    it('removes library record for non-S3 URL (skips S3 delete)', async () => {
      const externalImage = {
        ...mockCoverImage,
        imageUrl: 'https://cdn.example.com/images/cover.jpg',
      };
      mockRepo.findOne.mockResolvedValue(externalImage);
      mockS3Service.deleteS3Image.mockResolvedValue({ success: false });
      mockRepo.delete.mockResolvedValue({ affected: 1 });

      const res = await service.delete('img-uuid-1');

      expect(mockS3Service.deleteS3Image).toHaveBeenCalledWith(
        'test-assets-bucket',
        externalImage.imageUrl,
      );
      expect(mockRepo.delete).toHaveBeenCalledWith('img-uuid-1');
      expect(res).toEqual({ success: true });
    });
  });
});
