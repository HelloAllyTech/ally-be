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
  }

  async startLiveTranscription(
    session: UserChatSessionData,
    chatId: number,
    callback: (
      session: UserChatSessionData,
      chatId: number,
      event: any,
    ) => void,
  ) {
    this.logger.info(`startLiveTranscription - chatId :${chatId}`);
    if (this.liveClients[chatId]) {
      return;
    }
    const liveClient = this.deepgramClient.listen.live({
      model: 'nova-3',
      smart_format: true,
    });
    this.liveClients[chatId] = {
      liveClient,
    };
    this.keepAlive(chatId);
    this.addTranscriptListener(session, chatId, callback);
    return liveClient;
  }

  private addTranscriptListener(
    session: UserChatSessionData,
    chatId: number,
    callback: (session: UserChatSessionData, chatId: number, data: any) => void,
  ) {
    const liveClient = this.liveClients[chatId].liveClient;
    liveClient.on(LiveTranscriptionEvents.Open, () => {
      liveClient.on(LiveTranscriptionEvents.Transcript, (data) => {
        callback(session, chatId, data);
      });
    });
  }

  private keepAlive(chatId: number) {
    const liveClient = this.liveClients[chatId];
    if (!liveClient) {
      return;
    }
    liveClient.keepAlive = setInterval(() => {
      liveClient.liveClient.keepAlive();
    }, this.keepAliveInterval);
    return liveClient.keepAlive;
  }

  async stopLiveTranscription(chatId: number) {
    this.logger.info(`stopLiveTranscription - chatId :${chatId}`);
    const liveClient = this.liveClients[chatId];
    if (!liveClient) {
      return;
    }
    liveClient.keepAlive && clearInterval(liveClient.keepAlive);
    liveClient.liveClient.requestClose();
    delete this.liveClients[chatId];
  }

  async sendAudio(chatId: number, audio: Buffer) {
    this.logger.info(`sendAudio - chatId :${chatId}`);
    const liveClient = this.liveClients[chatId];
    liveClient.liveClient.send(audio);
  }
}
