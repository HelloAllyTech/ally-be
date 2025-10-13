import { Test, TestingModule } from '@nestjs/testing';
import { ChatEventConsumer } from '../chat.event.consumer';
import { ChatService } from '../../service/chat.service';
import { Chat } from '../../../common/entities/chat.entity';

describe('ChatEventConsumer', () => {
  let consumer: ChatEventConsumer;
  let chatService: jest.Mocked<ChatService>;

  const mockChat: Chat = {
    id: 1,
    counselorId: 1,
    clientId: 2,
    status: 'ENDED',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Chat;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatEventConsumer,
        {
          provide: ChatService,
          useValue: {
            handleChatEnded: jest.fn(),
          },
        },
      ],
    }).compile();

    consumer = module.get<ChatEventConsumer>(ChatEventConsumer);
    chatService = module.get(ChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleChatEnded', () => {
    it('should call chatService.handleChatEnded with the chat', async () => {
      chatService.handleChatEnded.mockResolvedValue(undefined);

      await consumer.handleChatEnded(mockChat);

      expect(chatService.handleChatEnded).toHaveBeenCalledWith(mockChat);
      expect(chatService.handleChatEnded).toHaveBeenCalledTimes(1);
    });

    it('should handle errors from chatService.handleChatEnded', async () => {
      const error = new Error('Handle chat ended failed');
      chatService.handleChatEnded.mockRejectedValue(error);

      await expect(consumer.handleChatEnded(mockChat)).rejects.toThrow(
        'Handle chat ended failed',
      );

      expect(chatService.handleChatEnded).toHaveBeenCalledWith(mockChat);
    });
  });
});
