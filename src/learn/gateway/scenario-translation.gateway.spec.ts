import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioTranslationGateway } from './scenario-translation.gateway';
import { ScenarioTranslationNotificationService } from '../service/scenario-translation-notification.service';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import {
  ScenarioTranslationAction,
  ScenarioTranslationEvents,
  ScenarioTranslationStatus,
} from '../enum/scenario-translation.enum';
import { ScenarioTranslationProgressPayload } from '../type/scenario-translation-progress.type';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

describe('ScenarioTranslationGateway', () => {
  let gateway: ScenarioTranslationGateway;
  let notificationService: ScenarioTranslationNotificationService;
  let wsAuthMiddleware: { webSocketMiddleware: jest.Mock };

  const mockUser = { id: 42 };

  const samplePayload = (
    overrides: Partial<ScenarioTranslationProgressPayload> = {},
  ): ScenarioTranslationProgressPayload => ({
    jobId: 'job-1',
    scenarioId: 7,
    scenarioTitle: 'Test scenario',
    action: ScenarioTranslationAction.CREATE,
    status: ScenarioTranslationStatus.TRANSLATING,
    language: 'fr',
    completed: 0,
    total: 3,
    emittedAt: '2026-05-19T07:00:00.000Z',
    ...overrides,
  });

  beforeEach(async () => {
    wsAuthMiddleware = {
      webSocketMiddleware: jest.fn().mockReturnValue(() => undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioTranslationGateway,
        {
          provide: ScenarioTranslationNotificationService,
          useValue: new ScenarioTranslationNotificationService(),
        },
        {
          provide: WebSocketAuthMiddleware,
          useValue: wsAuthMiddleware,
        },
      ],
    }).compile();

    gateway = module.get<ScenarioTranslationGateway>(
      ScenarioTranslationGateway,
    );
    notificationService = module.get(ScenarioTranslationNotificationService);

    gateway['server'] = {
      use: jest.fn(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;

    gateway['afterInit'](gateway['server']);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('afterInit', () => {
    it('should register auth middleware with EDIT_SCENARIO permission', () => {
      expect(wsAuthMiddleware.webSocketMiddleware).toHaveBeenCalledWith([
        PERMISSIONS.EDIT_SCENARIO,
      ]);
      expect(gateway['server'].use).toHaveBeenCalled();
    });
  });

  describe('handleConnection', () => {
    it('should emit CONNECTED to authenticated client', async () => {
      const client = {
        id: 'client-1',
        data: { user: mockUser },
        emit: jest.fn(),
        disconnect: jest.fn(),
        on: jest.fn(),
      };

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith(
        ScenarioTranslationEvents.CONNECTED,
        expect.objectContaining({ userId: 42 }),
      );
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect unauthenticated client', async () => {
      const client = {
        id: 'client-2',
        data: {},
        emit: jest.fn(),
        disconnect: jest.fn(),
        on: jest.fn(),
      };

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleJoinUserTranslationsRoom', () => {
    it('should join user:{userId} room for authenticated client', async () => {
      const client = {
        id: 'client-1',
        data: { user: mockUser },
        join: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn(),
      };

      await gateway.handleJoinUserTranslationsRoom(client);

      expect(client.join).toHaveBeenCalledWith('user:42');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect client when user is missing', async () => {
      const client = {
        id: 'client-2',
        data: {},
        join: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleJoinUserTranslationsRoom(client);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('notification listener (TRANSLATION_PROGRESS broadcast)', () => {
    it('should broadcast TRANSLATION_PROGRESS to the user room when notifyProgress is called', () => {
      const payload = samplePayload();

      notificationService.notifyProgress(42, payload);

      expect(gateway['server'].to).toHaveBeenCalledWith('user:42');
      expect(gateway['server'].to('user:42').emit).toHaveBeenCalledWith(
        ScenarioTranslationEvents.TRANSLATION_PROGRESS,
        payload,
      );
    });

    it('should target the correct room when userId differs', () => {
      const payload = samplePayload();

      notificationService.notifyProgress(100, payload);

      expect(gateway['server'].to).toHaveBeenCalledWith('user:100');
    });

    it('should forward all status types unchanged', () => {
      const statuses = [
        ScenarioTranslationStatus.STARTED,
        ScenarioTranslationStatus.TRANSLATING,
        ScenarioTranslationStatus.TRANSLATED,
        ScenarioTranslationStatus.LANGUAGE_FAILED,
        ScenarioTranslationStatus.COMPLETED,
        ScenarioTranslationStatus.FAILED,
      ];

      for (const status of statuses) {
        const payload = samplePayload({ status });
        notificationService.notifyProgress(42, payload);
        expect(gateway['server'].to('user:42').emit).toHaveBeenCalledWith(
          ScenarioTranslationEvents.TRANSLATION_PROGRESS,
          payload,
        );
      }
    });
  });

  describe('handleDisconnect', () => {
    it('should not throw when client disconnects', () => {
      expect(() =>
        gateway.handleDisconnect({ id: 'client-1' } as any),
      ).not.toThrow();
    });
  });
});
