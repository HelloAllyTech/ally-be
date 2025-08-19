import { forwardRef, Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, EntityManager } from 'typeorm';
import { S3Service } from '../../aws/service/s3.service';
import { ChatAudioUploadsService } from './chat-audio-uploads.service';
import { AiEventService } from '../../ai/service/ai-event.service';
import { LoggerService } from '../../logger/logger.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { ChatAudioUploadStatus } from '../../common/entities/chat-audio-uploads.entity';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from '../../common/constants/chat.constants';
import {
  ActiveCallStream,
  UserChatSessionData,
} from '../../chat/type/chat.type';
import { BroadcastMessageService } from './broadcast-message.service';
import { AppConfigService } from '../../config/config.service';
import { ChatService } from '../../chat/service/chat.service';
import { PLACEHOLDER_CHAT_ID } from '../../common/constants/user.constants';
import { findMessageBrokerChannelUsingProvider } from '../../common/util/chat-types.util';
import { ChatSummaryStatus } from 'src/common/entities/chat.entity';

@Injectable()
export class StreamFileProcessorService {
  constructor(
    private s3Service: S3Service,
    private chatAudioUploadsService: ChatAudioUploadsService,
    private dataSource: DataSource,
    private broadcastMessageService: BroadcastMessageService,
    @Inject(forwardRef(() => ChatService))
    private chatService: ChatService,
    private config: AppConfigService,
    private aiEventService: AiEventService,
  ) {}

  private readonly logger = LoggerService.getInstance(
    StreamFileProcessorService.name,
  );

  private pendingAudioQueue: { [key: string]: Buffer[] } = {};

  private MIN_PART_SIZE = 6 * 1024 * 1024; // 6 MB

  private activeCallStreams: {
    [key: string]: {
      parts: Array<{
        ETag: string;
        PartNumber: number;
      }>;
      uploadId: string;
      key: string;
      partNumber: number;
      currentFileIndex: number;
      files: {
        fileWriteStream: fs.WriteStream;
        tempFilePath: string;
        bufferSize: number;
      }[];
      callId: string;
      chatId: number;
    };
  } = {};

  addToPendingAudioQueue(clientId: string, audioBuffer: Buffer) {
    if (!this.pendingAudioQueue[clientId]) {
      this.pendingAudioQueue[clientId] = [];
    }
    this.pendingAudioQueue[clientId].push(audioBuffer);
  }

  processPendingAudioQueue(clientId: string, audioBuffer: Buffer) {
    if (this.pendingAudioQueue[clientId]?.length > 0) {
      const pendingAudioBuffer = Buffer.concat([
        ...this.pendingAudioQueue[clientId],
        audioBuffer,
      ]);
      this.clearPendingAudioQueue(clientId);
      return pendingAudioBuffer;
    } else {
      return audioBuffer;
    }
  }

  private generateStorageKey(chatId: number) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const timestamp = now.getTime();
    return `${year}/${month}/${day}/chat-${chatId}-${timestamp}.raw`;
  }

  async startCallStream(
    session: UserChatSessionData,
    chatData: {
      counselorId: number;
      provider: AudioChatProvider;
      platform?: AudioChatPlatform;
      sampleRate?: number;
    },
    onChatCreated: (chatId: number) => void,
  ) {
    const callId = session.id;
    let chatId: number | undefined;
    let chat: any = null;
    let s3UploadId: string | null = null;
    let tempFiles: string[] = [];
    let s3key: string = '';

    try {
      await this.dataSource.transaction(async (entityManager) => {
        // Create chat using entityManager
        chat = await this.chatService.createChatForAnyonymousClient({
          counselorId: chatData.counselorId,
          provider: chatData.provider,
          platform: chatData.platform,
          entityManager,
        });

        if (!chat) {
          throw new Error('Failed to create chat');
        }

        chatId = chat.chatId;

        // Setup call stream using entityManager
        const { uploadId, files, key } = await this.setupCallStream({
          session,
          chatId: chatId!,
          entityManager,
          sampleRate: chatData.sampleRate!,
        });
        s3UploadId = uploadId;
        tempFiles = files;
        s3key = key;
      });

      // Only update session after transaction is successfully completed
      if (chatId !== undefined && onChatCreated) onChatCreated(chatId);
    } catch (error) {
      this.logger.error(
        `Failed to create chat and start call stream for client ${callId}:`,
        error,
      );

      // Rollback external operations
      await this.rollbackExternalOperations({
        s3UploadId,
        tempFiles,
        callId,
        chatId,
        s3key,
      });
      throw error;
    }
  }

  private async setupCallStream({
    session,
    chatId,
    entityManager,
    sampleRate,
  }: {
    session: UserChatSessionData;
    chatId: number;
    entityManager: EntityManager;
    sampleRate: number;
  }): Promise<{ uploadId: string; files: string[]; key: string }> {
    const callId = session.id;
    const key = this.generateStorageKey(chatId);
    const tempFiles: string[] = [];

    try {
      const { UploadId } = await this.s3Service.createMultipartUpload({
        Bucket: this.config.s3.audioBucket,
        Key: key,
        ContentType: 'audio/raw',
      });

      // Create two files for ping-pong buffering
      const tempFilePath0 = path.join(
        this.config.audioStorage.dir!,
        `chat-${chatId}-0.part`,
      );
      const tempFilePath1 = path.join(
        this.config.audioStorage.dir!,
        `chat-${chatId}-1.part`,
      );
      tempFiles.push(tempFilePath0, tempFilePath1);

      const fileWriteStream0 = fs.createWriteStream(tempFilePath0);
      const fileWriteStream1 = fs.createWriteStream(tempFilePath1);

      // Create audio upload record using entityManager
      await this.chatAudioUploadsService.createAudioUpload(
        {
          chatId: chatId,
          storageKey: key,
          status: ChatAudioUploadStatus.PENDING,
          sampleRate,
          format: 'raw',
        },
        entityManager,
      );

      this.activeCallStreams[chatId] = {
        parts: [],
        uploadId: UploadId!,
        key,
        partNumber: 1,
        currentFileIndex: 0, // Start with file 0
        files: [
          {
            fileWriteStream: fileWriteStream0,
            tempFilePath: tempFilePath0,
            bufferSize: 0,
          },
          {
            fileWriteStream: fileWriteStream1,
            tempFilePath: tempFilePath1,
            bufferSize: 0,
          },
        ],
        chatId,
        callId,
      };

      const channel = findMessageBrokerChannelUsingProvider(session.provider!);
      this.broadcastMessageService.broadcastUserJoinedMessage(channel!, {
        participants: [session.userId],
        userId: session.userId,
        chatId,
      });
      this.logger.info(
        `Call stream started with dual files | ChatId: ${chatId} | Provider: ${session.provider}`,
      );

      return { uploadId: UploadId!, files: tempFiles, key };
    } catch (err) {
      this.logger.error(
        `Call stream start failed with error: ${err.message} | ChatId: ${chatId} | Provider: ${session.provider}`,
        err,
      );
      throw err;
    }
  }

  /**
   * Rollback external operations when transaction fails
   */
  private async rollbackExternalOperations({
    s3UploadId,
    tempFiles,
    callId,
    s3key,
    chatId,
  }: {
    s3UploadId: string | null;
    tempFiles: string[];
    callId: string;
    s3key: string;
    chatId?: number;
  }) {
    try {
      this.logger.info(`Rolling back external operations for call ${callId}`);

      // Abort S3 multipart upload if it exists
      if (s3UploadId && s3key) {
        try {
          await this.s3Service.abortMultipartUpload({
            Bucket: this.config.s3.audioBucket!,
            Key: s3key,
            UploadId: s3UploadId,
          });
          this.logger.info(`Aborted S3 multipart upload for key: ${s3key}`);
        } catch (abortError) {
          this.logger.warn(
            `Failed to abort S3 multipart upload: ${abortError.message}`,
          );
        }
      }

      if (chatId) {
        // Clean up temporary files
        this.cleanUpTemporaryFiles(tempFiles, chatId);
      }

      // Remove from active call streams
      delete this.activeCallStreams[callId];

      // Clear pending audio queue
      this.clearPendingAudioQueue(callId);

      this.logger.info(
        `Successfully rolled back external operations for call ${callId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to rollback external operations for call ${callId}:`,
        error,
      );
    }
  }

  private async flushFileAsPart({
    chatId,
    activeCallStream,
    fileToFlushIndex,
    provider,
  }: {
    chatId: number;
    activeCallStream: ActiveCallStream;
    fileToFlushIndex: number;
    provider?: AudioChatProvider;
  }) {
    // Get the file to flush (the one that's not currently active)
    const fileToFlush = activeCallStream.files[fileToFlushIndex];

    // End the write stream for the file being flushed
    await new Promise((resolve) => fileToFlush.fileWriteStream.end(resolve));

    // Upload the file to S3
    const fileBuffer = fs.createReadStream(fileToFlush.tempFilePath);
    const { ETag } = await this.s3Service.uploadPart({
      Bucket: this.config.s3.audioBucket,
      Key: activeCallStream.key,
      UploadId: activeCallStream.uploadId,
      PartNumber: activeCallStream.partNumber,
      Body: fileBuffer,
    });

    this.logger.info(
      `Flushed file ${fileToFlushIndex} as part | ETag: ${ETag} | PartNumber: ${activeCallStream.partNumber} | ChatId: ${chatId} | Provider: ${provider}`,
    );

    activeCallStream.parts.push({
      ETag: ETag!,
      PartNumber: activeCallStream.partNumber,
    });

    // Reset the flushed file for next use
    const newTempFilePath = path.join(
      this.config.audioStorage.dir!,
      `chat-${chatId}-${fileToFlushIndex}.part`,
    );
    fileToFlush.tempFilePath = newTempFilePath;
    fileToFlush.fileWriteStream = fs.createWriteStream(newTempFilePath);
    fileToFlush.bufferSize = 0;

    activeCallStream.partNumber += 1;
  }

  saveAudio(
    session: UserChatSessionData,
    {
      chatId,
      audioBase64,
      shouldBroadcastAudioMessage,
    }: {
      chatId: number;
      audioBase64: string;
      shouldBroadcastAudioMessage?: boolean;
    },
  ) {
    const audioData = Buffer.from(audioBase64, 'base64');

    if (chatId === PLACEHOLDER_CHAT_ID) {
      this.addToPendingAudioQueue(session.id, audioData);
      return;
    }

    const activeCallStream = this.activeCallStreams[chatId];

    if (!activeCallStream) {
      this.logger.error(`No active stream for chatId: ${chatId}`);
      return;
    }

    const audioBuffer = this.processPendingAudioQueue(
      activeCallStream.callId,
      audioData,
    );

    // Write to current active file
    const currentFileIndex = activeCallStream.currentFileIndex;
    const currentFile = activeCallStream.files[currentFileIndex];
    currentFile.fileWriteStream.write(audioBuffer);
    currentFile.bufferSize += audioBuffer.length;

    // Check if we need to flush the current file
    if (currentFile.bufferSize >= this.MIN_PART_SIZE) {
      activeCallStream.currentFileIndex = currentFileIndex === 0 ? 1 : 0;
      this.flushFileAsPart({
        chatId,
        activeCallStream,
        fileToFlushIndex: currentFileIndex,
        provider: session.provider!,
      });
    }

    if (shouldBroadcastAudioMessage) {
      const channel = findMessageBrokerChannelUsingProvider(session.provider!);
      this.broadcastMessageService.broadcastAudioStreamMessage(channel!, {
        participants: [session.userId],
        userId: session.userId,
        audioData: audioBuffer,
        chatId: chatId,
      });
    }
  }

  private async cleanUpTemporaryFiles(files: string[], chatId: number) {
    if (!files) return;

    const deletePromises = [];
    for (let i = 0; i < 2; i++) {
      const file = files[i];
      deletePromises.push(
        fs.promises.unlink(file).catch((error) => {
          if (error.code !== 'ENOENT') {
            this.logger.error(
              `Error deleting temporary file: ${file} | ChatId: ${chatId}`,
              error,
            );
          }
        }),
      );
    }

    await Promise.allSettled(deletePromises);
  }

  private handleEmptyFile(activeCallStream: ActiveCallStream, chatId: number) {
    this.chatAudioUploadsService.updateAudioUpload(chatId, {
      status: ChatAudioUploadStatus.FAILED,
    });

    this.cleanUpTemporaryFiles(
      activeCallStream.files?.map((file) => file.tempFilePath) || [],
      chatId,
    );
  }

  async endCallStream({
    chatId,
    provider,
  }: {
    chatId: number;
    provider?: AudioChatProvider;
  }) {
    const activeCallStream = this.activeCallStreams[chatId];
    if (!activeCallStream) {
      this.logger.error(
        `End call stream failed: No active stream for chatId: ${chatId} | Provider: ${provider}`,
      );
      return;
    }

    delete this.activeCallStreams[chatId];

    const currentFileIndex = activeCallStream.currentFileIndex;
    const currentFile = activeCallStream.files[currentFileIndex];
    this.chatService.updateCallMetadata(chatId);

    try {
      // Check if we have any parts (multipart upload) or just small files
      if (activeCallStream.parts.length > 0) {
        if (currentFile.bufferSize > 0) {
          await this.flushFileAsPart({
            chatId,
            activeCallStream,
            fileToFlushIndex: currentFileIndex,
            provider,
          });
        }
        // Use multipart upload for large files
        await this.s3Service.completeMultipartUploadWithParts({
          bucket: this.config.s3.audioBucket!,
          key: activeCallStream.key,
          uploadId: activeCallStream.uploadId,
          parts: activeCallStream.parts,
        });
      } else {
        // Abort the multipart upload since we're using regular upload
        try {
          await this.s3Service.abortMultipartUpload({
            Bucket: this.config.s3.audioBucket!,
            Key: activeCallStream.key,
            UploadId: activeCallStream.uploadId,
          });
          this.logger.debug(
            `Aborted multipart upload for regular upload | ChatId: ${chatId} | Provider: ${provider}`,
          );
        } catch (abortErr) {
          this.logger.warn(
            `Failed to abort multipart upload | Error: ${abortErr.message} | ChatId: ${chatId} | Provider: ${provider}`,
          );
        }

        if (activeCallStream.files[0].bufferSize === 0) {
          this.logger.info(
            `No audio data in file 0 | ChatId: ${chatId} | Provider: ${provider}`,
          );

          this.handleEmptyFile(activeCallStream, chatId);

          return;
        }

        // Use regular upload for small files - only file 0 has data
        const audioBuffer = fs.readFileSync(
          activeCallStream.files[0].tempFilePath,
        );

        await this.s3Service.uploadStream({
          Bucket: this.config.s3.audioBucket!,
          Key: activeCallStream.key,
          Body: audioBuffer,
          ContentType: 'audio/raw',
        });
      }

      this.logger.info(
        `Call stream upload completed | ChatId: ${chatId} | Provider: ${provider}`,
      );

      const audioUpload = await this.chatAudioUploadsService.updateAudioUpload(
        chatId,
        {
          status: ChatAudioUploadStatus.SUCCESS,
        },
      );

      const sampleRate = audioUpload.sampleRate;

      this.cleanUpTemporaryFiles(
        activeCallStream.files?.map((file) => file.tempFilePath) || [],
        chatId,
      );

      const audioUrl = await this.s3Service.generatePresignedUrl({
        bucket: this.config.s3.audioBucket!,
        key: activeCallStream.key,
        operation: 'get',
      });

      this.aiEventService.publishTranscribeAudioEvent({
        message_type: 'transcribe_and_summarize_request',
        timestamp: Date.now(),
        audio_url: audioUrl,
        chat_id: chatId,
        sample_rate: sampleRate!,
      });

      this.logger.info(
        `Call stream end completed | ChatId: ${chatId} | Provider: ${provider}`,
      );
    } catch (err) {
      this.logger.error(
        `Call stream end failed with error: ${err.message} | ChatId: ${chatId} | Provider: ${provider}`,
        err,
      );
      await this.chatService.updateChat(chatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
      });
    }
  }

  clearPendingAudioQueue(callId: string) {
    delete this.pendingAudioQueue[callId];
  }

  setAuthContext(session: UserChatSessionData) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.role,
      session.tenantId,
    );
  }
}
