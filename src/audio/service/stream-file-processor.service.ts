import {
  forwardRef,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as fs from 'fs';
import { WriteStream } from 'fs';
import * as path from 'path';
import { ChatSummaryStatus } from '../../chat/entity/chat.entity';
import {
  StreamEndReason,
  ABNORMAL_STREAM_END_REASONS,
} from '../../chat/constants/chat.constants';
import { DataSource, EntityManager } from 'typeorm';
import { AiEventService } from '../../ai/service/ai-event.service';
import { LoggerService } from '../../logger/logger.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { ChatAudioUploadStatus } from '../entity/chat-audio-uploads.entity';
import {
  AudioChatProvider,
  AudioChatPlatform,
  ScribeSessionMode,
  AUDIO_CHECKPOINT_SUFFIX,
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
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { MessageBrokerChannel } from '../../message-broker/constants/message-broker.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { AudioEncryptionUtil } from '../utils/audio-encryption.util';
import { CipherGCM } from 'crypto';
import { Chat } from '../../chat/entity/chat.entity';
import { ChatAudioUploadsService } from './chat-audio-uploads.service';

@Injectable()
export class StreamFileProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private s3Service: S3Service,
    private chatAudioUploadsService: ChatAudioUploadsService,
    private dataSource: DataSource,
    private broadcastMessageService: BroadcastMessageService,
    @Inject(forwardRef(() => ChatService))
    private chatService: ChatService,
    private config: AppConfigService,
    private aiEventService: AiEventService,
    private messageBroker: MessageBrokerService,
  ) {}

  private readonly logger = LoggerService.getInstance(
    StreamFileProcessorService.name,
  );

  private readonly auditLogger = AuditLoggerService.getInstance();

  private pendingAudioQueue: { [key: string]: Buffer[] } = {};

  private MIN_PART_SIZE = 6 * 1024 * 1024; // 6 MB

  // Live audio is only durable in S3 once a 6 MB part flushes or the session
  // ends cleanly (endCallStream). A short session (< MIN_PART_SIZE) whose pod
  // dies hard — OOM / SIGKILL / spot reclaim, i.e. no graceful shutdown drain —
  // loses everything, since its audio only ever lived in this pod's memory.
  // To bound that loss we periodically PutObject the audio-so-far (plaintext,
  // exactly what endCallStream uploads for a short session) to the final key.
  // Then a hard kill leaves a readable object and the reprocess backfill picks
  // it up automatically (its HEAD succeeds → re-dispatch). We only checkpoint
  // BEFORE the first part flushes: once parts exist the session is already
  // salvageable from the multipart upload, so we stop and free the buffer.
  private static readonly CHECKPOINT_INTERVAL_MS = 30_000;
  private checkpointTimer?: NodeJS.Timeout;

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
      // Raw audio accumulated for the durability checkpoint (only while no part
      // has flushed yet; cleared once the session becomes multipart-salvageable).
      checkpointChunks: Buffer[];
      checkpointBytes: number;
      // Bytes at the last successful checkpoint upload — skip re-uploading when
      // nothing new arrived.
      lastCheckpointBytes: number;
      // Serializes multipart part uploads. saveAudio flushes a full 6 MB file
      // as a part without blocking the socket, but those flushes MUST run in
      // order (parts are numbered) and their failures MUST be observed —
      // previously the flush was fire-and-forget, so a failed part became an
      // unhandled rejection and silently corrupted the multipart. Each flush is
      // chained here; endCallStream awaits the chain before completing.
      flushChain: Promise<void>;
      // Set if any chained part flush failed — the multipart is now incomplete.
      partUploadFailed: boolean;
    };
  } = {};

  onModuleInit(): void {
    this.checkpointTimer = setInterval(() => {
      void this.flushCheckpoints();
    }, StreamFileProcessorService.CHECKPOINT_INTERVAL_MS);
    if (typeof this.checkpointTimer.unref === 'function') {
      this.checkpointTimer.unref();
    }

    // Finalize recordings whose end-session landed on a different replica. The
    // ending replica (which doesn't hold the in-memory stream) broadcasts on
    // this channel; whichever replica actually owns the stream finalizes it.
    void this.messageBroker.subscribe(
      MessageBrokerChannel.MICROPHONE_STREAM_END,
      (message: {
        chatId?: number;
        provider?: AudioChatProvider;
        userId?: number | string;
        tenantId?: string;
      }) => {
        void this.handleRemoteStreamEnd(message);
      },
    );
  }

  /**
   * Broker handler for a cross-replica finalize request. No-op unless THIS
   * replica holds the recording (so only the owner finalizes). Re-invokes
   * endCallStream with allowRemoteFinalize=false so a miss here can't
   * re-broadcast and loop.
   */
  private async handleRemoteStreamEnd(message: {
    chatId?: number;
    provider?: AudioChatProvider;
    userId?: number | string;
    tenantId?: string;
  }): Promise<void> {
    const { chatId, provider, userId, tenantId } = message || {};
    if (chatId == null || !this.activeCallStreams[chatId]) return;
    try {
      // Broker callback runs outside a request scope — set the auth context
      // (as the janitor does) so the downstream chat/audio writes are scoped.
      ExecutionManager.setAuthContext(
        userId != null ? String(userId) : '',
        tenantId as string,
      );
      this.logger.warn(
        `Finalizing recording for chat ${chatId} on request from another replica`,
      );
      await this.endCallStream({
        chatId,
        provider,
        allowRemoteFinalize: false,
      });
    } catch (error) {
      this.logger.error(
        `Failed to finalize recording for chat ${chatId} from broker request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
  }

  /**
   * Periodically persist the audio-so-far for short, not-yet-durable sessions
   * so a hard pod kill loses at most CHECKPOINT_INTERVAL_MS of audio instead of
   * the whole recording. Best-effort: never throws, and is superseded by the
   * final object on a clean endCallStream.
   */
  private async flushCheckpoints(): Promise<void> {
    for (const chatId of Object.keys(this.activeCallStreams)) {
      const stream = this.activeCallStreams[chatId];
      // Skip sessions that already have a flushed part (salvageable) or have no
      // new audio since the last checkpoint.
      if (
        !stream ||
        stream.parts.length > 0 ||
        stream.checkpointBytes === 0 ||
        stream.checkpointBytes === stream.lastCheckpointBytes
      ) {
        continue;
      }

      const bytesAtSnapshot = stream.checkpointBytes;
      try {
        const buffer = Buffer.concat(stream.checkpointChunks);
        await this.s3Service.uploadStream({
          Bucket: this.config.s3.audioBucket!,
          // Separate key from the final object so this can never race with the
          // final write done on a clean endCallStream. Recovery promotes it.
          Key: `${stream.key}${AUDIO_CHECKPOINT_SUFFIX}`,
          Body: buffer,
          ContentType: 'audio/raw',
        });
        stream.lastCheckpointBytes = bytesAtSnapshot;
        this.logger.debug(
          `Checkpointed ${bytesAtSnapshot} byte(s) of in-progress audio | ChatId: ${stream.chatId}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to checkpoint in-progress audio for chat ${stream.chatId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

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
      mode?: ScribeSessionMode;
      sampleRate?: number;
      isLinear16Encoded?: boolean;
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
            mode: chatData.mode,
            isLinear16Encoded: chatData.isLinear16Encoded,
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

      // Broadcast user joined AFTER transaction is committed to ensure
      // subsequent GET /chats/counsellor-chat calls by the client see the new chat.
      const channel = findMessageBrokerChannelUsingProvider(session.provider!);
      this.broadcastMessageService.broadcastUserJoinedMessage(channel!, {
        participants: [session.userId],
        userId: session.userId,
        chatId: chatId!,
      });

      this.logger.debug(
        `Call stream started and user joined broadcasted | ChatId: ${chatId} | Provider: ${session.provider}`,
      );
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
        checkpointChunks: [],
        checkpointBytes: 0,
        lastCheckpointBytes: 0,
        flushChain: Promise.resolve(),
        partUploadFailed: false,
      };

      this.logger.debug(
        `Call stream setup with dual files | ChatId: ${chatId} | Provider: ${session.provider}`,
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

    // Accumulate the raw audio for the durability checkpoint, but only until a
    // part flushes (after which the session is salvageable from the multipart
    // upload). Bounded by MIN_PART_SIZE, so this holds < 6 MB per short session.
    if (activeCallStream.parts.length === 0) {
      activeCallStream.checkpointChunks.push(audioBuffer);
      activeCallStream.checkpointBytes += audioBuffer.length;
    }

    // Check if we need to flush the current file
    if (currentFile.bufferSize >= this.MIN_PART_SIZE) {
      activeCallStream.currentFileIndex = currentFileIndex === 0 ? 1 : 0;
      // Chain the part upload so flushes run strictly in order (parts are
      // numbered) and a failure is OBSERVED rather than becoming an unhandled
      // rejection that silently corrupts the multipart. endCallStream awaits
      // this chain before completing the upload.
      activeCallStream.flushChain = activeCallStream.flushChain
        .then(() =>
          this.flushFileAsPart({
            chatId,
            activeCallStream,
            fileToFlushIndex: currentFileIndex,
            provider: session.provider!,
          }),
        )
        .catch((err) => {
          activeCallStream.partUploadFailed = true;
          this.logger.error(
            `Part upload failed | ChatId: ${chatId} | Provider: ${session.provider} | Error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      // The session now has a durable part; stop checkpointing and free the
      // accumulated buffer.
      activeCallStream.checkpointChunks = [];
      activeCallStream.checkpointBytes = 0;
      activeCallStream.lastCheckpointBytes = 0;
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
    userId,
    tenantId,
    allowRemoteFinalize = true,
  }: {
    chatId: number;
    provider?: AudioChatProvider;
    // Auth context to carry to the replica that finalizes (broker callbacks run
    // outside a request scope). Sourced from the chat on the ending replica.
    userId?: number | string;
    tenantId?: string;
    // When true and the stream isn't held here, broadcast so the owning replica
    // finalizes it. Set false for broadcast-triggered calls to prevent loops.
    allowRemoteFinalize?: boolean;
  }) {
    const activeCallStream = this.activeCallStreams[chatId];
    if (!activeCallStream) {
      if (allowRemoteFinalize) {
        // The recording lives on the replica that owns the WebSocket, not this
        // one (the end-session request was load-balanced here). Broadcast so
        // that replica finalizes it — otherwise the audio is never persisted
        // and the session fails with "no transcript".
        this.logger.warn(
          `No active stream for chatId ${chatId} on this replica; broadcasting finalize to peers | Provider: ${provider}`,
        );
        await this.messageBroker.publish(
          MessageBrokerChannel.MICROPHONE_STREAM_END,
          { chatId, provider, userId, tenantId },
        );
      } else {
        this.logger.debug(
          `No active stream for chatId ${chatId} here (broadcast finalize; not owned by this replica)`,
        );
      }
      return;
    }

    delete this.activeCallStreams[chatId];

    const currentFileIndex = activeCallStream.currentFileIndex;
    const currentFile = activeCallStream.files[currentFileIndex];
    this.chatService.updateCallMetadata(chatId);

    try {
      // Wait for any in-flight chained part uploads to finish before we flush
      // the tail and complete the multipart, so no part is still uploading (or
      // silently failed) when we finalize.
      await activeCallStream.flushChain;
      if (activeCallStream.partUploadFailed) {
        throw new Error(
          'One or more multipart part uploads failed; recording is incomplete',
        );
      }

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

      // The final object is now written; drop any durability checkpoint so it
      // doesn't linger in storage (best-effort — a stray checkpoint is harmless
      // and would otherwise be cleaned by the bucket lifecycle).
      await this.s3Service
        .deleteObject({
          bucket: this.config.s3.audioBucket!,
          key: `${activeCallStream.key}${AUDIO_CHECKPOINT_SUFFIX}`,
        })
        .catch(() => undefined);

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
        audience: 'internal',
      });

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.PRESIGNED_URL_GENERATED,
        details: {
          purpose: 'Audio presigned url generated',
          chatId,
          provider,
        },
      });
      const { chat, callDetails } =
        await this.chatService.getChatWithCallDetails(chatId);

      // If the stream was finalized because the socket died (not a clean user
      // stop), the audio is almost certainly partial — flag the session so the
      // summary can be shown as "from an incomplete recording" rather than a
      // clean success. Merge to preserve correlationId/streamEndReason/etc.
      const existingMeta =
        (chat?.metadata as Record<string, any> | undefined) ?? {};
      const streamEndReason = existingMeta.streamEndReason as
        | StreamEndReason
        | undefined;
      if (
        streamEndReason &&
        ABNORMAL_STREAM_END_REASONS.includes(streamEndReason)
      ) {
        await this.chatService.updateChat(chatId, {
          metadata: {
            ...existingMeta,
            incompleteRecording: { reason: streamEndReason },
          } as Record<string, any>,
        });
        this.logger.warn(
          `Flagged chat ${chatId} as incomplete recording (streamEndReason=${streamEndReason}) | Provider: ${provider}`,
        );
      }

      await this.aiEventService.publishTranscribeAudioEvent({
        message_type: 'transcribe_and_summarize_request',
        timestamp: Date.now(),
        audio_url: audioUrl,
        chat_id: chatId,
        sample_rate: sampleRate!,
        mode: callDetails?.callInfo?.mode,
        is_linear16_encoded: callDetails?.callInfo?.isLinear16Encoded,
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
