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
  private bufferSize = 48000;
  private liveClients: {
    [key: string]: {
      liveClient: LiveClient;
      keepAlive?: NodeJS.Timeout;
      audioBuffer: Buffer[];
      currentBufferSize: number;
    };
  } = {};

  constructor(private config: AppConfigService) {
    this.deepgramClient = createClient(config.ai.deepgramApiKey);
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
      // diarize: true,
      interim_results: true,
      numerals: true,
      punctuate: true,
      //endpointing: 100,
      channels: 1,
      // encoding: 'linear16',
      //sample_rate: 16000,
      utterance_end_ms: 1000,
      extra: 'test:1',
      //  vad_events: true,
    });
    this.liveClients[userId] = {
      liveClient,
      audioBuffer: [],
      currentBufferSize: 0,
    };
    try {
      this.keepAlive(userId);
      this.addTranscriptListener(session, chatId, callback);
      return liveClient;
    } catch (error) {
      this.logger.error(
        `Error starting live transcription for userId: ${userId}`,
        error,
      );
      return null;
    }
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
        if (data.channel.alternatives[0].transcript?.trim() && data.is_final) {
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
      liveClient.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
        this.logger.info(
          `UtteranceEnd event for userId: ${userId} - ${JSON.stringify(data)}`,
        );
      });
      liveClient.on(LiveTranscriptionEvents.Unhandled, (data) => {
        this.logger.info(
          `Unhandled event for userId: ${userId} - ${JSON.stringify(data)}`,
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

  async sendAudio(session: UserChatSessionData, audio: Buffer) {
    const userId = session.userId;
    this.logger.info(
      `sendAudio - userId :${userId} - audio : ${Buffer.from(audio).toString()}`,
    );
    const liveClient = this.liveClients[userId];
    if (!liveClient) {
      this.logger.error(`Live client not found for userId: ${userId}`);
      return;
    }
    this.logger.info(
      `sendAudio - userId :${userId} - audio length: ${audio.length} | liveClientStatus - ${liveClient.liveClient.getReadyState()}`,
    );
    // const audioData = new Float32Array([...audio]); // Your normalized audio data (-1.0 to 1.0)

    // // Convert float values to 16-bit PCM
    // const int16Array = new Int16Array(
    //   audioData.map((sample) => Math.max(-1, Math.min(1, sample)) * 32767),
    // );

    // // Convert to a Buffer (equivalent to .tobytes())
    //const audioBytes = Buffer.from(int16Array.buffer);
    // console.log(audioBytes);
    // console.log(audio.toString('base64'));

    liveClient.liveClient.send(audio);

    /***
     *
     */
    // const inputPath = `temp/audio-${Date.now()}.webm`;
    // const outputPath = `temp/audio-${Date.now()}.wav`;

    // // Save WebM file
    // writeFileSync(inputPath, Buffer.from(audio));

    // // Convert WebM to WAV (16-bit PCM, 16kHz)
    // ffmpeg(inputPath)
    //   .toFormat('wav')
    //   .audioFrequency(16000)
    //   .audioChannels(1)
    //   .on('end', async () => {
    //     console.log(`Converted ${inputPath} -> ${outputPath}`);

    //     // Send WAV file to Deepgram
    //     const buffer = readFileSync(outputPath);
    //     liveClient.liveClient.send(buffer);

    //     // Cleanup files
    //     // unlinkSync(inputPath);
    //     // unlinkSync(outputPath);
    //   })
    //   .on('error', (err: any) => console.error('FFmpeg Error:', err))
    //   .save(outputPath);
    /*** */
    // liveClient.liveClient.send(audio);

    // liveClient.audioBuffer.push(audio);
    // liveClient.currentBufferSize += audio.length;

    // if (liveClient.currentBufferSize >= this.bufferSize) {
    //   const concatenatedBuffer = Buffer.concat(liveClient.audioBuffer);
    //   this.logger.info(`concatenatedBuffer: ${concatenatedBuffer.length}`);
    //   writeFileSync(`audio-${new Date().getTime()}.wav`, concatenatedBuffer);
    //   liveClient.liveClient.send(Buffer.from(concatenatedBuffer));

    //   // Reset buffer
    //   liveClient.audioBuffer = [];
    //   liveClient.currentBufferSize = 0;
    // }
  }
}
