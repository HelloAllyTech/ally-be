import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { ChatService } from './chat.service';
import { S3Service } from '../../aws/service/s3.service';
import { AiEventService } from '../../ai/service/ai-event.service';
import { ChatAudioUploadsService } from '../../audio/service/chat-audio-uploads.service';
import {
  ChatStatus,
  ChatSummaryStatus,
} from '../../common/entities/chat.entity';
import {
  AudioUploadRequestDto,
  AudioUploadResponseDto,
  ConfirmUploadDto,
  ConfirmUploadResponseDto,
} from '../dto/audio-upload.dto';
import { generateAudioStorageKey } from 'src/common/util/audio.util';
import { AudioChatProvider } from 'src/common/constants/chat.constants';
import { ChatAudioUploadStatus } from 'src/common/entities/chat-audio-uploads.entity';

@Injectable()
export class AudioUploadService {
  private readonly logger = LoggerService.getInstance(AudioUploadService.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly s3Service: S3Service,
    private readonly aiEventService: AiEventService,
    private readonly chatAudioUploadsService: ChatAudioUploadsService,
  ) {}

  async getPresignedUploadUrl(
    userId: number,
    audioUploadRequestDto: AudioUploadRequestDto,
  ): Promise<AudioUploadResponseDto> {
    const { fileName, contentType } = audioUploadRequestDto;

    this.logger.info(
      `Getting presigned URL for user ${userId}, file: ${fileName}`,
    );

    // Validate audio file type
    if (!contentType.startsWith('audio/')) {
      throw new BadRequestException('Only audio files are allowed');
    }

    // TODO: Validate file size

    // Generate S3 key
    const s3Key = generateAudioStorageKey({
      key: `${Date.now()}-${fileName}`,
    });

    // Generate presigned URL
    const presignedUrl = await this.s3Service.generatePresignedUrl({
      bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
      key: s3Key,
      operation: 'put',
      expiresIn: 3600, // 1 hour
      contentType: contentType,
    });

    this.logger.info(`Presigned URL generated`);

    return {
      presignedUrl,
      s3Key,
    };
  }

  async confirmUploadAndStartProcessing(
    confirmUploadDto: ConfirmUploadDto,
    userId: number,
  ): Promise<ConfirmUploadResponseDto> {
    const { s3Key } = confirmUploadDto;
    this.logger.info(`Confirming upload started`);

    // Verify file exists in S3
    const fileExists = await this.s3Service.checkFileExists({
      bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
      key: s3Key,
    });

    if (!fileExists) {
      throw new BadRequestException('File not found in S3');
    }

    // TODO: implement virus scanner

    const chat = await this.chatService.createChatForAnonymousClient({
      counselorId: userId,
      provider: AudioChatProvider.AUDIO_UPLOAD,
      status: ChatStatus.ENDED,
    });

    if (!chat) {
      throw new InternalServerErrorException('Failed to create chat');
    }

    const audioUrl = await this.s3Service.generatePresignedUrl({
      bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
      key: s3Key,
      operation: 'get',
      expiresIn: 3600, // 1 hour
    });

    await this.aiEventService.publishTranscribeAudioEvent({
      message_type: 'transcribe_and_summarize_request',
      chat_id: chat.id,
      timestamp: Date.now(),
      audio_url: audioUrl,
    });

    await this.chatAudioUploadsService.createAudioUpload({
      chatId: chat.id,
      storageKey: s3Key,
      status: ChatAudioUploadStatus.SUCCESS,
    });

    this.logger.info(`Audio processing started for chat ${chat.id}`);

    return {
      chat: {
        ...chat,
        summaryStatus: ChatSummaryStatus.IN_PROGRESS,
      },
    };
  }
}
