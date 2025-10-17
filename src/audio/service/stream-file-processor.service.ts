import { forwardRef, Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { WriteStream } from 'fs';
import * as path from 'path';
import { ChatSummaryStatus } from 'src/common/entities/chat.entity';
import { DataSource, EntityManager } from 'typeorm';
import { AiEventService } from '../../ai/service/ai-event.service';
import { LoggerService } from '../../logger/logger.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { ChatAudioUploadStatus } from '../../common/entities/chat-audio-uploads.entity';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from '../../common/constants/chat.constants';
import { S3Service } from '../../aws/service/s3.service';
import { ChatService } from '../../chat/service/chat.service';
import {
  ActiveCallStream,
  UserChatSessionData,
} from '../../chat/type/chat.type';
import { BroadcastMessageService } from './broadcast-message.service';
import { AppConfigService } from '../../config/config.service';
import { generateAudioStorageKey } from '../../common/util/audio.util';
import { PLACEHOLDER_CHAT_ID } from '../../common/constants/user.constants';
import { findMessageBrokerChannelUsingProvider } from '../../common/util/chat-types.util';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { AudioEncryptionUtil } from '../utils/audio-encryption.util';
import { CipherGCM } from 'crypto';
import { Chat } from 'src/common/entities/chat.entity';
import { ChatAudioUploadsService } from './chat-audio-uploads.service';

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

  private readonly auditLogger = AuditLoggerService.getInstance();

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
        cipher: CipherGCM;
        writeStream: WriteStream;
        encryptionKey: Buffer;
        iv: Buffer;
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
    let chat: Chat | null = null;
    let s3UploadId: string | null = null;
    let tempFiles: string[] = [];
    let s3key: string = '';

    try {
      await this.dataSource.transaction(async (entityManager) => {
        // Create chat using entityManager
        chat = await this.chatService.createChatForAnonymousClient(
          {
            counselorId: chatData.counselorId,
            provider: chatData.provider,
            platform: chatData.platform,
          },
          entityManager,
        );

        if (!chat) {
          throw new Error('Failed to create chat');
        }

        chatId = chat.id;

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
        `Failed to create chat and start call stream for client ${callId}: with error ${JSON.stringify(
          error,
        )}`,
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
    const key = generateAudioStorageKey({
      chatId,
      extension: 'raw',
      prefix: 'microphone-chat',
    });
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

      // Create encrypted streams using AudioEncryptionUtil
      const encryptionStream0 =
        AudioEncryptionUtil.createEncryptionStream(tempFilePath0);
      const encryptionStream1 =
        AudioEncryptionUtil.createEncryptionStream(tempFilePath1);

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
            cipher: encryptionStream0.cipher,
            writeStream: encryptionStream0.writeStream,
            encryptionKey: encryptionStream0.key,
            iv: encryptionStream0.iv,
            tempFilePath: tempFilePath0,
            bufferSize: 0,
          },
          {
            cipher: encryptionStream1.cipher,
            writeStream: encryptionStream1.writeStream,
            encryptionKey: encryptionStream1.key,
            iv: encryptionStream1.iv,
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
      this.logger.debug(
        `Call stream started with dual files | ChatId: ${chatId} | Provider: ${session.provider}`,
      );

      return { uploadId: UploadId!, files: tempFiles, key };
    } catch (err) {
      this.logger.error(
        `Call stream start failed with error: ${err.message} | ChatId: ${chatId} | Provider: ${session.provider} with error ${JSON.stringify(err)}`,
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
      this.logger.debug(`Rolling back external operations for call ${callId}`);

      // Abort S3 multipart upload if it exists
      if (s3UploadId && s3key) {
        try {
          await this.s3Service.abortMultipartUpload({
            Bucket: this.config.s3.audioBucket!,
            Key: s3key,
            UploadId: s3UploadId,
          });

          this.auditLogger.log({
            eventType: AUDIT_EVENTS.AUDIO_S3_MULTIPART_UPLOAD_ABORTED,
            details: {
              chatId,
            },
          });

          this.logger.debug(`Aborted S3 multipart upload for key: ${s3key}`);
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

      this.logger.debug(
        `Successfully rolled back external operations for call ${callId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to rollback external operations for call ${callId}: with error ${JSON.stringify(
          error,
        )}`,
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

    // Finalize encryption and get metadata
    const encryptionMetadata = await AudioEncryptionUtil.finalizeEncryption(
      fileToFlush.cipher,
      fileToFlush.encryptionKey,
      fileToFlush.iv,
      fileToFlush.writeStream,
    );

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.AUDIO_S3_MULTIPART_UPLOAD_STARTED,
      details: {
        chatId,
        partNumber: activeCallStream.partNumber,
        provider,
      },
    });

    // Decrypt file to buffer for S3 upload
    const decryptedBuffer = await AudioEncryptionUtil.decryptToBuffer(
      fileToFlush.tempFilePath,
      encryptionMetadata,
    );

    // Upload decrypted audio to S3
    const { ETag } = await this.s3Service.uploadPart({
      Bucket: this.config.s3.audioBucket,
      Key: activeCallStream.key,
      UploadId: activeCallStream.uploadId,
      PartNumber: activeCallStream.partNumber,
      Body: decryptedBuffer,
    });

    this.logger.debug(
      `Flushed file ${fileToFlushIndex} as part | ETag: ${ETag} | PartNumber: ${activeCallStream.partNumber} | ChatId: ${chatId} | Provider: ${provider}`,
    );

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.AUDIO_S3_MULTIPART_UPLOAD_STARTED,
      details: {
        chatId,
        partNumber: activeCallStream.partNumber,
        provider,
      },
    });

    activeCallStream.parts.push({
      ETag: ETag!,
      PartNumber: activeCallStream.partNumber,
    });

    // Reset the flushed file for next use
    const newTempFilePath = path.join(
      this.config.audioStorage.dir!,
      `chat-${chatId}-${fileToFlushIndex}.part`,
    );

    // Create new encryption stream
    const newEncryptionStream =
      AudioEncryptionUtil.createEncryptionStream(newTempFilePath);
    fileToFlush.tempFilePath = newTempFilePath;
    fileToFlush.cipher = newEncryptionStream.cipher;
    fileToFlush.writeStream = newEncryptionStream.writeStream;
    fileToFlush.encryptionKey = newEncryptionStream.key;
    fileToFlush.iv = newEncryptionStream.iv;
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

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        details: {
          chatId,
          reason: 'No active stream found',
          provider: session.provider,
        },
      });
      return;
    }

    const audioBuffer = this.processPendingAudioQueue(
      activeCallStream.callId,
      audioData,
    );

    // Write to current active encrypted stream
    const currentFileIndex = activeCallStream.currentFileIndex;
    const currentFile = activeCallStream.files[currentFileIndex];
    currentFile.cipher.write(audioBuffer);
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
              `Error deleting temporary file: ${file} | ChatId: ${chatId} with error ${JSON.stringify(
                error,
              )}`,
            );
          }
        }),
      );
    }

    await Promise.allSettled(deletePromises);
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.AUDIO_TEMP_FILES_CLEANUP,
      details: {
        chatId,
        files: files.join(','),
      },
    });
  }

  private handleEmptyFile(activeCallStream: ActiveCallStream, chatId: number) {
    this.chatAudioUploadsService.updateAudioUpload(chatId, {
      status: ChatAudioUploadStatus.FAILED,
    });

    this.cleanUpTemporaryFiles(
      activeCallStream.files?.map((file) => file.tempFilePath) || [],
      chatId,
    );

    this.chatService.updateChat(chatId, {
      summaryStatus: ChatSummaryStatus.NO_AUDIO,
    });
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

        this.auditLogger.log({
          eventType: AUDIT_EVENTS.AUDIO_S3_MULTIPART_UPLOAD_COMPLETED,
          details: {
            chatId,
            provider,
          },
        });
      } else {
        // Abort the multipart upload since we're using regular upload
        try {
          await this.s3Service.abortMultipartUpload({
            Bucket: this.config.s3.audioBucket!,
            Key: activeCallStream.key,
            UploadId: activeCallStream.uploadId,
          });

          this.auditLogger.log({
            eventType: AUDIT_EVENTS.AUDIO_S3_MULTIPART_UPLOAD_ABORTED,
            details: {
              chatId,
              provider,
            },
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
          this.logger.debug(
            `No audio data in file 0 | ChatId: ${chatId} | Provider: ${provider}`,
          );

          this.handleEmptyFile(activeCallStream, chatId);

          return;
        }

        // Finalize encryption for single-part upload
        const encryptionMetadata = await AudioEncryptionUtil.finalizeEncryption(
          activeCallStream.files[0].cipher,
          activeCallStream.files[0].encryptionKey,
          activeCallStream.files[0].iv,
          activeCallStream.files[0].writeStream,
        );

        // Decrypt file to buffer for S3 upload
        const audioBuffer = await AudioEncryptionUtil.decryptToBuffer(
          activeCallStream.files[0].tempFilePath,
          encryptionMetadata,
        );

        this.auditLogger.log({
          eventType: AUDIT_EVENTS.AUDIO_S3_SINGLEPART_UPLOAD_STARTED,
          details: {
            chatId,
            partNumber: activeCallStream.partNumber,
            provider,
          },
        });

        await this.s3Service.uploadStream({
          Bucket: this.config.s3.audioBucket!,
          Key: activeCallStream.key,
          Body: audioBuffer,
          ContentType: 'audio/raw',
        });
      }

      this.logger.debug(
        `Call stream upload completed | ChatId: ${chatId} | Provider: ${provider}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_S3_SINGLEPART_UPLOAD_ENDED,
        details: {
          chatId,
          partNumber: activeCallStream.partNumber,
          provider,
        },
      });

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

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.PRESIGNED_URL_GENERATED,
        details: {
          purpose: 'Audio presigned url generated',
          chatId,
          provider,
        },
      });

      this.aiEventService.publishTranscribeAudioEvent({
        message_type: 'transcribe_and_summarize_request',
        timestamp: Date.now(),
        audio_url: audioUrl,
        chat_id: chatId,
        sample_rate: sampleRate!,
      });

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_TRANSCRIPT_REQUEST_SENT,
        details: {
          purpose: 'Audio transcript request sent to AI service',
          chatId: chatId,
          provider,
        },
      });

      this.logger.debug(
        `Call stream end completed | ChatId: ${chatId} | Provider: ${provider}`,
      );
    } catch (err) {
      this.logger.error(
        `Call stream end failed with error: ${err.message} | ChatId: ${chatId} | Provider: ${provider} with error ${JSON.stringify(
          err,
        )}`,
      );
      await this.chatService.updateChat(chatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          error: err.message,
        },
      });
    }
  }

  clearPendingAudioQueue(callId: string) {
    delete this.pendingAudioQueue[callId];
  }

  setAuthContext(session: UserChatSessionData) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.tenantId,
    );
  }
}
