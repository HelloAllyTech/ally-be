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
import {
  AudioChatProvider,
  AUDIO_CHECKPOINT_SUFFIX,
} from 'src/common/constants/chat.constants';
import { UserService } from 'src/user/service/user.service';
import { addDurationToDate } from 'src/common/util/date.util';
import {
  SUPPORTED_AUDIO_FILE_TYPES,
  UPLOADED_AUDIO_FILE_SIZE_LIMIT,
  CHAT_REPROCESS_LOOKBACK_DAYS,
  MAX_STUCK_REPROCESS_ATTEMPTS,
} from '../constants/chat.constants';
import { ChatAudioUploadStatus } from '../../audio/entity/chat-audio-uploads.entity';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from 'src/common/decorator/execution.context.decorator';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { NotificationService } from '../../notification/service/notification.service';

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
    private readonly notificationService: NotificationService,
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

      await this.notificationService.notifyTranscriptionFailure({
        chatId: chat.id,
        stage: 'audio-upload',
        mode: 'dispatch-failure',
        reason: `Failed to dispatch audio to AI service: ${error.message}`,
      });
    }
  }

  /**
   * One-time backfill for recordings stuck on "Processing". For each stuck chat
   * whose source audio is still in S3, regenerates a presigned URL and re-emits
   * the transcribe request so it gets a real transcript/summary; touching the
   * row resets its TTL clock so the reaper won't fail an in-flight reprocess.
   * Chats with no recoverable audio are marked FAILED. Posts a Slack summary.
   */
  async reprocessStuckChats(): Promise<{
    reprocessed: number[];
    unrecoverable: number[];
    errored: number[];
  }> {
    const stuckChats = await this.chatService.findReprocessableStuckChats();
    this.logger.info(
      `Reprocess backfill: ${stuckChats.length} stuck chat(s) within the last ${CHAT_REPROCESS_LOOKBACK_DAYS} days`,
    );

    const reprocessed: number[] = [];
    // Confirmed dead: audio flipped to 'failed', so these leave the selection.
    const unrecoverable: number[] = [];
    // Threw mid-reprocess (transient/unexpected). These are NOT confirmed
    // unrecoverable — their audio is untouched, so they'd be retried. Tracked
    // and reported separately so a recurring error is visible instead of
    // masquerading as "unrecoverable", and attempt-capped so it can't loop
    // forever.
    const errored: number[] = [];

    for (const chat of stuckChats) {
      try {
        const audio = await this.chatAudioUploadsService.getAudioUpload(
          chat.id,
        );

        // Preserve the original failure attribution: merge into existing
        // metadata and record the reprocess outcome in a SEPARATE field rather
        // than overwriting `error`/`stage`. Overwriting was collapsing every
        // reprocess-failed chat into one generic reason and erasing why it
        // originally failed.
        const existingMetadata =
          (chat.metadata as Record<string, any> | undefined) ?? {};

        // Count this reprocess attempt so a chat that can never be recovered
        // (audio truly gone) isn't re-selected forever — see the attempt cap in
        // findReprocessableStuckChats branch (c).
        const nextAttempts =
          Number(existingMetadata.reprocessAttempts ?? 0) + 1;

        if (!audio?.storageKey) {
          // If there is a pending upload row with no usable object, mark it
          // failed so branch (c) of the reprocess selection stops re-listing it.
          if (audio) {
            await this.chatAudioUploadsService.updateAudioUpload(chat.id, {
              status: ChatAudioUploadStatus.FAILED,
            });
          }
          await this.chatService.updateChat(chat.id, {
            summaryStatus: ChatSummaryStatus.FAILED,
            metadata: {
              ...existingMetadata,
              error:
                existingMetadata.error ??
                'Stuck with no stored audio to reprocess',
              reprocessError: 'No stored audio to reprocess',
              reprocessedAt: new Date().toISOString(),
              reprocessAttempts: nextAttempts,
            },
          });
          unrecoverable.push(chat.id);
          continue;
        }

        // Confirm the object exists before re-dispatching. A live session that
        // ended abnormally leaves an *incomplete* multipart upload — the parts
        // are in S3 but no readable object exists yet — so HEAD 404s. In that
        // case try to finalize it from the uploaded parts before giving up.
        try {
          await this.s3Service.getHeadObject({
            bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
            key: audio.storageKey,
          });
        } catch {
          const salvaged = await this.tryFinalizeIncompleteUpload(
            process.env.AUDIO_STORAGE_S3_BUCKET!,
            audio.storageKey,
            chat.id,
          );
          if (!salvaged) {
            // Confirmed unrecoverable: flip the upload from 'pending' to
            // 'failed' so the reprocess selection (which keys off a pending
            // upload) stops re-listing it every hour, and the audio-state
            // breakdown reflects "confirmed unrecoverable" vs "not yet tried".
            await this.chatAudioUploadsService.updateAudioUpload(chat.id, {
              status: ChatAudioUploadStatus.FAILED,
            });
            await this.chatService.updateChat(chat.id, {
              summaryStatus: ChatSummaryStatus.FAILED,
              metadata: {
                ...existingMetadata,
                error:
                  existingMetadata.error ??
                  'Audio no longer present in storage',
                reprocessError:
                  'Audio unrecoverable (no finalizable multipart upload)',
                reprocessedAt: new Date().toISOString(),
                reprocessAttempts: nextAttempts,
              },
            });
            unrecoverable.push(chat.id);
            continue;
          }
          // Salvaged: the object now exists — fall through to re-dispatch.
        }

        const audioUrl = await this.s3Service.generatePresignedUrl({
          bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
          key: audio.storageKey,
          operation: 'get',
          expiresIn: 3600,
          audience: 'internal',
        });

        await this.aiEventService.publishTranscribeAudioEvent({
          message_type: 'transcribe_and_summarize_request',
          chat_id: chat.id,
          timestamp: Date.now(),
          audio_url: audioUrl,
        });

        // Touch the row so updatedAt resets and the reaper gives this freshly
        // re-dispatched chat a full TTL window to complete.
        await this.chatService.updateChat(chat.id, {
          summaryStatus: ChatSummaryStatus.PENDING,
        });

        reprocessed.push(chat.id);
        this.logger.info(
          `Re-dispatched stuck chat ${chat.id} for transcription`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to reprocess stuck chat ${chat.id}: ${message}`,
        );
        errored.push(chat.id);
        // The chat's audio was NOT marked failed, so it stays selectable. Bump
        // the attempt counter (best-effort, separate write) so a chat that
        // errors on every run is eventually dropped by the attempt cap instead
        // of recurring forever and masquerading as "unrecoverable".
        try {
          const meta = (chat.metadata as Record<string, any> | undefined) ?? {};
          await this.chatService.updateChat(chat.id, {
            metadata: {
              ...meta,
              reprocessAttempts: Number(meta.reprocessAttempts ?? 0) + 1,
              lastReprocessError: message,
              reprocessedAt: new Date().toISOString(),
            },
          });
        } catch (bumpError) {
          this.logger.error(
            `Failed to record reprocess attempt for chat ${chat.id}: ${
              bumpError instanceof Error ? bumpError.message : String(bumpError)
            }`,
          );
        }
      }
    }

    await this.notificationService.notifyReprocessSummary({
      reprocessed,
      unrecoverable,
      errored,
    });

    return { reprocessed, unrecoverable, errored };
  }

  /**
   * Recover a live-session recording whose multipart upload was never completed
   * (the session ended abnormally, so `endCallStream` never ran). The parts are
   * still in S3 as an in-progress multipart upload; finalize it from those
   * parts so a readable object exists at the key and transcription can run.
   *
   * Returns true if the object was finalized (caller re-dispatches), false if
   * unrecoverable: no in-progress upload (already aborted / lifecycle-expired)
   * or zero uploaded parts (a very short session whose audio only ever lived in
   * the in-memory buffer). Best-effort — never throws. Note the finalized audio
   * omits the final un-flushed buffer (< one part), so it may lose a small tail.
   */
  private async tryFinalizeIncompleteUpload(
    bucket: string,
    key: string,
    chatId: number,
  ): Promise<boolean> {
    try {
      const uploadId = await this.s3Service.findInProgressMultipartUploadId({
        bucket,
        key,
      });
      // No in-progress upload (already aborted / lifecycle-expired). Fall back
      // to a durability checkpoint if the session wrote one before dying.
      if (!uploadId) return this.tryPromoteCheckpoint(bucket, key, chatId);

      const parts = await this.s3Service.listMultipartParts({
        bucket,
        key,
        uploadId,
      });
      if (parts.length === 0) {
        // Nothing was ever flushed as a part. Abort to release the in-progress
        // upload (best-effort), then fall back to the durability checkpoint —
        // a short session that never reached 6 MB still has its audio there.
        await this.s3Service
          .abortMultipartUpload({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          })
          .catch(() => undefined);
        return this.tryPromoteCheckpoint(bucket, key, chatId);
      }

      await this.s3Service.completeMultipartUploadWithParts({
        bucket,
        key,
        uploadId,
        parts,
      });
      // The object now exists — mark the upload SUCCESS so it isn't treated as
      // pending again.
      await this.chatAudioUploadsService.updateAudioUpload(chatId, {
        status: ChatAudioUploadStatus.SUCCESS,
      });
      this.logger.info(
        `Finalized abandoned multipart upload for chat ${chatId} ` +
          `(${parts.length} part(s)); audio recovered for re-transcription`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to finalize incomplete upload for chat ${chatId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /**
   * Fallback recovery when the multipart upload can't be finalized (no parts /
   * no in-progress upload): a live session that died before flushing a 6 MB
   * part still has its audio in the durability checkpoint object written by the
   * stream processor. Promote it to the canonical key so transcription can run.
   * Returns true if a checkpoint existed and was promoted. Best-effort.
   */
  private async tryPromoteCheckpoint(
    bucket: string,
    key: string,
    chatId: number,
  ): Promise<boolean> {
    const checkpointKey = `${key}${AUDIO_CHECKPOINT_SUFFIX}`;
    try {
      await this.s3Service.getHeadObject({ bucket, key: checkpointKey });
    } catch {
      // No checkpoint object — genuinely unrecoverable.
      return false;
    }
    try {
      await this.s3Service.copyObject({
        bucket,
        sourceKey: checkpointKey,
        destKey: key,
      });
      await this.chatAudioUploadsService.updateAudioUpload(chatId, {
        status: ChatAudioUploadStatus.SUCCESS,
      });
      // Tidy up the checkpoint now that the canonical object exists.
      await this.s3Service
        .deleteObject({ bucket, key: checkpointKey })
        .catch(() => undefined);
      this.logger.info(
        `Recovered chat ${chatId} from durability checkpoint ${checkpointKey}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to promote durability checkpoint for chat ${chatId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /**
   * Recover a single chat by re-transcribing from its stored audio. Used as the
   * fallback for the Retry action when there is no transcript to summarise from
   * (transcription itself never came back). Re-dispatches the transcribe request
   * with the original mode/sample-rate and resets the chat to PENDING so the
   * pipeline runs again. Bounded by MAX_STUCK_REPROCESS_ATTEMPTS.
   */
  async reprocessChatById(
    chatId: number,
  ): Promise<{ reprocessed: boolean; reason?: string }> {
    const audio = await this.chatAudioUploadsService.getAudioUpload(chatId);
    if (!audio?.storageKey) {
      return {
        reprocessed: false,
        reason: 'No stored audio to re-transcribe',
      };
    }

    const { chat, callDetails } =
      await this.chatService.getChatWithCallDetails(chatId);
    const metadata = (chat?.metadata as Record<string, any>) ?? {};
    const attempts = Number(metadata.reprocessAttempts ?? 0);
    if (attempts >= MAX_STUCK_REPROCESS_ATTEMPTS) {
      return {
        reprocessed: false,
        reason: `Re-transcription attempt limit reached (${MAX_STUCK_REPROCESS_ATTEMPTS})`,
      };
    }

    // Confirm the object still exists before re-dispatching.
    try {
      await this.s3Service.getHeadObject({
        bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
        key: audio.storageKey,
      });
    } catch {
      return {
        reprocessed: false,
        reason: 'Audio no longer present in storage',
      };
    }

    const audioUrl = await this.s3Service.generatePresignedUrl({
      bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
      key: audio.storageKey,
      operation: 'get',
      expiresIn: 3600,
      audience: 'internal',
    });

    await this.aiEventService.publishTranscribeAudioEvent({
      message_type: 'transcribe_and_summarize_request',
      chat_id: chatId,
      timestamp: Date.now(),
      audio_url: audioUrl,
      sample_rate: audio.sampleRate ?? undefined,
      mode: callDetails?.callInfo?.mode,
      is_linear16_encoded: callDetails?.callInfo?.isLinear16Encoded,
    });

    // publishTranscribeAudioEvent set IN_PROGRESS + a fresh correlationId.
    // Preserve that, bump the re-transcribe count, and reset to PENDING so the
    // reaper gives the freshly re-dispatched chat a full window.
    const refreshed = await this.chatService.getChatById(chatId);
    const refreshedMeta = (refreshed?.metadata as Record<string, any>) ?? {};
    await this.chatService.updateChat(chatId, {
      summaryStatus: ChatSummaryStatus.PENDING,
      metadata: {
        ...refreshedMeta,
        reprocessAttempts: attempts + 1,
      } as Record<string, any>,
    });

    this.logger.info(
      `Re-dispatched chat ${chatId} for re-transcription (retry fallback), attempt ${attempts + 1}`,
    );
    return { reprocessed: true };
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
