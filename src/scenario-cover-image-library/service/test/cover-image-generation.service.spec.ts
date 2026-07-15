import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { ImageGenerationProviderFactory } from 'src/image-generation/provider/image-generation-provider.factory';
import { CoverImageGenerationService } from '../cover-image-generation.service';
import { ScenarioCoverImageLibraryService } from '../scenario-cover-image-library.service';
import { LoggerService } from 'src/logger/logger.service';

jest.mock('src/logger/logger.service');

describe('CoverImageGenerationService', () => {
  let service: CoverImageGenerationService;

  const mockProvider = {
    getModel: jest.fn().mockReturnValue('gpt-image-1'),
    assertConfigured: jest.fn(),
    generateImage: jest.fn(),
  };
  const mockFactory = {
    getProvider: jest
      .fn()
      .mockReturnValue({ provider: mockProvider, providerType: 'openai' }),
  };
  const mockPromptShared = {
    getPromptByCode: jest
      .fn()
      .mockResolvedValue(
        'Cover for "{{title}}". About: {{description}} Style: {{styleHints}}',
      ),
  };
  const mockS3 = {
    uploadStream: jest.fn().mockResolvedValue({}),
    getS3Url: jest.fn(
      (bucket: string, region: string, key: string) =>
        `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
    ),
    sanitizeFileName: jest.fn((name: string) =>
      name.replace(/\s+/g, '-').toLowerCase(),
    ),
  };
  const mockLibrary = { addCoverImage: jest.fn().mockResolvedValue({}) };
  const mockUsage = { record: jest.fn().mockResolvedValue(undefined) };
  const mockConfig = {
    s3: { assetsBucket: 'assets-bucket' },
    aws: { region: 'us-east-1' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (LoggerService.getInstance as jest.Mock).mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoverImageGenerationService,
        { provide: AppConfigService, useValue: mockConfig },
        { provide: S3Service, useValue: mockS3 },
        { provide: ImageGenerationProviderFactory, useValue: mockFactory },
        { provide: PromptSharedService, useValue: mockPromptShared },
        { provide: ScenarioCoverImageLibraryService, useValue: mockLibrary },
        { provide: LlmUsageService, useValue: mockUsage },
      ],
    }).compile();

    service = module.get(CoverImageGenerationService);
  });

  const dto = {
    title: 'Difficult Feedback',
    description: 'A hard conversation.',
    styleHints: 'Photorealistic',
  };

  it('renders the managed template, uploads, adds to library and returns the URL', async () => {
    mockProvider.generateImage.mockResolvedValue(Buffer.from('png-bytes'));

    const result = await service.generateCoverImage(dto);

    expect(mockPromptShared.getPromptByCode).toHaveBeenCalledWith(
      'cover_image_generation',
    );
    expect(mockProvider.generateImage).toHaveBeenCalledWith(
      'Cover for "Difficult Feedback". About: A hard conversation. Style: Photorealistic',
      expect.any(String),
    );
    expect(mockS3.uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'assets-bucket',
        ContentType: 'image/png',
      }),
    );
    expect(mockLibrary.addCoverImage).toHaveBeenCalledWith({
      imageUrl: result.imageUrl,
    });
    expect(result.provider).toBe('openai');
    expect(result.imageUrl).toMatch(
      /^https:\/\/assets-bucket\.s3\.us-east-1\.amazonaws\.com\/scenario-cover-image-library\/.*\.png$/,
    );
    expect(mockUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-image-1',
        task: 'generate_cover_image',
        unit: 'images',
      }),
    );
  });

  it('substitutes the scenario persona fields into the template', async () => {
    mockPromptShared.getPromptByCode.mockResolvedValueOnce(
      '{{name}}, a {{age}}-year-old {{profession}} from {{currentLocation}}. {{gender}}',
    );
    mockProvider.generateImage.mockResolvedValue(Buffer.from('png-bytes'));

    await service.generateCoverImage({
      title: 'Kavya Intake Interview',
      name: 'Kavya',
      age: 20,
      gender: 'female',
      profession: 'Student',
      currentLocation: 'Jaipur, India',
    });

    expect(mockProvider.generateImage).toHaveBeenCalledWith(
      'Kavya, a 20-year-old Student from Jaipur, India. female',
      expect.any(String),
    );
  });

  it('substitutes empty strings for optional fields left blank', async () => {
    mockProvider.generateImage.mockResolvedValue(Buffer.from('png-bytes'));

    await service.generateCoverImage({ title: 'Solo Title' });

    expect(mockProvider.generateImage).toHaveBeenCalledWith(
      'Cover for "Solo Title". About:  Style: ',
      expect.any(String),
    );
  });

  it('404s when the managed prompt template is missing', async () => {
    mockPromptShared.getPromptByCode.mockResolvedValueOnce(null);

    await expect(service.generateCoverImage(dto)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockProvider.generateImage).not.toHaveBeenCalled();
  });

  it('maps provider 400s to BadRequest and does not upload', async () => {
    mockProvider.generateImage.mockRejectedValueOnce({
      status: 400,
      message: 'content policy',
    });

    await expect(service.generateCoverImage(dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockS3.uploadStream).not.toHaveBeenCalled();
  });

  it('maps provider quota/unknown failures to BadGateway', async () => {
    mockProvider.generateImage.mockRejectedValueOnce({ status: 429 });
    await expect(service.generateCoverImage(dto)).rejects.toThrow(
      BadGatewayException,
    );

    mockProvider.generateImage.mockRejectedValueOnce(new Error('boom'));
    await expect(service.generateCoverImage(dto)).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('still succeeds when the library insert fails', async () => {
    mockProvider.generateImage.mockResolvedValue(Buffer.from('png-bytes'));
    mockLibrary.addCoverImage.mockRejectedValueOnce(new Error('db down'));

    const result = await service.generateCoverImage(dto);
    expect(result.imageUrl).toContain('assets-bucket');
  });
});
