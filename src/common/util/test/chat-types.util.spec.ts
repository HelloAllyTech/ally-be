import { findMessageBrokerChannelUsingProvider } from '../chat-types.util';
import { AudioChatProvider } from '../../constants/chat.constants';
import { MessageBrokerChannel } from '../../../message-broker/constants/message-broker.constants';

describe('ChatTypesUtil', () => {
  describe('findMessageBrokerChannelUsingProvider', () => {
    it('should return WEBRTC channel for WEBRTC provider', () => {
      const result = findMessageBrokerChannelUsingProvider(
        AudioChatProvider.WEBRTC,
      );

      expect(result).toBe(MessageBrokerChannel.CHAT_MESSAGE_WEBRTC);
    });

    it('should return MICROPHONE channel for MICROPHONE provider', () => {
      const result = findMessageBrokerChannelUsingProvider(
        AudioChatProvider.MICROPHONE,
      );

      expect(result).toBe(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE);
    });

    it('should return CLOUD_TELEPHONY channel for EXOTEL_CONFERENCE_CALL provider', () => {
      const result = findMessageBrokerChannelUsingProvider(
        AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      );

      expect(result).toBe(MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY);
    });

    it('should return CLOUD_TELEPHONY channel for OZONETEL provider', () => {
      const result = findMessageBrokerChannelUsingProvider(
        AudioChatProvider.OZONETEL,
      );

      expect(result).toBe(MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY);
    });

    it('should return null for unknown provider', () => {
      const result = findMessageBrokerChannelUsingProvider(
        'UNKNOWN' as AudioChatProvider,
      );

      expect(result).toBeNull();
    });
  });
});
