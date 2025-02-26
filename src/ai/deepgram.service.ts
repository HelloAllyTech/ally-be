import { Blob } from 'buffer';
import {
  createClient,
  DeepgramClient,
  LiveClient,
  LiveTranscriptionEvents,
} from '@deepgram/sdk';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { LoggerService } from '../logger/logger.service';
import { UserChatSessionData } from '../chat/type/chat.type';

@Injectable()
export class DeepgramService {
  private logger = LoggerService.getInstance(DeepgramService.name);
  private deepgramClient: DeepgramClient;
  private keepAliveInterval = 3000;
  private liveClients: {
    [key: string]: { liveClient: LiveClient; keepAlive?: NodeJS.Timeout };
  } = {};

  constructor(private config: AppConfigService) {
    this.deepgramClient = createClient(config.ai.deepgramApiKey);

    // Define Blob globally so Deepgram doesn't crash
    if (typeof globalThis.Blob === 'undefined') {
      globalThis.Blob = Blob as any;
    }
  }

  async startLiveTranscription(
    session: UserChatSessionData,
    chatId: number,
    callback: (
      session: UserChatSessionData,
      userId: number,
      event: any,
    ) => void,
  ) {
    const userId = session.userId;
    this.logger.info(`startLiveTranscription - userId :${userId}`);
    if (this.liveClients[userId]) {
      return;
    }
    const liveClient = this.deepgramClient.listen.live({
      model: 'nova-3',
      smart_format: true,
      diarize: true,
      interim_results: true,
      numerals: true,
      punctuate: true,
      endpointing: false,
      channels: 1,
      //encoding: 'mulaw',
      //sample_rate: 16000,
      utterance_end_ms: 1000,
      extra: '',
    });
    this.liveClients[userId] = {
      liveClient,
    };
    this.keepAlive(userId);
    this.addTranscriptListener(session, chatId, callback);
    return liveClient;
  }

  private addTranscriptListener(
    session: UserChatSessionData,
    chatId: number,
    callback: (session: UserChatSessionData, chatId: number, data: any) => void,
  ) {
    const userId = session.userId;
    const liveClient = this.liveClients[userId].liveClient;
    liveClient.on(LiveTranscriptionEvents.Open, () => {
      liveClient.on(LiveTranscriptionEvents.Transcript, (data) => {
        this.logger.info(
          `Transcript received for userId: ${userId}| ${data.channel.alternatives[0].transcript} | is Final :${JSON.stringify(data)}`,
        );
        if (
          data.channel.alternatives[0].is_final &&
          data.channel.alternatives[0].transcript?.trim()
        ) {
          callback(session, chatId, data.channel.alternatives[0].transcript);
        }
      });
      liveClient.on(LiveTranscriptionEvents.Close, () => {
        this.logger.info(`Live transcription closed for userId: ${userId}`);
      });
      liveClient.on(LiveTranscriptionEvents.Error, (error) => {
        this.logger.error(
          `Live transcription error for userId: ${userId}`,
          error,
        );
      });
    });
  }

  private keepAlive(userId: number) {
    const liveClient = this.liveClients[userId];
    if (!liveClient) {
      return;
    }
    liveClient.keepAlive = setInterval(() => {
      liveClient.liveClient.keepAlive();
    }, this.keepAliveInterval);
    return liveClient.keepAlive;
  }

  async stopLiveTranscription(userId: number) {
    this.logger.info(`stopLiveTranscription - userId :${userId}`);
    const liveClient = this.liveClients[userId];
    if (!liveClient) {
      return;
    }
    liveClient.keepAlive && clearInterval(liveClient.keepAlive);
    liveClient.liveClient.requestClose();
    delete this.liveClients[userId];
  }

  async sendAudio(userId: number, audio: Buffer) {
    this.logger.info(`sendAudio - userId :${userId}`);
    const liveClient = this.liveClients[userId];

    // const arrayBuffer = audio.buffer.slice(
    //   audio.byteOffset,
    //   audio.byteOffset + audio.byteLength,
    // );

    //liveClient.liveClient.sendBuffer(arrayBuffer);
    liveClient.liveClient.send(audio);
  }
}
