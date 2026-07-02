export enum MessageBrokerChannel {
  CHAT_MESSAGE_WEBRTC = 'chat-message-WEBRTC',
  CHAT_MESSAGE_MICROPHONE = 'chat-message-MICROPHONE',
  CHAT_MESSAGE_CLOUD_TELEPHONY = 'chat-message-CLOUD_TELEPHONY',
  // Cross-replica request to finalize a live recording. The in-memory
  // recording state lives only on the replica that owns the WebSocket, but the
  // end-session request is load-balanced to any replica. When the ending
  // replica doesn't hold the stream, it broadcasts here so the replica that
  // does can finalize the upload (otherwise the audio is never persisted).
  MICROPHONE_STREAM_END = 'microphone-stream-end',
}
