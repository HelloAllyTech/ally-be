import * as WebSocket from 'ws';
export interface AudioIngestInterface {
  startCall(msg: any, ws: WebSocket): Promise<void>;
  endCall(clientId: string): Promise<void>;
  handleAudioMessage(msg: any): Promise<void>;
  handleStreamEvent(messageData: any, ws: WebSocket): Promise<void>;
  handleConnectionAlive(ws: WebSocket, messageData: any): void;
}
