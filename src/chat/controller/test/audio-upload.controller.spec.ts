import { Test, TestingModule } from '@nestjs/testing';
import { AudioUploadController } from '../audio-upload.controller';
import { AudioUploadService } from '../../service/audio-upload.service';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import {
  AudioUploadRequestDto,
  AudioUploadResponseDto,
  CancelUploadRequestDto,
  ProcessAudioUploadRequestDto,
} from '../../dto/audio-upload.dto';
import { AudioChatPlatform } from 'src/common/constants/chat.constants';

describe('AudioUploadController', () => {
  let controller: AudioUploadController;
  let mockAudioUploadService: any;

  beforeEach(async () => {
    mockAudioUploadService = {
      createChatWithUploadUrl: jest.fn(),
      cancelUpload: jest.fn(),
      processAudioUpload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AudioUploadController],
      providers: [
        {
          provide: AudioUploadService,
          useValue: mockAudioUploadService,
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermission: jest.fn(),
            getUserPermissions: jest.fn(),
            getUserRoles: jest.fn().mockResolvedValue(['CLIENT']),
          },
        },
        {
          provide: 'Reflector',
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: 'RolesGuard',
          useValue: {
            canActivate: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    controller = module.get<AudioUploadController>(AudioUploadController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createChatWithUploadUrl', () => {
    it('should create chat and return presigned upload URL', async () => {
      const dto: AudioUploadRequestDto = {
        fileName: 'audio.wav',
        fileSize: 1000,
        contentType: 'audio/wav',
        counselorId: 1,
        platform: AudioChatPlatform.WEB,
        duration: 11,
        startedAt: new Date(),
      };

      const mockResponse: AudioUploadResponseDto = {
        chatId: 1,
        presignedUrl: 'https://dummy-s3-url',
      };

      mockAudioUploadService.createChatWithUploadUrl.mockResolvedValue(
        mockResponse,
      );

      const result = await controller.createChatWithUploadUrl(dto);

      expect(result).toEqual(mockResponse);
      expect(
        mockAudioUploadService.createChatWithUploadUrl,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockAudioUploadService.createChatWithUploadUrl,
      ).toHaveBeenCalledWith(dto);
    });

    it('should propagate errors from service', async () => {
      const dto: AudioUploadRequestDto = {
        fileName: 'audio.wav',
        fileSize: 1000,
        contentType: 'audio/wav',
        counselorId: 1,
        platform: AudioChatPlatform.WEB,
        duration: 11,
        startedAt: new Date(),
      };

      const error = new Error('Invalid file type');
      mockAudioUploadService.createChatWithUploadUrl.mockRejectedValue(error);

      await expect(controller.createChatWithUploadUrl(dto)).rejects.toThrow(
        'Invalid file type',
      );
    });
  });

  describe('cancelUpload', () => {
    it('should cancel audio upload successfully', async () => {
      const dto: CancelUploadRequestDto = {
        chatId: 1,
      };

      const mockResponse = {
        message: 'Upload cancelled successfully',
      };

      mockAudioUploadService.cancelUpload.mockResolvedValue(mockResponse);

      const result = await controller.cancelUpload(dto);

      expect(result).toEqual(mockResponse);
      expect(mockAudioUploadService.cancelUpload).toHaveBeenCalledTimes(1);
      expect(mockAudioUploadService.cancelUpload).toHaveBeenCalledWith(dto);
    });

    it('should propagate errors from service', async () => {
      const dto: CancelUploadRequestDto = {
        chatId: 1,
      };

      const error = new Error('Cancel failed');
      mockAudioUploadService.cancelUpload.mockRejectedValue(error);

      await expect(controller.cancelUpload(dto)).rejects.toThrow(
        'Cancel failed',
      );
    });
  });

  describe('processAudioUpload', () => {
    it('should process audio upload successfully', async () => {
      const dto: ProcessAudioUploadRequestDto = {
        s3Key: 'uploads/audio/chat-1/audio.wav',
      };
      const mockResponse = {
        message: 'Audio processed successfully',
        chatId: 1,
      };

      mockAudioUploadService.processAudioUpload.mockResolvedValue(mockResponse);

      const result = await controller.processAudioUpload(dto);

      expect(result).toEqual(mockResponse);
      expect(mockAudioUploadService.processAudioUpload).toHaveBeenCalledTimes(
        1,
      );
      expect(mockAudioUploadService.processAudioUpload).toHaveBeenCalledWith(
        dto.s3Key,
      );
    });

    it('should propagate errors from service', async () => {
      const dto: ProcessAudioUploadRequestDto = {
        s3Key: 'uploads/audio/chat-1/audio.wav',
      };
      const error = new Error('Processing failed');

      mockAudioUploadService.processAudioUpload.mockRejectedValue(error);

      await expect(controller.processAudioUpload(dto)).rejects.toThrow(
        'Processing failed',
      );
    });
  });
});
