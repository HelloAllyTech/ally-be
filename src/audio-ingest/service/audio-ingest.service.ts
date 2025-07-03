import * as WebSocket from 'ws';
import { Inject, Injectable, Query } from '@nestjs/common';
import { OzonetelService } from './ozonetel.service';
import { AudioIngestInterface } from '../interface/audio-ingest.interface';
@Injectable()
export class AudioIngestService {
  constructor(
    private readonly ozonetelService: OzonetelService,
    @Inject('AudioIngestInterface')
    private readonly audioIngestInterface: AudioIngestInterface,
  ) {}

  initiateOzonetel(@Query() query: any) {
    return this.ozonetelService.initiateOzonetel(query);
  }

  startCall(msg: any, ws: WebSocket): Promise<void> {
    return this.audioIngestInterface.startCall(msg, ws);
  }

  handleAudioMessage(msg: any, ws: WebSocket) {
    return this.audioIngestInterface.handleAudioMessage(msg, ws);
  }

  endCall(clientId: string): Promise<void> {
    return this.audioIngestInterface.endCall(clientId);
  }

  handleStreamEvent(messageData: any, ws: WebSocket) {
    return this.audioIngestInterface.handleStreamEvent(messageData, ws);
  }

  handleConnectionAlive(ws: WebSocket, messageData: any) {
    return this.audioIngestInterface.handleConnectionAlive(ws, messageData);
  }
}
