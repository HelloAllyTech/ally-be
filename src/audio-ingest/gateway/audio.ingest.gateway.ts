import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';
import { LoggerService } from '../../logger/logger.service';
import { OnGatewayConnection } from '@nestjs/websockets';

@Injectable()
export class AudioIngestGateway implements OnGatewayConnection {
  private wss: WebSocket.Server;

  private readonly logger = LoggerService.getInstance(AudioIngestGateway.name);

  constructor() {
    this.wss = new WebSocket.Server({ noServer: true });
    this.initialize();
  }
  handleConnection(client: any, ...args: any[]) {
    this.logger.info('3rd-party WS client connected - ' + client.id);
  }

  getWss(): WebSocket.Server {
    return this.wss;
  }

  initialize(): void {
    this.logger.info('Initializing Audio Ingest Gateway');

    this.wss.on('connection', (ws) => {
      let isAlive = true;

      this.logger.info('3rd-party WS client connected');

      ws.send('Hello from the server!');

      ws.on('pong', () => {
        isAlive = true;
      });

      ws.on('message', (msg) => {
        this.logger.info(`Received from 3rd-party: ${msg.toString()}`);
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
        this.logger.info('3rd-party WS client disconnected');
      });
    });
  }
}
