import { AudioChatProvider } from '../constants/chat.constants';
import { MessageBrokerChannel } from '../constants/message-broker.constants';

export function findMessageBrokerChannelUsingProvider(
  provider: AudioChatProvider,
) {
  switch (provider) {
    case AudioChatProvider.WEBRTC:
      return MessageBrokerChannel.CHAT_MESSAGE_WEBRTC;
    case AudioChatProvider.MICROPHONE:
      return MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE;
    case AudioChatProvider.EXOTEL_CONFERENCE_CALL:
      return MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY;
    default:
      return null;
  }
}
