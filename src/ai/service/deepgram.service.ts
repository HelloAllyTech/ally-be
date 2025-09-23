import {
  createClient,
  DeepgramClient,
  LiveClient,
  LiveTranscriptionEvents,
} from '@deepgram/sdk';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  DeepgramTranscriptMetadata,
  UserChatSessionData,
} from '../../chat/type/chat.type';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { ITranscriptionService } from '../interfaces/transcription.interface';
import {
  DeepgramTranscriptionOptions,
  DeepgramTranscriptResult,
  SpeakerSegment,
} from '../type/transcription.type';

interface LiveClientSession {
  liveClient: LiveClient;
  keepAlive?: NodeJS.Timeout;
  audioBuffer: Buffer[];
  currentBufferSize: number;
  transcriptBuffer: string;
  currentUtterance: number;
  currentTranscriptStart?: number;
  currentTranscriptEnd?: number;
  isDiarizationEnabled: boolean;
  speakerSegmentsBuffer: SpeakerSegment[];
}

@Injectable()
export class DeepgramService implements ITranscriptionService, OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(DeepgramService.name);
  private readonly deepgramClient: DeepgramClient;
  private readonly keepAliveInterval = 3000;
  private readonly bufferSize = 48000;
  private readonly liveClients: Map<string, LiveClientSession> = new Map();
  private endOfSentencePunctuation = ['.', '!', '?'];
  private minUtteranceDuration = 500;
  private pendingAudioQueue: Map<string, Buffer[]> = new Map();

  constructor(private readonly config: AppConfigService) {
    this.deepgramClient = createClient(config.ai.deepgramApiKey);
  }
  async handleAudioChatMuted(session: UserChatSessionData): Promise<void> {
    this.logger.debug(`handleAudioChatMuted for userId: ${session.userId}`);
    const clientSession = this.liveClients.get(session.id);
    if (clientSession) {
      await clientSession.liveClient.finalize();
    }
    return;
  }

  async onModuleDestroy() {
    // Cleanup all live connections when the application shuts down
    await this.cleanupAllConnections();
  }

  async startLiveTranscription(
    {
      session,
      chatId,
      chatCreatedAt,
      options,
    }: {
      session: UserChatSessionData;
      chatId: number;
      chatCreatedAt?: Date;
      options?: DeepgramTranscriptionOptions;
    },
    callback: (
      session: UserChatSessionData,
      chatId: number,
      transcript: string,
    ) => void,
  ): Promise<void> {
    this.logger.debug(`startLiveTranscription -  userId: ${session.userId}`);

    if (this.liveClients.has(session.id)) {
      this.logger.warn(
        `startLiveTranscription - Live transcription already exists for userId: ${session.userId}`,
      );
      return;
    }

    try {
      const liveClient = this.createLiveClient(options);
      const clientSession: LiveClientSession = {
        liveClient,
        audioBuffer: [],
        currentBufferSize: 0,
        transcriptBuffer: '',
        currentUtterance: 0,
        currentTranscriptStart: undefined,
        currentTranscriptEnd: undefined,
        isDiarizationEnabled: options?.diarize ?? false,
        speakerSegmentsBuffer: [],
      };
      this.setupKeepAlive(clientSession, liveClient);
      await this.setupTranscriptionListeners(
        {
          session,
          chatId,
          chatCreatedAt,
        },
        liveClient,
        callback,
      );
      this.processPendingAudioQueue(session, clientSession);
      this.liveClients.set(session.id, clientSession);
    } catch (error) {
      this.logger.error(
        `startLiveTranscription - Failed to start live transcription for userId: ${session.userId}`,
        error,
      );
      throw error;
    }
  }

  private createLiveClient(options?: DeepgramTranscriptionOptions): LiveClient {
    return this.deepgramClient.listen.live({
      model: options?.model ?? 'nova-3',
      smart_format: options?.smartFormat ?? true,
      interim_results: options?.interimResults ?? true,
      numerals: options?.numerals ?? false,
      punctuate: options?.punctuate ?? true,
      channels: options?.channels ?? 1,
      endpointing: options?.endpointing ?? 300,
      utterance_end_ms: options?.utteranceEndMs ?? 2000,
      language: options?.language ?? 'multi',
      diarize: options?.diarize ?? false,
      ...(options?.encoding && { encoding: options.encoding }),
      ...(options?.sample_rate && { sample_rate: options.sample_rate }),
    });
  }

  private setupKeepAlive(
    clientSession: LiveClientSession,
    liveClient: LiveClient,
  ): void {
    if (!clientSession) return;

    clientSession.keepAlive = setInterval(() => {
      liveClient.keepAlive();
    }, this.keepAliveInterval);
  }

  private async setupTranscriptionListeners(
    {
      session,
      chatId,
      chatCreatedAt,
    }: {
      session: UserChatSessionData;
      chatId: number;
      chatCreatedAt?: Date;
    },
    liveClient: LiveClient,
    callback: (
      session: UserChatSessionData,
      chatId: number,
      transcript: string,
    ) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      liveClient.on(LiveTranscriptionEvents.Open, () => {
        this.setupTranscriptionEvents(
          {
            session,
            chatId,
            chatCreatedAt,
          },
          liveClient,
          callback,
        );
        resolve();
      });

      liveClient.on(LiveTranscriptionEvents.Error, (error) => {
        this.logger.error(
          `Live transcription error for userId: ${session.userId} | error: ${error.message}`,
        );
        reject(error);
      });
    });
  }

  private getTranscriptSpeakerSegments(
    data: DeepgramTranscriptResult,
  ): SpeakerSegment[] {
    const words = data.channel.alternatives[0].words;
    const speakerSegments = words.map((word) => {
      return {
        speaker: word.speaker,
        word: word.word,
      };
    });

    return speakerSegments;
  }

  private setupTranscriptionEvents(
    {
      session,
      chatId,
      chatCreatedAt,
    }: {
      session: UserChatSessionData;
      chatId: number;
      chatCreatedAt?: Date;
    },
    liveClient: LiveClient,
    callback: (
      session: UserChatSessionData,
      chatId: number,
      transcript: string,
      metadata: DeepgramTranscriptMetadata,
    ) => void,
  ): void {
    liveClient.on(
      LiveTranscriptionEvents.Transcript,
      (data: DeepgramTranscriptResult) => {
        const transcript = data.channel.alternatives[0].transcript?.trim();
        this.logger.debug(
          `Transcript for userId: ${session.userId} | transcript: ${transcript} | isFinal: ${data.is_final} | isSpeech:${data.speech_final}`,
        );
        const clientSession = this.liveClients.get(session.id);
        if (transcript && clientSession) {
          let speakerSegments;
          let finalSpeakerSegments: SpeakerSegment[] = [];
          if (clientSession.isDiarizationEnabled) {
            speakerSegments = this.getTranscriptSpeakerSegments(data);
            finalSpeakerSegments =
              clientSession.speakerSegmentsBuffer.concat(speakerSegments);
          }
          const finalTranscript = clientSession?.transcriptBuffer + transcript;
          const transcriptWords = data.channel.alternatives[0].words;
          clientSession.currentTranscriptStart =
            clientSession.currentTranscriptStart || transcriptWords[0].start;
          const end = transcriptWords[transcriptWords.length - 1].end;
          clientSession.currentTranscriptEnd = end;
          const currentTranscriptCreatedAt = chatCreatedAt
            ? new Date(
                new Date(chatCreatedAt).getTime() +
                  clientSession.currentTranscriptStart * 1000,
              )
            : new Date();
          const isSentenceComplete =
            data.is_final &&
            this.isSentenceComplete(clientSession, finalTranscript);
          const wordCount = data.is_final
            ? this.getWordCountByLanguage(data)
            : undefined;
          callback(session, chatId, transcript, {
            isFinal: data.is_final,
            isSentenceComplete,
            currentTranscriptBuffer: finalTranscript,
            currentTranscriptCreatedAt,
            currentTranscriptStart: clientSession.currentTranscriptStart,
            currentTranscriptEnd: clientSession.currentTranscriptEnd,
            wordCountByLanguage: wordCount,
            speakerSegments: finalSpeakerSegments,
          });

          // reset buffer if sentence is complete
          if (isSentenceComplete) {
            clientSession.transcriptBuffer = '';
            clientSession.currentTranscriptStart = undefined;
            clientSession.currentTranscriptEnd = undefined;
            clientSession.speakerSegmentsBuffer = [];
          } else if (data.is_final) {
            // add to buffer
            clientSession.transcriptBuffer = finalTranscript;
            clientSession.speakerSegmentsBuffer = finalSpeakerSegments;
          }
        }
      },
    );

    liveClient.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
      this.logger.debug(
        `Utterance end for userId: ${session.userId} | data : ${JSON.stringify(
          data,
        )}`,
      );
      const clientSession = this.liveClients.get(session.id);
      if (clientSession) {
        const transcriptWords = data.channel.alternatives[0].words;
        clientSession.currentTranscriptStart =
          clientSession.currentTranscriptStart || transcriptWords[0].start;
        const end = transcriptWords[transcriptWords.length - 1].end;
        clientSession.currentTranscriptEnd = end;
        const currentTranscriptCreatedAt =
          chatCreatedAt && clientSession.currentTranscriptStart
            ? new Date(
                new Date(chatCreatedAt).getTime() +
                  clientSession.currentTranscriptStart * 1000,
              )
            : new Date();
        callback(session, chatId, '', {
          isFinal: data.is_final,
          currentTranscriptBuffer: clientSession?.transcriptBuffer || '',
          isSentenceComplete: true,
          isUtteranceEnd: true,
          currentTranscriptCreatedAt,
          currentTranscriptStart: clientSession.currentTranscriptStart,
          currentTranscriptEnd: clientSession.currentTranscriptEnd,
        });
        clientSession.transcriptBuffer = '';
        clientSession.currentTranscriptStart = undefined;
        clientSession.currentTranscriptEnd = undefined;
      }
    });

    liveClient.on(LiveTranscriptionEvents.Close, () => {
      this.logger.debug(
        `Live transcription closed for userId: ${session.userId}`,
      );
      const clientSession = this.liveClients.get(session.id);
      if (clientSession?.transcriptBuffer?.trim()) {
        const currentTranscriptCreatedAt =
          clientSession.currentTranscriptStart && chatCreatedAt
            ? new Date(
                new Date(chatCreatedAt).getTime() +
                  clientSession.currentTranscriptStart * 1000,
              )
            : new Date();
        callback(session, chatId, clientSession.transcriptBuffer, {
          isFinal: true,
          isSentenceComplete: true,
          currentTranscriptBuffer: clientSession.transcriptBuffer,
          currentTranscriptCreatedAt,
          currentTranscriptStart: clientSession.currentTranscriptStart,
          currentTranscriptEnd: clientSession.currentTranscriptEnd,
        });
      }
      this.liveClients.delete(session.id);
    });

    liveClient.on(LiveTranscriptionEvents.Error, (error) => {
      this.logger.error(
        `Live transcription error for userId: ${session.userId} | error: ${error.message}`,
      );
    });

    liveClient.on(LiveTranscriptionEvents.Unhandled, (data) => {
      this.logger.error(
        `Live transcription unhandled event for userId: ${session.userId}`,
        data,
      );
    });
  }

  private isSentenceComplete(
    clientSession: LiveClientSession,
    transcript: string,
  ): boolean {
    const lastChar = transcript[transcript.length - 1];
    const isEndOfSentence = this.endOfSentencePunctuation.includes(lastChar);
    // TODO include nlp to check if the sentence is complete
    return isEndOfSentence;
  }

  async stopLiveTranscription(session: UserChatSessionData): Promise<void> {
    this.logger.debug(`Stopping live transcription for userId: ${session.id}`);
    await this.cleanupConnection(session.id);
  }

  async sendAudio(session: UserChatSessionData, audio: Buffer): Promise<void> {
    const clientSession = this.liveClients.get(session.id);

    if (!clientSession) {
      if (!this.pendingAudioQueue.has(session.id)) {
        this.pendingAudioQueue.set(session.id, []);
      }
      this.pendingAudioQueue.get(session.id)?.push(audio);
      return;
    }

    try {
      this.processPendingAudioQueue(session, clientSession);
      clientSession.liveClient.send(audio);
    } catch (error) {
      this.logger.error(
        `Failed to send audio for userId: ${session.userId} | sessionId: ${session.id}`,
        error,
      );
      throw error;
    }
  }

  private processPendingAudioQueue(
    session: UserChatSessionData,
    clientSession: LiveClientSession,
  ): void {
    const audioQueue = this.pendingAudioQueue.get(session.id);
    if (audioQueue) {
      for (const audio of audioQueue) {
        clientSession.liveClient.send(audio);
      }
      this.pendingAudioQueue.delete(session.id);
    }
  }

  private async cleanupConnection(sessionId: string): Promise<void> {
    this.logger.debug(`Cleaning up connection for sessionId: ${sessionId}`);
    const clientSession = this.liveClients.get(sessionId);
    if (!clientSession) return;

    if (clientSession.keepAlive) {
      clearInterval(clientSession.keepAlive);
    }

    try {
      await clientSession.liveClient.finalize();
      await clientSession.liveClient.requestClose();
    } catch (error) {
      this.logger.error(
        `Error closing connection for userId: ${sessionId}`,
        error,
      );
    }
  }

  private async cleanupAllConnections(): Promise<void> {
    this.logger.debug('Cleaning up all connections');
    const cleanup = Array.from(this.liveClients.keys()).map((sessionId) =>
      this.cleanupConnection(sessionId),
    );
    await Promise.all(cleanup);
  }

  private getWordCountByLanguage(
    data: DeepgramTranscriptResult,
  ): Record<string, number> | undefined {
    const wordList = data.channel.alternatives[0]?.words;

    if (!wordList?.length) {
      return undefined;
    }

    return wordList.reduce<Record<string, number>>((acc, word) => {
      const language = word.language || 'unknown';
      acc[language] = (acc[language] || 0) + 1;
      return acc;
    }, {});
  }
}
