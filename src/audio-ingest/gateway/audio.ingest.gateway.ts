import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';
import { LoggerService } from '../../logger/logger.service';
import { OnGatewayConnection } from '@nestjs/websockets';
import { AudioIngestService } from '../service/audio-ingest.service';

@Injectable()
export class AudioIngestGateway implements OnGatewayConnection {
  private wss: WebSocket.Server;

  private readonly logger = LoggerService.getInstance(AudioIngestGateway.name);

  constructor(private audioIngestService: AudioIngestService) {
    this.wss = new WebSocket.Server({ noServer: true });
    this.initialize();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleConnection(client: any, ...args: any[]) {
    this.logger.info(
      '3rd-party WS client connected via NestJS gateway' + client.id,
    );
  }

  getWss(): WebSocket.Server {
    return this.wss;
  }

  initialize(): void {
    this.logger.info('Initializing Audio Ingest Gateway');

    this.wss.on('connection', async (ws: WebSocket) => {
      let isAlive = true;

      ws.on('pong', () => {
        isAlive = true;
      });

      ws.on('message', async (msg: any) => {
        this.logger.info(`Audio Ingest Gateway: Received message`);
        const messageData = JSON.parse(msg.toString());
        this.audioIngestService.handleConnectionAlive(ws, messageData);
        await this.audioIngestService.handleStreamEvent(messageData, ws);
      });

      const pingInterval = setInterval(() => {
        if (!isAlive) {
          this.logger.warn('3rd-party WS client unresponsive, terminating');
          return ws.terminate();
        }

        isAlive = false;
        ws.ping();
      }, 30_000);

      ws.on('close', () => {
        clearInterval(pingInterval);
        this.logger.info(`Audio Ingest Gateway: Client disconnected`);
        // TODO: handle close event
      });
    });
  }
}
