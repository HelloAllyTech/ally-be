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
import { ChatStatus, ChatSummaryStatus } from '../entity/chat.entity';
import {
  AudioUploadRequestDto,
  AudioUploadResponseDto,
  CancelUploadRequestDto,
} from '../dto/audio-upload.dto';
import { generateAudioStorageKey } from 'src/common/util/audio.util';
import { AudioChatProvider } from 'src/common/constants/chat.constants';
import { UserService } from 'src/user/service/user.service';
import { addDurationToDate } from 'src/common/util/date.util';
import {
  SUPPORTED_AUDIO_FILE_TYPES,
  UPLOADED_AUDIO_FILE_SIZE_LIMIT,
} from '../constants/chat.constants';
import { ChatAudioUploadStatus } from '../../audio/entity/chat-audio-uploads.entity';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from 'src/common/decorator/execution.context.decorator';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';

@Injectable()
export class AudioUploadService {
  private readonly logger = LoggerService.getInstance(AudioUploadService.name);
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private readonly chatService: ChatService,
    private readonly s3Service: S3Service,
    private readonly aiEventService: AiEventService,
    private readonly chatAudioUploadsService: ChatAudioUploadsService,
    private readonly userService: UserService,
  ) {}

  async createChatWithUploadUrl(
    audioUploadRequestDto: AudioUploadRequestDto,
  ): Promise<AudioUploadResponseDto> {
    const {
      fileName,
      contentType,
      counselorId,
      startedAt,
      platform,
      duration,
      fileSize,
    } = audioUploadRequestDto;

    this.logger.info(`Getting presigned URL for file: ${fileName}`);

    if (!SUPPORTED_AUDIO_FILE_TYPES.includes(contentType)) {
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_UPLOAD_FAILED,
        userId: counselorId,
        details: {
          reason: 'Invalid file type',
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });
      throw new BadRequestException('Invalid file type');
    }

    if (fileSize > UPLOADED_AUDIO_FILE_SIZE_LIMIT) {
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_UPLOAD_FAILED,
        userId: counselorId,
        details: {
          reason: 'File size exceeds the limit',
          fileSize,
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });
      throw new BadRequestException('File size exceeds the limit');
    }

    const counselor = await this.userService.get(counselorId);

    if (!counselor) {
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_UPLOAD_FAILED,
        details: {
          reason: 'Counselor not found',
          counselorId,
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });
      throw new BadRequestException('Counselor not found');
    }

    const chat = await this.chatService.createChatForAnonymousClient({
      counselorId,
      provider: AudioChatProvider.AUDIO_UPLOAD,
      status: ChatStatus.STARTED,
      startedAt: new Date(startedAt),
      endedAt: addDurationToDate({
        date: new Date(startedAt),
        duration,
        unit: 'second',
      }),
      platform,
    });

    if (!chat) {
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_UPLOAD_FAILED,
        tenantId: counselor.tenantId,
        details: {
          reason: 'Failed to create chat',
          counselorId,
          fileName,
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });
      throw new InternalServerErrorException('Failed to create chat');
    }

    const sanitizedFileName = this.s3Service.sanitizeFileName(fileName);

    const s3Key = generateAudioStorageKey({
      key: `${Date.now()}-${chat.id}-${sanitizedFileName}`,
      prefix: 'audio-upload',
    });

    const presignedUrl = await this.s3Service.generatePresignedUrl({
      bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
      key: s3Key,
      operation: 'put',
      expiresIn: 3600, // 1 hour
      contentType,
      metadata: {
        // Custom metadata; S3 stores keys in lowercase automatically
        chatid: chat.id.toString(),
        provider: AudioChatProvider.AUDIO_UPLOAD,
      },
    });

    this.logger.info(`Presigned URL generated for chat ${chat.id}`);

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.AUDIO_UPLOAD_PRESIGNED_URL_GENERATED,
      tenantId: counselor.tenantId,
      userId: counselorId,
      details: {
        chatId: chat.id,
        provider: AudioChatProvider.AUDIO_UPLOAD,
      },
    });

    return {
      presignedUrl,
      s3Key,
      chatId: chat.id,
    };
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async processAudioUpload(s3Key: string) {
    this.logger.info(`Processing audio upload`);

    let file;

    try {
      file = await this.s3Service.getHeadObject({
        bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
        key: s3Key,
      });
    } catch (error) {
      this.logger.error(`Failed to get head object: ${error.message}`);
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        details: {
          reason: 'Failed to get head object from S3',
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });
      return;
    }

    const { chatid: chatId, provider } = file.Metadata as {
      chatid: string;
      provider: string;
    };

    if (!chatId || !provider || provider !== AudioChatProvider.AUDIO_UPLOAD) {
      this.logger.error(`Invalid file metadata: ${file.Metadata}`);
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        details: {
          reason: 'Invalid file metadata',
          metadata: file.Metadata,
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });
      return;
    }

    const chat = await this.chatService.getChatByIdForServiceCall(+chatId);

    ExecutionManager.setAuthContext(
      chat.createdBy?.toString() || '',
      chat.tenantId,
    );

    if (!chat || chat.status !== ChatStatus.STARTED) {
      this.logger.error(
        `Chat not found or not in started status: ${chatId} and status: ${chat?.status}`,
      );
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        details: {
          reason: 'Chat not found or not in started status',
          chatId,
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });
      return;
    }

    this.logger.info(`Audio upload processed for chat ${chat.id}`);

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.AUDIO_PROCESSING_COMPLETED,
      details: {
        chatId: chat.id,
        provider: AudioChatProvider.AUDIO_UPLOAD,
      },
    });

    await this.chatService.updateChat(chat.id, {
      status: ChatStatus.ENDED,
    });

    try {
      await this.chatAudioUploadsService.createAudioUpload({
        chatId: chat.id,
        storageKey: s3Key,
        status: ChatAudioUploadStatus.SUCCESS,
      });

      const audioUrl = await this.s3Service.generatePresignedUrl({
        bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
        key: s3Key,
        operation: 'get',
        expiresIn: 3600, // 1 hour
        audience: 'internal',
      });

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.PRESIGNED_URL_GENERATED,
        details: {
          purpose: 'Audio presigned url generated',
          chatId: chat.id,
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });

      await this.aiEventService.publishTranscribeAudioEvent({
        message_type: 'transcribe_and_summarize_request',
        chat_id: chat.id,
        timestamp: Date.now(),
        audio_url: audioUrl,
      });

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_TRANSCRIPT_REQUEST_SENT,
        details: {
          purpose: 'Audio transcript request sent to AI service',
          chatId: chat.id,
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });
      this.logger.info(`Uploaded audio send to AI service for chat ${chat.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to process audio upload for chat ${chat.id} with error ${JSON.stringify(
          error,
        )}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_UPLOAD_FAILED,
        details: {
          purpose: 'Audio presigned url sending to AI service',
          chatId,
        },
      });

      await this.chatService.updateChat(chat.id, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          error: error.message,
        },
      });
    }
  }

  async cancelUpload(cancelUploadRequestDto: CancelUploadRequestDto) {
    const { chatId } = cancelUploadRequestDto;

    await this.chatService.updateChat(chatId, {
      status: ChatStatus.CANCELLED,
      summaryStatus: ChatSummaryStatus.NO_AUDIO,
    });

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.AUDIO_UPLOAD_CANCELLED,
      details: {
        chatId,
        reason: 'Upload cancelled by user',
        provider: AudioChatProvider.AUDIO_UPLOAD,
      },
    });
  }
}
