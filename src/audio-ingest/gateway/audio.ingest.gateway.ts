import { Injectable } from '@nestjs/common';

import * as WebSocket from 'ws';

import { Server } from 'http';

import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class AudioIngestGateway {
  private wss: WebSocket.Server | undefined;

  private logger = LoggerService.getInstance(AudioIngestGateway.name);

  initialize(httpServer: Server) {
    this.logger.info('Initializing Audio Ingest Gateway');

    this.wss = new WebSocket.Server({
      server: httpServer,
      path: '/ws',
      verifyClient: (info, callback) => {
        console.log('verifyClient', info);
        callback(true);
      },
    });

    this.wss.on('connection', (ws) => {
      let isAlive = true;

      console.log('3rd-party WS client connected');

      ws.send('Hello from the server!!!!!');

      ws.on('pong', () => {
        isAlive = true;
      });
      let counter = 0;

      ws.on('message', (msg) => {
        console.log('Received from 3rd party:', msg.toString());

        counter++;
        if (counter < 10) {
          ws.send('Hello from the server!!!!!');
        }
      });

      // send ping every 30 seconds

      const pingInterval = setInterval(() => {
        if (isAlive) {
          this.logger.info('Sending ping to 3rd-party WS client');

          ws.ping();
        }
      }, 30 * 1000);

      ws.on('close', () => {
        clearInterval(pingInterval);

        this.logger.info('3rd-party WS client disconnected');
      });
    });
  }
}
