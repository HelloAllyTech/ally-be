import {
  createClient,
  DeepgramClient,
  LiveClient,
  LiveTranscriptionEvents,
} from '@deepgram/sdk';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import {
  DeepgramTranscriptMetadata,
  UserChatSessionData,
} from '../../chat/type/chat.type';
import { ITranscriptionService } from '../interfaces/transcription.interface';
import { DeepgramTranscriptionOptions } from '../type/transcription.type';

interface LiveClientSession {
  liveClient: LiveClient;
  keepAlive?: NodeJS.Timeout;
  audioBuffer: Buffer[];
  currentBufferSize: number;
  transcriptBuffer: string;
  currentUtterance: number;
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

  constructor(private readonly config: AppConfigService) {
    this.deepgramClient = createClient(config.ai.deepgramApiKey);
  }

  async onModuleDestroy() {
    // Cleanup all live connections when the application shuts down
    await this.cleanupAllConnections();
  }

  async startLiveTranscription(
    session: UserChatSessionData,
    chatId: number,
    callback: (
      session: UserChatSessionData,
      chatId: number,
      transcript: string,
    ) => void,
    options?: DeepgramTranscriptionOptions,
  ): Promise<void> {
    const userId = session.userId;
    this.logger.info(`startLiveTranscription -  userId: ${userId}`);

    if (this.liveClients.has(userId.toString())) {
      this.logger.warn(
        `startLiveTranscription - Live transcription already exists for userId: ${userId}`,
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
      };

      this.liveClients.set(userId.toString(), clientSession);
      this.setupKeepAlive(userId);
      await this.setupTranscriptionListeners(
        session,
        chatId,
        callback,
        liveClient,
      );
    } catch (error) {
      this.logger.error(
        `startLiveTranscription - Failed to start live transcription for userId: ${userId}`,
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
      numerals: options?.numerals ?? true,
      punctuate: options?.punctuate ?? true,
      channels: options?.channels ?? 1,
      endpointing: 2000,
      utterance_end_ms: 2000,
    });
  }

  private setupKeepAlive(userId: number): void {
    const clientSession = this.liveClients.get(userId.toString());
    if (!clientSession) return;

    clientSession.keepAlive = setInterval(() => {
      clientSession.liveClient.keepAlive();
    }, this.keepAliveInterval);
  }

  private async setupTranscriptionListeners(
    session: UserChatSessionData,
    chatId: number,
    callback: (
      session: UserChatSessionData,
      chatId: number,
      transcript: string,
    ) => void,
    liveClient: LiveClient,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      liveClient.on(LiveTranscriptionEvents.Open, () => {
        this.setupTranscriptionEvents(session, chatId, callback, liveClient);
        resolve();
      });

      liveClient.on(LiveTranscriptionEvents.Error, (error) => {
        this.logger.error(
          `Live transcription error for userId: ${session.userId}`,
          error,
        );
        reject(error);
      });
    });
  }

  private setupTranscriptionEvents(
    session: UserChatSessionData,
    chatId: number,
    callback: (
      session: UserChatSessionData,
      chatId: number,
      transcript: string,
      metadata: DeepgramTranscriptMetadata,
    ) => void,
    liveClient: LiveClient,
  ): void {
    liveClient.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel.alternatives[0].transcript?.trim();
      const clientSession = this.liveClients.get(session.userId.toString());
      if (transcript && clientSession) {
        const finalTranscript = clientSession?.transcriptBuffer + transcript;
        const isSentenceComplete =
          data.is_final &&
          this.isSentenceComplete(clientSession, finalTranscript);
        callback(session, chatId, transcript, {
          isFinal: data.is_final,
          isSentenceComplete,
          currentTranscriptBuffer: finalTranscript,
        });

        // reset buffer if sentence is complete
        if (isSentenceComplete) {
          clientSession.transcriptBuffer = '';
          clientSession.currentUtterance = data.duration * 1000;
        } else if (data.is_final) {
          // add to buffer
          clientSession.transcriptBuffer = finalTranscript;
        }
      }
    });

    // liveClient.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
    //   this.logger.info(`Utterance end for userId: ${session.userId}`);
    //   const clientSession = this.liveClients.get(session.userId.toString());
    //   if (clientSession) {
    //     clientSession.currentUtterance = data.duration * 1000;
    //     callback(session, chatId, '', {
    //       isFinal: data.is_final,
    //       currentTranscriptBuffer: clientSession.transcriptBuffer,
    //       isSentenceComplete: true,
    //     });
    //     clientSession.transcriptBuffer = '';
    //     clientSession.currentUtterance = data.duration * 1000;
    //   }
    // });

    liveClient.on(LiveTranscriptionEvents.Close, () => {
      this.logger.info(
        `Live transcription closed for userId: ${session.userId}`,
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

  async stopLiveTranscription(userId: number): Promise<void> {
    this.logger.info(`Stopping live transcription for userId: ${userId}`);
    await this.cleanupConnection(userId.toString());
  }

  async sendAudio(session: UserChatSessionData, audio: Buffer): Promise<void> {
    const userId = session.userId.toString();
    const clientSession = this.liveClients.get(userId);

    if (!clientSession) {
      throw new Error(`No live client found for userId: ${userId}`);
    }

    try {
      clientSession.liveClient.send(audio);
    } catch (error) {
      this.logger.error(`Failed to send audio for userId: ${userId}`, error);
      throw error;
    }
  }

  private async cleanupConnection(userId: string): Promise<void> {
    const clientSession = this.liveClients.get(userId);
    if (!clientSession) return;

    if (clientSession.keepAlive) {
      clearInterval(clientSession.keepAlive);
    }

    try {
      await clientSession.liveClient.requestClose();
    } catch (error) {
      this.logger.error(
        `Error closing connection for userId: ${userId}`,
        error,
      );
    } finally {
      this.liveClients.delete(userId);
    }
  }

  private async cleanupAllConnections(): Promise<void> {
    this.logger.info('Cleaning up all connections');
    const cleanup = Array.from(this.liveClients.keys()).map((userId) =>
      this.cleanupConnection(userId),
    );
    await Promise.all(cleanup);
  }
}
