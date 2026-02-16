import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioReportGateway } from './scenario-report.gateway';
import { ScenarioReportService } from '../service/scenario-report.service';
import { ScenarioReportNotificationService } from '../service/scenario-report-notification.service';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import {
  ScenarioReportEvents,
  ScenarioReportRoomTypes,
} from '../enum/scenario-report.enum';

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

describe('ScenarioReportGateway', () => {
  let gateway: ScenarioReportGateway;
  let scenarioReportService: jest.Mocked<ScenarioReportService>;
  let scenarioReportNotificationService: ScenarioReportNotificationService;

  const mockUser = { id: 42 };
  const mockReportId = 'report-uuid-1';
  const mockReports = { data: [{ id: mockReportId }], count: 1 };
  const mockReport = { id: mockReportId, scenarioId: 1, status: 'COMPLETED' };

  beforeEach(async () => {
    const mockScenarioReportService = {
      getFilteredScenarioReports: jest.fn().mockResolvedValue(mockReports),
      getScenarioReportById: jest.fn().mockResolvedValue(mockReport),
    };

    const mockWsAuthMiddleware = {
      webSocketMiddleware: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioReportGateway,
        {
          provide: ScenarioReportService,
          useValue: mockScenarioReportService,
        },
        {
          provide: ScenarioReportNotificationService,
          useValue: new ScenarioReportNotificationService(),
        },
        {
          provide: WebSocketAuthMiddleware,
          useValue: mockWsAuthMiddleware,
        },
      ],
    }).compile();

    gateway = module.get<ScenarioReportGateway>(ScenarioReportGateway);
    scenarioReportService = module.get(ScenarioReportService);
    scenarioReportNotificationService = module.get(
      ScenarioReportNotificationService,
    );

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

  describe('handleJoinUserReportsRoom', () => {
    it('should join user room, store session with USER roomType and lookbackMinutes, and emit initial reports to client', async () => {
      const client = {
        id: 'client-1',
        data: { user: mockUser },
        join: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleJoinUserReportsRoom(client, {
        lookbackMinutes: 30,
      });

      expect(client.join).toHaveBeenCalledWith('user:42');
      expect(
        scenarioReportService.getFilteredScenarioReports,
      ).toHaveBeenCalledWith(42, 30);
      expect(client.emit).toHaveBeenCalledWith(
        ScenarioReportEvents.REPORTS_UPDATED,
        mockReports,
      );

      const session = gateway['sessions'].get('client-1');
      expect(session).toEqual({
        userId: 42,
        clientId: 'client-1',
        roomType: ScenarioReportRoomTypes.USER,
        lookbackMinutes: 30,
      });
    });

    it('should call getFilteredScenarioReports without lookbackMinutes when not provided', async () => {
      const client = {
        id: 'client-2',
        data: { user: mockUser },
        join: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleJoinUserReportsRoom(client, {});

      expect(
        scenarioReportService.getFilteredScenarioReports,
      ).toHaveBeenCalledWith(42, undefined);
      const session = gateway['sessions'].get('client-2');
      expect(session?.lookbackMinutes).toBeUndefined();
    });

    it('should disconnect client when user is missing', async () => {
      const client = {
        id: 'client-3',
        data: {},
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleJoinUserReportsRoom(client, { lookbackMinutes: 60 });

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(
        scenarioReportService.getFilteredScenarioReports,
      ).not.toHaveBeenCalled();
    });
  });

  describe('handleJoinReportRoom', () => {
    it('should join report room, store session with REPORT roomType and reportId, and emit initial report to client', async () => {
      const client = {
        id: 'client-1',
        data: { user: mockUser },
        join: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleJoinReportRoom(client, { reportId: mockReportId });

      expect(client.join).toHaveBeenCalledWith('report:report-uuid-1');
      expect(scenarioReportService.getScenarioReportById).toHaveBeenCalledWith(
        mockReportId,
      );
      expect(client.emit).toHaveBeenCalledWith(
        ScenarioReportEvents.REPORTS_UPDATED,
        mockReport,
      );

      const session = gateway['sessions'].get('client-1');
      expect(session).toEqual({
        userId: 42,
        clientId: 'client-1',
        roomType: ScenarioReportRoomTypes.REPORT,
        reportId: mockReportId,
      });
    });

    it('should disconnect client when user is missing', async () => {
      const client = {
        id: 'client-2',
        data: {},
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleJoinReportRoom(client, { reportId: mockReportId });

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(
        scenarioReportService.getScenarioReportById,
      ).not.toHaveBeenCalled();
    });
  });

  describe('handleReportUpdated (via notification listener)', () => {
    it('should broadcast filtered reports to user room when user has USER session with lookbackMinutes', async () => {
      gateway['sessions'].set('client-1', {
        userId: 42,
        clientId: 'client-1',
        roomType: ScenarioReportRoomTypes.USER,
        lookbackMinutes: 60,
      });

      scenarioReportNotificationService.notifyUpdate(42, mockReportId);

      await new Promise((r) => setImmediate(r));

      expect(
        scenarioReportService.getFilteredScenarioReports,
      ).toHaveBeenCalledWith(42, 60);
      expect(gateway['server'].to).toHaveBeenCalledWith('user:42');
      expect(gateway['server'].to('user:42').emit).toHaveBeenCalledWith(
        ScenarioReportEvents.REPORTS_UPDATED,
        mockReports,
      );
    });

    it('should broadcast report to report room when report has REPORT subscribers', async () => {
      gateway['sessions'].set('client-2', {
        userId: 42,
        clientId: 'client-2',
        roomType: ScenarioReportRoomTypes.REPORT,
        reportId: mockReportId,
      });

      scenarioReportNotificationService.notifyUpdate(42, mockReportId);

      await new Promise((r) => setImmediate(r));

      expect(scenarioReportService.getScenarioReportById).toHaveBeenCalledWith(
        mockReportId,
      );
      expect(gateway['server'].to).toHaveBeenCalledWith('report:report-uuid-1');
      expect(
        gateway['server'].to('report:report-uuid-1').emit,
      ).toHaveBeenCalledWith(ScenarioReportEvents.REPORTS_UPDATED, mockReport);
    });

    it('should use correct room names: user:userId and report:reportId', async () => {
      gateway['sessions'].set('c1', {
        userId: 100,
        clientId: 'c1',
        roomType: ScenarioReportRoomTypes.USER,
        lookbackMinutes: 30,
      });
      gateway['sessions'].set('c2', {
        userId: 100,
        clientId: 'c2',
        roomType: ScenarioReportRoomTypes.REPORT,
        reportId: 'r-99',
      });

      scenarioReportNotificationService.notifyUpdate(100, 'r-99');

      await new Promise((r) => setImmediate(r));

      expect(gateway['server'].to).toHaveBeenCalledWith('user:100');
      expect(gateway['server'].to).toHaveBeenCalledWith('report:r-99');
    });
  });

  describe('handleDisconnect', () => {
    it('should remove client session on disconnect', () => {
      gateway['sessions'].set('client-1', {
        userId: 42,
        clientId: 'client-1',
        roomType: ScenarioReportRoomTypes.USER,
      });

      gateway.handleDisconnect({ id: 'client-1' } as any);

      expect(gateway['sessions'].has('client-1')).toBe(false);
    });
  });
});
