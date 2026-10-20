import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { ImageGenerationProviderFactory } from 'src/image-generation/provider/image-generation-provider.factory';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { TrackCoverImageService } from '../track-cover-image.service';

jest.mock('src/logger/logger.service');

describe('TrackCoverImageService', () => {
  let service: TrackCoverImageService;

  const mockProvider = {
    getModel: jest.fn().mockReturnValue('gpt-image-1'),
    assertConfigured: jest.fn(),
    generateImage: jest.fn(),
  };
  const mockFactory = { getProvider: jest.fn() };
  const mockS3 = {
    uploadStream: jest.fn().mockResolvedValue({}),
    getS3Url: jest.fn(
      (bucket: string, region: string, key: string) =>
        `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
    ),
    sanitizeFileName: jest.fn((name: string) => name),
  };
  const mockUsage = { record: jest.fn().mockResolvedValue(undefined) };
  let mockConfig: {
    s3: { learnMediaPublicBucket?: string };
    aws: { region?: string };
  };

  const dto = {
    prompt: 'A calm, realistic photograph of two people talking on a bench.',
    trackTitle: 'Listening Well',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (LoggerService.getInstance as jest.Mock).mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });
    mockFactory.getProvider.mockReturnValue({
      provider: mockProvider,
      providerType: 'openai',
    });
    mockConfig = {
      s3: { learnMediaPublicBucket: 'learn-media' },
      aws: { region: 'us-east-1' },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackCoverImageService,
        { provide: AppConfigService, useFactory: () => mockConfig },
        { provide: S3Service, useValue: mockS3 },
        { provide: ImageGenerationProviderFactory, useValue: mockFactory },
        { provide: LlmUsageService, useValue: mockUsage },
      ],
    }).compile();

    service = module.get(TrackCoverImageService);
  });

  it('sends the prompt verbatim at medium quality, stores under track-media/image/ and returns the URL', async () => {
    mockProvider.generateImage.mockResolvedValue(Buffer.from('png-bytes'));

    const result = await service.generate(dto);

    expect(mockProvider.generateImage).toHaveBeenCalledWith(
      dto.prompt,
      '1536x1024',
      { quality: 'medium' },
    );
    const upload = mockS3.uploadStream.mock.calls[0][0];
    expect(upload.Bucket).toBe('learn-media');
    expect(upload.Key).toMatch(
      /^track-media\/image\/\d+-generated-cover-listening-well\.png$/,
    );
    expect(upload.ContentType).toBe('image/png');
    expect(result.imageUrl).toBe(
      `https://learn-media.s3.us-east-1.amazonaws.com/${upload.Key}`,
    );
    expect(mockUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        task: LlmTask.GENERATE_COURSE_COVER_IMAGE,
        unit: 'images',
        model: 'gpt-image-1',
      }),
    );
  });

  it('names the file generically when the course has no title yet', async () => {
    mockProvider.generateImage.mockResolvedValue(Buffer.from('png-bytes'));

    await service.generate({ prompt: dto.prompt });

    expect(mockS3.uploadStream.mock.calls[0][0].Key).toMatch(
      /-generated-cover-course\.png$/,
    );
  });

  it('is unavailable, not a crash, when the media bucket is not configured', async () => {
    mockConfig.s3.learnMediaPublicBucket = undefined;

    await expect(service.generate(dto)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(mockProvider.generateImage).not.toHaveBeenCalled();
  });

  it('is unavailable when no image provider is configured', async () => {
    mockFactory.getProvider.mockImplementation(() => {
      throw new BadRequestException('OPENAI_API_KEY is not configured');
    });

    await expect(service.generate(dto)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps a provider refusal to 400 and uploads nothing', async () => {
    mockProvider.generateImage.mockRejectedValue({
      status: 400,
      message: 'safety system',
    });

    const error = await service.generate(dto).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toMatch(/rewording/);
    expect(error.message).not.toMatch(/safety system/);
    expect(mockS3.uploadStream).not.toHaveBeenCalled();
    expect(mockUsage.record).not.toHaveBeenCalled();
  });

  it('maps a rate limit or outage to 502', async () => {
    mockProvider.generateImage.mockRejectedValueOnce({ status: 429 });
    await expect(service.generate(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );

    mockProvider.generateImage.mockRejectedValueOnce(new Error('timeout'));
    await expect(service.generate(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
